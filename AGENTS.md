# flashcards-open-source-app

Open-source, offline-first flashcards platform.

- Domain: `nibomo.com` carries the marketing site, legal pages, docs, and the
  hosts browsers use (`app.`, `admin.`, `auth.`, and the `api.` they call). The
  `flashcards-open-source-app.com` hosts are permanent, not deprecated: they
  front the same backend and database forever, because every shipped iOS and
  Android build has them compiled in with no client-side remedy
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
Before releasing or bumping versions, read [Release All Platforms and Start the Next Development Version](docs/release-current-version.md); it owns the release sequence, authorization, and aligned version surfaces.
The Web, iOS, and Android clients are multilingual, so always account for localization and follow the existing translation patterns in the surrounding code and dedicated client documentation.
Adding a new language spans more surfaces than any single client guide covers, so read [docs/add-language.md](docs/add-language.md) before starting one.
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
Local Gradle, `xcodebuild`, simulator, and emulator runs are unrestricted, so run them whenever they are useful without asking the user for approval.

## Release Gates and Monitoring

Release and check workflows use independent AWS/web, Android, and iOS streams.
Pull-request checks stay deliberately light and fast: do not add heavy mobile build or test jobs to pull-request workflows.
Android jobs inside `.github/workflows/pr-checks.yml` are an accepted exception: build, unit tests, and lint run for every Android-impacting pull request, and the GitHub-hosted `data:local` emulator instrumentation runs only when the Android data layer or shared Android Gradle configuration changes. `Repository static checks` is the strict required aggregate PR gate; Firebase Test Lab stays out of pull requests.
Auto-merge is enabled but never updates a `BEHIND` branch, so it cannot rescue a pull request on its own: update the branch once server-side, then queue `gh pr merge --auto` so the merge lands unattended once the gate passes instead of racing `main` with repeated updates, and still watch the post-merge deploy to completion.
Nothing compiles iOS before merge by design, though `PR Checks` still runs the static iOS checks.
Swift builds and tests run in Xcode Cloud, whose workflow definitions live in App Store Connect; its in-repo build inputs are documented in [docs/ios-ci-cd.md](docs/ios-ci-cd.md).
Keep the Xcode Cloud `Test - iOS` action non-required on purpose so TestFlight can receive builds even when smoke tests fail.
A request to execute the full release runbook authorizes its manual workflow dispatches and publication steps. Reading and monitoring Xcode Cloud runs, results, and artifacts is always allowed without asking, including outside a release. Outside a release request, dispatch Xcode Cloud workflows or trigger `Android Release` / `MCP Registry Publish` only when the user requests those actions; agents may monitor and fix automatically triggered GitHub Actions.
Details, rollback rules, and live smoke references: [docs/release-gates.md](docs/release-gates.md).

## Data Sources for Analysis

- Website search traffic and SEO: Google Search Console exports in BigQuery; read [Data Sources for Analysis](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/AGENTS.md#data-sources-for-analysis) in the separate `kirill-markin/flashcards-open-source-app-website` repository for access, datasets across the domain move, and links to internal admin event reports. It is usually checked out on the same machine in a neighboring directory; verify its local path.
- Backend and auth runtime logs: CloudWatch Lambda log groups, read with the `flashcards-open-source-app` AWS profile; the default profile resolves to a different account and answers with an empty list instead of an error. Agent SQL executions emit one structured record per run on every surface, and every authenticated `/mcp` request emits one more; the record fields and the queries live in [docs/agent-sql-telemetry.md](docs/agent-sql-telemetry.md).
- Errors and crashes: Sentry, one project per surface (`SENTRY_BACKEND_PROJECT`, `SENTRY_WEB_PROJECT`, `SENTRY_ANDROID_PROJECT`, `SENTRY_IOS_PROJECT`) inside `SENTRY_ORG`. When resolving a fixed Sentry issue, default to `Resolved in current release` for backend/web/MCP and `Resolved in next release` for iOS/Android; use the actual shipped release when known. iOS `WatchdogTermination` events carry no stack trace by design; read [docs/ios-memory-diagnostics.md](docs/ios-memory-diagnostics.md) before interpreting one.
- AI chat and dictation traces: Langfuse when enabled, [docs/langfuse-operations.md](docs/langfuse-operations.md).
- Direct SQL over product data: the read-only `reporting_readonly` role, [docs/analytics-db-access.md](docs/analytics-db-access.md).
- Internal admin reports on product events, audience, and catalog-install funnels: [docs/admin-app.md](docs/admin-app.md).
- Product-wide aggregates: the daily snapshot behind `GET /v1/global/snapshot`, [docs/global-metrics.md](docs/global-metrics.md).
- App Store discovery, downloads, usage, sales, and subscriptions: App Store Connect Analytics Reports API, [docs/app-store-analytics.md](docs/app-store-analytics.md).
- iOS cloud build and test runs, per-test timings, and `.xcresult` bundles: [docs/xcode-cloud-data-access.md](docs/xcode-cloud-data-access.md).

Reach the database through an SSM port-forward: `bash scripts/setup/get-analytics-db-access.sh` prints the current instance id, endpoint, and password, `aws ssm start-session --document-name AWS-StartPortForwardingSessionToRemoteHost` opens the tunnel, and a local Postgres client connects on the forwarded port. There is no SSH path and the bastion has no ingress rules. Never reuse a previously noted instance id, because a deploy can change it. The role is read-only at session level, so writes fail with SQLSTATE `25006`. Close the tunnel with `aws ssm terminate-session`; killing the CLI leaves the plugin process and the session running.

The Langfuse and App Store Connect credentials live in the repository-root `.env`, which exists only in the main checkout. Load it by path when working from a worktree. For App Store Connect, check these local credentials and use the API first for supported operations; use the browser only when the API is insufficient or access remains blocked after diagnosis. See [credential setup and checks](docs/xcode-cloud-data-access.md#required-local-secrets).

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

`apps/{backend,ios,android}`, `db/{migrations,views,queries}`, `infra/{docker,aws}`, `docs/`, `scripts/`

## Auth Service (`apps/auth/`)

Email + OTP authentication via AWS Cognito (passwordless).
Details and key files: [docs/auth-service.md](docs/auth-service.md).

## Engineering Principles

- Keep logic simple and explicit.
- Prefer pure functions for domain logic.
- Use strict typing across services.
- Keep changes minimal and scoped.
- Offline-first clients may apply narrow local overlays for pending changes, but complex product/domain rules must stay server-owned unless explicitly required; do not reimplement full backend algorithms in clients.
- The conventional machine API document probes (`GET /v1/openapi.json`, `GET /v1/swagger.json`, `GET /v1/agent/openapi.json`, and `GET /v1/agent/swagger.json`) return concise source-discovery JSON that links to the open-source repository and relevant backend and auth route source files; they do not publish OpenAPI documents.
- The in-app chat and the MCP server serve one tool inventory from a shared registry, and the Agent REST API re-implements the same capabilities as HTTP routes over the same shared contract modules; before changing any of those three surfaces, read [docs/agent-tool-surfaces.md](docs/agent-tool-surfaces.md).
- Paid access is a cross-client contract: tiers and their integer ranks, access status, how an entitlement is derived, and what a client may trust offline; before changing premium, entitlements, AI limits, or billing on any surface, read [docs/premium-entitlements.md](docs/premium-entitlements.md) and the product decisions in [docs/premium-offer.md](docs/premium-offer.md).
- Flashcard side contract is mandatory across all clients and APIs: `frontText` is only a question/review prompt (never the answer), and `backText` contains the answer (optionally with a concrete example, preferably in a fenced markdown code block when helpful).
- We align the functional contract across iOS and Android, but we do not synchronize the designs between them. The iOS UI should stay maximally native to iOS, and the Android UI should stay maximally native to Android and Material 3.
- In the iOS app, every user tap should trigger immediate Apple-standard UI feedback, with background loading shown in place or on the next surface, failed actions restoring the previous state, and successful actions clearly exposing the next step.
- In the iOS app and the web app, user actions should feel instantaneous. In key flows we proactively prepare the most likely next states, and where that is not possible or too expensive, we react immediately and show in-place loading feedback such as a spinner or small partial-loading spinners while data arrives.
- Analytics events store facts; funnels, cohorts, and groupings are produced by queries over those facts at analysis time, so never add an event or event property that exists only to assemble one specific report.
- Always mention the schema explicitly in migrations.
- When adding, removing, or renaming backend HTTP routes, update `infra/aws/lib/gateways/api-gateway.ts` in the same change so API Gateway stays in sync.
- AWS CLI access is available in this environment. When debugging backend, AI, or SSE issues, prefer checking the exact Lambda log group first instead of inferring only from client symptoms.
- For CloudWatch investigations, avoid complex OR filter patterns. Fetch fresh events first, then filter locally by `requestId` and chat error signals.
- For live SSE issues, correlate the CloudWatch structured log, the `X-Request-Id` response header, and the client-visible error body.
- Prioritize clear, actionable errors.

Backend changes must remain backward-compatible with already released client versions by default. Do not break backend-facing contracts or behavior that shipped clients rely on unless the user explicitly asks for a breaking change. For the web, iOS, and Android clients, backward compatibility is not a goal; prefer keeping the latest codepath clean and current.

Card reappearance and FSRS scheduling logic are documented in `docs/fsrs-scheduling-logic.md`.
