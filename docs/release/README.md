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

## Required Reading

Before any release or version-only work, read this entry point's authorization,
completion, and sequence rules. For a full release, also read
[shared evidence](evidence.md), [release notes](release-notes.md),
[versioning](versioning.md), and **every in-scope platform/topic file** below.
For a single-platform release, read shared evidence and the relevant platform
procedure; for version-only work, read versioning. These shared rules remain
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
that channel live. This same gate controls the next-development transition.

## Release Sequence

1. Identify the current shared version, previous released tag, and release
   commit on `main`; verify version alignment and required CI. Record the
   companion's separate source commit and reconcile the [inventory](mcp-and-plugins.md#release-inventory) and
   [ledger](evidence.md#release-ledger).
   Keep the release version throughout fixes and publication.
2. Prepare the [release notes](release-notes.md) as reusable texts in the chat.
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
   satisfy all [next-development safeguards](versioning.md#next-development-version), then
   bump `X.Y.Z` → `X.(Y+1).0` unless the user specifies another version. Merge
   aligned version surfaces through normal PR/CI and monitor automatic checks.
   Do not dispatch mobile/MCP releases or publish development plugin packages.
7. Report the ledger's actual channel states, public links, app/companion
   Releases, merged next-version commits, and every remaining accepted action.
