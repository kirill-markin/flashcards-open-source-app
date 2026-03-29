# iOS CI/CD

This repository uses Xcode Cloud as the native iOS release gate and distribution path, and the main GitHub release orchestrator waits for the matching Xcode Cloud checks on the same `main` SHA when `apps/ios` changed.

## Native release gate

The intended iOS release order is:

1. Native XCTest unit and app-hosted checks
2. Native XCUITest live smoke in `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift`
3. Archive and distribution from Xcode Cloud

The live smoke flow is intentionally one connected story across Review, Cards, AI, and Settings. It uses the same linked-account contract as the other clients:

- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift`
- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt`
- Web: `apps/web/e2e/live-smoke.spec.ts`

The shared scheme for cloud builds is:

- `apps/ios/Flashcards/Flashcards Open Source App.xcodeproj/xcshareddata/xcschemes/Flashcards Open Source App.xcscheme`

## Xcode Cloud inputs

Xcode Cloud receives the same service configuration values that local builds use through `apps/ios/Flashcards/ci_scripts/ci_post_clone.sh`.

The required environment values are documented in [`docs/ios-local-setup.md`](ios-local-setup.md). Every Xcode Cloud workflow that builds this iOS project must define:

- `XCODE_CLOUD_DEVELOPMENT_TEAM`
- `XCODE_CLOUD_APP_BUNDLE_IDENTIFIER`
- `XCODE_CLOUD_API_BASE_URL`
- `XCODE_CLOUD_AUTH_BASE_URL`
- `XCODE_CLOUD_PRIVACY_POLICY_URL`
- `XCODE_CLOUD_TERMS_OF_SERVICE_URL`
- `XCODE_CLOUD_SUPPORT_URL`
- `XCODE_CLOUD_SUPPORT_EMAIL_ADDRESS`

`ci_post_clone.sh` fails the build before `xcodebuild` if any required variable is missing or if any URL value is malformed for `.xcconfig` usage.

If the workflow injects the review/demo email for the live smoke flow explicitly, use `FLASHCARDS_LIVE_REVIEW_EMAIL`.

Recommended value for this repository:

- `FLASHCARDS_LIVE_REVIEW_EMAIL=apple-review@example.com`

This keeps the Xcode Cloud live smoke workflow pinned to the intended review/demo account instead of relying on the default value embedded in the UI test code.

`FLASHCARDS_LIVE_REVIEW_EMAIL` remains optional.

## Monitoring expectations

After pushing to `main`, watch both the main GitHub release orchestrator and the Xcode Cloud workflow through the full archive and distribution path. Do not assume the iOS release completed just because the AWS part of the GitHub workflow is green.

If the native live smoke gate fails, or if archive/distribution does not continue after the smoke gate, the main release orchestrator must also fail for that SHA.
