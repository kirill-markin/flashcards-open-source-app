<a id="release-all-platforms-and-start-the-next-development-version"></a>

# Release All Platforms

A human or an AI with API/CLI and browser access can execute this runbook.
A request to run the full release authorizes the documented platform workflow dispatches
and existing distribution update/publication actions: store metadata, Android
rollout, iOS App Review and final Apple publication, MCP Registry, existing
connector/plugin/directory updates, companion tags and CI-produced packages,
necessary website distribution-link updates, release-version preparation, and closeout.
This includes committing, pushing, and merging release fixes and version
alignment in this repository, `kirill-markin/nibomo-plugins`, and necessary link
changes in `kirill-markin/flashcards-open-source-app-website` through each
repository's normal PR/CI gates. New directory creation and optional marketplace
expansion require their own scope; they are not required by every release.
Confirm the version choice under [release preparation](versioning.md#release-preparation)
before a new release; do not ask for separate approval at every later step.
A request only to explain or edit this guide, draft notes, or bump versions
does not authorize a full release.

Prefer APIs/CLIs where supported; use the browser for store consoles and actions
without adequate API access. Ask the user for login, MFA, missing permissions,
or help with unexpected state or a decision the available evidence cannot
resolve. Pause the affected action until resolved; continue independent work.
Do not guess store declarations or bypass failed gates. Skip a platform only
when the user explicitly asks to skip it.

## Required Reading

Before any release or version-only work, read this entry point's authorization,
completion, and sequence rules. For a full release, also read
[shared evidence](evidence.md), [release notes](release-notes.md),
[versioning](versioning.md), and **every in-scope platform/topic file** below.
For a single-platform release, read shared evidence, versioning, and the relevant
platform procedure; for version-only work, read versioning. These shared rules remain
mandatory when following a linked procedure directly.

| Platform/topic | Procedure |
| --- | --- |
| iOS | [Local preflight, Xcode Cloud, App Review, and publication](ios.md) |
| Android | [Local preflight, Firebase, and Play publication](android.md) |
| Web and backend | [Deployment and public runtime verification](web-backend.md) |
| MCP and plugins | [Canonical channel inventory, directories, website links, and publication](mcp-and-plugins.md) |

Here, "manual" means explicitly dispatched rather than automatically triggered
by a push; either a human or an authorized AI can operate workflows and consoles.

## Release Inventory and Completion

For each channel, inspect the existing publication first. Verify/reuse unchanged
publication when its inputs still match; update the existing listing or artifact
when source, version, tools, auth, or metadata requires it. Never blindly
republish, recreate a listing, or silently omit a channel.

See the [canonical channel inventory](mcp-and-plugins.md#release-inventory) and
maintain the [release ledger](evidence.md#release-ledger).

Submission, approval, and a portal's **Published** label alone do not prove
public availability. External review may run alongside independent work, but
remains open work. Full publication is complete only when every in-scope channel
is publicly verified as live or unchanged, or the user explicitly accepts a
scoped exception. Report such an exception and its remaining work; never call
that channel live. This same gate controls [release closeout](versioning.md#release-closeout-and-development).

## Release Sequence

1. Identify the last coordinated release version/tag, current app and companion
   source versions, and any prepared or partly published release in the
   [ledger](evidence.md#release-ledger). Reconcile the [inventory](mcp-and-plugins.md#release-inventory).
   For a new release, obtain the user's patch/minor/major choice or exact target
   under [release preparation](versioning.md#release-preparation). Resume a recorded
   target without another bump.
2. Align all app and companion version sources through normal PR/cloud CI,
   [verify the release version](versioning.md#verify-the-release-version), and
   record each resulting source SHA before release builds, registry publication,
   provider packages, or release metadata. Prepare the [release notes](release-notes.md)
   as reusable texts in the chat. Keep this version throughout fixes and publication.
3. Reuse matching artifacts first. For new mobile artifacts, complete the
   mandatory [local preflights](evidence.md#local-mobile-release-gate)
   before the corresponding cloud dispatch, preserving all local/cloud gates.
   Start the necessary Android, iOS, MCP Registry, and companion publication
   flows in parallel; prepare metadata while builds and review run.
4. Complete [platform procedures](#required-reading) and the existing
   [directory updates](mcp-and-plugins.md#release-inventory), including final Apple/Play publication and public
   verification. On failure, inspect evidence, fix and merge through normal CI,
   then repeat affected gates. Update the target SHA/notes and revalidate reuse
   of unaffected artifacts. If a fix affects an already published artifact,
   ask the user how to handle that platform before proceeding.
5. Preserve the release commits and publish/verify the app and companion
   [tags, Releases, and package assets](versioning.md#github-tag-and-release). This may happen
   while external review continues or when a distribution channel needs those
   assets; a GitHub Release does not complete a pending channel.
6. After the public completion gate above (or an explicit scoped exception),
   complete [release closeout and development safeguards](versioning.md#release-closeout-and-development).
   Retain the selected version in both repositories; do not pre-bump development.
7. Report the ledger's actual channel states, public links, app/companion
   Releases and source SHAs, retained version, and every remaining accepted action.
