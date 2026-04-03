# Version Bump Guide

Use this guide when bumping release versions across the repository.

## Scope

The project has separate version surfaces for backend-related Node packages, the web app, Android, and iOS. A version bump is not complete until the manifest values and the runtime-reported client versions are aligned.

Do not change `/v1` API paths, OpenAPI `info.version: v1`, or API Gateway stage names as part of an app release bump. Those values describe the public API contract version, not the app release version.

## Source Of Truth By Platform

### Backend and backend-adjacent packages

Update these package manifests together:

- `apps/backend/package.json`
- `api/package.json`
- `apps/auth/package.json`
- `infra/aws/package.json`

For each of those packages, also update the matching top-level package version fields in the adjacent `package-lock.json`.

### Web

The checked-in web package version lives in:

- `apps/web/package.json`
- `apps/web/package-lock.json`

The runtime-reported web client version is read through:

- `apps/web/src/clientIdentity.ts`

Keep the runtime fallback aligned with the checked-in package version so builds still report the correct version when `VITE_APP_VERSION` is not injected by CI or the local shell.

Web request headers and device reporting reuse that same runtime value, including `X-Client-Version`.

### Android

The Android app semantic version lives in:

- `apps/android/app/build.gradle.kts`

Android currently sends its app version from hardcoded request payloads and AI runtime diagnostics in:

- `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/CloudRepositories.kt`
- `apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/CloudGuestSessionCoordinator.kt`
- `apps/android/feature/ai/src/main/java/com/flashcardsopensourceapp/feature/ai/AiChatRuntime.kt`

Tests that assert the Android client version must stay aligned too, especially:

- `apps/android/data/local/src/test/java/com/flashcardsopensourceapp/data/local/ai/AiChatRemoteWireTest.kt`

Android `versionCode` is not bumped manually in the repo. Release builds receive `ANDROID_VERSION_CODE` from CI, and the workflow computes that value at release time.

### iOS

The iOS marketing version lives in:

- `apps/ios/Flashcards/Config/Base.xcconfig`

`Info.plist` reads that marketing version indirectly, so do not replace the variable wiring there unless the build system changes.

Runtime fallbacks that must stay aligned with the iOS marketing version live in:

- `apps/ios/Flashcards/Flashcards/CloudSync/CloudSyncTransport.swift`
- `apps/ios/Flashcards/Flashcards/AI/AIChatTypes.swift`

Under the current release process, the repo-tracked iOS build number is intentionally left alone during normal version bumps. Xcode Cloud handles signed archive and distribution separately, and the repository documentation does not define an in-repo build-number bump workflow.

## Release Metadata

If store or release metadata includes the current app version, update it in the same change. Today that includes:

- `docs/google-play-store-metadata.md`

## Expected Flow

1. Choose the next semantic version.
2. Search the repo for the current version strings so you can see every manifest, runtime fallback, and test expectation that still reports the old value.
3. Update backend-related package manifests and their top-level lockfile version entries.
4. Update web package versioning and keep the runtime fallback aligned in `apps/web/src/clientIdentity.ts`.
5. Update Android `versionName`, Android request payload version strings, and Android version assertions in tests.
6. Update iOS `APP_MARKETING_VERSION` and any iOS runtime fallback strings that still report the old version.
7. Update release metadata that names the current app version.
8. Re-run targeted searches to confirm the old app version strings are gone from the intended version surfaces.
9. Run the smallest useful verification commands for the touched platforms.

## Minimum Verification

After a version bump, use targeted checks instead of broad test runs:

- repo search for stale old-version literals in intended version surfaces
- `npm run build --prefix apps/web`
- `./gradlew :app:assembleDebug` from `apps/android/`

For iOS, verify by code inspection and targeted search that the marketing version and runtime fallbacks are aligned, unless a specific iOS build or test run is needed for the change.
