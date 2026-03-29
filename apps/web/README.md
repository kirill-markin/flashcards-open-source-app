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

- unit and component tests run with Vitest
- release-gate browser coverage runs with Playwright in `apps/web/e2e/live-smoke.spec.ts`

The live smoke scenario intentionally mirrors the mobile clients:

- iOS equivalent: `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift`
- Android equivalent: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt`

## CI/CD

Web build and deploy details are documented in [`docs/backend-web-deployment.md`](../../docs/backend-web-deployment.md).

The expected release gate is:

1. Native web build and unit coverage in GitHub Actions
2. Native Playwright live smoke on `main`
3. Web deploy after the GitHub `CI` workflow succeeds

When a change lands on `main`, follow the GitHub `CI` and deploy workflows through completion instead of assuming the web release finished automatically.
