# flashcards-open-source-app

Open-source, offline-first flashcards platform.

- Domain: `flashcards-open-source-app.com`
- Repository: `kirill-markin/flashcards-open-source-app`
- Product stage: early development

## Product Direction

Build a practical Anki-like alternative focused on:
- Fast mobile UX
- Offline-first behavior
- Transparent open-source architecture

## Platform Plan

- Backend: AWS
- iOS app: Swift (priority)
- Android app: planned later

## Repository Strategy

Use a single monorepo for now.

Reasons:
- Shared API contracts and data model in one place
- Easier coordinated changes across backend and mobile
- Lower operational overhead at early stage

## High-Level Architecture

- Source of truth: Postgres in AWS
- Mobile local database: SQLite on device
- Sync model: offline-first synchronization via API

## Database Decision

Use Postgres as the backend primary database.

Why Postgres (vs DynamoDB as primary):
- Natural fit for relational flashcards data (workspaces, cards, review events, sync metadata)
- Strong transactions and consistency
- Easier evolution of schema and query patterns for scheduling, stats, and filtering

## Offline-First Sync Rules

- App reads/writes to local SQLite first
- Local writes are queued in an `outbox`
- On connectivity restore:
  1. push pending operations to backend (idempotent by operation id)
  2. pull remote changes since last sync cursor
  3. apply updates locally
  4. advance sync cursor and clear acknowledged outbox rows

## Data Modeling Notes

- Prefer UUID/ULID identifiers to support offline entity creation
- Include `updated_at` and `deleted_at` for sync and tombstones
- Keep review history append-only where possible
- Avoid hidden fallback logic in sync: either succeed or fail with explicit errors

## Initial Monorepo Shape (planned)

```text
apps/
  backend/
  ios/
  android/
db/
  migrations/
  views/
  queries/
infra/
  docker/
  aws/
api/
  openapi.yaml
docs/
scripts/
```

## Auth Service (`apps/auth/`)

Email + OTP authentication via AWS Cognito (passwordless).

- `AUTH_MODE` env var: `none` (local dev, no auth) or `cognito` (verify JWT from `Authorization: Bearer` header)
- Auth Lambda handles auth UI/API on `auth.<domain>` (and `/v1` stage paths on execute-api)
- Backend Lambda verifies JWTs using `aws-jwt-verify`
- Key files:
  - `apps/auth/src/app.ts` — Hono app factory (shared between local and Lambda)
  - `apps/auth/src/lambda.ts` — Lambda entry point
  - `apps/auth/src/routes/` — sendCode, verifyCode, refreshToken, revokeToken, loginPage, health
  - `apps/auth/src/server/cognitoAuth.ts` — Cognito API client
  - `apps/backend/src/auth.ts` — JWT verification middleware
  - `apps/backend/src/ensureUser.ts` — auto-provision user_settings + workspace on first request
  - `infra/aws/lib/auth.ts` — CDK Cognito User Pool construct
  - `db/migrations/0002_user_settings.sql` — user_settings table

## Engineering Principles

- Keep logic simple and explicit
- Prefer pure functions for domain logic
- Use strict typing across services
- Keep changes minimal and scoped
- Prioritize clear, actionable errors

Card reappearance and FSRS scheduling logic are described in `docs/fsrs-scheduling-logic.md`.
