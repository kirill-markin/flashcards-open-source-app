# iOS CI/CD

The dedicated Mac Catalyst app uses the [Mac cloud and release procedure](macos-ci-cd.md).

This repository uses full local native acceptance followed by explicitly dispatched Xcode Cloud archive/signing for iOS releases. The GitHub-side AWS/Web release workflow does not start or wait for Xcode Cloud on `main`.
We do not aim for exhaustive iOS test coverage in this pipeline. The most trusted automated signal is the native simulator-backed live smoke because it exercises the real app closest to production behavior, while any non-smoke tests should stay targeted to important native contracts.

## Native release gate

Complete the [local native acceptance](ios-local-setup.md#local-native-acceptance) and unsigned device Release archive before dispatching **iOS Release Build** under the [iOS release procedure](release/ios.md#ios). Require all five schema-4 gates before App Review submission. Mac releases require their full [signed local acceptance](macos-ci-cd.md#signed-local-native-acceptance).

Exactly two Cloud workflows remain enabled:

| Workflow | ID | Required action |
| --- | --- | --- |
| `iOS Release Build` | `97ECE547-B59E-4970-ACFA-52ED8F6F7B29` | `Archive - iOS`, platform `IOS` |
| `macOS Release Build` | `9d704b65-5254-4f04-be24-bebc0f0cfc7d` | `Archive - macOS`, platform `MACOS` |

Both retain **Flashcards Open Source App**, Release configuration, App Store eligible preparation, managed signing, service/secrets, manual-main start settings and TestFlight internal-testers postactions. TestFlight distribution is neither XCTest nor proof of the exact new uploaded build. Do not create version-specific workflow copies.

`tests-workflow` (`d16e0e37-0c3a-4b2e-841f-669b636ba3e8`) and `macos-tests-workflow` (`b737acb2-4548-45bb-a7a3-8ac26bc8f111`) remain disabled with configuration and history intact. Do not dispatch them routinely or require them for new release readiness. Retain the original `CloudSmoke` plan and historical schema contracts, including failures; disabling a workflow never changes a recorded result.

Guest AI availability remains part of full local acceptance: guest AI must pass without login, and disabled/quota-exhausted responses are release failures. Cross-client live-smoke references are in [Release Gates](release-gates.md).

The acceptance plans set `diagnosticCollectionPolicy` to `Never`, disabling automatic diagnostic collection. This does not remove ordinary XCTest result/log records or the smoke harness's screenshot, hierarchy and diagnostic attachments; retain and inspect those in `.xcresult`, including failures. Record actual local-test/Cloud-archive elapsed times and diagnostic/export sizes in the release record.

## Supported OS destinations

The app supports iOS/iPadOS 18.0 onward with the current SDK and pinned packages. Local acceptance uses one latest iPhone, one latest iPad on the same latest iOS major, and one actual iOS 18.x iPhone or iPad for compatibility. Verify latest-OS eligibility against the actual local runtimes; an SDK version does not establish the destination OS. If a required local destination is unavailable, block release until it is available; a newer runtime or `My Mac` cannot substitute for iOS 18 evidence. Do not downgrade Xcode/SDK or add a routine Cloud test matrix.

Static PR checks establish neither native compilation nor runtime behavior. Every new release requires recorded complete native evidence and the [binary compatibility checks](release/ios.md#ios). The [iOS 18 manual checklist](ios-local-setup.md#ios-18-compatibility-smoke) applies to the first support expansion or changes affecting OS-specific behavior.

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

`FLASHCARDS_LIVE_REVIEW_EMAIL` is required in the UI-test runner when the selected plan includes login; the local acceptance plans do. See [local injection](ios-local-setup.md#local-native-acceptance).

## Cloud configuration preflight

Before each authorized dispatch, inspect the saved remote configuration of
both release workflows. Use the App Store Connect API first, starting with
`GET /v1/ciWorkflows/{workflowId}` and its relationships; use the Xcode Cloud UI
for settings the API does not expose, including environment values. Follow
[API access diagnosis](xcode-cloud-data-access.md#required-local-secrets) before
switching to the browser for an access failure.

1. Verify the intended SCM repository, branch/tag ref and resolved release SHA.
   Check that the workflow is enabled and its manual start conditions allow
   that ref; a push branch filter does not establish manual-start eligibility.
2. Verify the saved IDs/names/enabled states in [the workflow inventory](#native-release-gate): only the two release builds are enabled, and both test workflows remain disabled. Check the selected Xcode/macOS toolchain, project container, **Flashcards Open Source App** scheme, required platform-specific Archive action and App Store eligible preparation. Preserve the TestFlight internal-testers postaction; it does not establish native acceptance or uploaded-build identity.
3. Verify the production Release configuration, signing/distribution settings,
   and presence of the [required environment values](#xcode-cloud-inputs) for
   each workflow. Inspect non-secret service values for the intended production
   environment. Check any explicit `SENTRY_URL` against the endpoint that issued
   `SENTRY_AUTH_TOKEN`; do not print token contents, DSNs or other secrets, or
   replace masked secrets with empty values while editing unrelated settings.
4. Record workflow IDs, secret-free saved configuration readback, inspected settings and secret-presence results in the release ledger. Preserve actions, scheme, signing/distribution, environment/secrets and start settings. If temporary manual branch/tag-filter edits are necessary within the authorized release, record original and temporary filters, change only those filters and read back saved values before dispatch. Do not enable test workflows or automatic push builds as a shortcut.
5. Record the accepted run IDs and verify their source SHAs. After all accepted
   runs using the temporary filters finish, restore the original filters and
   verify saved readback; record restoration in the ledger. If dispatch fails
   with no accepted run, restore immediately. If other operators changed the
   filters meanwhile, reconcile the change instead of overwriting it blindly.

## Automation marker

iOS smoke and marketing screenshot runs drive the real app against a deployed backend, so every run
registers installations that seed cards and reviews. The app declares those installations as
automation and the backend then refuses to emit product analytics for them, permanently: the
declaration is described in [`analytics-audience.md`](analytics-audience.md#automation-installations)
and decided in `apps/ios/Flashcards/Flashcards/App/AutomationRun.swift`.

The process decision and preference protection are documented in [audience analytics](analytics-audience.md#automation-installations). For every manual or automated Apple check, including signed Release/TestFlight, set `FLASHCARDS_AUTOMATION_RUN=1` in the app process and verify `automation_run_decided` reports `isAutomation=true` before interaction. On Mac, use `bash scripts/ios/launch-macos-test-app.sh "<path/Nibomo.app>"`. A launch without verified marking is not test evidence.

The repository's own XCUITest harnesses set that variable through `XCUIApplication.launchEnvironment`
in `LiveSmokeLaunching.swift` and `MarketingManualScreenshotTestCase.swift`, so it reaches the app on
a physical device too. Any other automation that drives this app must set it the same way.

Every launch logs the decision, Debug/simulator/UI-test inputs and environment value under the `automation_run` category, so a
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
[full release runbook](release/README.md).

### Sentry environments

iOS telemetry is bucketed by Sentry environment. The only one that reflects real user impact is `production` (shipped App Store builds); developer builds report as `local`, and automated XCUITest runs report under simulator environments such as `ci-simulator` and `marketing-screenshot-simulator`. When triaging iOS Sentry signal, filter to `environment:production`; the non-production environments are test or developer noise and must not be read as user impact.

### App Hang policy

The app reports only fully-blocking app hangs: `enableReportNonFullyBlockingAppHangs` is disabled and `appHangTimeoutInterval` is set explicitly in `apps/ios/Flashcards/Flashcards/Observability/Sentry/SentryConfiguration.swift`. Non-fully-blocking "partial" hang samples are intentionally not reported, because on throttled, low-memory, or Low Power Mode devices they are dominated by device conditions rather than app code and are not individually actionable. CI-simulator app-hang events are additionally dropped client-side in `sanitizeSentryEvent` so test runs never create App Hang issues.
