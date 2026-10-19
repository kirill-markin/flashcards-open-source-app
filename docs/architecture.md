# Architecture

## System overview

```
Web browser          -> Cloudflare -> app.<domain>   -> CloudFront + S3 web SPA
Admin browser        -> Cloudflare -> admin.<domain> -> CloudFront + S3 admin SPA
Browser/native auth  -> Cloudflare -> auth.<domain>  -> API Gateway -> Auth Lambda -> Cognito
Web/iOS/Android API  -> Cloudflare -> api.<domain>   -> API Gateway -> backend Lambda -> Postgres
AI chat              -> api.<domain> backend Lambda -> detached chat worker Lambda -> model provider APIs
MCP clients          -> Cloudflare -> mcp.<domain>   -> API Gateway -> MCP Lambda -> Postgres
Agent bootstrap      -> Cloudflare -> auth.<domain>  -> Auth Lambda -> Cognito EMAIL_OTP -> API key
Apex fallback        -> Cloudflare -> <domain>       -> CloudFront redirect -> app.<domain>
```

- `app.<domain>` serves the web SPA from `apps/web`, and `admin.<domain>` the admin SPA from `apps/admin`; both derive their API and auth hosts from the current hostname.
- `auth.<domain>` (`apps/auth`) owns sign-in: email OTP, Apple and Google, session and token refresh, agent OTP bootstrap and the OAuth authorization server for MCP.
- `api.<domain>` (`apps/backend`) serves the human app API, sync, AI chat and the machine-facing agent API; `mcp.<domain>/mcp` serves the same tool inventory over MCP.
- The apex `<domain>` is an optional CloudFront redirect to `app.<domain>`.

The CDK app in [`infra/aws`](../infra/aws/README.md) provisions all of it, including networking, the database, monitoring, backups and CI/CD roles; [`api-gateway.ts`](../infra/aws/lib/gateways/api-gateway.ts) and [`auth-gateway.ts`](../infra/aws/lib/gateways/auth-gateway.ts) show which Lambdas sit behind each host. The backend, auth and migration Lambdas run in the VPC; Postgres (RDS) sits in private subnets.

## Database roles

- The migration runner connects as the database owner and is the only component that applies schema migrations and views; it then configures the runtime role passwords.
- `backend_app` is the runtime role for `apps/backend`; its row-level-security policies are the canonical runtime policies for app data in `org`, `content`, and `sync`.
- `auth_app` is the narrower runtime role for `apps/auth`, limited to the auth and bootstrap paths.
- `reporting_readonly` is the read-only role for admin reports and operators ([analytics DB access](analytics-db-access.md)).
- Older migrations still mention the removed shared `app` role; it is not a runtime role, and new migrations must not depend on it.

## Authentication model

- Production auth verifies Cognito ID tokens; local dev can run with `AUTH_MODE=none` ([`.env.example`](../.env.example)). The account id is a product-owned surrogate, not the Cognito subject ([auth service](auth-service.md)).
- Browser sign-in ends with signed session cookies on the shared cookie domain plus session refresh; native clients receive tokens in JSON and refresh them through the auth service.
- Agents authenticate through the auth service's OTP endpoints and receive a long-lived API key (`Authorization: ApiKey ...`) that stores its own selected workspace, independent of the human session selection. MCP clients use OAuth against the same auth host.
- The backend always runs request auth before loading app data, and the first authenticated request provisions the account's profile and a selected workspace ([`ensureUser.ts`](../apps/backend/src/auth/ensureUser.ts)).

## Client storage

Each client keeps its local source of truth and syncs it: the web app in IndexedDB, iOS and Android in SQLite. The web app loads `/me`, resolves the selected workspace and persists cloud-link metadata locally before it syncs.

## Offline-first sync

The sync contract is the same across web, iOS, and Android:

1. Write locally first.
2. Add a record to the local outbox.
3. Push pending operations to `POST /v1/workspaces/:workspaceId/sync/push`.
4. Bootstrap hot current state from `POST /v1/workspaces/:workspaceId/sync/bootstrap` when the workspace has not been hydrated locally yet.
5. Pull hot-state deltas from `POST /v1/workspaces/:workspaceId/sync/pull`.
6. Pull append-only review history from `POST /v1/workspaces/:workspaceId/sync/review-history/pull` in the background.
7. Advance the local hot/history cursors and clear only acknowledged outbox rows.

Implemented sync behavior:

- Operations are scoped to a workspace and an installation's workspace replica ([sync identity model](sync-identity-model.md)).
- Push is idempotent through `sync.applied_operations_current` and processed in batches rather than one transaction per operation.
- Cards, decks, and workspace scheduler settings resolve conflicts last-writer-wins ([`lww.ts`](../apps/backend/src/sync/conflicts/lww.ts)).
- Review events are append-only and deduplicated by `(workspace_id, replica_id, client_event_id)`. Live and historical submissions both use the normal push contract; for `review_event` operations, `clientUpdatedAt` must equal `payload.reviewedAtClient`.
- Mutable state and review history sync through separate lanes with separate local cursors: hot mutable roots use `sync.hot_changes` plus direct materialization from canonical tables, and review history uses `content.review_events.review_sequence`.
- Progress, streaks, and chart day buckets are derived from `content.review_events.reviewed_at_client` in the requested timezone, not from server ingest time.

### Client media transfer

Client card content and media byte transfer are intentionally separate:

- Card Markdown references media as `fcasset:<mediaAssetId>`. A card references a workspace-scoped `content.media_assets` row, which enforces access and points to a deduplicated backend-internal `content.media_blobs` row.
- Clients read `media_assets` rows through sync pull/bootstrap when they opt into `includeMediaAssets`, but create or update them only through the media upload API, never the JSON sync outbox.
- File bytes move only through short-lived signed upload/download URLs the backend authorizes. They are transport credentials, not persisted user content; public CDN delivery is a possible later optimization.
- Upload/download queue rows and a local cache keyed by blob `sha256` are local operational state and are not synced as user content.

## Scheduling architecture

- FSRS state is persisted on the card row and the workspace scheduler settings. Review submission is compute-on-write (append the review event, recompute and store the card schedule, emit sync changes); review eligibility is compute-on-read. There is no background scheduler worker.
- Backend, iOS, and Android maintain mirrored scheduling logic; the web app reuses the backend module [`apps/backend/src/scheduling`](../apps/backend/src/scheduling/index.ts) directly. The rules are in [FSRS scheduling logic](fsrs-scheduling-logic.md).

## AI chat architecture

- Chat is server-owned: the backend owns session ids, run state, transcript history, run execution, cancellation, and recovery, stored in Postgres under the `ai` schema. Every first-party client uses the same backend surface ([`handlers.ts`](../apps/backend/src/chat/http/handlers.ts), [`contract.ts`](../apps/backend/src/chat/http/contract.ts)).
- `POST /v1/chat` creates a persisted run and asynchronously dispatches the detached worker; `GET /v1/chat` reads the persisted snapshot and is the canonical recovery path for run progress.
- A chat attachment is a file of its session: bytes in the media assets bucket, a row in `ai.chat_files`, and a reference in the transcript ([`chatFiles`](../apps/backend/src/chatFiles/index.ts)).
- The model-facing tools come from the shared agent tool registry, apart from the generated-image tool the chat appends itself for a signed-in run ([agent tool surfaces](agent-tool-surfaces.md)).

## Agent API architecture

The machine-facing API is intentionally narrower than the human app API. Discovery starts at `GET /v1/` (also `GET /v1/agent`); the route list is [`routes/agent.ts`](../apps/backend/src/routes/agent.ts) plus the discovery and document-probe routes in [`routes/system/index.ts`](../apps/backend/src/routes/system/index.ts), and how the routes relate to MCP and the in-app chat is [agent tool surfaces](agent-tool-surfaces.md). The SQL dialect is not full PostgreSQL but a constrained contract implemented in `apps/backend/src/aiTools`.

## Security model

- Cloudflare is the public DNS and edge TLS layer; RDS is private and reachable only from the VPC; Lambda functions connect with dedicated security groups and per-service secrets.
- Browser session-authenticated unsafe API requests require CSRF validation plus allowed-origin checks. The backend derives the CSRF token from the session JWT with a dedicated secret, so CSRF needs no database state.
- PostgreSQL row-level security is enabled for the runtime tables, and backend and auth access is scoped through the runtime roles plus `app.user_id` and `app.workspace_id` session settings.

## Decisions

- One monorepo keeps shared API contracts and the data model together, makes coordinated backend/mobile changes easier, and lowers operational overhead at this stage.
- Postgres is the primary backend database because flashcards data is relational (workspaces, cards, review events, sync metadata), transactions and consistency matter, and schema and query evolution for scheduling, stats, and filtering is simpler than with DynamoDB.
