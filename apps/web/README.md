# Web App

Read this file before making any web-specific flow change.

## Goal

The web client should stay aligned with the shared flashcards product contract while feeling immediate, browser-native, and operationally simple to deploy.

The top-level product scope matches the other clients:

- Review
- Cards
- AI
- Settings

## Localization

When adding a new web language, follow [docs/web-localization.md](../../docs/web-localization.md).
That guide covers the real source-of-truth files, browser-local language override behavior, support/error-path audit points, auth locale coordination, and smoke-test expectations.

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

## Respect Existing Code

Before making any change, read the existing components and modules in the area you are touching.

Follow the patterns already present:

- match the component structure, state management approach, and API call conventions already used in neighboring screens
- use the same naming conventions for components, hooks, types, and test selectors already established in the codebase
- if a shared hook, utility, or helper already exists for what you need, use it instead of adding a new one
- do not introduce a new abstraction or pattern unless the existing one is clearly broken for the task at hand

If you are unsure how something is done, read two or three existing screens or hooks first. The answer is almost always already there.

## CI/CD

Web build and deploy details are documented in [`docs/backend-web-deployment.md`](../../docs/backend-web-deployment.md).

The expected main-branch release flow is:

1. Native web build in GitHub Actions
2. Web deploy on `main`
3. Native Playwright live smoke after deploy as an operational signal

When a change lands on `main`, follow the GitHub `AWS/Web Release` workflow through completion instead of assuming the web release finished automatically. A failed web live smoke is visible after deploy, leaves the deployed release in place, and should be fixed forward in the next iteration. Do not try to guard every internal web detail with tests; add only the smallest targeted check that validates an important boundary or user flow.
