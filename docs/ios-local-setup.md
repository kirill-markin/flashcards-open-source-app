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

Use **Flashcards Native Acceptance**, Debug and test-plan configuration **Acceptance**.
Run each plan on exactly one actual destination. The
[Mac procedure](macos-ci-cd.md#signed-local-native-acceptance) uses a separate signed plan.

| Readiness gate | Xcode plan | Destination | Coverage |
| --- | --- | --- | --- |
| `local-iphone-critical` | [LocalIPhoneCritical](../apps/ios/Flashcards/LocalIPhoneCritical.xctestplan) | Latest iPhone | FSRS parity and review outbox checks; card and rating persistence across relaunch, real linked-workspace sign-in and relaunch, live guest AI after consent, and fixture-driven notification routing |
| `local-ipad-critical` | [LocalIPadCritical](../apps/ios/Flashcards/LocalIPadCritical.xctestplan) | Latest iPad | Wide companion preserves the draft and revealed answer across sections |
| `local-ios18-critical` | [IOS18Critical](../apps/ios/Flashcards/IOS18Critical.xctestplan) | Actual 18.x iPhone or iPad | Card and rating persistence across relaunch |

Use the same latest iOS major for the iPhone and iPad. Independently establish
the selected inventory from the pinned plans and Xcode destination before
inspecting results. Record the actual OS, exact selection, every named result,
logs and `.xcresult` in the [ledger](release/evidence.md#release-ledger).
Unexpected skips, missing cases and failures block the gate. Use
[targeted recovery](release/evidence.md#targeted-recovery) for an affected
selected case. For changed behavior, use `LocalFull`, `LocalIPad` or
`IOS18Compatibility`, with `-only-testing:'<target>/<class>/<method>'` when
appropriate. Use the compatibility plan or filter
`LiveSmokeSettingsTests/testLiveSmokeLoginAndLinkedWorkspaceFlow()` there for
iOS 18 sign-in, session or Keychain changes. The disabled Cloud test workflow
retains `CloudSmoke` for historical evidence.

The manual card journey starts in an empty local guest workspace. It uses the
real editor and review UI and verifies the saved rating in local Progress after
relaunch. Use the [signed artifact check](release/ios.md#exact-artifact-checks)
for disconnected operation and the [independent-client check](release/evidence.md#independent-client-sync-check)
for sync. Check real notification permission and delivery when changed.

After [local configuration](#after-cloning), run from the repository root once
per table row. Keep the software keyboard available. The runner environment
passes the configured review email for the linked-workspace method. Verify the
[automation marker](ios-ci-cd.md#automation-marker) before interaction.

```bash
set -o pipefail
mkdir -p tmp
xcrun simctl list runtimes
xcrun simctl list devices available
xcrun simctl bootstatus '<simulator-uuid>' -b
TEST_RUNNER_FLASHCARDS_LIVE_REVIEW_EMAIL=apple-review@example.com \
xcodebuild \
  -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Native Acceptance" \
  -configuration Debug -testPlan '<plan>' -only-test-configuration Acceptance \
  -derivedDataPath "tmp/ios-derived-data" \
  -destination 'platform=iOS Simulator,id=<simulator-uuid>' \
  -parallel-testing-enabled NO \
  -resultBundlePath "tmp/ios-<gate>-<unique-run>.xcresult" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test \
  2>&1 | tee "tmp/ios-<gate>-<unique-run>.log"
```

Ad-hoc signing enables simulator app/runner signing and Keychain access.
Inspect full logs and `.xcresult` attachments, including warnings and failures.
Retain evidence before retrying and record measured duration and size.

## iOS 18 compatibility smoke

Use the current Xcode/SDK and pinned packages with deployment target 18.0.
If an 18.x simulator is unavailable, use a trusted iPhone or iPad on 18.x with
Developer Mode. In the command above, omit `simctl`, use
`-destination 'platform=iOS,id=<device-uuid>'`, add
`-allowProvisioningUpdates DEVELOPMENT_TEAM=<team-id>`, and replace
`CODE_SIGN_IDENTITY=-` with an installed Apple Development identity. Retain
`CODE_SIGNING_ALLOWED=YES` for app and runner signing. Tell the user before
downloading a runtime. If no suitable destination is available, record the
restriction under the [standing release policy](release/README.md#standing-best-effort-release-policy).

For the first release expanding iOS/iPadOS 18 support, or changes affecting
its OS-specific behavior, check the applicable surfaces on that destination
with disposable data and the verified [automation marker](ios-ci-cd.md#automation-marker).

- AI composer, transcript and Done with the keyboard open, including multiline input and send/stop.
- Long review text scrolls clear of bottom actions, and editor, pickers and scheduler inputs remain usable.
- Destructive workspace confirmation, cancellation and completion, and account deletion confirmation cancelled.
- Native notification permissions and reminder routing on a device that can receive the reminder.
- For persistence or sync changes, use the [signed artifact](release/ios.md#exact-artifact-checks)
  and [independent-client](release/evidence.md#independent-client-sync-check) checks on iOS 18.
