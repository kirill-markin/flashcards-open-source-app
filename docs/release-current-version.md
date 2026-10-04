# Release All Platforms and Start the Next Development Version

A human or an AI with API/CLI and browser access can execute this runbook.
A request to run the full release authorizes the documented platform workflow dispatches
and existing distribution update/publication actions: store metadata, Android
rollout, iOS App Review and final Apple publication, MCP Registry, existing
connector/plugin/directory updates, companion tags and CI-produced packages,
necessary website distribution-link updates, and the next-version transition.
This includes committing, pushing, and merging release fixes and version
alignment in this repository, `kirill-markin/nibomo-plugins`, and necessary link
changes in `kirill-markin/flashcards-open-source-app-website` through each
repository's normal PR/CI gates. New directory creation and optional marketplace
expansion require their own scope; they are not required by every release.
Do not ask for separate approval at every step. A request only to explain or
edit this guide, draft notes, or bump versions does not authorize a full release.

Prefer APIs/CLIs where supported; use the browser for store consoles and actions
without adequate API access. Ask the user for login, MFA, missing permissions,
or help with unexpected state or a decision the available evidence cannot
resolve. Pause the affected action until resolved; continue independent work.
Do not guess store declarations or bypass failed gates. Skip a platform only
when the user explicitly asks to skip it.

## Release Inventory and Completion

For each channel, inspect the existing publication first. Verify/reuse unchanged
publication when its inputs still match; update the existing listing or artifact
when source, version, tools, auth, or metadata requires it. Never blindly
republish, recreate a listing, or silently omit a channel.

| Channel | Existing destination and release obligation |
| --- | --- |
| Web, backend, machine API/MCP runtime | Verify deployed components, public web access, machine discovery, and applicable smokes under [Web and Backend](manual-production-release.md#web-and-backend). |
| iOS | Verify the matching version on the public App Store; [iOS procedure](manual-production-release.md#ios). |
| Android | Verify the matching production version and rollout on Google Play; [Android procedure](manual-production-release.md#android). |
| Official MCP Registry | Verify `com.nibomo/flashcards` at the target manifest version; [MCP procedure](manual-production-release.md#mcp). |
| Claude connector and plugin | Verify the [connector](https://claude.ai/directory/nibomo) and the plugin's separate public/installable version; [Anthropic gate](#anthropic-connector-and-plugin). |
| Smithery | Verify/update the [existing server](https://smithery.ai/servers/kirill-fofi/nibomo), endpoint, health, auth, and discovered tools. |
| Glama | Verify/update the [existing connector](https://glama.ai/mcp/connectors/com.nibomo/flashcards), endpoint, health, auth, and discovered tools. |
| Gemini CLI | Verify the [gallery entry](https://geminicli.com/extensions/?name=kirill-markinnibomo-plugins) and released install/update source and version. |
| Executor | Verify/update the [existing public app](https://v2.executor.sh/apps/nibomo/nibomo) from reviewed `executor/` source; record uploaded/deployed/published identities separately from Git and installed copies. |
| OpenAI | Reconcile the existing submission's current package, review/publication state, and any required update. Preserve its identity; a disabled website button is not a public listing. |
| Antigravity | Optional marketplace work; packaged assets do not prove listing approval. Include publication only when explicitly scoped. |

Provider-specific update, installation, and workflow verification belong in
[`nibomo-plugins` publishing](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md)
and [Executor publishing](https://github.com/kirill-markin/nibomo-plugins/blob/main/executor/README.md).
The inventory's current MCP listings must resolve to
`https://mcp.nibomo.com/mcp`. Record health, authentication, and discovered
tool inventory against the
[shared contract](connector-directory-submission.md), including any stale provider
cache or unresolved diagnostic. Run the companion's real OAuth/create/study/edit
verification when affected inputs change or valid evidence is missing. Package
CI alone proves neither OAuth nor those user workflows.

At each release, inspect the website's current `origin/main`
[`Footer.tsx`](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/components/Footer.tsx)
and [`connectorDirectories.ts`](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/lib/connectorDirectories.ts).
Reconcile every distribution link with this inventory. Whenever a website link
is added, update this inventory and its procedure in the same change. During
an authorized release, change the website only when verified public status or
URLs require it, using that repository's instructions and checks. Never enable
a directory button based only on a submission or approval.

Keep a separate release ledger in the operator's chat or release record, not a
historical status table in these permanent docs. One row per channel must hold:
target version; source/artifact identity; CI, smoke, skip and warning evidence;
publication request and status; verified public URL/version/time (and applicable
storefront/rollout scope); remaining action. Keep secrets and reviewer credentials
out. Use distinct states: **submitted**, **review pending**, **approved**,
**propagation pending**, **live**, **unchanged verified**, **blocked**, and
**explicitly excluded**. Record an exclusion's user authorization and scope.
Track optional/not-yet-public channels separately: reconciling an existing
OpenAI submission does not automatically make new marketplace availability a
mandatory release gate. Record whether its publication is in the agreed scope.

Submission, approval, and a portal's **Published** label alone do not prove
public availability. External review may run alongside independent work, but
remains open work. Full publication is complete only when every in-scope channel
is publicly verified as live or unchanged, or the user explicitly accepts a
scoped exception. Report such an exception and its remaining work; never call
that channel live. This same gate controls the next-development transition.

## Resume and Artifact Reuse

Before dispatching or submitting, inspect current source commits and versions,
store builds/statuses, registry versions, public listings, and successful CI.
Reuse a matching built, submitted, approved, or live artifact with its gate
evidence and continue at its next unfinished step. Do not rebuild or resubmit
an approved/live binary merely because this runbook was restarted.

If the final root commit differs from the artifact's SHA after unrelated or
docs-only merges, explicitly compare all relevant client/build inputs, including
shared dependencies, lockfiles, build configuration and workflows. Record both
SHAs, the compared scope/diff, original artifact/run provenance, and why each
affected gate's evidence still applies. A matching version string is insufficient.
Source-affecting changes invalidate the affected artifacts/evidence; rerun their
gates. Missing evidence is a gap to resolve or explicitly accept with the user,
not a silent waiver. Use the [platform reuse rules](manual-production-release.md#reuse-existing-artifacts)
for mobile test, skip, and warning evidence.

## Release Sequence

1. Identify the current shared version, previous released tag, and release
   commit on `main`; verify version alignment and required CI. Record the
   companion's separate source commit and reconcile the inventory/ledger above.
   Keep the release version throughout fixes and publication.
2. Prepare the release notes below as reusable texts in the chat.
3. Reuse matching artifacts first. For new mobile artifacts, complete the
   mandatory [local preflights](manual-production-release.md#local-mobile-release-gate)
   before the corresponding cloud dispatch, preserving all local/cloud gates.
   Start the necessary Android, iOS, MCP Registry, and companion publication
   flows in parallel; prepare metadata while builds and review run.
4. Complete [platform procedures](manual-production-release.md) and the existing
   directory updates above, including final Apple/Play publication and public
   verification. On failure, inspect evidence, fix and merge through normal CI,
   then repeat affected gates. Update the target SHA/notes and revalidate reuse
   of unaffected artifacts. If a fix affects an already published artifact,
   ask the user how to handle that platform before proceeding.
5. Preserve the release commits and publish/verify the app and companion
   [tags, Releases, and package assets](#github-tag-and-release). This may happen
   while external review continues or when a distribution channel needs those
   assets; a GitHub Release does not complete a pending channel.
6. After the public completion gate above (or an explicit scoped exception),
   satisfy all [next-development safeguards](#next-development-version), then
   bump `X.Y.Z` → `X.(Y+1).0` unless the user specifies another version. Merge
   aligned version surfaces through normal PR/CI and monitor automatic checks.
   Do not dispatch mobile/MCP releases or publish development plugin packages.
7. Report the ledger's actual channel states, public links, app/companion
   Releases, merged next-version commits, and every remaining accepted action.

## Anthropic Connector and Plugin

Use the existing [Nibomo connector](https://claude.ai/directory/nibomo) and plugin
submission `d8c1028d-4318-4da5-8514-1ed3e0b9a09e` in the
[developer portal](https://claude.ai/directory/manage), in the owning Claude
organization. The plugin source is the root of
[`kirill-markin/nibomo-plugins`](https://github.com/kirill-markin/nibomo-plugins),
tracked on `main`. Update these listings; do not create duplicate submissions.

1. **Connector runtime:** verify the release's backend deployment and MCP smoke
   in `AWS/Web Release` succeeded for the intended commit. The connector and
   plugin both use `https://mcp.nibomo.com/mcp`; backend deployment updates that
   server. Record its deployed release version/commit and MCP verification.
   `initialize.serverInfo.version` currently comes from `SERVER_VERSION = "v1"`
   in `apps/backend/src/mcp/server.ts`, not the package version. Preserve that
   identity during a version bump; it is not proof of the deployed app version.
2. **Connector listing:** inspect the existing public listing and update changed
   metadata, including displayed tool names, through its existing portal entry.
   Submit those edits for review and record their status. Server/tool changes
   deploy normally; they do not require a new connector submission or a guessed
   directory version field. Follow Anthropic's
   [server update instructions](https://claude.com/docs/connectors/building/after-publishing#mcp-server-changes)
   and [listing edit procedure](https://claude.com/docs/connectors/building/managing-your-listing#edit-your-listing).
3. **Plugin source:** align the [plugin version surfaces](#anthropic-plugin-version-sources)
   to the current release, even when only the product version changed. Follow
   that repository's [packaging and verification instructions](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md)
   and require its **Plugin packages** cloud CI for the exact source commit.
   Merge through its normal PR/CI gates and record that commit and artifact/run
   link. Package validation alone does not verify OAuth or study flows.
4. **Plugin update:** after the aligned manifest version and plugin changes
   reach `kirill-markin/nibomo-plugins` `main`, the connected GitHub push webhook
   notifies Anthropic and triggers validation/security scans automatically.
   Confirm the new version and source commit in the existing submission,
   inspect scan results, and fix blocking findings. **Check for new commits**
   is only needed if delivery/detection failed or to retry after fixes.
   Follow [Update a published plugin](https://claude.com/docs/plugins/submit#update-a-published-plugin)
   and [Publish a passing version](https://claude.com/docs/plugins/submit#publish-a-passing-version).
   Check the applied policy in **Overview → Auto-publish** together with
   **Settings → Publish new versions automatically**. Passing updates publish
   automatically only when Anthropic's applied policy allows it, the toggle is
   on, and no reviewer hold applies. Inspect the actual policy and version status
   on every run: a matching version may already have published automatically.
   Otherwise select **Publish** / **Publish update** as offered and verify
   whether it went live or created a reviewer request; do not assume every
   version requires reviewer approval.
   Reuse an already submitted or published matching version on resume.
5. **Publication evidence:** record plugin version, source commit, CI and scan
   results, publication policy, request/status, and public listing link when
   verified. Check the plugin's own public listing and installable version;
   the connector URL does not establish plugin availability. A scan, Publish
   request, private ZIP upload, or portal **Published** status alone does not
   prove public visibility. Report reviewer delay or public propagation
   separately; the directory serves the last published version meanwhile.

Completion: the runtime, required connector listing edits, and matching plugin's
public/installable version are verified. Apply the inventory's completion rule
to reviewer or propagation delays; a request alone leaves this channel open.

## Release Notes

Compare the release target with the previous version actually released to users.
Start with the commit range between that tag and the target; inspect code only
where the user-visible effect is unclear.

- Describe visible changes in short, plain bullets, most important first.
- Omit internal refactors, tests, CI/CD, and infrastructure details unless users
  notice the result; group small changes as bug fixes or performance improvements.
- Put one fenced `text` block per locale in the chat, with the locale label
  outside and only flat `-` release-note bullets inside. These are reusable
  inputs for the operator, including an AI continuing the same task; do not
  stop to ask the user to copy or approve them.
- Use every locale in the order in
  [Supported App Locales](ios-localization.md#supported-app-locales).
  Keep `es-MX` and `es-ES` separate. Map store locale identifiers using
  [Locale tags per surface](add-language.md#locale-tags-per-surface) and the
  [App Store](app-store-connect-metadata.md) /
  [Google Play](google-play-store-metadata.md) metadata guides. If the current
  store draft requires additional locales, prepare and retain those texts too.
- Reuse these texts in each store's What's New/release notes fields; use the
  English text for GitHub Release. Never publish the raw generated commit, PR,
  or contributor list as release notes.

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
existing channels in the inventory and requires the completion and transition
gates above; a standalone version bump only aligns source.

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
AWS/web and Android workflows according to [Release Gates](release-gates.md).
