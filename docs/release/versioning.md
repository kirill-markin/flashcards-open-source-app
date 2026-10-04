# Release Versioning

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

## Release Preparation

Development retains the last coordinated release version in app and companion
sources. Select a new version only when preparing a new release. First inspect
the ledger, source versions, tags, and store/provider state: resume a prepared or
partly published release at its recorded target without another bump.

For a new release, compare completed changes with the last coordinated release
and ask the user to choose patch, minor, or major. Compute and show all three
resulting numeric versions from the last coordinated release
(`X.Y.(Z+1)`, `X.(Y+1).0`, `(X+1).0.0`), and recommend one based on those changes. Wait for the answer before bumping, building release artifacts, or
publishing. If this session already explicitly supplies the bump choice or exact
target, use it without asking again. Record the decision and target in the ledger.
Do not infer a choice from a generic release request or select minor by default.

Update all [app and companion sources](#source-of-truth-by-platform) to that
target through each repository's normal PR/cloud-CI gates. Keep product and
plugin versions equal; record any concrete user-approved exception. A bump is
complete only when all sources and runtime wiring align. Apply the
[development publication safeguards](#release-closeout-and-development) before
merging preparation changes to tracked plugin `main`; source alignment alone
does not authorize provider publication.

[Verify the release version](#verify-the-release-version) and pin the resulting
app and companion source SHAs before signed builds, registry publication,
provider packages, and release metadata. Retain successful **Plugin packages**
CI artifacts for the exact aligned companion SHA; packaging CI may run as part
of preparation, but publishing its assets belongs to the authorized release.
A version-only request stops after source alignment and CI; it does not authorize
release dispatches or distribution actions. Full releases still require every
local/cloud and publication gate.

Do not change `/v1` API paths, API Gateway stage names, or MCP `SERVER_VERSION = "v1"` as part of an app release bump. These identify the API contract, not app semver.

## GitHub Tag and Release

Tags and GitHub Releases are mandatory controlled release actions. Once the
applicable source/artifact gates pass, create or verify immutable current-version
tags in both app and companion repositories at their exact recorded release commits,
whose manifests still report that version. Prefer annotated tags and existing
naming conventions. Record any artifact-SHA comparison under the reuse rules.
Publish GitHub Releases with the English notes and preserve the companion's
exact successful **Plugin packages** CI assets under its
[publishing procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md).
Record asset identity/checksums and provenance; an expiring Actions artifact
alone is not durable release preservation. Complete this before release closeout.
Do not wait for external review or propagation, or reconstruct historical mobile
logs for already-published matching artifacts, before this checkpoint. Apply the
[reuse rules](evidence.md#reuse-existing-artifacts); artifact/source identity and
immutable package provenance remain required. Public channels can still be pending.

Before retrying, check whether the tag, Release, and package assets already exist.
Reuse matching results; never move published tags or overwrite published packages.
A conflicting publication needs the user's explicit resolution. Locate and verify
the recorded release commit even if `main` has advanced with the same version;
a matching version string alone is insufficient to identify released source.

<a id="next-development-version"></a>

## Release Closeout and Development

Close the release after the [operator completion boundaries](README.md#release-inventory-and-completion).
Verify both release tags, GitHub Releases, and preserved package assets; record
external review/propagation and any later manual publication action as follow-up
without calling pending channels live. Keep the selected version across app and companion
sources after completion and throughout subsequent development; do not pre-bump
the next minor or create development release packages.

Before any development or preparation commit reaches the plugin's tracked
`main`, even with unchanged manifest versions, turn Anthropic automatic
publication off and verify the saved setting and applied policy. Preserve any
accepted pending release request and its source commit; changing the
tracked ref can cancel a pending request, so do not use it to bypass review.
If preservation is blocked, stop the affected merge and report it.

Also establish and verify the companion's stable Gemini install/update source
under its [publishing procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md)
and [Gemini release guidance](https://geminicli.com/docs/extensions/releasing/).
Check both fresh installation and the supported update path resolve the released
version and source, including the source reached from the gallery. An unpinned
Git install follows HEAD; neither a tag nor an unchanged manifest version
protects users following `main`. Do not merge development or preparation changes
until the stable route is verified and existing users' update behavior is
accounted for. Keep accepted pending requests and follow-up in the ledger.
Apply these safeguards at the merge boundary, not only during release closeout.

Automatic web/backend deployments continue from `main` during development.
The retained coordinated version does not identify their exact deployed code;
record deployment/build SHAs under [Web and Backend](web-backend.md).

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

Publish the selected `server.json.version` during the platform release stage, before release closeout. The registry accepts each manifest version only once.

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
[completion](README.md#release-inventory-and-completion) and development safeguards above; a standalone version bump only aligns source.

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

<a id="verify-the-next-version-bump"></a>

## Verify the Release Version

Search for the old version across both repositories before editing and again
after the bump. Confirm manifests, lockfile top-level versions, runtime readers,
compatibility comments, and any versioned metadata agree. Leave frozen test
fixtures and platform build-number handling as documented above.

Use both repositories' normal cloud CI gates, including **Plugin packages**;
do not run local builds or broad test suites for a version-only change. Report
both merged preparation commits and pin each source SHA separately from
Anthropic's published/pending version and source.
Inspect iOS version wiring directly. Monitor automatic
AWS/web and Android workflows according to [Release Gates](../release-gates.md).
