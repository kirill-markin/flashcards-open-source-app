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

If backend comments or compatibility notes explicitly describe the currently
released first-party client version, update those references in the same
change so the documented minimum-compatible client behavior stays accurate.

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

- `apps/android/data/local/src/test/java/com/flashcardsopensourceapp/data/local/ai/AiChatRemoteTestFixtures.kt`
- `apps/android/data/local/src/test/java/com/flashcardsopensourceapp/data/local/ai/AiChatRemoteTransportRequestTest.kt`

Search for additional Android test fixtures or AndroidTest support files that
embed the app version as request metadata or expected wire values, and keep
them aligned in the same change.

Android `versionCode` is not bumped manually in the repo. Release builds receive `ANDROID_VERSION_CODE` from CI, and the workflow computes that value at release time.

### iOS

The iOS marketing version lives in:

- `apps/ios/Flashcards/Config/Base.xcconfig`

`Info.plist` reads that marketing version indirectly, so do not replace the variable wiring there unless the build system changes.

The runtime-reported iOS app version must be read from bundle metadata (`CFBundleShortVersionString`) through:

- `apps/ios/Flashcards/Flashcards/CloudSupport.swift`

Do not introduce aligned literals, overrides, or fallbacks for the iOS app version; a missing or blank bundle version is a configuration error that should fail explicitly.

Under the current release process, the repo-tracked iOS build number is intentionally left alone during normal version bumps. Xcode Cloud handles signed archive and distribution separately, and the repository documentation does not define an in-repo build-number bump workflow.

If backend or client-side compatibility comments name the current iOS or
first-party app version explicitly, update those references too so the release
notes in code still describe the current shipped floor.

## Release Metadata

If store or release metadata for the touched platform explicitly includes the
current app version, update it in the same change. Do not edit store metadata
files that do not actually mention a version just because they are release
adjacent.

Today, there is no always-versioned store metadata file that must change on
every app release. Check the touched platform metadata files case by case.

Versioned metadata examples, when present, include:

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

When generating the final output for App Store release notes in this repository,
return one fenced `text` code block per locale instead of prose outside code
blocks.

Use the current iOS App Store locale set and keep this order:

- `English (U.S.)`
- `Arabic`
- `Chinese (Simplified)`
- `German`
- `Hindi`
- `Japanese`
- `Russian`
- `Spanish (Mexico)`
- `Spanish (Spain)`

Inside each code block:

- use flat `-` bullets only
- keep the copy high-level and user-facing
- order bullets from most important to least important
- avoid technical wording unless the user would recognize it in the app

If the user asks for localized release notes, provide all of those locales in
the same response unless they explicitly ask for a smaller subset.

For this repository, a `git log` review of commit titles across the version range
is usually enough for a first draft, and deeper code inspection is only needed
when the user-facing effect is unclear.

## Expected Flow

1. Choose the next semantic version for the release.
2. By default, treat that version as the shared project version for backend, web, Android, and iOS.
3. Search the repo for the current version strings so you can see every manifest, runtime reader, and test expectation that still reports the old value for the release.
4. Update all repo-owned version surfaces that participate in that release, and keep each platform's runtime-reported version aligned with its checked-in version source.
5. Update version-coupled test fixtures, Android instrumentation support values, and compatibility comments that explicitly name the released first-party client version.
6. Update release metadata only when that metadata actually names the current app version for the touched platform.
7. Re-run targeted searches to confirm the old app version strings are gone from the intended version surfaces and any version-coupled fixtures or comments you intended to update.
8. Run the smallest useful verification commands for the touched platforms.

## Minimum Verification

After a version bump, use targeted checks instead of broad test runs:

- repo search for stale old-version literals in intended version surfaces
- repo search for stale old-version literals in version-coupled test fixtures and compatibility comments when the repo uses them
- `npm run build --prefix apps/web`
- `./gradlew :app:assembleDebug` from `apps/android/`

For iOS, verify by code inspection and targeted search that the marketing version and bundle-based runtime version reader are aligned, unless a specific iOS build or test run is needed for the change.
