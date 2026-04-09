# Version Bump Guide

Use this guide when bumping release versions in the repository.

## Scope

The repository has separate version surfaces for backend-related Node packages, the web app, Android, and iOS, but the default release policy is to use one shared semantic version across the whole project most of the time.

In normal releases, backend, web, Android, and iOS should all move to the same new version in the same change. Only split versions when there is a concrete release reason to do that, and make that exception explicit in the change.

A version bump is not complete until the repo-owned version surfaces that participate in that release stay aligned with each other and with each platform's runtime-reported version source.

Do not change `/v1` API paths, OpenAPI `info.version: v1`, or API Gateway stage names as part of an app release bump. Those values describe the public API contract version, not the app release version.

## Source Of Truth By Platform

Even though we usually ship one shared project version, each platform still has its own checked-in source of truth and runtime wiring. Keep those sources aligned instead of introducing copied fallback literals.

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

Read the web runtime version directly from `apps/web/package.json` through that helper. Do not introduce runtime overrides or fallbacks for the app version; a missing or blank checked-in package version is a configuration error that should fail explicitly.

Web request headers and device reporting reuse that same runtime value, including `X-Client-Version`.

### Android

The Android app semantic version lives in:

- `apps/android/app/build.gradle.kts`

Android runtime-reported app version must be derived from installed package metadata (`PackageInfo.versionName`) and reused in request payloads, AI runtime diagnostics, and device diagnostics. Do not hardcode aligned literals for these surfaces; a missing or blank runtime package version is a configuration error that should fail explicitly.

The main Android consumers of that runtime value are:

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

The runtime-reported iOS app version must be read from bundle metadata (`CFBundleShortVersionString`) through:

- `apps/ios/Flashcards/Flashcards/CloudSupport.swift`

Do not introduce aligned literals, overrides, or fallbacks for the iOS app version; a missing or blank bundle version is a configuration error that should fail explicitly.

Under the current release process, the repo-tracked iOS build number is intentionally left alone during normal version bumps. Xcode Cloud handles signed archive and distribution separately, and the repository documentation does not define an in-repo build-number bump workflow.

## Release Metadata

If store or release metadata for the touched platform includes the current app version, update it in the same change. Today that includes:

- `docs/google-play-store-metadata.md`

## App Store release notes

When preparing iOS App Store release notes for a new version, compare the new
release against the previous version that was actually released to users.

Do not write the notes from branch history, technical implementation detail, or
internal infrastructure changes alone. Start from the commit range between the
previous released version tag and the new release version, then summarize only
the user-visible changes.

The preferred tone is short, plain English from the user's point of view:

- describe visible improvements or new behavior
- group technical work under concise wording such as `minor bug fixes` or
  `performance improvements`
- omit internal refactors, test-only work, CI/CD changes, and backend-only
  plumbing unless users would notice the result directly

For this repository, a `git log` review of commit titles across the version range
is usually enough for a first draft, and deeper code inspection is only needed
when the user-facing effect is unclear.

## Expected Flow

1. Choose the next semantic version for the release.
2. By default, treat that version as the shared project version for backend, web, Android, and iOS.
3. Search the repo for the current version strings so you can see every manifest, runtime reader, and test expectation that still reports the old value for the release.
4. Update all repo-owned version surfaces that participate in that release, and keep each platform's runtime-reported version aligned with its checked-in version source.
5. Update release metadata that names the current app version for the touched platform.
6. Re-run targeted searches to confirm the old app version strings are gone from the intended version surfaces.
7. Run the smallest useful verification commands for the touched platforms.

## Minimum Verification

After a version bump, use targeted checks instead of broad test runs:

- repo search for stale old-version literals in intended version surfaces
- `npm run build --prefix apps/web`
- `./gradlew :app:assembleDebug` from `apps/android/`

For iOS, verify by code inspection and targeted search that the marketing version and bundle-based runtime version reader are aligned, unless a specific iOS build or test run is needed for the change.
