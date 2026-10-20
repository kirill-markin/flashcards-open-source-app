# Web App

Read this file before making any web-specific flow change.

## Goal

The web client should stay aligned with the shared flashcards product contract while feeling immediate, browser-native, and operationally simple to deploy.

The top-level product scope matches the other clients:

- Review
- Cards
- AI
- Settings

## Optional sign-in

The browser opens a cloud-synced guest workspace immediately. **Guest · Sign in** saves the current
workspace before opening the auth UI. Eligible [demo-only sign-in](../../docs/demo-card.md#guest-upgrade)
enters an existing account automatically. Other guest content can merge into any accessible workspace
or a new one. Keep this browser’s site data until conversion finishes: guest access depends
on its essential cookie, and clearing all site data can lose that access. An unverified guest cache
opens read-only until its original session can be verified. Stripe purchases require sign-in.
Nibomo-funded chat, dictation and images follow the [browser trial policy](../../docs/premium-offer.md#browser-guest-ai-trial).
AI refusals invite sign-in inside the conversation and preserve the draft; each feature has an independent
server allowance. Guest key entry is deferred until sign-in;
an already saved key remains available. Funded guest dictation stops at the smaller of 120 seconds
and the remaining personal allowance, then uploads 16 kHz mono 16-bit PCM WAV with one stable
operation ID per recording. Other dictation keeps its existing format.

The live smoke starts with guest authoring/review, reload and IndexedDB-only restoration, then covers
authored-card transfer, legacy demo cleanup and interrupted completion replay using the configured review
account. It also checks reviewed demo-only sign-in without any transfer chooser, including a committed
completion whose response is lost, followed by in-page retry or reload. A dedicated new-account bind
can also be checked manually against a fresh local Cognito-backed
database or a disposable, previously unmapped account:

1. Open the app with a fresh browser profile, record the guest user/workspace/card IDs from local
   ownership metadata and IndexedDB, create a card, and review the demo. Wait for sync.
2. Press **Guest · Sign in** and authenticate as the unmapped account. The bind finishes without a
   destination chooser. Confirm the account keeps the same user ID, workspace ID, card IDs and review
   event IDs, the demo stays active, and the workspace list has no extra workspace.
3. Reload and check the same cards and review progress. Confirm the pending conversion metadata is
   gone only after destination hot state and review history have loaded, and ordinary writes work.
4. With another fresh guest, author a real card or edit the demo, then sign in to the existing account.
   Confirm the transfer chooser appears and the authored or edited content survives the selected
   transfer, including after reload. Check demo retention against the [canonical contract](../../docs/demo-card.md#guest-upgrade).
5. With a fresh guest holding only its unchanged demo, review it, wait for sync and sign in to the
   existing account. Confirm no transfer chooser appears, the destination account keeps its data,
   and the guest demo and its reviews are absent after sign-in and reload.
6. Repeat step 5 while interrupting completion, then retry or reload. Confirm the saved automatic
   selection is replayed and pending ownership clears only after destination hydration and dropped-entity
   reconciliation. The live smoke injects loss of the actual committed server response for this check.
7. On the isolated Cognito-backed local stack, use an already-mapped existing-account fixture with
   exactly one workspace and no card or review rows, including tombstones. Do not open that account
   in the registered web app before this scenario, and do not empty a production account to prepare it.
   Repeat step 5 and both recovery variants in step 6 against this fixture, starting each run with a
   fresh guest browser profile. Confirm the original single workspace is selected, no transfer chooser
   appears, IndexedDB and the local backend still contain zero cards and reviews (including any newly
   seeded demo), and the outbox is empty after completion and another reload. Pending ownership must
   clear only after hydration. After all three runs, confirm a normal authored card saves and syncs.

Never publish cookies, CSRF tokens, keys, auth responses, or full storage dumps in diagnostics.

## Catalog first study smoke

Use the isolated local stack for writes. For guest and account conversion scenarios, use the
Cognito-backed local stack described above. Repeat the primary entry flow at mobile and desktop
viewport sizes. Use an exact public package-version URL at `/catalog/import/<packageVersionId>`.

1. In a fresh browser profile, open the catalog URL directly. Confirm localized import/sync feedback
   leads to an actual card from that version in review, without import controls or a success chooser.
   Check the local cards and outbox: package tags are preserved, no import tag or demo is created.
   Reload review, then sign in to a disposable unmapped account and reload again; no demo appears.
2. With the same guest session, author a card and reopen another catalog URL. Confirm the manual
   import controls appear and the guest identity and authored card survive. Also check an existing
   guest that already imported cards. Never clear owned site data to force automatic entry.
3. Start ordinary app onboarding in another fresh profile and wait for its provenance-backed demo
   to sync. Open a catalog URL; confirm automatic import removes that demo only after import commits
   and review shows an imported card. Repeat with a reviewed unchanged demo. Edit the demo, including
   editing and reverting before sync; confirm the manual import preserves it. Repeat with a legacy
   demo lacking provenance and with an authored card beside the demo.
4. Use a registered local account with exactly one empty visible workspace, then one with an
   unchanged demo. Confirm automatic study in both. Use an account with several visible workspaces,
   all empty, including a session without a selected workspace: confirm a workspace chooser always
   appears, choosing a different workspace reaches manual controls, and confirmation remains required.
5. Block the install POST before it reaches the local backend. Confirm the localized error and
   Retry action appear, with prior cards preserved. Restore connectivity and retry. Repeat while
   losing the actual committed POST response, using a local proxy/devtools response interception:
   retry in-page and separately reload the catalog page. Compare request bodies and backend install
   ledger: the same install ID, timestamps, replica ID, options and operation prefix are replayed,
   with one card set. Do not replace the committed response with a fake successful response.
6. Let the POST commit but block the subsequent sync pull/bootstrap. Confirm review does not open
   early or show an old demo/empty state; restore the requests and retry or reload. Confirm the same
   install replays, its cards and demo tombstone hydrate, and the first actual card appears with the
   all-cards selection after the destination provider remount. Also start with an explicitly empty
   saved tag filter and confirm it cannot hide the imported cards.
7. While automatic entry is waiting, author/edit a card from another tab and sync it before the
   guarded install. Confirm the backend eligibility refusal preserves that content and returns to
   manual controls. Open the same catalog URL concurrently in two tabs and confirm the request is
   coordinated and no duplicate card set is committed.
8. Outside catalog entry, open the app in a fresh profile and confirm ordinary demo onboarding still
   works. In a non-English locale, repeat entry and a failed install/sync to verify localized loading,
   failure and retry copy; include an RTL locale and the two supported Spanish variants.

## Localization

When adding a new web language, follow [docs/web-localization.md](../../docs/web-localization.md).
That guide covers the real source-of-truth files, browser-local language override behavior, support/error-path audit points, auth locale coordination, and smoke-test expectations.

## Analytics Identity

The web app does not own an anonymous identity of its own. `anonymous_id` is the `analytics_visitor`
cookie the backend mints for the product domain, so this app measures a person from the first page
view and across a logout: [analytics visitor identity](../../docs/analytics-visitor-identity.md).
It does not survive an account deletion, which expires it in this browser so the person continues as
a new anonymous visitor; a deletion started on another device cannot reach this browser's copy.

The auth origin is on that same id, which puts it inside the consent gate. It mints no identity of
its own: its server-side sign-in funnel reports under this cookie and reports nothing for a browser
that holds none, so `app.` and `auth.` measure one visitor.

Where the law requires consent first, a bottom strip asks for it, and until the person answers this
app writes nothing to the device and sends nothing carrying an identifier. The banner also asks on
the public catalog, invite and share routes, and the same switch withdraws on both sides of the
session gate: the settings screen at `/settings/analytics` for a signed-in person, and a corner link
on those public routes for a visitor with no account. Both render the one switch in
`src/analytics/AnalyticsConsentToggleCard.tsx`, and both carry the answer to the account whenever one
is signed in on this browser. Read [analytics visitor identity](../../docs/analytics-visitor-identity.md) before
touching the banner, either withdrawal entry, or anything in `src/analytics/` that runs before a
decision exists.

The banner decides only that identifier. Whether this person is measured at all is a second, separate
switch beside it on the same two surfaces: on, because the basis is legitimate interest, and while it
is off the client sends nothing, queues nothing and holds nothing. Refusing the cookie is not
refusing analytics, and neither answer is ever read into the other
(`src/analytics/productAnalyticsCollection.ts`).

Which transport an event leaves on follows from whether a credential exists. A signed-in browser
batches through the authenticated ingest; a signed-out one reports one event per request through the
credential-free collector, [anonymous client analytics](../../docs/anonymous-client-analytics.md).
Events collected under an account never leave credential-free, and neither does anything while this
browser says an account owns it: a signed-in person reporting `app_opened` only through the collector
would be read as an actor with no `app_opened` at all, and auto-excluded from every person-level
report until a human restores them.

## Native Test Stack

The web app uses the browser-native test stack already present in this package:

- targeted Vitest checks can cover real module boundaries in the web package, but we do not aim for exhaustive unit coverage
- release-gate browser coverage runs with Playwright in `apps/web/e2e/live-smoke.spec.ts`, grouped into shared-session smoke flows

Prefer the Playwright live smoke when a change affects a real user flow. It is the highest-confidence web check because it exercises the shipped browser app closest to production.

The live smoke scenario intentionally mirrors the mobile clients:

- iOS equivalent: `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift`
- Android equivalent: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/LiveSmokeTest.kt`

For local web work, `npm run test:e2e:local` in `apps/web` runs the same Playwright smoke against the local browser stack:

1. local auth on `http://localhost:8081`
2. local backend on `http://localhost:8080`
3. local production-style web preview on `http://localhost:3000` that Playwright builds and serves automatically

This local smoke does not reuse production auth. It is intentionally isolated so localhost never depends on the deployed auth allowlist or production web origin.

Local smoke prerequisites:

- root `.env` must keep `AUTH_MODE=cognito`
- local auth/backend must have real Cognito config (`COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION`, `SESSION_ENCRYPTION_KEY`)
- review account sign-in should be enabled locally with `DEMO_EMAIL_DOSTIP` and `DEMO_PASSWORD_DOSTIP`
- start the local data/auth stack first with `make db-up`, `make auth-dev`, and `make backend-dev`

The local smoke preflight fails fast if local auth or backend is unavailable, or if the Playwright target is misconfigured to mix localhost with deployed origins.

`npm run test:e2e` and `npm run test:e2e:prod` remain the production/deployed smoke entrypoints. They must not point at localhost and are the paths used by CI/CD and post-deploy verification.

### Local login-free stack

`make local-app` checks a web change by hand before merge without Cognito or a root `.env`: [the script](../../scripts/local/app.sh) starts Docker Desktop if needed, local Postgres with migrations, then the backend with `AUTH_MODE=none`, the auth service in development mode, and the Vite dev server on `http://localhost:3000`, signed in as the local user. The database starts empty and normal onboarding seeds the [demo card](../../docs/demo-card.md); nothing touches production. Ctrl-C stops the servers and leaves Postgres running for `make db-down`. Sign-in flows need the Cognito-based `npm run test:e2e:local` above.

AI chat does not work in this stack: the chat endpoints refuse `AUTH_MODE=none` and require Bearer, session, or guest auth ([`assertSupportedTransport`](../backend/src/chat/http/dependencies.ts)).

## Respect Existing Code

Before making any change, read the existing components and modules in the area you are touching.

Follow the patterns already present:

- match the component structure, state management approach, and API call conventions already used in neighboring screens
- use the same naming conventions for components, hooks, types, and test selectors already established in the codebase
- if a shared hook, utility, or helper already exists for what you need, use it instead of adding a new one
- do not introduce a new abstraction or pattern unless the existing one is clearly broken for the task at hand

If you are unsure how something is done, read two or three existing screens or hooks first. The answer is almost always already there.

Error messages reach Sentry verbatim, so never interpolate user-authored content into one: no card text, deck names, email addresses, or chat messages. Identifiers, endpoints, field names, sizes, and status codes are fine.

## CI/CD

Web build and deploy details are documented in [`docs/backend-web-deployment.md`](../../docs/backend-web-deployment.md).

The expected main-branch release flow is:

1. Native web build in GitHub Actions
2. Web deploy on `main`
3. Native Playwright live smoke after deploy as an operational signal

When a change lands on `main`, follow the GitHub `AWS/Web Release` workflow through completion instead of assuming the web release finished automatically. A failed web live smoke is visible after deploy, leaves the deployed release in place, and should be fixed forward in the next iteration. Do not try to guard every internal web detail with tests; add only the smallest targeted check that validates an important boundary or user flow.
