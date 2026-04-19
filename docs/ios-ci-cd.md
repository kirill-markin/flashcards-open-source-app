# iOS CI/CD

This repository uses Xcode Cloud as the native iOS release gate and distribution path. The GitHub-side AWS/Web release workflow does not wait for Xcode Cloud on `main`.
We do not aim for exhaustive iOS test coverage in this pipeline. The most trusted automated signal is the native simulator-backed live smoke because it exercises the real app closest to production behavior, while any non-smoke tests should stay targeted to important native contracts.

## Native release gate

The intended iOS release order is:

1. Native XCUITest grouped live smoke in the grouped `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift` files
2. Archive and distribution from Xcode Cloud

The live smoke coverage is split into independent grouped flows across Review, Cards, AI, and Settings. Only one grouped smoke signs into the linked demo account, creates an isolated linked workspace, verifies relaunch persistence, and deletes that workspace before exit. The remaining grouped smokes stay guest/local and do not perform login.

Guest AI availability is part of the iOS release contract. The guest AI smoke must pass without login, and a guest-AI-disabled or guest-quota-exhausted response is treated as a real release failure.

The grouped smoke suite still maps to the same top-level live-smoke contract as the other clients:

- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift`
- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/LiveSmokeTest.kt`
- Web: `apps/web/e2e/live-smoke.spec.ts`

The shared scheme for cloud builds is:

- `apps/ios/Flashcards/Flashcards Open Source App.xcodeproj/xcshareddata/xcschemes/Flashcards Open Source App.xcscheme`

The shared cloud scheme runs the UI smoke bundle only. FSRS parity tests remain in `apps/ios/Flashcards/FlashcardsTests` for focused local/native verification and are not part of the Xcode Cloud release gate.

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

If the workflow injects the review/demo email for the login smoke path explicitly, use `FLASHCARDS_LIVE_REVIEW_EMAIL`.

Recommended value for this repository:

- `FLASHCARDS_LIVE_REVIEW_EMAIL=apple-review@example.com`

This keeps the login smoke path pinned to the intended review/demo account instead of relying on the default value embedded in the UI test code.

`FLASHCARDS_LIVE_REVIEW_EMAIL` remains optional.

## Monitoring expectations

After pushing to `main`, watch Xcode Cloud separately through the full archive and distribution path. Do not assume the iOS release completed just because the GitHub-side AWS/Web release workflow is green.
