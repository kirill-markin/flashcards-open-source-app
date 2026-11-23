# Release Versioning

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

## Release Preparation

Development retains each repository's last release version. Select a new app
version only when preparing a new release. First inspect
the ledger, source versions, tags, and store/provider state: resume a prepared or
partly published release at its recorded target without another bump.

For a new release, compare completed changes with the last coordinated release
and ask the user to choose patch, minor, or major. Compute and show all three
resulting numeric versions from the last coordinated release
(`X.Y.(Z+1)`, `X.(Y+1).0`, `(X+1).0.0`), and recommend one based on those changes. Wait for the answer before bumping, building release artifacts, or
publishing. If this session already explicitly supplies the bump choice or exact
target, use it without asking again. Record the decision and target in the ledger.
Do not infer a choice from a generic release request or select minor by default.

Update the [app version sources](#source-of-truth-by-platform) to the selected
target through normal PR/cloud-CI gates. Apply the [MCP and plugin release
decisions](#mcp-and-plugin-release-decisions) before touching companion versions
and the [source safeguards](#release-closeout-and-development) before merging to
tracked companion `main`.

[Verify the release version](#verify-the-release-version) and pin the app SHA
and the source SHA of any new companion release. A version-only request ends
after the applicable source alignment and CI. Release dispatches and
publication belong to the authorized release and follow each channel's gates.

Do not change `/v1` API paths, API Gateway stage names, or MCP `SERVER_VERSION = "v1"` as part of an app release bump. These identify the API contract, not app semver.

## MCP and Plugin Release Decisions

Before bumping versions, compare each destination's intended payload with its
last submitted artifact or exact source, including a submission awaiting
review. Use the last published version for channels with no submission step.
Record the baseline, change and decision per destination in the
[ledger](evidence.md#release-ledger).

| Destination | Compare |
| --- | --- |
| MCP Registry | The published `server.json` manifest against the intended registry metadata. Hosted MCP changes deploy separately through [Web and Backend](web-backend.md). |
| OpenAI plugin | The generated ZIP contents and reviewable listing metadata. Hosted MCP scans and live tools are tracked [separately](mcp-and-plugins.md#openai). |
| Anthropic plugin | Claude plugin contents and directory listing fields at the tracked source, against the latest requested or published version. Compare connector listing edits separately. |
| `nibomo-plugins` GitHub Release | The shipped companion manifests, installable packages and resolved Executor source against the last companion Release. |

Compare unpacked contents. Ignore changes limited to version labels, versioned
filenames, archive timestamps or a new commit or pin that resolves to identical
shipped content. A source or package change matters only to the destinations
whose submitted contents or listing metadata it changes.

When a destination has no relevant changes, retain its submitted or published
version and verify that state. Resume any authorized publication step for the
matching submission using its recorded source. If the companion payload is
unchanged, reuse its version, tag, Release and assets. If it changed, use the
selected app release version for the new companion Release and align its
internal manifests for CI. Use the new or retained companion artifact that
matches the intended payload for each destination requiring an update.
For example, an OpenAI-only listing translation can require a companion Release
and a new OpenAI submission while Claude and the MCP Registry keep their
existing versions.

## GitHub Tag and Release

After applicable source/artifact gates pass, create or verify the immutable
core version tag and GitHub Release at the exact recorded commit. Prefer
annotated tags and existing naming conventions. Publish English notes and
[contributor thanks](release-notes.md#github-release-thanks).

When the [companion release decision](#mcp-and-plugin-release-decisions) calls
for a new Release, complete its exact-source package/typecheck CI and publish
its matching immutable tag, Release and original
[package assets](../plugin-publishing.md#release-source-and-durable-packages)
before the core Release. The core release event only runs the Executor
publisher when its matching companion tag exists. Record the asset
checksums and provenance before closeout.

Do not wait for external review or propagation, or reconstruct historical mobile
logs for already-published matching artifacts, before this checkpoint. Apply the
[reuse rules](evidence.md#reuse-existing-artifacts); artifact/source identity and
immutable package provenance remain required. Public channels can still be pending.

Before retrying, check whether the tag, Release, and package assets already exist.
Reuse matching results; never move published tags or overwrite published packages.
A conflicting publication needs the user's explicit resolution. Locate and verify
the recorded release commit even if `main` has advanced with the same version;
a matching version string alone is insufficient to identify released source.

### Mac-only source and tags

A coordinated release retains its core `vX.Y.Z` tag/Release and the applicable
companion Release and package provenance above. Record Mac archive/test SHAs
and any bounded comparison to the coordinated core tag. A Mac-only release resumes the recorded
shared Apple version unless a new version was explicitly chosen. It does not
authorize another platform's dispatch, submission replacement or companion publication.
Preserve existing core/companion tags, Releases, assets and pending submissions.

Reuse an existing core tag only when its Mac inputs are proven equivalent under
[shared reuse](evidence.md#resume-and-artifact-reuse). When Mac archive source
differs, preserve its exact commit with a separate immutable annotated
`macos-vX.Y.Z-buildN` tag and platform GitHub Release, where `N` is the verified
Mac distribution build number; include archive/source comparison and Mac
evidence in that Release. Do not move the coordinated tag to a later same-version
commit or imply the companion shipped new source. Verify any existing platform
tag/Release before creating it; conflicts require explicit resolution. Keep
remaining coordinated channels' ledger entries pending and close out only the
authorized Mac scope.

<a id="next-development-version"></a>

## Release Closeout and Development

Close the release after the [operator completion boundaries](README.md#release-inventory-and-completion).
For Mac-only scope, apply [its tag and preservation rules](#mac-only-source-and-tags)
to the existing coordinated publications and any required platform tag/Release;
do not create another companion release just to close the Mac channel.
Verify the core Release and the new or reused companion Release and assets. Record
external review/propagation and any later manual publication action as follow-up
without calling pending channels live. Keep each repository's selected version
throughout subsequent development.

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
The retained coordinated version does not identify their exact deployed code;
record deployment/build SHAs under [Web and Backend](web-backend.md).

## Source Of Truth By Platform

Keep the app version sources aligned and read each platform's version from its
existing source of truth.

### Backend, admin, and backend-adjacent packages

Update these package manifests together:

- `apps/backend/package.json`
- `apps/admin/package.json`
- `apps/auth/package.json`
- `infra/aws/package.json`

For each of those packages, also update the matching top-level package version fields in the adjacent `package-lock.json`.

If backend comments or compatibility notes explicitly describe the currently
released first-party client version, update those references in the same
change so the documented minimum-compatible client behavior stays accurate.

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

Android `versionCode` is not bumped manually in the repo. Release builds receive `ANDROID_VERSION_CODE` from CI, and the workflow computes that value at release time.

<a id="ios"></a>

### iOS and macOS

The shared iOS and dedicated Mac Catalyst marketing version lives in:

- `apps/ios/Flashcards/Config/Base.xcconfig`

`Info.plist` reads that marketing version indirectly, so do not replace the variable wiring there unless the build system changes.

Both Apple apps' runtime-reported version must be read from bundle metadata (`CFBundleShortVersionString`) through:

- `apps/ios/Flashcards/Flashcards/Cloud/Support/CloudSupport.swift`

Do not introduce aligned literals, overrides, or fallbacks for either Apple app version; a missing or blank bundle version is a configuration error that should fail explicitly.

Under the current release process, the shared repo-tracked Apple build number is intentionally left alone during normal version bumps. Xcode Cloud handles signed archive and distribution separately, and the repository documentation does not define an in-repo build-number bump workflow.

iOS and macOS share the target, bundle ID and marketing-version source, but
use independent Xcode Cloud release-build workflows, local native acceptance
runs, uploaded platform build IDs and App Review drafts. Only **iOS Release Build**
and **macOS Release Build** stay enabled; retain disabled test workflows and history. Cloud run numbers are not distribution build
numbers. Record local test source/configuration separately from the exact Cloud
run → Archive action → uploaded app/platform/version/build ID and signed export provenance; TestFlight internal distribution does not prove tests or a new build. Record each exact build identity; never attach an iOS build to the
`MAC_OS` draft or replace another platform's pending submission. Follow the
[Mac procedure](macos.md) without changing the iOS gate contract.

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

Search for the old app version before editing and after the bump. When the
companion qualifies for a release, repeat the check for its old version in that
repository. Confirm manifests, lockfile top-level versions, runtime readers,
compatibility comments, and any versioned metadata agree. Leave frozen test
fixtures and platform build-number handling as documented above.

Use normal cloud CI for each changed repository, including **Plugin packages**
for a changed companion. Keep version-only verification to source inspection
and CI. Report the app preparation commit and the new or reused companion
source separately from each provider's submitted or published version and source.
Inspect iOS version wiring directly. Monitor automatic
AWS/web and Android workflows according to [Release Gates](../release-gates.md).
