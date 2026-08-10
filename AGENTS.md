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

For iOS App Store screenshots and derived marketing materials, read [apps/ios/docs/marketing-screenshots.md](apps/ios/docs/marketing-screenshots.md).
Marketing attribution links and campaign naming rules live in [docs/marketing-links.md](docs/marketing-links.md).

We support the web app, the iOS app, the Android app, and the terminal-first AI-agent API flow. When making changes, we try to keep all supported clients aligned where relevant.
The platform READMEs are part of the working agreement for client work: [apps/web/README.md](apps/web/README.md) for web changes, [apps/ios/README.md](apps/ios/README.md) for iOS changes, and [apps/android/README.md](apps/android/README.md) for Android changes.
Before bumping release versions anywhere in the repo, read [docs/version-bump.md](docs/version-bump.md) and follow that flow so backend, web, Android, iOS, runtime-reported versions, and release metadata stay aligned.
The Web, iOS, and Android clients are multilingual, so always account for localization and follow the existing translation patterns in the surrounding code and dedicated client documentation.
The demo onboarding card seeded for new users is a cross-client contract, so before changing it on any client, read [docs/demo-card.md](docs/demo-card.md).

## Testing Philosophy

We do not try to cover the whole product with tests, and we do not optimize for blanket test coverage metrics.
Do not add unit tests by default, and do not guard every helper or pure function with a dedicated test.
Do not add new unit tests for this repository as part of implementation or as part of a written plan unless the user explicitly asks for unit tests.
Targeted integration or module-boundary tests are allowed when they validate a real interaction between modules, storage layers, or contracts.
The most trusted tests are the native/browser smoke flows that run the real app on a simulator, emulator, managed device, or deployed environment because they are the closest checks to production behavior.
Keep tests minimal and focused on primary user flows, critical contracts, or important cross-module behavior.
When proposing a test plan, treat "real testing" as one of these two options only: either implement a real integration/end-to-end/smoke flow that exercises the app or API for real, or provide explicit manual test instructions for the user to run. Do not treat unit tests as the default validation plan.

For iOS local testing details, see [docs/ios-local-setup.md](docs/ios-local-setup.md).
For Android local testing details, see [docs/android-ci-cd.md](docs/android-ci-cd.md).
Running `./gradlew` is resource-heavy in this repository. Do not run `./gradlew` locally unless the user explicitly allows that Gradle run for the current task. This applies even when a Gradle run seems necessary to validate a change: ask the user for permission first when validation genuinely requires it, wait for approval, and otherwise report that the Gradle check was not run. When allowed, choose the narrowest Gradle task that validates the change, and avoid broad Gradle runs without a clear reason.
Running iOS simulator-backed tests or local smoke flows is resource-heavy in this repository. Do not run iOS simulator `xcodebuild test`, XCUITest, screenshot-generation, or local smoke flows unless the user explicitly allows that simulator-backed run for the current task. When allowed, choose the narrowest iOS simulator run that validates the change, and avoid broad iOS test runs without a clear reason.
For the optional private analytical DB access path, granted reporting permissions, and operator setup flow, see [docs/analytics-db-access.md](docs/analytics-db-access.md).

## Release Gates and Monitoring

Release and check workflows use independent AWS/web, Android, and iOS streams.
Pull-request checks stay deliberately light and fast: do not add heavy mobile build or test jobs to pull-request workflows.
Two Android pull-request workflows are an accepted exception and stay: `Android PR` in `.github/workflows/android-pr.yml` runs build, unit tests, and lint for every Android-impacting pull request (about 6 minutes), and `Android PR data:local` in `.github/workflows/android-pr-data-local.yml` adds the GitHub-hosted `data:local` emulator instrumentation only when the Android data layer or shared Android Gradle configuration changes; the Firebase Test Lab managed-device suite stays out of pull requests.
Nothing compiles iOS before merge by design, though `PR Checks` still runs the static iOS checks.
Swift builds and tests run in Xcode Cloud, whose workflow definitions live in App Store Connect; its in-repo build inputs are documented in [docs/ios-ci-cd.md](docs/ios-ci-cd.md).
Keep the Xcode Cloud `Test - iOS` action non-required on purpose so TestFlight can receive builds even when smoke tests fail.
Xcode Cloud iOS test and build workflows are manually started and monitored by a human. Do not trigger or monitor them unless the user explicitly authorizes that exact action. Do not trigger `Android Release` or `MCP Registry Publish` unless the user explicitly authorizes that exact action; agents may monitor and fix automatically triggered GitHub Actions.
Details, rollback rules, and live smoke references: [docs/release-gates.md](docs/release-gates.md).
Agent SQL executions emit one structured CloudWatch record per run on every surface; the record fields and the failure-rate queries live in [docs/agent-sql-telemetry.md](docs/agent-sql-telemetry.md).
iOS `WatchdogTermination` events carry no stack trace by design; the memory fields carried on the app's own breadcrumbs and the decision tree for reading such an event live in [docs/ios-memory-diagnostics.md](docs/ios-memory-diagnostics.md).

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
Details and key files: [docs/auth-service.md](docs/auth-service.md).

## Engineering Principles

- Keep logic simple and explicit.
- Prefer pure functions for domain logic.
- Use strict typing across services.
- Keep changes minimal and scoped.
- Offline-first clients may apply narrow local overlays for pending changes, but complex product/domain rules must stay server-owned unless explicitly required; do not reimplement full backend algorithms in clients.
- Machine API documentation is intentionally duplicated across the discovery envelope (`actions` and `instructions`) and the published specs (`/v1/openapi.json`, `/v1/swagger.json`, generated from `api/src/openapi.yaml`). When changing the machine API, keep all of these in sync in the same change.
- Flashcard side contract is mandatory across all clients and APIs: `frontText` is only a question/review prompt (never the answer), and `backText` contains the answer (optionally with a concrete example, preferably in a fenced markdown code block when helpful).
- We align the functional contract across iOS and Android, but we do not synchronize the designs between them. The iOS UI should stay maximally native to iOS, and the Android UI should stay maximally native to Android and Material 3.
- In the iOS app, every user tap should trigger immediate Apple-standard UI feedback, with background loading shown in place or on the next surface, failed actions restoring the previous state, and successful actions clearly exposing the next step.
- In the iOS app and the web app, user actions should feel instantaneous. In key flows we proactively prepare the most likely next states, and where that is not possible or too expensive, we react immediately and show in-place loading feedback such as a spinner or small partial-loading spinners while data arrives.
- Always mention the schema explicitly in migrations.
- When adding, removing, or renaming backend HTTP routes, update `infra/aws/lib/gateways/api-gateway.ts` in the same change so API Gateway stays in sync.
- AWS CLI access is available in this environment. When debugging backend, AI, or SSE issues, prefer checking the exact Lambda log group first instead of inferring only from client symptoms.
- For CloudWatch investigations, avoid complex OR filter patterns. Fetch fresh events first, then filter locally by `requestId` and chat error signals.
- For live SSE issues, correlate the CloudWatch structured log, the `X-Request-Id` response header, and the client-visible error body.
- Prioritize clear, actionable errors.

Backend changes must remain backward-compatible with already released client versions by default. Do not break backend-facing contracts or behavior that shipped clients rely on unless the user explicitly asks for a breaking change. For the web, iOS, and Android clients, backward compatibility is not a goal; prefer keeping the latest codepath clean and current.

Card reappearance and FSRS scheduling logic are documented in `docs/fsrs-scheduling-logic.md`.
