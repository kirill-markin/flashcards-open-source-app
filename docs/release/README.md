<a id="release-all-platforms-and-start-the-next-development-version"></a>

# Release All Platforms

A human or an AI with API/CLI and browser access can execute this runbook.
A request to run the full release authorizes the documented platform workflow dispatches
and existing distribution update/publication actions: store metadata, Android
rollout, iOS and dedicated macOS App Review and final Apple publication, MCP
Registry, existing connector/plugin/directory updates, companion tags and CI-produced packages,
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

An explicit user reservation of a final action overrides this general release
authorization. Prepare and verify the handoff, then leave that exact action to
the user; do not execute an equivalent API or console action. Follow the
[iOS final-Submit handoff](ios.md#user-reserved-final-submit) when applicable.

Prefer APIs/CLIs where supported; use the browser for store consoles and actions
without adequate API access. Ask the user for login, MFA, missing permissions,
or help with unexpected state or a decision the available evidence cannot
resolve. Pause the affected action until resolved; continue independent work.
Do not guess store declarations. Skip a platform only when the user explicitly asks to skip it.

## Standing Best-Effort Release Policy

For every authorized release, run feasible testing with reasonable effort: full existing latest-OS acceptance and focused compatibility checks wherever available. When external test infrastructure, destinations or required local test tooling remain unavailable after bounded diagnosis, record the unexecuted checks, reason, retained evidence, feasible alternatives and coverage limits in the [ledger](evidence.md#release-ledger), with a dated operator readiness decision bound to the exact source and artifact. Continue authorized dispatch, submission and publication, then fix forward, without requesting the same waiver each release. Reuse known diagnoses while unresolved and unchanged; retry on remediation or material new evidence.

Fix identifiable app/test defects, actionable build/compiler/lint/configuration or security issues, and actual signing, archive, upload or publication failures before proceeding with the affected action. An unavailable test is a coverage gap; a failed test is investigated and remains failed. Preserve original failures/skips and readiness manifests/reports; never manufacture a pass or change a recorded contract to make it green. Missing build/test evidence may leave the readiness CLI blocked while the separate operator decision permits publication under this policy.

Platform test requirements below describe normal acceptance and are subject to this policy for unavailable checks. Required CI, signing, artifact identity and store/publication guards remain enforced; this policy introduces no generic workflow bypass. For the known Android physical-network issue, select the existing default-off [Device Run exception](../android-device-run-network-issue.md) explicitly during preflight and retain its provenance.

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
| macOS | [Dedicated Catalyst archive, full native tests, App Review, and publication](macos.md) |
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
   prepare separate reusable [store notes and GitHub changelog](release-notes.md)
   in the chat. Keep that version through fixes.
4. **Run platform flows in parallel.** Follow the [platform procedures](#required-reading):
   complete feasible iOS and signed `LocalMac` acceptance under the [standing policy](#standing-best-effort-release-policy) before their Xcode Cloud release-build dispatches, use Android's
   [cloud-first gate](evidence.md#android-cloud-release-gate), and follow the independent
   [macOS local acceptance and Cloud archive flow](macos.md). Prepare metadata while builds run.
5. **Verify results and artifacts.** Inspect native results, warnings, source/build
   correlation, uploaded binaries and saved metadata under those procedures;
   retain [readiness evidence](evidence.md#release-ledger) before new Apple or Android submission/publication.
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
  and the actual supported OS versions under [destination requirements](../ios-ci-cd.md#supported-os-destinations).
- For macOS, inspect the [saved Mac release workflow and local destination](macos.md#preflight-and-cloud-gates),
  shared Apple version and separate `MAC_OS` build/draft. Reserve disk for the
  exact export and full local native evidence; inspect the required genuine local development certificate/profile and actual host macOS before testing. Preserve pending iOS submissions.
- Verify authenticated access for the remaining provider/store actions and the
  [saved Xcode Cloud configuration](../ios-ci-cd.md#cloud-configuration-preflight).
  Choose Android's normal four-session route or the [known-issue route](../android-device-run-network-issue.md) before dispatch; check all four configured [Device Run destinations](../android-ci-cd.md#choose-the-device-run-devices) when using the normal route. Resolve access blockers only where needed; preserve reusable artifacts.

Machine/provider setup, legal acceptance and runtime provisioning are setup work;
repeat them only when missing or newly required. Older-OS manual walkthroughs
apply to first support expansion or affected OS-specific changes, as defined in
[iOS](ios.md) and [Android](android.md#first-release-api-30-walkthrough).
Under the [standing policy](#standing-best-effort-release-policy), for every new iOS release complete [full local native acceptance](../ios-local-setup.md#local-native-acceptance) on latest iPhone, focused latest iPad and actual iOS 18, then retain Cloud archive/signing. Mac requires full signed `LocalMac` acceptance before its Cloud archive. Only **iOS Release Build** and **macOS Release Build** stay enabled; do not routinely dispatch disabled test workflows. Android retains its four sequential Device Run sessions.

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
| macOS | Exact `MAC_OS` version/build successfully submitted for review, with saved automatic release after approval verified; in manual mode, complete any available final release action and record any action awaiting approval as follow-up. Apply the standing policy to unavailable Mac testing; exact-artifact gates remain mandatory. |
| Android | Exact production version is publicly available at the selected rollout scope, after required GitHub gates pass, with Device Run/OS-specific acceptance or recorded standing-policy coverage gaps. |
| Web/backend and MCP Registry | Intended deployment/runtime or registry version is verified under its procedure. |
| Established connector/plugin/directory channels | Required CI/scans and focused checks passed, and the exact update/publication request was accepted, or the unchanged publication was verified. |

A user-reserved final action or [reviewer-disabled plugin publication](mcp-and-plugins.md#reviewer-disabled-plugin-publication)
remains pending at its unchanged boundary. Close out independently completed
work and preserve required tags, Releases, assets and safeguards, with the
exact remaining action, owner and next condition in the ledger. Do not call
the pending channel or the whole release complete; complete every available
required action on the other channels.

External iOS/macOS/provider review and directory crawl/propagation are follow-up; they
do not hold overall closeout open after these boundaries. Record pending states
factually and any later operator action, without calling them live. Every coordinated
release includes the established [OpenAI channel](mcp-and-plugins.md#openai):
inspect its hosted MCP and package independently, then verify unchanged live
content or complete the applicable update under the
[companion procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md#openai).

Before a new publication/submission, apply the [release warning policy](#release-warning-policy).
Already-published matching Apple or Android artifacts count complete under the
[reuse rules](evidence.md#reuse-existing-artifacts); historical gaps do not reopen
them. Reuse valid evidence on unchanged inputs and do not extend completed
publication with optional tests. These boundaries, together with mandatory tags,
Releases, assets, and development safeguards, control
[release closeout](versioning.md#release-closeout-and-development).

## Release Warning Policy

Before a new publication/submission, fix release errors, identifiable app/test failures,
applicable security vulnerabilities, and actionable first-party, configuration,
build, compiler, lint, and toolchain warnings. Apply the [standing policy](#standing-best-effort-release-policy) to unavailable testing; it does not waive these defects or security, signing and publication failures.
The [Mac procedure](macos.md) defines signed local native acceptance; retain historical failed Cloud actions and diagnoses unchanged. Disabled Cloud test workflows are not current gates, and local evidence never converts a Cloud failure to a pass.
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
