# iOS CI/CD

This repository uses Xcode Cloud as the explicitly dispatched native iOS release gate and distribution path. The GitHub-side AWS/Web release workflow does not start or wait for Xcode Cloud on `main`.
We do not aim for exhaustive iOS test coverage in this pipeline. The most trusted automated signal is the native simulator-backed live smoke because it exercises the real app closest to production behavior, while any non-smoke tests should stay targeted to important native contracts.

## Native release gate

Run the separate Xcode Cloud test and archive workflows in parallel for the
release SHA. Follow the [iOS release procedure](manual-production-release.md#ios)
for their completion gates, warning handling, and App Review submission.

The live smoke coverage is split into independent grouped flows across Review, Cards, AI, and Settings. Only one grouped smoke signs into the linked review account, creates an isolated linked workspace, verifies relaunch persistence, and deletes that workspace before exit. The remaining grouped smokes stay guest/local and do not perform login.

Guest AI availability is part of the iOS release contract. The guest AI smoke must pass without login, and a guest-AI-disabled or guest-quota-exhausted response is treated as a real release failure.

The grouped smoke suite still maps to the same top-level live-smoke contract as the other clients:

- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift`
- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/LiveSmokeTest.kt`
- Web: `apps/web/e2e/live-smoke.spec.ts`

The shared scheme for cloud builds is:

- `apps/ios/Flashcards/Flashcards Open Source App.xcodeproj/xcshareddata/xcschemes/Flashcards Open Source App.xcscheme`

The shared cloud scheme runs the UI smoke bundle only. FSRS parity tests remain in `apps/ios/Flashcards/FlashcardsTests/Review` for focused local/native verification and are not part of the Xcode Cloud release gate.

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
- `XCODE_CLOUD_SENTRY_DSN` (secure workflow value; do not commit the real DSN)

Signed archive workflows must also define the Sentry debug-file upload values:

- `SENTRY_AUTH_TOKEN` (secure secret)
- `SENTRY_ORG`
- `SENTRY_IOS_PROJECT`

Optional Sentry environment values:

- `XCODE_CLOUD_SENTRY_ENVIRONMENT` (defaults to `production` in Xcode Cloud)
- `XCODE_CLOUD_SENTRY_TRACES_SAMPLE_RATE` (defaults to `0.0`)
- `SENTRY_URL` (only needed for a non-default Sentry endpoint; the URL must match the endpoint that issued `SENTRY_AUTH_TOKEN`)

`ci_post_clone.sh` fails the build before `xcodebuild` if any required build-time variable is missing or if any URL value is malformed for `.xcconfig` usage. `ci_post_xcodebuild.sh` fails the archive if any required Sentry upload value is missing, if `sentry-cli` cannot be downloaded, or if the downloaded binary fails SHA-256 verification.

`SENTRY_CLI_EXPECTED_SHA256` is an optional non-secret override for the pinned `sentry-cli` binary checksum. Set it only when intentionally bumping the pinned CLI version.

If the workflow injects the review email for the login smoke path explicitly, use `FLASHCARDS_LIVE_REVIEW_EMAIL`.

Recommended value for this repository:

- `FLASHCARDS_LIVE_REVIEW_EMAIL=apple-review@example.com`

This keeps the login smoke path pinned to the intended review account instead of relying on the default value embedded in the UI test code.

`FLASHCARDS_LIVE_REVIEW_EMAIL` remains optional.

## Automation marker

iOS smoke and marketing screenshot runs drive the real app against a deployed backend, so every run
registers installations that seed cards and reviews. The app declares those installations as
automation and the backend then refuses to emit product analytics for them, permanently: the
declaration is described in [`analytics-audience.md`](analytics-audience.md#automation-installations)
and decided in `apps/ios/Flashcards/Flashcards/App/AutomationRun.swift`.

The decision combines two positive inputs, and neither covers the other:

- the app is running on a simulator, which needs no configuration and catches local runs and the
  simulator-backed Xcode Cloud tests
- `FLASHCARDS_AUTOMATION_RUN` is set to `1`, `true` or `yes` in the app process environment, which is
  the only input that works in a cloud device farm on real hardware

Setting `FLASHCARDS_AUTOMATION_RUN` to `0`, `false` or `no` (trimmed, case-insensitive, like the
affirmative values) overrides both inputs and declares the run human. Because the simulator input
cannot be turned off and the backend marker is sticky, that override is the only way to exercise the
real install and ingest path from a simulator; it is logged separately from an unset variable, so an
unmarked run still explains itself.

The repository's own XCUITest harnesses set that variable through `XCUIApplication.launchEnvironment`
in `LiveSmokeLaunching.swift` and `MarketingManualScreenshotTestCase.swift`, so it reaches the app on
a physical device too. Any other automation that drives this app must set it the same way.

Every launch logs the decision and all three of its inputs under the `automation_run` category, so a
run that should have been marked and was not is diagnosable from the run's own log.
The line is emitted at default level, so it is both streamable live and persisted for later reading.

On a simulator, stream it while the run is in progress:

```bash
xcrun simctl spawn booted log stream --predicate 'category == "automation_run"'
```

On real hardware there is no `simctl`, and a device-farm run has no booted simulator to stream, so
the recipe above cannot reach it. A simulator run is marked unless `FLASHCARDS_AUTOMATION_RUN`
carries a negative value, so that stream recipe is how an unexpected override is confirmed. On a
device, collect the log from a connected device and read the archive afterwards:

```bash
log collect --device --last 10m --output automation-run.logarchive
log show --archive automation-run.logarchive --predicate 'category == "automation_run"'
```

In a device farm the device is not connected to your machine, so read the same category from the
device log inside the run's result bundle, or from the sysdiagnose the farm returns, with the same
`log show --archive ... --predicate ...` command.

## Release operation

A human or authorized AI operates Xcode Cloud under the
[full release runbook](release-current-version.md).

### Sentry environments

iOS telemetry is bucketed by Sentry environment. The only one that reflects real user impact is `production` (shipped App Store builds); developer builds report as `local`, and automated XCUITest runs report under simulator environments such as `ci-simulator` and `marketing-screenshot-simulator`. When triaging iOS Sentry signal, filter to `environment:production`; the non-production environments are test or developer noise and must not be read as user impact.

### App Hang policy

The app reports only fully-blocking app hangs: `enableReportNonFullyBlockingAppHangs` is disabled and `appHangTimeoutInterval` is set explicitly in `apps/ios/Flashcards/Flashcards/Observability/Sentry/SentryConfiguration.swift`. Non-fully-blocking "partial" hang samples are intentionally not reported, because on throttled, low-memory, or Low Power Mode devices they are dominated by device conditions rather than app code and are not individually actionable. CI-simulator app-hang events are additionally dropped client-side in `sanitizeSentryEvent` so test runs never create App Hang issues.
