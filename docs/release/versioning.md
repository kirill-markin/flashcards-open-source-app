# Release Versioning

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

## GitHub Tag and Release

Once the source/artifact gates pass, create or verify immutable current-version
tags in both app and companion repositories at their recorded release commits,
whose manifests still report that version. Prefer annotated tags and existing
naming conventions. Record any artifact-SHA comparison under the reuse rules.
Publish GitHub Releases with the English notes and preserve the companion's
exact successful **Plugin packages** CI assets under its
[publishing procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md).
Record asset identity/checksums and provenance; an expiring Actions artifact
alone is not durable release preservation. Do this before either repository's
next-development bump. Public channels can still be pending at this stage.

Before retrying, check whether the tag and Release already exist. Reuse a
matching result; do not move a published tag or overwrite conflicting release
state without the user's explicit direction. If the next-version bump already
landed, locate and verify the actual release commit before that bump rather
than tagging the new development version.

## Next Development Version

Update backend, web, Android, and iOS to the same next minor version in one
change only after the public completion gate or the user's explicit scoped
exception. Align the companion plugin in its separate repository in the same
cycle. Keep product and plugin versions equal; record any concrete exception.

A version bump is not complete until the version surfaces below, including the
plugin repository, are aligned with their documented runtime version sources.

Before either bump, verify both release tags and preserved package assets.
Before merging to the plugin's tracked `main`, turn Anthropic automatic
publication off and verify the saved setting. Preserve any explicitly accepted
pending release request and its source commit; changing the tracked ref can
cancel a pending request, so do not use it to bypass review. If preservation is
blocked, stop the affected transition and report it.

Also establish and verify the companion's stable Gemini install/update source
under its [publishing procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md)
and [Gemini release guidance](https://geminicli.com/docs/extensions/releasing/).
Check both fresh installation and the supported update path resolve the released
version, including the source reached from the gallery. An unpinned Git install
follows HEAD; merely creating a tag does not protect users following `main`.
Do not merge the next-version manifest until the stable route is verified and
existing users' update behavior is accounted for. Keep the accepted pending
request and remaining follow-up in the ledger through the transition.

Do not change `/v1` API paths, API Gateway stage names, or MCP `SERVER_VERSION = "v1"` as part of an app release bump. These identify the API contract, not app semver.

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

Publish the current `server.json.version` during the platform release stage, before the GitHub Release and next-version bump. The registry accepts each manifest version only once.

If backend comments or compatibility notes explicitly describe the currently
released first-party client version, update those references in the same
change so the documented minimum-compatible client behavior stays accurate.

### Anthropic plugin version sources

For every shared-version update, align these files in the separate
[`nibomo-plugins`](https://github.com/kirill-markin/nibomo-plugins) repository:

- `.claude-plugin/plugin.json` — Anthropic plugin `version`.
- `plugin.json` — portable plugin `version`.
- `gemini-extension.json` — shared extension `version` required by packaging CI.
- Versioned archive names in `README.md` and `docs/publishing.md`, when present.

Keep the packaging script's derived archive versions and Antigravity metadata
derived from the manifests; do not add another version literal. This source
alignment alone does not authorize publication. A full release includes the
existing channels in the [inventory](mcp-and-plugins.md#release-inventory) and requires the
[completion](README.md#release-inventory-and-completion) and transition gates above; a standalone version bump only aligns source.

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

## Verify the Next-Version Bump

Search for the old version across both repositories before editing and again
after the bump. Confirm manifests, lockfile top-level versions, runtime readers,
compatibility comments, and any versioned metadata agree. Leave frozen test
fixtures and platform build-number handling as documented above.

Use both repositories' normal cloud CI gates, including **Plugin packages**;
do not run local builds or broad test suites for a version-only change. Report
both merged bump commits separately from Anthropic's published/pending version.
Inspect iOS version wiring directly. Monitor automatic
AWS/web and Android workflows according to [Release Gates](../release-gates.md).
