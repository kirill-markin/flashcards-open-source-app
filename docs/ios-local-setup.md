# iOS Local Setup

## After cloning

Create your machine-local iOS config file:

```bash
cp apps/ios/Flashcards/Config/Local.xcconfig.example apps/ios/Flashcards/Config/Local.xcconfig
```

`Local.xcconfig` is gitignored and must be filled on each machine that builds the iOS app.

Debug selects `com.flashcards-open-source-app.app.development` after loading this file,
isolating its data and private credentials from Release. Physical-device signing must
provision that development App ID. Release uses the configured production identity.
External capture signing overrides remain explicit; see the
[signed Mac procedure](macos-ci-cd.md#signed-local-native-acceptance).

If you want local signed archives to reuse the same values as Xcode Cloud, keep
the `XCODE_CLOUD_*` keys in the repo-root `.env` and regenerate
`Local.xcconfig` with:

```bash
sh apps/ios/Flashcards/ci_scripts/ci_post_clone.sh
```

The script reads the same `XCODE_CLOUD_*` keys from Xcode Cloud workflow
environment variables in CI and from the local root `.env` outside Xcode Cloud.

## Required values

The app reads hosted service, observability, and legal/support values from `Local.xcconfig`.

```xcconfig
APP_BUNDLE_IDENTIFIER = com.flashcards-open-source-app.app
API_BASE_URL = https:/$()/api.nibomo.com/v1
AUTH_BASE_URL = https:/$()/auth.nibomo.com
PRIVACY_POLICY_URL = https:/$()/nibomo.com/privacy/
TERMS_OF_SERVICE_URL = https:/$()/nibomo.com/terms/
SUPPORT_URL = https:/$()/nibomo.com/support/
SUPPORT_EMAIL_ADDRESS = kirill+flashcards@kirill-markin.com
FLASHCARDS_SENTRY_DSN =
FLASHCARDS_SENTRY_ENVIRONMENT = local
FLASHCARDS_SENTRY_TRACES_SAMPLE_RATE = 0.0
```

Add `DEVELOPMENT_TEAM` when you need to run on a physical device or create signed archives:

```xcconfig
DEVELOPMENT_TEAM = ABCDE12345
```

Important: Xcode `.xcconfig` treats `//` as a comment, so URL values must use `https:/$()/...` instead of literal `https://...`.

## Xcode Cloud

Set the same values in the Xcode Cloud workflow environment. These values are mandatory for Xcode Cloud builds of the iOS app:

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

Optional Sentry values:

- `XCODE_CLOUD_SENTRY_ENVIRONMENT` (defaults to `production` in Xcode Cloud and `local` outside it)
- `XCODE_CLOUD_SENTRY_TRACES_SAMPLE_RATE` (defaults to `0.0`)
- `SENTRY_URL` (only needed for a non-default Sentry endpoint; the URL must match the endpoint that issued `SENTRY_AUTH_TOKEN`)

`apps/ios/Flashcards/ci_scripts/ci_post_clone.sh` writes those values into the generated `Config/Local.xcconfig` file during Xcode Cloud builds.
The same script can be run locally and will read the repo-root `.env` when those
keys are present there. `apps/ios/Flashcards/ci_scripts/ci_post_xcodebuild.sh`
reads Sentry upload values from Xcode Cloud, or from the repo-root `.env.sentry`
and `.env` outside Xcode Cloud.

Xcode Cloud builds now fail in `ci_post_clone.sh` before `xcodebuild` starts if any required build-time value is missing or if any URL value does not start with `https:/$()/`. Archives fail in `ci_post_xcodebuild.sh` if any required Sentry upload value is missing, if `sentry-cli` cannot be downloaded, or if its checksum does not match.

`SENTRY_CLI_EXPECTED_SHA256` is an optional non-secret override for the pinned `sentry-cli` binary checksum. Set it only when intentionally bumping the pinned CLI version.

The iOS release procedure is documented in [iOS Release Procedure](release/ios.md#ios).

For Xcode Cloud workflows that select linked-workspace login smokes, also set:

- `FLASHCARDS_LIVE_REVIEW_EMAIL=apple-review@example.com`

`FLASHCARDS_LIVE_REVIEW_EMAIL` is required in the UI-test runner for login
smokes. Guest-only runs do not need it. For local CLI injection, see the
[local native acceptance](#local-native-acceptance) below.

## Local App Store archive

Xcode Cloud remains the canonical iOS release path, but a local signed archive can
be used when Xcode Cloud is unavailable or when an urgent manual upload is needed.

Before creating a local App Store archive:

1. Regenerate `apps/ios/Flashcards/Config/Local.xcconfig` from the repo-root `.env`:

```bash
sh apps/ios/Flashcards/ci_scripts/ci_post_clone.sh
```

2. Make sure the local values match the intended Xcode Cloud release values,
including at least:

- `DEVELOPMENT_TEAM`
- `APP_BUNDLE_IDENTIFIER`
- `API_BASE_URL`
- `AUTH_BASE_URL`
- `PRIVACY_POLICY_URL`
- `TERMS_OF_SERVICE_URL`
- `SUPPORT_URL`
- `SUPPORT_EMAIL_ADDRESS`

3. Set a local-only iOS build number override in
`apps/ios/Flashcards/Config/Local.xcconfig` with `APP_CURRENT_PROJECT_VERSION`.

The local signed build number must be higher than the latest relevant build number
that could conflict in App Store Connect, including queued or recently uploaded
Xcode Cloud builds for the same app version.

Example local override:

```xcconfig
APP_CURRENT_PROJECT_VERSION = 204
```

The repository default build number in `Base.xcconfig` is only a stable fallback.
Do not treat it as the signed release build number.

Archive and export example:

```bash
xcodebuild \
  -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Open Source App" \
  -configuration Release \
  -derivedDataPath "tmp/ios-derived-data" \
  -destination "generic/platform=iOS" \
  -archivePath "tmp/ios-archives/Flashcards-Review.xcarchive" \
  -allowProvisioningUpdates \
  archive
```

Manual `xcodebuild archive` does not run Xcode Cloud post-build hooks. Before
exporting the archive, upload the archive dSYMs with the same hook Xcode Cloud
runs automatically:

```bash
CI_ARCHIVE_PATH="tmp/ios-archives/Flashcards-Review.xcarchive" \
  sh apps/ios/Flashcards/ci_scripts/ci_post_xcodebuild.sh
```

Export example:

```bash
xcodebuild \
  -exportArchive \
  -archivePath "tmp/ios-archives/Flashcards-Review.xcarchive" \
  -exportPath "tmp/ios-export" \
  -exportOptionsPlist "tmp/ios-export-options-app-store-connect.plist" \
  -allowProvisioningUpdates
```

Use `method = app-store-connect` in the export options plist for App Store Connect
distribution.

## Local Testing Rules

The iOS Xcode project is file-synchronized, so new Swift files can be added without manual `project.pbxproj` edits.
Use the [repository testing policy](../AGENTS.md#testing-philosophy) and the acceptance plans below. Record measured build/test durations.
Prefer an already booted local iPhone simulator on the selected iOS runtime. Reuse that exact device instead of booting a different one when possible.
Prefer the background CLI flow over opening heavy Xcode UI: `xcrun simctl bootstatus`, then `xcodebuild test`.
Do not open a visible iOS Simulator window for test runs unless the user explicitly asks for a visible simulator at that time.
Pass `-derivedDataPath "tmp/ios-derived-data"` for local CLI builds and tests so repeated runs reuse repo-local build artifacts instead of creating new global DerivedData directories.
If an iOS test fails, inspect the generated `.xcresult` bundle and read the relevant screenshots, attachments, and logs before changing code.
If a suitable simulator is already warmed, keep using it and avoid rebuilding unnecessarily.
If no suitable local iPhone simulator runtime is already available, downloading one is slow and large, so tell the user before starting that download.
For iOS, `My Mac` can be used only for iOS compile smoke-checks such as `build` or `build-for-testing`, not as a reliable destination for app-hosted unit tests.

## Local native acceptance

For every new release, complete the unsigned device Release archive in [the release procedure](release/ios.md#ios) and all three local test gates below on the accepted native inputs. Run one destination per invocation, sequentially; latest iPhone and iPad must use the same latest supported iOS major. Pin device UUID/model, actual OS, Xcode/SDK, exact source SHA, scheme, test plan, test-plan configuration and build configuration in the [ledger](release/evidence.md#release-ledger).

Use shared scheme **Flashcards Native Acceptance**, `-only-test-configuration Acceptance` (the test-plan configuration), and Debug build configuration. The original **Flashcards Open Source App** archive scheme does not establish these local gates. Catalyst acceptance uses the explicit [LocalMac plan](macos-ci-cd.md#signed-local-native-acceptance).

| Gate / plan | Exactly one destination | Required inventory |
| --- | --- | --- |
| `local-full` / `LocalFull` | Latest iPhone | Entire existing `Flashcards Open Source App Tests` non-UI bundle and all eligible `Flashcards Open Source App UI Tests` flows. UI coverage includes Review, Cards, AI, Settings, own-key persistence, ordinary iPhone, RTL and the four phone-eligible consent flows. |
| `local-ipad` / `LocalIPad` | Latest iPad | `LiveSmokeIPadTests/testIPadCompanionPreservesDraftAndRevealedReviewAcrossSections()`, `LiveSmokeIPadTests/testIPadReviewHardwareKeysRespectFilterAndRateCards()`, `LiveSmokeAIConsentTests/testWideCompanionAndCardHandoffStayBlockedAfterWithdrawal()` |
| `local-ios18` / `IOS18Compatibility` | Actual iOS/iPadOS 18.x iPhone or iPad | `LiveSmokeSettingsTests/testLiveSmokeGuestNavigationFlow()`, `LiveSmokeReviewTests/testLiveSmokeManualCardReviewFlow()`, `LiveSmokeSettingsTests/testLiveSmokeLoginAndLinkedWorkspaceFlow()` |

The full phone plan excludes `MarketingScreenshotsTests`, `LiveSmokeIPadTests`, `LiveSmokeMacCatalystTests` and only the wide-companion consent method. The iPad plan selects both iPad methods and that consent method; the compatibility plan selects exactly the three named methods. `CloudSmoke` is retained for historical evidence and disabled Cloud test configuration; it is not a new release gate. These are plan exclusions, not passing or skipped test results. Independently establish the full expected discovered inventory from the pinned scheme, plan, source and Xcode selection before inspecting passes; retain every selected non-UI/UI method and its native result. Do not infer completeness from these descriptions or a fixed count. Record unexpected skips, failures, missing or unselected required methods as blocking; acceptance requires every configured required case to execute and pass.

Configure the review email in the UI-test runner for all plans. `TEST_RUNNER_` passes the variable to the runner with that prefix removed; setting it only in the app process or a separately invoked `ci_post_clone.sh` does not satisfy `configuredReviewEmail()`. The plans and UI launcher set `FLASHCARDS_AUTOMATION_RUN=1`; verify `automation_run_decided` reports `isAutomation=true` before app interaction. Keep software keyboard input available.

After local configuration setup, inspect installed runtimes/devices and substitute actual UUIDs and unique result paths. Run from the repository root; each command has one explicit plan and one destination. Keep `set -o pipefail` when using `tee`, so logging cannot hide a failure:

```bash
set -o pipefail
mkdir -p tmp
xcrun simctl list runtimes
xcrun simctl list devices available
xcrun simctl bootstatus <latest-iphone-uuid> -b
TEST_RUNNER_FLASHCARDS_LIVE_REVIEW_EMAIL=apple-review@example.com \
xcodebuild \
  -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Native Acceptance" \
  -configuration Debug -testPlan LocalFull -only-test-configuration Acceptance \
  -derivedDataPath "tmp/ios-derived-data" \
  -destination 'platform=iOS Simulator,id=<latest-iphone-uuid>' \
  -parallel-testing-enabled NO \
  -resultBundlePath "tmp/ios-local-full-<unique-run>.xcresult" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test \
  2>&1 | tee "tmp/ios-local-full-<unique-run>.log"

xcrun simctl bootstatus <latest-ipad-uuid> -b
TEST_RUNNER_FLASHCARDS_LIVE_REVIEW_EMAIL=apple-review@example.com \
xcodebuild \
  -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Native Acceptance" \
  -configuration Debug -testPlan LocalIPad -only-test-configuration Acceptance \
  -derivedDataPath "tmp/ios-derived-data" \
  -destination 'platform=iOS Simulator,id=<latest-ipad-uuid>' \
  -parallel-testing-enabled NO \
  -resultBundlePath "tmp/ios-local-ipad-<unique-run>.xcresult" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test \
  2>&1 | tee "tmp/ios-local-ipad-<unique-run>.log"
```

The ad-hoc signing overrides enable simulator app/runner signing and their Keychain access. Inspect full logs, named results and `.xcresult` attachments even after a successful command. The plans' `diagnosticCollectionPolicy=Never` leaves ordinary XCTest logs/results and explicit screenshot/hierarchy attachments available; retain failure artifacts before rerunning. Record measured durations and evidence sizes separately from targets.

During diagnosis, append `-only-testing:'<target>/<class>/<method>'` before `test` to rerun an affected selected method. Such filtered results are diagnostic evidence, not a complete acceptance gate. After fixes, require a complete all-green affected plan on accepted inputs; retain successful unchanged gates only under [bounded source equivalence](release/evidence.md#resume-and-artifact-reuse). Do not force new native runs for docs-only/unrelated changes when that comparison proves all relevant native inputs unchanged. Do not reuse failed or interrupted results as passes.

## iOS 18 compatibility smoke

Every new release requires the `IOS18Compatibility` plan on one actual 18.x destination locally, in addition to latest-iPhone full acceptance and focused latest-iPad acceptance. Cloud test workflows remain disabled.

Use the current Xcode/SDK and pinned packages with deployment target 18.0. Inspect installed runtimes/devices; if no supported 18.x simulator is available, use a physical iPhone or iPad actually running 18.x. Tell the user before downloading a runtime. A newer runtime or `My Mac` provides no 18.x evidence. If neither eligible simulator nor hardware is available, record the exact toolchain/runtime restriction and block release.

```bash
set -o pipefail
mkdir -p tmp
xcrun simctl bootstatus <ios-18-device-uuid> -b
TEST_RUNNER_FLASHCARDS_LIVE_REVIEW_EMAIL=apple-review@example.com \
xcodebuild \
  -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Native Acceptance" \
  -configuration Debug -testPlan IOS18Compatibility -only-test-configuration Acceptance \
  -derivedDataPath "tmp/ios-derived-data" \
  -destination 'platform=iOS Simulator,id=<ios-18-device-uuid>' \
  -parallel-testing-enabled NO \
  -resultBundlePath "tmp/ios-local-ios18-<unique-run>.xcresult" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test \
  2>&1 | tee "tmp/ios-local-ios18-<unique-run>.log"
```

For hardware, omit `simctl`, use `-destination 'platform=iOS,id=<device-uuid>'`, and replace `CODE_SIGN_IDENTITY=-` with a real installed Apple Development identity. Use a trusted device with Developer Mode, add `-allowProvisioningUpdates` and `DEVELOPMENT_TEAM=<team-id>`, and retain `CODE_SIGNING_ALLOWED=YES`: the test targets disable iOS signing by default, so a team alone does not enable runner signing. Keep runner email injection and the same plan/configuration. Require all three named tests to execute and pass, and record exact source/toolchain/destination, selection, logs and result bundle in the ledger. Do not create a duplicate suite or relax stable identifiers for older presentation.

For the first public release expanding support to iOS/iPadOS 18, or changes
affecting OS-specific behavior, also complete this short manual checklist on
that same 18.x destination using an isolated workspace and disposable cards. Set `FLASHCARDS_AUTOMATION_RUN=1` in the app process and verify `automation_run_decided` reports `isAutomation=true` before interacting:

1. Open AI, type with the software keyboard, send/stop a response, dismiss and
   reopen the keyboard. Verify the composer, transcript and Done button remain
   visible, tappable and clear of the keyboard/tab bar, including multiline input.
2. Create a card, reveal its answer and rate it. Scroll long front/back text;
   verify the bottom actions remain reachable and do not cover the last content.
3. Open a destructive workspace confirmation: check disabled/enabled states,
   red role styling, cancel, progress and completion on disposable data. Inspect
   account deletion confirmation and cancel without deleting the review account.
4. Open tag/deck and attachment pickers, search Cards/Tags/Decks, return to the
   same flow, and edit scheduler fields with the keyboard and Done button.
5. Configure reminders through the native permissions flow; verify a scheduled
   reminder opens the intended review surface on a device supporting delivery.
6. After online bootstrap, go offline, create a card, relaunch and review it.
   Reconnect, sync the linked workspace, and confirm the card/review persist
   after another relaunch and appear in another supported client.
