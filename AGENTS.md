# flashcards-open-source-app

Open-source, offline-first flashcards platform.

- Domain: `flashcards-open-source-app.com`
- Repository: `kirill-markin/flashcards-open-source-app`
- Product stage: early development

## Product Direction

Build a practical Anki-like alternative focused on fast mobile UX, offline-first behavior, and transparent open-source architecture.

## Platform Plan

- Backend: AWS
- AWS infra deploys via CI/CD only. Do not run AWS deploys locally; push to `main` and watch CI/CD.
- Do not build AWS SDK bundles or other AWS deployment artifacts locally. Push code to `main`, and let CI/CD build and deploy everything.
- Web app: supported. Before making any web change, read [apps/web/README.md](apps/web/README.md).
- iOS app: Swift (priority). Before making any iOS change, read [apps/ios/README.md](apps/ios/README.md).
- Android app: Kotlin + Jetpack Compose. Before making any Android change, read [apps/android/README.md](apps/android/README.md).
- Terminal / AI-agent API client: supported via the canonical machine API entrypoint `GET https://api.flashcards-open-source-app.com/v1/` (the same discovery payload is also available at `GET https://api.flashcards-open-source-app.com/v1/agent`)

We support the web app, the iOS app, the Android app, and the terminal-first AI-agent API flow. When making changes, we try to keep all supported clients aligned where relevant.
The platform READMEs are part of the working agreement for client work: [apps/web/README.md](apps/web/README.md) for web changes, [apps/ios/README.md](apps/ios/README.md) for iOS changes, and [apps/android/README.md](apps/android/README.md) for Android changes.
The iOS Xcode project is file-synchronized, so new Swift files can be added without manual `project.pbxproj` edits.
Running iOS tests is a heavy operation, so do not run them automatically and only run them after the user explicitly agrees.
iOS full test runs can take a bit more than 2 minutes locally, and that is normal.
If iOS tests are explicitly requested, run them only on one specific iPhone simulator runtime that is already downloaded locally.
If that iPhone simulator runtime is not already available locally, do not run the tests and do not trigger extra runtime downloads or installations.
For iOS, `My Mac` can be used only for iOS compile smoke-checks such as `build` or `build-for-testing`, not as a reliable destination for app-hosted unit tests.
For Android, follow [apps/android/README.md](apps/android/README.md) for platform targets and testing focus. Tests should be run only against the final supported Android target, not against older API levels.
Run Android local tests sequentially, not in parallel, otherwise local runs can become unstable.
Before running Android tests, also check which Android emulators are available locally. If a local emulator is available, Android tests can be run by starting that emulator.

## Release Gates and Monitoring

Pushes to `main` use one GitHub Actions release orchestrator in `.github/workflows/deploy.yml`:

- it detects whether AWS changed
- when AWS changed, it deploys production, runs the native Playwright smoke in `apps/web/e2e/live-smoke.spec.ts`, and keeps or rolls back the whole AWS runtime based on that result
- rollback is automatic only when the failed AWS release did not include new DB migrations
- migration-bearing AWS failures are explicit fix-forward cases; the next push must still be allowed to run
- when Android changed, `.github/workflows/android-release.yml` is explicitly dispatched by the main release orchestrator for that same SHA after the AWS/web outcome is known
- when iOS changed, Xcode Cloud runs independently for the same `main` SHA

When a change lands on `main`, monitor the main release orchestrator for AWS/web outcome, monitor `Android Release` separately only when it was dispatched for an Android-changing SHA, and monitor Xcode Cloud separately when iOS changed.

Cross-client live smoke references:

- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift`
- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt`
- Web: `apps/web/e2e/live-smoke.spec.ts`

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

The sync approach and the data model changed multiple times during development. To understand how the system works now, read `docs/architecture.md` together with the full relevant migration chain in `db/migrations`, and do not infer current behavior from only one or two isolated migrations.

## Data Modeling Notes

- Prefer UUID/ULID identifiers for offline entity creation.
- Include `updated_at` and `deleted_at` for sync and tombstones.
- Keep review history append-only where possible.
- Do not hide sync failures behind fallback logic.

## Planned Monorepo Shape

`apps/{backend,ios,android}`, `db/{migrations,views,queries}`, `infra/{docker,aws}`, `api/src/openapi.yaml`, `docs/`, `scripts/`

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
- Machine API documentation is intentionally duplicated across the discovery envelope (`actions` and `instructions`) and the published specs (`/v1/openapi.json`, `/v1/swagger.json`, generated from `api/src/openapi.yaml`). When changing the machine API, keep all of these in sync in the same change.
- Flashcard side contract is mandatory across all clients and APIs: `frontText` is only a question/review prompt (never the answer), and `backText` contains the answer (optionally with a concrete example, preferably in a fenced markdown code block when helpful).
- We align the functional contract across iOS and Android, but we do not synchronize the designs between them. The iOS UI should stay maximally native to iOS, and the Android UI should stay maximally native to Android and Material 3.
- In the iOS app, every user tap should trigger immediate Apple-standard UI feedback, with background loading shown in place or on the next surface, failed actions restoring the previous state, and successful actions clearly exposing the next step.
- In the iOS app and the web app, user actions should feel instantaneous. In key flows we proactively prepare the most likely next states, and where that is not possible or too expensive, we react immediately and show in-place loading feedback such as a spinner or small partial-loading spinners while data arrives.
- Always mention the schema explicitly in migrations.
- When adding, removing, or renaming backend HTTP routes, update `infra/aws/lib/api-gateway.ts` in the same change so API Gateway stays in sync.
- For CloudWatch investigations, avoid complex OR filter patterns. Fetch fresh events first, then filter locally by `requestId` and chat error signals.
- Prioritize clear, actionable errors.

We do not support backward compatibility. Instead, we migrate old data and aim to keep only one correct solution working, avoiding the accumulation of legacy behavior.

Card reappearance and FSRS scheduling logic are documented in `docs/fsrs-scheduling-logic.md`.
