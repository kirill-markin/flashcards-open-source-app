# flashcards-open-source-app

Open-source, offline-first flashcards platform.

- Domain: `flashcards-open-source-app.com`
- Repository: `kirill-markin/flashcards-open-source-app`
- Product stage: early development

## Product Direction

Build a practical Anki-like alternative focused on fast mobile UX, offline-first behavior, and transparent open-source architecture.

## Platform Plan

- Backend: AWS
- Web app: supported
- iOS app: Swift (priority)
- Android app: planned later
- Terminal / AI-agent API client: supported via the canonical machine API entrypoint `GET https://api.flashcards-open-source-app.com/v1/` (the same discovery payload is also available at `GET https://api.flashcards-open-source-app.com/v1/agent`)

We support the web app, the iOS app, and the terminal-first AI-agent API flow. When making changes, we try to keep all supported clients aligned where relevant.
The iOS Xcode project is file-synchronized, so new Swift files can be added without manual `project.pbxproj` edits.
Running iOS tests is a heavy operation, so do not run them automatically and only run them after the user explicitly agrees.
If iOS tests are explicitly requested, run them only on one specific simulator image confirmed with the user or already available locally, and do not trigger extra runtime downloads automatically.
For iOS, `My Mac` can be used only for iOS compile smoke-checks such as `build` or `build-for-testing`, not as a reliable destination for app-hosted unit tests.

## Repository Strategy

Use a single monorepo for now because it keeps shared API contracts and the data model together, makes coordinated backend/mobile changes easier, and lowers operational overhead at this stage.

## Architecture

- Source of truth: Postgres in AWS
- Mobile local database: SQLite on device
- Sync model: offline-first synchronization via API

## Database Decision

Use Postgres as the primary backend database because flashcards data is relational (workspaces, cards, review events, sync metadata), transactions/consistency matter, and schema/query evolution for scheduling, stats, and filtering is simpler than with DynamoDB as primary.

## Offline-First Sync Rules

- Read and write locally to SQLite first.
- Queue local writes in an `outbox`.
- When connectivity returns:
  1. push pending operations to the backend (idempotent by operation id)
  2. pull remote changes since the last sync cursor
  3. apply updates locally
  4. advance the sync cursor and clear acknowledged outbox rows

## Data Modeling Notes

- Prefer UUID/ULID identifiers for offline entity creation.
- Include `updated_at` and `deleted_at` for sync and tombstones.
- Keep review history append-only where possible.
- Do not hide sync failures behind fallback logic.

## Planned Monorepo Shape

`apps/{backend,ios,android}`, `db/{migrations,views,queries}`, `infra/{docker,aws}`, `api/openapi.yaml`, `docs/`, `scripts/`

## Auth Service (`apps/auth/`)

Email + OTP authentication via AWS Cognito (passwordless).

- `AUTH_MODE`: `none` (local dev, no auth) or `cognito` (verify JWT from `Authorization: Bearer`)
- Auth Lambda serves the auth UI/API on `auth.<domain>` and `/v1` execute-api stage paths
- Backend Lambda verifies JWTs with `aws-jwt-verify`
- Key files:
  - `apps/auth/src/app.ts`: shared Hono app factory
  - `apps/auth/src/lambda.ts`: Lambda entry point
  - `apps/auth/src/routes/`: `sendCode`, `verifyCode`, `refreshToken`, `revokeToken`, `loginPage`, `health`
  - `apps/auth/src/server/cognitoAuth.ts`: Cognito API client
  - `apps/backend/src/auth.ts`: JWT verification middleware
  - `apps/backend/src/ensureUser.ts`: auto-provisions `user_settings` and `workspace` on first request
  - `infra/aws/lib/auth.ts`: CDK Cognito User Pool construct
  - `db/migrations/0002_user_settings.sql`: `user_settings` table

## Engineering Principles

- Keep logic simple and explicit.
- Prefer pure functions for domain logic.
- Use strict typing across services.
- Keep changes minimal and scoped.
- Machine API documentation is intentionally duplicated across the discovery envelope (`actions` and `instructions`) and the published specs (`/v1/openapi.json`, `/v1/swagger.json`, `api/openapi.yaml`). When changing the machine API, keep all of these in sync in the same change.
- Flashcard side contract is mandatory across all clients and APIs: `frontText` is only a question/review prompt (never the answer), and `backText` contains the answer (optionally with a concrete example, preferably in a fenced markdown code block when helpful).
- In the iOS app, every user tap should trigger immediate Apple-standard UI feedback, with background loading shown in place or on the next surface, failed actions restoring the previous state, and successful actions clearly exposing the next step.
- Always mention the schema explicitly in migrations.
- When adding, removing, or renaming backend HTTP routes, update `infra/aws/lib/api-gateway.ts` in the same change so API Gateway stays in sync.
- Prioritize clear, actionable errors.

We do not support backward compatibility. Instead, we migrate old data and aim to keep only one correct solution working, avoiding the accumulation of legacy behavior.

Card reappearance and FSRS scheduling logic are documented in `docs/fsrs-scheduling-logic.md`.
