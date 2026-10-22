# flashcards-open-source-app

Open-source, offline-first flashcards platform.

Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md).

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
- iPhone and iPad app (including iPhone Duo): Swift (priority), iOS/iPadOS 18+. Before making any iOS/iPadOS change, read [apps/ios/README.md](apps/ios/README.md).
- macOS app: macOS 15+ on Apple silicon via Mac Catalyst. Before making any Catalyst change, read [apps/ios/README.md](apps/ios/README.md) and [docs/macos-ci-cd.md](docs/macos-ci-cd.md).
- Android app: Kotlin + Jetpack Compose; Android 11, 12, 12L, 13, 14, 15, 16, and 17. Before making any Android change, read [apps/android/README.md](apps/android/README.md).
- AI assistants via MCP: supported at `https://mcp.nibomo.com/mcp`.
- Terminal / AI-agent API client: supported via the canonical machine API entrypoint `GET https://api.flashcards-open-source-app.com/v1/` (the same discovery payload is also available at `GET https://api.flashcards-open-source-app.com/v1/agent`)

Before marketing or store-asset work, read the matching guide: [iOS App Store screenshots](apps/ios/docs/marketing-screenshots.md), [store-card processing](docs/store-screenshot-processing.md), or [attribution links and campaign naming](docs/marketing-links.md).

We support the web, iOS/iPadOS, Mac Catalyst, Android, MCP, and terminal-first AI-agent API clients. When making changes, we try to keep all supported clients aligned where relevant.
Before releasing or bumping versions, read [Release All Platforms](docs/release/README.md); it owns the release sequence, authorization, and aligned version surfaces.
The Web, iOS, and Android clients are multilingual, so always account for localization and follow the existing translation patterns in the surrounding code and dedicated client documentation.
Adding a new language spans more surfaces than any single client guide covers, so read [docs/add-language.md](docs/add-language.md) before starting one.
The demo onboarding card seeded for new users is a cross-client contract, so before changing it on any client, read [docs/demo-card.md](docs/demo-card.md).
Before changing auth (`apps/auth/`, passwordless email OTP via AWS Cognito), read [docs/auth-service.md](docs/auth-service.md).
Before changing card reappearance or FSRS scheduling, read [docs/fsrs-scheduling-logic.md](docs/fsrs-scheduling-logic.md).

## Mobile OS Compatibility

- Prioritize the latest mobile OS: native UX, performance, current dependencies, and clean architecture.
- Support older OS versions through narrow availability/API adapters; share domain logic, state, storage, sync, and navigation across OS versions within each mobile app. Do not duplicate screens or downgrade the architecture for older devices.

## Testing Philosophy

We do not optimize for blanket test coverage. Do not add unit tests, in an implementation or a written plan, unless the user explicitly asks for them.
Targeted integration or module-boundary tests are allowed when they validate a real interaction between modules, storage layers, or contracts.
The most trusted tests are the native/browser smoke flows that run the real app on a simulator, emulator, managed device, or deployed environment. Keep tests minimal and focused on primary user flows, critical contracts, or important cross-module behavior.
Run the full existing mobile smoke selection on the latest OS; run only a small essential compatibility smoke on older supported OS versions.
A test plan offers only real testing: a real integration/end-to-end/smoke flow that exercises the app or API, or explicit manual test instructions for the user.

For iOS local testing details, see [docs/ios-local-setup.md](docs/ios-local-setup.md).
For Android local testing details, see [docs/android-ci-cd.md](docs/android-ci-cd.md).
Run useful local project checks, builds and tests during implementation and pre-release validation without additional approval. Honor explicit static-only review instructions. AWS deployment and deployment-artifact restrictions above still apply.
Before every manual or automated Apple test, local or cloud, including Release/TestFlight, apply the [automation marker](docs/ios-ci-cd.md#automation-marker).

## Local development loop

Rule: read production, write locally. Both commands open on `localhost` without login; check admin and web changes there before merge.

- `make local-admin`: the admin app on `http://localhost:3001` reading production data read-only through `reporting_readonly`; details in [apps/admin/README.md](apps/admin/README.md#local-admin-on-production-data-read-only).
- `make local-app`: the web app on `http://localhost:3000` against a local Docker Postgres, never production; details in [apps/web/README.md](apps/web/README.md#local-login-free-stack).

## Release Gates and Monitoring

Pull-request checks stay deliberately light and fast: do not add heavy mobile build or test jobs to pull-request workflows.
Before merging a pull request, read [merging pull requests](docs/release-gates.md#merging-pull-requests).
Run Apple builds and tests only in Xcode Cloud or local Xcode; never use Firebase for Apple tests.
A request to execute the full release runbook authorizes its manual workflow dispatches and publication steps. Reading and monitoring Xcode Cloud runs, results, and artifacts is always allowed without asking, including outside a release. Outside a release request, dispatch Xcode Cloud workflows or trigger `Android Release` / `MCP Registry Publish` only when the user requests those actions; agents may monitor and fix automatically triggered GitHub Actions.
Release streams, Apple and Android release gates, rollback rules, and live smoke references: [docs/release-gates.md](docs/release-gates.md).

## Data Sources for Analysis

Before any product-data analysis, read [docs/analytics-db-access.md](docs/analytics-db-access.md).

- Website search traffic and SEO: Google Search Console exports in BigQuery; read [Data Sources for Analysis](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/AGENTS.md#data-sources-for-analysis) in the separate `kirill-markin/flashcards-open-source-app-website` repository for access, datasets across the domain move, and links to internal admin event reports. It is usually checked out on the same machine in a neighboring directory; verify its local path.
- Backend and auth runtime logs: CloudWatch Lambda log groups, read with the `flashcards-open-source-app` AWS profile; the default profile resolves to a different account and answers with an empty list instead of an error. Agent SQL executions emit one structured record per run on every surface, and every authenticated `/mcp` request emits one more; the record fields and the queries live in [docs/agent-sql-telemetry.md](docs/agent-sql-telemetry.md).
- Errors and crashes: Sentry, one project per surface (`SENTRY_BACKEND_PROJECT`, `SENTRY_WEB_PROJECT`, `SENTRY_ANDROID_PROJECT`, `SENTRY_IOS_PROJECT`) inside `SENTRY_ORG`. Before resolving a fixed Sentry issue, read `$HOME/.agents/skills/sentry-triage-kirill/SKILL.md`. Resolve per project using the exact merged fix commit or verified first fixed Sentry release; never infer it from checked-in semver or platform name, or treat a merge or Sentry release as proof of deployment or public store availability. iOS `WatchdogTermination` events carry no stack trace by design; read [docs/ios-memory-diagnostics.md](docs/ios-memory-diagnostics.md) before interpreting one.
- Direct SQL over product data: the read-only `reporting_readonly` role, [docs/analytics-db-access.md](docs/analytics-db-access.md).
- Internal admin reports on product events, audience, and catalog-install funnels: [docs/admin-app.md](docs/admin-app.md).
- Product-wide aggregates: the daily snapshot behind `GET /v1/global/snapshot`, [docs/global-metrics.md](docs/global-metrics.md).
- App Store discovery, downloads, usage, sales, and subscriptions: App Store Connect Analytics Reports API, [docs/app-store-analytics.md](docs/app-store-analytics.md).
- The same App Store reports imported hourly into Postgres: the `store_analytics` schema, [docs/store-analytics.md](docs/store-analytics.md).
- iOS cloud build and test runs, per-test timings, and `.xcresult` bundles: [docs/xcode-cloud-data-access.md](docs/xcode-cloud-data-access.md).

Reach the database through an SSM port-forward: `bash scripts/setup/get-analytics-db-access.sh` prints the current instance id, endpoint, and password, `aws ssm start-session --document-name AWS-StartPortForwardingSessionToRemoteHost` opens the tunnel, and a local Postgres client connects on the forwarded port. There is no SSH path and the bastion has no ingress rules. Never reuse a previously noted instance id, because a deploy can change it. The role is read-only at session level, so writes fail with SQLSTATE `25006`. Close the tunnel with `aws ssm terminate-session`; killing the CLI leaves the plugin process and the session running.

The App Store Connect credentials live in the repository-root `.env`, which exists only in the main checkout. Load it by path when working from a worktree. For App Store Connect, check these local credentials and use the API first for supported operations; use the browser only when the API is insufficient or access remains blocked after diagnosis. See [credential setup and checks](docs/xcode-cloud-data-access.md#required-local-secrets).

## Architecture

Postgres in AWS is the source of truth. Clients read and write their local store first, queue writes in an outbox, and sync through the API.
The sync approach and the data model changed multiple times during development. To understand how the system works now, read [docs/architecture.md](docs/architecture.md) together with the full relevant migration chain in `db/migrations`, and do not infer current behavior from only one or two isolated migrations.

## Data Modeling Notes

- Prefer UUID/ULID identifiers for offline entity creation.
- Include `updated_at` and `deleted_at` for sync and tombstones.
- Keep review history append-only where possible.
- Do not hide sync failures behind fallback logic.

## Engineering Principles

- Keep logic simple and explicit.
- Prefer pure functions for domain logic.
- Use strict typing across services.
- Keep changes minimal and scoped.
- Store each fact once: in code; if code cannot say it, in the shortest comment beside the code that enforces it; only short high-level information no code can hold (how parts combine, product and business decisions, procedures a human runs) goes in `docs/`, once. Everything else links to it, and a repeat needs a reason. Marketing and published content (store and connector listings, website articles) is content, not code documentation, and is exempt.
- Offline-first clients may apply narrow local overlays for pending changes, but complex product/domain rules must stay server-owned unless explicitly required; do not reimplement full backend algorithms in clients.
- The in-app chat and the MCP server serve one tool inventory from a shared registry, and the Agent REST API re-implements the same capabilities as HTTP routes over the same shared contract modules; before changing any of those three surfaces or any AI-facing text (MCP instructions, tool descriptions, guides, chat prompt), read [docs/agent-tool-surfaces.md](docs/agent-tool-surfaces.md).
- Paid access is a cross-client contract: tiers and their integer ranks, access status, how an entitlement is derived, and what a client may trust offline; before changing premium, entitlements, AI limits, or billing on any surface, read [docs/premium-entitlements.md](docs/premium-entitlements.md) and the product decisions in [docs/premium-offer.md](docs/premium-offer.md).
- Flashcard side contract is mandatory across all clients and APIs: `frontText` is only a question/review prompt (never the answer), and `backText` contains the answer (optionally with a concrete example, preferably in a fenced markdown code block when helpful).
- We align the functional contract across iOS and Android, but we do not synchronize the designs between them. The iOS UI should stay maximally native to iOS, and the Android UI should stay maximally native to Android and Material 3.
- Use separate native screens for mobile forms and multistep flows, replacing the previous step instead of expanding controls beneath it.
- In every client UI, every user tap should trigger immediate platform-standard UI feedback, with background loading shown in place or on the next surface, failed actions restoring the previous state, and successful actions clearly exposing the next step.
- In the iOS app and the web app, user actions should feel instantaneous. In key flows we proactively prepare the most likely next states, and where that is not possible or too expensive, we react immediately and show in-place loading feedback such as a spinner or small partial-loading spinners while data arrives.
- Analytics events store facts; funnels, cohorts, and groupings are produced by queries over those facts at analysis time, so never add an event or event property that exists only to assemble one specific report.
- Always mention the schema explicitly in migrations.
- Apply authorized one-off data changes directly in the database. Reserve migrations for schema changes and bulk data transformations.
- AWS CLI access is available in this environment. When debugging backend, AI, or SSE issues, prefer checking the exact Lambda log group first instead of inferring only from client symptoms.
- For CloudWatch investigations, avoid complex OR filter patterns. Fetch fresh events first, then filter locally by `requestId` and chat error signals.
- For live SSE issues, correlate the CloudWatch structured log, the `X-Request-Id` response header, and the client-visible error body.
- Prioritize clear, actionable errors.

Backend changes must remain backward-compatible with already released client versions by default. Do not break backend-facing contracts or behavior that shipped clients rely on unless the user explicitly asks for a breaking change. For the web, iOS, and Android clients, preserving obsolete client implementations is not a goal; keep the latest codepath clean and current while supporting the mobile OS versions declared in the platform READMEs.
