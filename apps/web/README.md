# Web App

Read this file before making any web-specific flow change.

## Goal

The web client should stay aligned with the shared flashcards product contract while feeling immediate, browser-native, and operationally simple to deploy.

The top-level product scope matches the other clients:

- Review
- Cards
- AI
- Settings

## Native Test Stack

The web app uses the browser-native test stack already present in this package:

- targeted Vitest checks can cover real module boundaries in the web package, but we do not aim for exhaustive unit coverage
- release-gate browser coverage runs with Playwright in `apps/web/e2e/live-smoke.spec.ts`, grouped into shared-session smoke flows

Prefer the Playwright live smoke when a change affects a real user flow. It is the highest-confidence web check because it exercises the shipped browser app closest to production.

The live smoke scenario intentionally mirrors the mobile clients:

- iOS equivalent: `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift`
- Android equivalent: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt`

## CI/CD

Web build and deploy details are documented in [`docs/backend-web-deployment.md`](../../docs/backend-web-deployment.md).

The expected main-branch release flow is:

1. Native web build in GitHub Actions
2. Web deploy on `main`
3. Native Playwright live smoke after deploy as an operational signal

When a change lands on `main`, follow the GitHub `CI` and deploy workflows through completion instead of assuming the web release finished automatically. A failed web live smoke is visible after deploy and should be fixed forward. Do not try to guard every internal web detail with tests; add only the smallest targeted check that validates an important boundary or user flow.
