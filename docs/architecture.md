# Architecture

## System overview

```
Web browser         -> Cloudflare -> app.<domain>  -> CloudFront + S3 web SPA
Browser auth        -> Cloudflare -> auth.<domain> -> API Gateway -> Auth Lambda -> Cognito EMAIL_OTP
iOS app             -> Cloudflare -> auth.<domain> -> API Gateway -> Auth Lambda -> Cognito EMAIL_OTP
iOS + web sync/API  -> Cloudflare -> api.<domain>  -> API Gateway -> Lambda backend -> Postgres
AI chat streaming   -> Cloudflare -> api.<domain>  -> API Gateway -> streaming Lambda -> model provider APIs
Agent bootstrap     -> Cloudflare -> auth.<domain> -> API Gateway -> Auth Lambda -> Cognito EMAIL_OTP -> API key
Apex fallback       -> Cloudflare -> <domain>      -> CloudFront redirect -> app.<domain>
```

The repository currently implements three public service surfaces:

- `app.<domain>` for the web SPA in `apps/web`
- `auth.<domain>` for OTP login, session refresh, token refresh, and agent OTP bootstrap in `apps/auth`
- `api.<domain>` for the main backend, sync API, AI chat transport, and the machine-facing agent API in `apps/backend`

The apex `<domain>` is an optional CloudFront redirect to `app.<domain>`.

## Monorepo shape

- `apps/backend`: Hono backend for human clients and agents
- `apps/auth`: Hono auth service for browser, native, and agent OTP flows
- `apps/web`: React + Vite web app with IndexedDB local storage
- `apps/ios`: SwiftUI iOS app with SQLite local storage
- `api`: published OpenAPI source used by the backend and agent docs
- `db/migrations`: PostgreSQL schema, security, and runtime-role migrations
- `db/views`: SQL views applied after migrations
- `infra/aws`: CDK stack for networking, database, auth, API, web hosting, CI/CD, backups, and monitoring
- `infra/docker`: local migration container assets

## Deployment architecture

### Web

- `infra/aws/lib/web.ts` deploys the web app to S3 behind CloudFront.
- SPA routing is handled by serving `index.html` for `403` and `404`.
- The web app derives `api.<domain>/v1` and `auth.<domain>` from the current hostname unless local overrides are provided.

### Auth service

- `infra/aws/lib/auth-gateway.ts` deploys a dedicated API Gateway + Lambda for auth.
- The auth Lambda runs in the VPC, reads its own DB secret, and talks to Cognito.
- Browser and native sign-in use the same passwordless email OTP foundation, but different session handling:
  - Web uses signed cookies plus session refresh.
  - iOS receives tokens in JSON and stores refresh credentials locally.
  - Agents use a separate OTP bootstrap flow that ends with a long-lived API key.

### Backend API

- `infra/aws/lib/api-gateway.ts` deploys the main API Gateway and two Lambda entrypoints:
  - a buffered backend Lambda for normal JSON endpoints
  - a dedicated streaming Lambda for `/chat/turn`
- The backend Lambda runs in the VPC, reads the backend DB secret, verifies Cognito ID tokens, and can optionally read model-provider secrets.
- API Gateway predeclares the public route tree, including agent, workspace, sync, cards, chat, and system routes.

### Database and operations

- `infra/aws/lib/database.ts` deploys PostgreSQL 18 on RDS in private subnets.
- A separate migration runner Lambda applies SQL migrations and views, then configures runtime role passwords for `backend_app` and `auth_app`.
- Monitoring, backups, and CI/CD are provisioned from the same CDK stack.

## Backend runtime structure

`apps/backend/src/app.ts` mounts six route groups:

- `system`: discovery, health, OpenAPI, session/account inspection, account deletion
- `agent`: machine-facing discovery, workspace bootstrap, SQL endpoint, and agent OpenAPI documents
- `workspaces`: list/create/select workspaces and manage agent API key connections from human sessions
- `cards`: card query and tag summary endpoints
- `chat`: streaming AI chat turn, transcription, and diagnostics endpoints
- `sync`: offline-first push and pull endpoints

The backend is Hono-based in local dev and in Lambda. In local dev it serves on `http://localhost:8080/v1`.

## Client architecture

### Web app

- React 19 SPA in `apps/web`
- Local source of truth is IndexedDB, not the network
- IndexedDB stores:
  - `cards`
  - `cardTags`
  - `decks`
  - `reviewEvents`
  - `workspaceSettings`
  - `outbox`
  - `meta`
- The app loads `/me`, resolves the selected workspace, persists cloud-link metadata locally, then syncs
- Browser auth recovery is automatic through `POST /api/refresh-session` on the auth host

### iOS app

- SwiftUI app in `apps/ios`
- Local source of truth is SQLite via `LocalDatabase`
- Persistence is split into dedicated stores such as `CardStore`, `DeckStore`, `OutboxStore`, `SyncApplier`, and `WorkspaceSettingsStore`
- Cloud linking stores Cognito refresh credentials locally and refreshes ID tokens through the auth service
- The iOS app mirrors backend FSRS scheduling and local AI-tool behavior closely

## Authentication model

### Human users

- Production auth mode is Cognito ID-token verification.
- Local dev can run with `AUTH_MODE=none`.
- Browser login flow:
  1. `POST /api/send-code` on `auth.<domain>`
  2. `POST /api/verify-code`
  3. auth service sets signed browser session cookies
  4. web app calls `GET /v1/me`
- Native login flow:
  1. `POST /api/send-code`
  2. `POST /api/verify-code`
  3. auth service returns `idToken` and `refreshToken` in JSON
  4. iOS refreshes through `POST /api/refresh-token`

### Agents

- `GET /v1/` and `GET /v1/agent` return the machine discovery envelope.
- Agents authenticate through auth-service OTP endpoints:
  - `POST /api/agent/send-code`
  - `POST /api/agent/verify-code`
- Successful agent verification creates a long-lived API key stored in `auth.agent_api_keys`.
- Agent requests use `Authorization: ApiKey ...`.
- Each API key stores its own selected workspace, independent of the human session selection.

### User bootstrap

- The backend always runs request auth before loading app data.
- The first authenticated human request auto-provisions:
  - `org.user_settings`
  - a default `Personal` workspace if none exists
  - the selected workspace pointer
- Agent API keys also auto-provision or auto-select a workspace when possible.

## Data model

The Postgres schema is split by responsibility:

- `org`: users, workspaces, memberships, user settings
- `content`: cards, decks, review events
- `sync`: devices, applied operations, global change feed
- `auth`: agent OTP challenges, API keys, OTP rate-limit state, deleted subjects
- `security`: helpers for runtime database context

Important tables and responsibilities:

- `org.user_settings`: human profile metadata and selected workspace
- `org.workspaces`: workspace metadata and persisted FSRS scheduler settings
- `org.workspace_memberships`: workspace access control
- `content.cards`: card state, including persisted FSRS fields
- `content.decks`: saved deck filters
- `content.review_events`: append-only review history
- `sync.devices`: known client devices per workspace
- `sync.applied_operations`: idempotency table for pushed operations
- `sync.changes`: ordered workspace change feed consumed by pull sync
- `auth.agent_api_keys`: long-lived terminal/agent connections

## Offline-first sync

The sync contract is the same across web and iOS:

1. Write locally first.
2. Add a record to the local outbox.
3. Push pending operations to `POST /v1/workspaces/:workspaceId/sync/push`.
4. Pull ordered remote changes from `POST /v1/workspaces/:workspaceId/sync/pull`.
5. Apply pulled changes locally.
6. Advance the local sync cursor and clear acknowledged outbox rows.

Implemented sync behavior:

- Operations are scoped to a workspace and device.
- Push is idempotent through `sync.applied_operations`.
- Cards, decks, and workspace scheduler settings use last-writer-wins metadata:
  - `clientUpdatedAt`
  - `lastModifiedByDeviceId`
  - `lastOperationId`
- Review events are append-only and deduplicated by `(workspace_id, device_id, client_event_id)`.
- The server records every applied mutation in `sync.changes`, then clients read that ordered feed with `afterChangeId`.

## Scheduling architecture

- FSRS scheduling is persisted on the card row and workspace scheduler settings.
- Review submission is compute-on-write:
  - append a review event
  - recompute the card schedule
  - update the card snapshot
  - emit sync changes
- Review visibility is compute-on-read with `due_at <= now()`.
- Backend and iOS maintain mirrored scheduling logic and state validation.

There is no separate background scheduler worker.

## AI chat architecture

The app uses backend-executed AI chat:

- The model call is remote and goes through `POST /v1/chat/turn`.
- The response is streamed over SSE from the dedicated streaming Lambda.
- Available model vendors are OpenAI and Anthropic.
- Shared workspace data access is intentionally normalized around one SQL tool contract.
- The backend executes AI chat tools and continues provider loops internally.
- Web and iOS act as stream plus sync clients and do not execute chat tools locally.

## Agent API architecture

The machine-facing API is intentionally narrower than the human app API:

- discovery at `GET /v1/` and `GET /v1/agent`
- account context at `GET /v1/agent/me`
- workspace listing and bootstrap at `GET/POST /v1/agent/workspaces`
- workspace selection at `POST /v1/agent/workspaces/{workspaceId}/select`
- SQL reads and writes at `POST /v1/agent/sql`
- published docs at `GET /v1/agent/openapi.json` and `GET /v1/agent/swagger.json`

The SQL dialect is not full PostgreSQL. It is a constrained contract implemented in `apps/backend/src/aiTools`.

## Security model

- Cloudflare is the public DNS and edge TLS layer.
- RDS is private and reachable only from the VPC.
- Lambda functions connect with dedicated security groups and per-service secrets.
- Browser OTP state is HMAC-signed and expires after 3 minutes.
- Browser session-authenticated unsafe API requests require CSRF validation plus allowed-origin checks.
- The backend derives the browser CSRF token from the session JWT using a dedicated secret, so it does not need extra CSRF database state.
- PostgreSQL row-level security is enabled for the runtime tables.
- Backend and auth DB access is scoped through runtime roles plus `app.user_id` and `app.workspace_id` session settings.

## Local development entrypoints

- web: `http://localhost:3000`
- backend: `http://localhost:8080/v1`
- auth: `http://localhost:8081`

These local URLs are wired into the app config and the agent/auth discovery helpers.
