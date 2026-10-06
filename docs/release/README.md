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
| Android | [Cloud validation, Device Run, and Play publication](android.md) |
| Web and backend | [Deployment and public runtime verification](web-backend.md) |
| MCP and plugins | [Canonical channel inventory, directories, website links, and publication](mcp-and-plugins.md) |

Here, "manual" means explicitly dispatched rather than automatically triggered
by a push; either a human or an authorized AI can operate workflows and consoles.

## Release Sequence

Use this routine checklist; the linked procedures own the detailed gates.

1. **Resume or choose a version.** Inspect the [ledger](evidence.md#release-ledger),
   current publications and [inventory](mcp-and-plugins.md#release-inventory).
   [Reuse matching artifacts](evidence.md#reuse-existing-artifacts); for a new
   release, obtain the [version choice](versioning.md#release-preparation).
2. **Preflight remaining work.** Check the essentials below before expensive
   local work, downloads or dispatches; reused artifacts resume at their next unfinished step.
3. **Merge preparation.** Align app/companion versions through normal PR/cloud
   CI, [verify them](versioning.md#verify-the-release-version), pin both SHAs and
   prepare reusable [release notes](release-notes.md) in the chat. Keep that version through fixes.
4. **Run platform flows in parallel.** Follow the [platform procedures](#required-reading):
   complete required iOS local gates before Xcode Cloud dispatch, use Android's
   [cloud-first gate](evidence.md#android-cloud-release-gate), and prepare metadata while builds run.
5. **Verify results and artifacts.** Inspect native results, warnings, source/build
   correlation, uploaded binaries and saved metadata under those procedures;
   retain [readiness evidence](evidence.md#release-ledger) before new mobile submission/publication.
6. **Complete distribution actions.** Submit/publish the exact verified artifacts
   and existing channel updates to their [completion boundaries](#release-inventory-and-completion).
7. **Preserve and close out.** Verify app/companion [tags, Releases and package assets](versioning.md#github-tag-and-release),
   then apply [closeout and development safeguards](versioning.md#release-closeout-and-development).
   Tags/assets may be needed earlier by a channel or preserved while external review continues; retain the selected version.
8. **Hand off actual states.** Report [channel status and remaining actions](evidence.md#release-ledger),
   public links, both Releases/source SHAs and retained version. Separate completed work from external review and public availability.

On failure, inspect evidence, fix and merge through normal CI, then repeat only
affected gates and revalidate artifact reuse. Update the target SHA and notes.
If a fix affects an already published artifact, ask the user how to handle that platform.

### Early preflight

- Before required local Xcode work or runtime downloads, check available disk
  against the actual archive/result/runtime needs; there is no universal free-space threshold.
  Inspect installed [iOS runtimes/devices](../ios-local-setup.md#local-testing-rules)
  and the actual [Cloud catalog](../ios-ci-cd.md#supported-os-destinations).
- Verify authenticated access for the remaining provider/store actions and the
  [saved Xcode Cloud configuration](../ios-ci-cd.md#cloud-configuration-preflight).
  Check all four configured [Device Run destinations](../android-ci-cd.md#choose-the-device-run-devices)
  before new Android dispatch. Resolve access blockers only where needed; preserve reusable artifacts.

Machine/provider setup, legal acceptance and runtime provisioning are setup work;
repeat them only when missing or newly required. Older-OS manual walkthroughs
apply to first support expansion or affected OS-specific changes, as defined in
[iOS](ios.md) and [Android](android.md#first-release-api-30-walkthrough).
For every new iOS release, the [three automated iOS 18 smokes](../ios-local-setup.md#ios-18-compatibility-smoke)
still run locally when Cloud cannot provide that independent selection.
Keep the full latest-OS suite and Android's four sequential Device Run sessions.

## Release Inventory and Completion

For each channel, inspect the existing publication first. Verify/reuse unchanged
publication when its inputs still match; update the existing listing or artifact
when source, version, tools, auth, or metadata requires it. Never blindly
republish, recreate a listing, or silently omit a channel.

See the [canonical channel inventory](mcp-and-plugins.md#release-inventory) and
maintain the [release ledger](evidence.md#release-ledger).

Operational completion means our required publication or submission actions are
finished at the boundary below. Track observed public availability separately:
submission, approval, and a portal's **Published** label alone do not prove it.

| Channel | Operator completion boundary |
| --- | --- |
| iOS | Exact version/build successfully submitted for review with automatic release after approval enabled and its saved setting verified. In manual mode, complete any available final release action and record a later action still awaiting approval as follow-up. |
| Android | Exact production version is publicly available at the selected rollout scope, after the required GitHub/Device Run gates and applicable OS-specific checks. |
| Web/backend and MCP Registry | Intended deployment/runtime or registry version is verified under its procedure. |
| Established connector/plugin/directory channels | Required CI/scans and focused checks passed, and the exact update/publication request was accepted, or the unchanged publication was verified. |

External iOS/provider review and directory crawl/propagation are follow-up; they
do not hold overall closeout open after these boundaries. Record pending states
factually and any later operator action, without calling them live. OpenAI's
initial publication is excluded from routine release until a separately scoped
initial launch establishes that channel; preserve its submission identity through
the [companion procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md).

Before a new publication/submission, apply the [release warning policy](#release-warning-policy).
Already-published matching mobile artifacts count complete under the
[reuse rules](evidence.md#reuse-existing-artifacts); historical gaps do not reopen
them. Reuse valid evidence on unchanged inputs and do not extend completed
publication with optional tests. These boundaries, together with mandatory tags,
Releases, assets, and development safeguards, control
[release closeout](versioning.md#release-closeout-and-development).

## Release Warning Policy

Before a new publication/submission, fix release errors, failed required tests,
applicable security vulnerabilities, and actionable first-party, configuration,
build, compiler, lint, and toolchain warnings. A known failure blocks that action.
All existing build, test, security, and publication gates remain mandatory.
Only the bounded warning exceptions below may remain.

Vendor-owned, non-actionable deprecation, tool, or runtime notices may remain
when supported stable compatible vendor versions have been assessed, no
behavior-preserving vendor-supported fix is available, and the required gates
pass. Classify simulator/platform runtime and optional cache/optimization
diagnostics from inspected evidence, not substring matching or severity labels;
these are distinct from compiler, lint, or test failures. Retain raw diagnostics
and investigate app/test failures regardless of apparent vendor ownership.
Fix supported actionable notices; do not suppress logs or downgrade toolchains
to obtain a clean report.

The standing payment exception covers unavoidable transitive upstream npm
deprecation notices in an official payment SDK, including an official
authentication SDK used for payment integration. First upgrade the SDK to the
latest supported stable vendor release and verify the affected flows. The
exception applies only if the notice remains and no vendor-supported fix exists.
Record the exact SDK and deprecated package versions, dependency chain, evidence
of the current supported stable SDK and absence of vendor-supported remediation,
affected-flow verification, and a security assessment with its evidence.
Deprecation does not establish the presence or absence of a vulnerability;
applicable security vulnerabilities still block release.

Compiler warnings require an explicitly named compatibility exception; vendor
ownership alone never qualifies. The Sentry
`enableReportNonFullyBlockingAppHangs = false` setter deprecation is an approved
example when retaining it preserves fully-blocking-only hang reporting and no
supported replacement preserves that behavior. Recheck the supported replacement
and affected flow every release. This does not exempt other compiler or lint
warnings, and a Sentry URL configuration mismatch is an actionable configuration
defect, not an unavoidable vendor notice.

For each exception, record in the [release ledger](evidence.md#release-ledger)
the exact notice, versions, owner and dependency/toolchain chain, upstream
remediation assessment, affected-flow and gate evidence, security assessment,
and reason it qualifies. Reassess each release and adopt supported fixes when
available. Reuse documented qualifying decisions under this standing policy
without repeated user approval. Changes to product/security behavior, broader
dependency replacement, SDK forks or internal patches, and incompatible
dependency overrides require separate scope and authorization.
