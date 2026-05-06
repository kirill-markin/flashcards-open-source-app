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

The app reads hosted service and legal/support values from `Local.xcconfig`.

```xcconfig
APP_BUNDLE_IDENTIFIER = com.flashcards-open-source-app.app
API_BASE_URL = https:/$()/api.flashcards-open-source-app.com/v1
AUTH_BASE_URL = https:/$()/auth.flashcards-open-source-app.com
PRIVACY_POLICY_URL = https:/$()/flashcards-open-source-app.com/privacy/
TERMS_OF_SERVICE_URL = https:/$()/flashcards-open-source-app.com/terms/
SUPPORT_URL = https:/$()/flashcards-open-source-app.com/support/
SUPPORT_EMAIL_ADDRESS = kirill+flashcards@kirill-markin.com
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

`apps/ios/Flashcards/ci_scripts/ci_post_clone.sh` writes those values into the generated `Config/Local.xcconfig` file during Xcode Cloud builds.
The same script can be run locally and will read the repo-root `.env` when those
keys are present there.

Xcode Cloud builds now fail in `ci_post_clone.sh` before `xcodebuild` starts if any required value is missing or if any URL value does not start with `https:/$()/`.

The iOS release-gate and monitoring expectations are documented in [`docs/ios-ci-cd.md`](ios-ci-cd.md).

If Xcode Cloud should pin the live smoke flow to the standard review account explicitly, also set:

- `FLASHCARDS_LIVE_REVIEW_EMAIL=apple-review@example.com`

`FLASHCARDS_LIVE_REVIEW_EMAIL` remains optional.

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
Run iOS tests locally when they help validate the requested change or when the user asks for them.
iOS full test runs can take a bit more than 2 minutes locally, and that is normal.
If iOS tests are requested, run them only on one specific iPhone simulator runtime that is already downloaded locally.
Prefer an already booted local iPhone simulator on the final supported iOS runtime. Reuse that exact device instead of booting a different one when possible.
Prefer the background CLI flow over opening heavy Xcode UI: `xcrun simctl bootstatus`, then `xcodebuild test`.
Do not open a visible iOS Simulator window for test runs unless the user explicitly asks for a visible simulator at that time.
Pass `-derivedDataPath "tmp/ios-derived-data"` for local CLI builds and tests so repeated runs reuse repo-local build artifacts instead of creating new global DerivedData directories.
If an iOS test fails, inspect the generated `.xcresult` bundle and read the relevant screenshots, attachments, and logs before changing code.
If a suitable simulator is already warmed, keep using it and avoid rebuilding unnecessarily.
If no suitable local iPhone simulator runtime is already available, do not trigger extra runtime downloads or installations. Stop and ask the user how to proceed.
For iOS, `My Mac` can be used only for iOS compile smoke-checks such as `build` or `build-for-testing`, not as a reliable destination for app-hosted unit tests.
Preferred local CLI examples:

```bash
xcrun simctl list devices available
xcrun simctl bootstatus <device-uuid> -b
xcodebuild -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" -scheme "Flashcards Open Source App" -derivedDataPath "tmp/ios-derived-data" -destination 'platform=iOS Simulator,id=<device-uuid>' test
xcodebuild -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" -scheme "Flashcards Open Source App" -derivedDataPath "tmp/ios-derived-data" -destination 'platform=iOS Simulator,id=<device-uuid>' -only-testing:'Flashcards Open Source App UI Tests/LiveSmokeSettingsTests/testLiveSmokeLocalNavigationFlow' test
```
