# iOS Local Setup

## After cloning

Create your machine-local iOS config file:

```bash
cp apps/ios/Flashcards/Config/Local.xcconfig.example apps/ios/Flashcards/Config/Local.xcconfig
```

`Local.xcconfig` is gitignored and must be filled on each machine that builds the iOS app.

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

Xcode Cloud builds now fail in `ci_post_clone.sh` before `xcodebuild` starts if any required value is missing or if any URL value does not start with `https:/$()/`.

The iOS release-gate and monitoring expectations are documented in [`docs/ios-ci-cd.md`](ios-ci-cd.md).

If Xcode Cloud should pin the live smoke flow to the standard review/demo account explicitly, also set:

- `FLASHCARDS_LIVE_REVIEW_EMAIL=apple-review@example.com`

`FLASHCARDS_LIVE_REVIEW_EMAIL` remains optional.
