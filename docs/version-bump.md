# Version Bump Guide

Use this guide when bumping release versions in the repository.

## Required Release Reminder

When a user asks for release notes, a release, or a version bump, proactively
remind them that the full release sequence has four parts:

1. Summarize the user-visible changes since the previous released tag.
2. Ask for explicit user approval to publish the GitHub tag and GitHub Release
   for the version that is currently ready to ship, using human-readable release
   notes instead of a commit list.
3. Ask the user to manually start or finish the platform release actions for
   Android, Apple iOS, and the MCP server.
4. Bump the repo-owned version surfaces to the next version only after those
   release actions have started, finished, or been explicitly skipped.

Creating or pushing a git tag and publishing a GitHub Release are remote write
actions. Never do them from a reminder, recommendation, or assumption; wait for
an explicit user approval such as "yes, publish it" or "create the tag and
release."

Do not go directly from release-note drafting to a version bump unless the user
explicitly confirms that the tag, GitHub Release, and manual platform release
actions for the current version are already handled.

## Release Note Delivery Format

Deliver the summary from part 1 in every supported app locale, one fenced code
block per locale, so each block can be copied straight into store metadata
without reformatting. Put nothing but the release-note lines inside a block;
keep commentary, reasoning, and the release-sequence reminder outside them.

Use the supported app locale order declared in
[ios-localization.md](ios-localization.md):

`en`, `ar`, `zh-Hans`, `de`, `hi`, `ja`, `ru`, `es-MX`, `es-ES`

Spanish always stays split into `es-MX` and `es-ES`; never collapse them into a
generic `es` block. When the same notes are pasted into Google Play, keep this
content and order and only remap the tag spellings per
[google-play-store-metadata.md](google-play-store-metadata.md).

## Scope

The repository has separate version surfaces for backend-related Node packages, the web app, Android, and iOS, but the default release policy is to use one shared semantic version across the whole project most of the time.

In normal releases, backend, web, Android, and iOS should all move to the same new version in the same change. Only split versions when there is a concrete release reason to do that, and make that exception explicit in the change.

A version bump is not complete until the repo-owned version surfaces that participate in that release stay aligned with each other and with each platform's runtime-reported version source.

Do not change `/v1` API paths or API Gateway stage names as part of an app release bump. Those values describe the public API contract version, not the app release version.

## Source Of Truth By Platform

Even though we usually ship one shared project version, each platform still has its own checked-in source of truth and runtime wiring. Keep those sources aligned instead of introducing copied fallback literals.

### Backend, admin, and backend-adjacent packages

Update these package manifests together:

- `apps/backend/package.json`
- `apps/admin/package.json`
- `apps/auth/package.json`
- `infra/aws/package.json`

For each of those packages, also update the matching top-level package version fields in the adjacent `package-lock.json`.

Also update the MCP registry manifest at the repo root:

- `server.json`

`server.json` carries the published MCP registry manifest `version`, and it must move with the shared release version so the registry entry matches releases. There is no adjacent `package-lock.json` to update for it.

Publishing `server.json` to the MCP Registry is a separate manual release step. The registry accepts each manifest `version` only once, so trigger the manual publish workflow only after the shared product version is ready, the GitHub tag/release for that version is published, and `server.json.version` names a new, unpublished version. Do this before bumping the repository to the next version.

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

Test fixtures do not track the release version. Android and web unit tests
that need an app-version string use a frozen dummy (`"1.0.0"`) as a
self-referential input/output value, so they are intentionally not bumped on
release. Each such fixture carries a "do not bump" comment in code. If you add
a new fixture that embeds an app version, reuse the same frozen dummy instead
of the real release version.

Android `versionCode` is not bumped manually in the repo. Release builds receive `ANDROID_VERSION_CODE` from CI, and the workflow computes that value at release time.

### iOS

The iOS marketing version lives in:

- `apps/ios/Flashcards/Config/Base.xcconfig`

`Info.plist` reads that marketing version indirectly, so do not replace the variable wiring there unless the build system changes.

The runtime-reported iOS app version must be read from bundle metadata (`CFBundleShortVersionString`) through:

- `apps/ios/Flashcards/Flashcards/Cloud/Support/CloudSupport.swift`

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

## User-Facing Release Notes

When preparing GitHub Release notes, iOS App Store release notes, or any other
user-facing release description for a new version, compare the new release
against the previous version that was actually released to users.

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

For GitHub Releases, do not publish the raw auto-generated list of commits,
pull requests, or contributors as the release body. GitHub-generated notes may
be used as an input checklist, but the published release body should use the
same concise, user-facing bullets as the App Store notes.

When the same release needs both GitHub Release notes and localized store notes,
reuse the same user-facing bullet strings for each locale when they fit. For an
English-only GitHub Release, use the `English (U.S.)` copy.

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

## Release Tag And Manual Platform Releases

After sending the user-facing change summary or App Store release notes, pause
before changing version files and recommend publishing the current version. Ask
for explicit user approval before creating or pushing a tag or publishing a
GitHub Release.

For the GitHub release:

- after explicit approval, create or verify the tag for the version that is
  currently ready to ship
- target the commit whose checked-in version surfaces still report that release
  version
- prefer an annotated tag when creating a missing tag manually
- create the GitHub Release from that tag with curated human-readable notes, not
  the raw GitHub-generated commit or pull request list
- do not move an existing published tag unless the user explicitly asks for a
  tag correction

If the next-version bump has already landed before the tag was created, backfill
the missed release by targeting the last commit before the bump merge where the
repo still reports the old release version. For a merge commit that bumps the
version, that is usually the first parent of the bump merge.

Before bumping the repository to the next version, ask the user to manually run
or complete the production release actions documented in
[docs/manual-production-release.md](./manual-production-release.md), including:

- Android release
- Apple iOS release
- MCP server release, through the manual `MCP Registry Publish` workflow when
  the release should refresh the official MCP Registry entry

These platform release actions are intentionally manual. Do not treat a GitHub
Release alone as proof that Android, Apple iOS, or the MCP server release has
been launched or finished.

## Expected Flow

1. Identify the version that is currently ready to release and the previous
   released tag.
2. Summarize the user-visible changes between the previous released tag and the
   current release target.
3. Send the release notes in the requested format. For GitHub Release notes,
   use concise human-readable bullets instead of a commit list. For iOS App
   Store notes, use the locale and formatting rules above. Reuse the same
   user-facing wording across GitHub and store notes when it fits.
4. Recommend publishing the GitHub tag and GitHub Release for the current
   version before editing version files. Ask for explicit approval before any
   tag or release write. If the user explicitly approves, create or verify the
   tag at the correct commit, then create the GitHub Release with the curated
   release notes.
5. Ask the user to manually start or finish the Android release, Apple iOS
   release, and MCP server release when applicable, following
   [docs/manual-production-release.md](./manual-production-release.md). The MCP
   server release uses the manual `MCP Registry Publish` workflow and must not
   reuse a `server.json.version` that already exists in the registry.
6. Only after the current version's tag, GitHub Release, and manual platform
   release actions have started, finished, or been explicitly skipped, choose
   the next semantic version for the repository.
7. By default, treat that next version as the shared project version for
   backend, web, Android, and iOS.
8. Search the repo for the current version strings so you can see every
   manifest, runtime reader, and newly added repo-owned version surface that
   still reports the old value for the next release.
9. Update all repo-owned version surfaces that participate in that next
   release, and keep each platform's runtime-reported version aligned with its
   checked-in version source.
10. Update compatibility comments that explicitly name the released first-party
    client version. Do not bump test fixtures: tests that need an app-version
    string use a frozen dummy (`"1.0.0"`) and are intentionally excluded from
    the release bump.
11. Update release metadata only when that metadata actually names the current
    app version for the touched platform.
12. Re-run targeted searches to confirm the old app version strings are gone
    from the intended version surfaces and any version-coupled fixtures or
    comments you intended to update.
13. Run the smallest useful verification commands for the touched platforms.

## Minimum Verification

After a version bump, use targeted checks instead of broad test runs:

- repo search for stale old-version literals in intended version surfaces
- repo search for stale old-version literals in compatibility comments when the repo uses them (test fixtures use a frozen `"1.0.0"` dummy and are not bumped)
- `npm run build --prefix apps/web`
- `./gradlew :app:assembleDebug` from `apps/android/`

For iOS, verify by code inspection and targeted search that the marketing version and bundle-based runtime version reader are aligned, unless a specific iOS build or test run is needed for the change.
