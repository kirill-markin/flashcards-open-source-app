# Flashcards Open Source App

![iOS app screenshots](docs/images/ios-app-screenshots.jpeg)

Flashcards are a simple study format: the front side shows a question or prompt, and the back side shows the answer. People use them to study languages, facts, definitions, code, and other material they want to remember. This project is an open-source Anki-like flashcards app focused on iOS, Android, web, and offline-first sync.

Open-source offline-first flashcards app for iOS, Android, and web.

## Clients

- iOS app in `apps/ios`
- Android app in `apps/android`
- Web client in `apps/web`
- AI agents support through the external agent API: [https://api.flashcards-open-source-app.com/v1/](https://api.flashcards-open-source-app.com/v1/)

## Features

- Offline-first: browser local database on web, SQLite on iOS and Android
- Auto-sync: clients write locally first and sync with the backend when online

## Release Gates

Production delivery is gated client-by-client with native test stacks:

- iOS uses XCTest and XCUITest, including the stateful live smoke in [`apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift`](apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift)
- Android uses JUnit plus native Compose instrumentation, including the stateful live smoke in [`apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt`](apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt)
- Web uses Vitest and Playwright, including the stateful live smoke in [`apps/web/e2e/live-smoke.spec.ts`](apps/web/e2e/live-smoke.spec.ts)

For web/backend/auth/infra on `main`, production deploy now happens first and the web Playwright smoke runs after deploy as an operational signal. iOS and Android keep their own native release gates.
After every push to `main`, watch all triggered client pipelines through completion instead of assuming the release finished automatically. A failed web post-deploy smoke is expected to be fixed forward.

## Card scheduling

- Review scheduling uses FSRS-6 with pinned default weights
- The full scheduler is implemented in backend and iOS and must stay behaviorally identical
- The web app mirrors the scheduler data contract and review flow, but does not contain a third FSRS implementation
- Cards appear in review when they are due: `due_at <= now()`
- Detailed scheduling rules live in [`docs/fsrs-scheduling-logic.md`](docs/fsrs-scheduling-logic.md)


## Setup Docs

- [iOS local setup](docs/ios-local-setup.md)
- [iOS CI/CD](docs/ios-ci-cd.md)
- [Android CI/CD](docs/android-ci-cd.md)
- [Web app notes](apps/web/README.md)
- [Backend and web deployment](docs/backend-web-deployment.md)
- [More architecture details](docs/architecture.md)

Android CI/CD setup uses separate GitHub repository variables for Google Cloud and Firebase Test Lab. The required variable names and the helper sync script are documented in [`docs/android-ci-cd.md`](docs/android-ci-cd.md).

## Review Demo Accounts

The optional `DEMO_EMAIL_DOSTIP` auth setting only enables insecure instant sign-in for listed review/demo emails in the `example.com` domain. For deployed auth, keep the allowlist as normal deploy config and keep the shared demo password in AWS Secrets Manager.

If review/demo access is enabled, create the matching `@example.com` Cognito users manually and keep their emails and shared password aligned with the deployed allowlist and demo password secret. The intended setup flow is: keep `DEMO_EMAIL_DOSTIP` and `DEMO_PASSWORD_DOSTIP` in the local root `.env`, run `bash scripts/setup-auth-secrets.sh --region <aws-region>`, then run `bash scripts/setup-github.sh`. We intentionally keep Cognito user creation manual instead of adding an automated provisioning script for these insecure review-only accounts.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

- [Kirill Markin](https://github.com/kirill-markin)
