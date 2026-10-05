# iOS Local Setup

## After cloning

Create your machine-local iOS config file:

```bash
cp apps/ios/Flashcards/Config/Local.xcconfig.example apps/ios/Flashcards/Config/Local.xcconfig
```

`Local.xcconfig` is gitignored and must be filled on each machine that builds the iOS app.

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
[iOS 18 compatibility smoke](#ios-18-compatibility-smoke) below.

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
iOS full test runs can take a bit more than 2 minutes locally, and that is normal.
Run the full existing smoke selection on one latest iPhone simulator runtime that is already downloaded locally. Use one additional iOS 18 destination only for the compatibility selection below.
Prefer an already booted local iPhone simulator on the selected iOS runtime. Reuse that exact device instead of booting a different one when possible.
Prefer the background CLI flow over opening heavy Xcode UI: `xcrun simctl bootstatus`, then `xcodebuild test`.
Do not open a visible iOS Simulator window for test runs unless the user explicitly asks for a visible simulator at that time.
Pass `-derivedDataPath "tmp/ios-derived-data"` for local CLI builds and tests so repeated runs reuse repo-local build artifacts instead of creating new global DerivedData directories.
If an iOS test fails, inspect the generated `.xcresult` bundle and read the relevant screenshots, attachments, and logs before changing code.
If a suitable simulator is already warmed, keep using it and avoid rebuilding unnecessarily.
If no suitable local iPhone simulator runtime is already available, downloading one is slow and large, so tell the user before starting that download.
For iOS, `My Mac` can be used only for iOS compile smoke-checks such as `build` or `build-for-testing`, not as a reliable destination for app-hosted unit tests.
Preferred local CLI examples:

```bash
xcrun simctl list devices available
xcrun simctl bootstatus <device-uuid> -b
xcodebuild -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" -scheme "Flashcards Open Source App" -derivedDataPath "tmp/ios-derived-data" -destination 'platform=iOS Simulator,id=<device-uuid>' test
xcodebuild -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" -scheme "Flashcards Open Source App" -derivedDataPath "tmp/ios-derived-data" -destination 'platform=iOS Simulator,id=<device-uuid>' -only-testing:'Flashcards Open Source App UI Tests/LiveSmokeSettingsTests/testLiveSmokeLocalNavigationFlow' test
```

## iOS 18 compatibility smoke

Every new iOS release requires these three existing native smokes on one actual
18.x destination, independently of the full latest-OS Xcode Cloud suite. Use
Cloud only when the [selected toolchain's catalog and independent selection](ios-ci-cd.md#supported-os-destinations)
permit it; otherwise this local run is mandatory before cloud release dispatch.
Retain valid evidence only under the [existing source comparison and reuse rules](release/evidence.md#resume-and-artifact-reuse).

Use the current Xcode/SDK and pinned packages with deployment target 18.0.
Inspect `xcrun simctl list runtimes` and `xcrun simctl list devices available`;
select one device whose runtime is actually iOS 18.x. If absent, install an
18.x runtime only if the selected Xcode supports it, or use a physical iPhone
or iPad actually running 18.x. Do not count a newer runtime or `My Mac` as
18 evidence. When local execution is required and neither is available, record
the exact runtime/toolchain restriction and block the new release until resolved.
Tell the user before downloading a runtime; source implementation does not
require provisioning it.

After the configuration setup above, run from the repository root. The login
smoke requires the configured review-account email in the UI-test runner.
Replace the example email below if your review account differs. The
`TEST_RUNNER_` prefix makes `xcodebuild` pass `FLASHCARDS_LIVE_REVIEW_EMAIL`
to the runner with the prefix removed; setting it only for the app process
does not satisfy `configuredReviewEmail()`. Running `ci_post_clone.sh`
separately generates build configuration but cannot export its loaded `.env`
values into this command's environment.

```bash
xcrun simctl bootstatus <ios-18-device-uuid> -b
TEST_RUNNER_FLASHCARDS_LIVE_REVIEW_EMAIL=apple-review@example.com \
xcodebuild \
  -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Open Source App" \
  -derivedDataPath "tmp/ios-derived-data" \
  -destination 'platform=iOS Simulator,id=<ios-18-device-uuid>' \
  -resultBundlePath "tmp/ios-18-smoke-<unique-run>.xcresult" \
  -only-testing:'Flashcards Open Source App UI Tests/LiveSmokeSettingsTests/testLiveSmokeGuestNavigationFlow' \
  -only-testing:'Flashcards Open Source App UI Tests/LiveSmokeReviewTests/testLiveSmokeManualCardReviewFlow' \
  -only-testing:'Flashcards Open Source App UI Tests/LiveSmokeSettingsTests/testLiveSmokeLoginAndLinkedWorkspaceFlow' \
  CODE_SIGNING_ALLOWED=YES \
  CODE_SIGN_IDENTITY=- \
  test
```

The simulator signing overrides enable ad-hoc signing for the app and UI-test
runner, including their keychain access.

For hardware, omit `simctl` and use `-destination 'platform=iOS,id=<device-uuid>'`.
Use a trusted device with Developer Mode enabled and a development team that
can provision both the app and UI-test runner. Keep the same `TEST_RUNNER_`
email injection and add `-allowProvisioningUpdates`, `CODE_SIGNING_ALLOWED=YES`
and `DEVELOPMENT_TEAM=<team-id>` to the `xcodebuild` command before `test`.
Replace the simulator-only `CODE_SIGN_IDENTITY=-` with a real installed
Apple Development signing identity for that team.
The command-line signing override is required because the UI-test target sets
`CODE_SIGNING_ALLOWED=NO` in both Debug and Release; setting only a development
team does not enable runner signing. Keep the software keyboard available.
Do not create a duplicate suite
or relax stable accessibility identifiers to accommodate older presentation.
Inspect the `.xcresult` and require all three tests to execute and pass; skipped
or unselected tests provide no evidence. Record the exact source SHA, Xcode/SDK,
device and OS version, selected tests, named results, full logs and result
bundle/run link in the existing [release ledger](release/evidence.md#release-ledger),
with manual results when required. Keep the latest full existing Cloud smoke gate independently.

For the first public release expanding support to iOS/iPadOS 18, or changes
affecting OS-specific behavior, also complete this short manual checklist on
that same 18.x destination using an isolated workspace and disposable cards:

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
