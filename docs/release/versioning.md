# Release Versioning

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

## Release Preparation

[Select release scope](README.md#select-release-scope) first. Development
retains the last version set for each source. Resume a prepared or partly
published release at its recorded targets. Check the [companion
payloads](#mcp-and-plugin-release-decisions) before changing their versions.

For each new target, compute patch, minor and major candidates from the highest
applicable version in its selected sources, remote release tags and provider
records. For a Mac-only bump, include the shared Apple source,
`macos-vX.Y.Z-buildN` tags and macOS App Store versions. Apply provider rules
and the [companion tag check](#check-for-an-executor-tag-collision) before
presenting the available candidates. Recommend one based on the selected
changes and ask the user to choose. Use a bump choice or exact target already
supplied in this session subject to the same checks. Verify the authorized
target against current sources, tags and provider rules before bumping,
building or publishing. Record the choice in the [ledger](evidence.md#release-ledger).

Update only the [version sources](#source-of-truth-by-platform) needed for the
selected builds. Public versions can differ by destination. An Apple-only bump
changes the shared Apple source version. Keep web, backend, admin and Android
versions at their existing values. Keep API contract identifiers such as
`/v1` paths, API Gateway stage names and MCP `SERVER_VERSION` out of app bumps.

[Verify the applicable versions](#verify-the-release-version) through normal
PR/CI gates and pin the exact release SHAs. Apply the [source
safeguards](#release-closeout-and-development) before merging to tracked
companion `main`. A version-only request ends with source verification and CI.

## MCP and Plugin Release Decisions

Use the [common scope rules](README.md#select-release-scope) for each companion
destination.

| Destination | Compare |
| --- | --- |
| MCP Registry | The published `server.json` manifest against the intended registry metadata. Hosted MCP changes deploy separately through [Web and Backend](web-backend.md). |
| OpenAI plugin | The generated ZIP contents and reviewable listing metadata. Hosted MCP scans and live tools are tracked [separately](mcp-and-plugins.md#openai). |
| Anthropic plugin | Claude plugin contents and directory listing fields at the tracked source, against the latest requested or published version. Compare connector listing edits separately. |
| `nibomo-plugins` GitHub Release | The shipped companion manifests, installable packages and resolved Executor source against the last companion Release. |

Reuse the companion version, tag, Release and assets when its payload matches.
For a changed companion release, choose its target and align its manifests for
CI. When both repositories plan stable `vX.Y.Z` Releases and Executor is outside
scope, choose distinct targets. Use matching tags when publishing Executor
through the stable core release event. Use the new or retained artifact that
matches each provider's intended update.

## GitHub Tag and Release

After the applicable gates pass, create or verify the immutable core tag and
GitHub Release at the exact recorded commit for a versioned core release or
when the [Executor procedure](mcp-and-plugins.md#executor) requires the core
release event. Before publishing, apply the
[Executor tag check](#check-for-an-executor-tag-collision). For Mac-only work,
use the [Mac tag rules](#mac-only-source-and-tags). Prefer annotated tags and
existing naming conventions. Keep the English
[notes and contributor thanks](release-notes.md#github-release-thanks) within
the selected scope.

For a new companion Release, complete its exact-source package/typecheck CI
and publish its immutable tag, Release and original
[package assets](../plugin-publishing.md#release-source-and-durable-packages).
Publish it first when the Executor procedure uses the core release event.
Record asset checksums and provenance before closeout.

Do not wait for external review or propagation, or reconstruct historical mobile
logs for already-published matching artifacts, before this checkpoint. Apply the
[reuse rules](evidence.md#reuse-existing-artifacts); artifact/source identity and
immutable package provenance remain required. Public channels can still be pending.

Before retrying, check whether the tag, Release, and package assets already exist.
Reuse matching results; never move published tags or overwrite published packages.
A conflicting publication needs the user's explicit resolution. Locate and verify
the recorded release commit even if `main` has advanced with the same version;
a matching version string alone is insufficient to identify released source.

### Check for an Executor tag collision

Publishing a stable core `vX.Y.Z` Release can
[deploy Executor](mcp-and-plugins.md#executor) from a matching companion tag,
including one from a companion-only release. For a planned stable core
`vX.Y.Z` Release that excludes Executor, check for a planned matching companion
tag and query the remote before choosing the core version. Repeat both checks
immediately before publishing that core Release, including when publishing a
draft or retrying. Use the proposed version in this command.

```bash
git ls-remote --exit-code --refs --tags https://github.com/kirill-markin/nibomo-plugins.git refs/tags/vX.Y.Z
```

Check a successful response for the exact ref. Exit status 2 confirms absence.
Resolve other query errors before proceeding. If a matching tag exists or is
planned, exclude that candidate and hold any prepared core Release until the
user authorizes a collision-free target or explicitly adds Executor to scope
and its applicable gates pass. Preserve existing tags and Releases.

### Mac-only source and tags

Record Mac archive/test SHAs and any bounded comparison to the core tag.
A Mac-only release can resume the recorded shared Apple version or use a
newly chosen version. Preserve existing core and companion tags, Releases,
assets and other platforms' pending submissions.

Reuse an existing core tag only when its Mac inputs are proven equivalent under
[shared reuse](evidence.md#resume-and-artifact-reuse). If the core tag is absent
or the Mac inputs differ, preserve the exact Mac commit with an immutable annotated
`macos-vX.Y.Z-buildN` tag and platform GitHub Release, where `N` is the verified
Mac distribution build number; include archive/source comparison and Mac
evidence in that Release. Do not move the coordinated tag to a later same-version
commit or imply the companion shipped new source. Verify any existing platform
tag/Release before creating it; conflicts require explicit resolution. Keep
remaining coordinated channels' ledger entries pending and close out only the
authorized Mac scope.

<a id="next-development-version"></a>

## Release Closeout and Development

Apply the [operator completion boundaries](README.md#release-inventory-and-completion)
and verify applicable new or reused tags, Releases and assets. Follow the
[Mac-only tag rules](#mac-only-source-and-tags) when applicable. Record external
review, propagation and manual publication follow-up separately from live state.

Keep Anthropic's GitHub push webhook enabled for scans. Before merging to
tracked `main`, verify **Settings → Publish new versions automatically** is
off and confirm the applied policy in **Overview → Auto-publish**. Use the
[Anthropic procedure](mcp-and-plugins.md#anthropic-connector-and-plugin) to
request publication for a changed Claude payload during an authorized release.
Preserve accepted pending requests and their source commits; changing the tracked
ref can cancel a pending request, so do not use it to bypass review. If
preservation is blocked, stop the affected merge and report it.

Also establish and verify the companion's stable Gemini install/update source
under the [publishing procedure](../plugin-publishing.md#public-listings)
and [Gemini release guidance](https://geminicli.com/docs/extensions/releasing/).
Check both fresh installation and the supported update path resolve the released
version and source, including the source reached from the gallery. An unpinned
Git install follows HEAD; neither a tag nor an unchanged manifest version
protects users following `main`. Do not merge development or preparation changes
until the stable route is verified and existing users' update behavior is
accounted for. Keep accepted pending requests and follow-up in the ledger.
Apply these safeguards at the merge boundary, not only during release closeout.

Automatic web/backend deployments continue from `main` during development.
Use deployment and build SHAs to identify the deployed code under
[Web and Backend](web-backend.md).

## Source Of Truth By Platform

Read each platform's version from its existing source of truth.

### Backend, admin, and backend-adjacent packages

Use the applicable package manifests and their adjacent lockfiles.

- `apps/backend/package.json`
- `apps/admin/package.json`
- `apps/auth/package.json`
- `infra/aws/package.json`

Match each updated manifest to both root version fields in its
`package-lock.json`.

Update compatibility notes only when the verified supported floor changes
for the client they describe.

### MCP Registry manifest

The companion repository owns [`server.json`](https://github.com/kirill-markin/nibomo-plugins/blob/main/server.json)
and its `version`. Companion **Plugin packages** CI checks its alignment with
the companion package manifests. Follow the [registry procedure](mcp-and-plugins.md#mcp)
when a registry update qualifies.

### Anthropic plugin version sources

For a qualifying companion release, align these files in the separate
[`nibomo-plugins`](https://github.com/kirill-markin/nibomo-plugins) repository:

- `.claude-plugin/plugin.json` — Anthropic plugin `version`.
- `plugin.json` — portable plugin `version`.
- `gemini-extension.json` — shared extension `version` required by packaging CI.
- Versioned archive names in `README.md`, when present.

Archive versions and Antigravity metadata are derived from the manifests.

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

Wear OS inherits `versionName` from `:app`. Release CI supplies the separate
phone `ANDROID_VERSION_CODE` and Wear `ANDROID_WEAR_VERSION_CODE`.

<a id="ios"></a>

### iOS and macOS

The shared iOS and dedicated Mac Catalyst marketing version lives in:

- `apps/ios/Flashcards/Config/Base.xcconfig`

`Info.plist` reads that marketing version indirectly, so do not replace the variable wiring there unless the build system changes.

Both Apple apps' runtime-reported version must be read from bundle metadata (`CFBundleShortVersionString`) through:

- `apps/ios/Flashcards/Flashcards/Cloud/Support/CloudSupport.swift`

Do not introduce aligned literals, overrides, or fallbacks for either Apple app version; a missing or blank bundle version is a configuration error that should fail explicitly.

Under the current release process, the shared repo-tracked Apple build number is intentionally left alone during normal version bumps. Xcode Cloud handles signed archive and distribution separately, and the repository documentation does not define an in-repo build-number bump workflow.

iOS and macOS share the target, bundle ID and marketing-version source.
They have separate public versions, Xcode Cloud release-build workflows,
local native acceptance runs, uploaded platform build IDs and App Review drafts.
Keep **iOS Release Build** and **macOS Release Build** enabled and retain the
disabled test workflows and history. Cloud run numbers are not distribution build
numbers. Record local test source/configuration separately from the exact Cloud
run → Archive action → uploaded app/platform/version/build ID and signed export provenance; TestFlight internal distribution does not prove tests or a new build. Record each exact build identity; never attach an iOS build to the
`MAC_OS` draft or replace another platform's pending submission. Follow the
[Mac procedure](macos.md) without changing the iOS gate contract.

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

Search for each affected old version before editing and after the bump.
Confirm the selected manifests and lockfiles agree within each package, and
check Gradle, Apple bundle wiring, runtime readers and versioned metadata as
applicable. Retain frozen fixtures and CI-managed build numbers.

Run normal cloud CI for each changed repository, including **Plugin packages**
for a changed companion. Report the prepared source SHA and version separately
from each provider's submitted or public version and source. Monitor automatic
deployments selected by [Release Gates](../release-gates.md).
