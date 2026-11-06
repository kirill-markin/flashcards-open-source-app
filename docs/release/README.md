<a id="release-all-platforms-and-start-the-next-development-version"></a>

# Release All Platforms

A full release request authorizes the documented workflow dispatches, review,
publication, existing listing and website link updates, companion packages/tags,
and release fixes and version alignment through the normal PR/CI gates in
the core, `nibomo-plugins` and website repositories. Confirm the
[version choice](versioning.md#release-preparation) for a new release.
Version bumps, notes, guide edits and explanations have their own scope.
New listings and optional marketplace expansion require explicit scope.

A user-reserved action takes precedence. Verify the handoff and leave the
reserved action to the user, including [iOS final Submit](ios.md#user-reserved-final-submit).
Prefer API/CLI, then the browser for unsupported actions or diagnosed access
blockers. Ask for help with missing access, declarations or unresolved decisions
and continue independent work. Skip platforms only at the user's request.

## Standing Best-Effort Release Policy

Run feasible testing with reasonable effort, including full latest-OS
acceptance and focused compatibility. After bounded diagnosis of unavailable
infrastructure, destinations or local tooling, record unexecuted checks,
reasons, alternatives, coverage limits, retained evidence and a dated operator
decision for the exact source and artifact in the [ledger](evidence.md#release-ledger).
Continue authorized publication on that decision, even when the readiness
report remains blocked. Reuse unchanged diagnoses and retry on remediation
or material new evidence.

Fix identifiable app/test defects, actionable build/toolchain/configuration
or security issues, and signing, archive, upload or publication failures
before the affected action. Preserve failed and skipped results and blocked
reports. Required CI, signing, artifact identity, store guards and all four
Android physical Device Run sessions remain mandatory.

## Required Reading

Read [shared evidence](evidence.md) and [versioning](versioning.md) for release
work. For a version-only change, read versioning. For each active channel
follow its procedure when you reach it. Read [release notes](release-notes.md)
for a new release and follow exception/legacy references only when applicable.

- [iOS](ios.md) · [macOS](macos.md) · [Android](android.md)
- [Web and backend](web-backend.md) · [MCP and plugins](mcp-and-plugins.md)

## Release Sequence

1. Inspect current publications against the [inventory](mcp-and-plugins.md#release-inventory).
   Open the [ledger](evidence.md#release-ledger), resume the recorded version
   and [reuse matching artifacts](evidence.md#reuse-existing-artifacts).
2. Complete [early preflight](#early-preflight) for the remaining work.
3. For a new release, align app and companion versions through normal PR/CI,
   [verify version surfaces](versioning.md#verify-the-release-version), pin
   both SHAs and prepare [store notes and GitHub changelog](release-notes.md).
4. Run the [platform flows](#required-reading) in parallel.
   After saved-workflow preflight, dispatch only **iOS Release Build**
   and **macOS Release Build** alongside their respective local acceptance.
   Android's signed build runs alongside the native gate. Prepare metadata
   while builds run.
5. Before new submission or publication, reconcile exact build and native
   results, retain [readiness evidence](evidence.md#release-ledger), apply the
   [warning policy](#release-warning-policy) and complete store checks.
   For a blocking failure, preserve its evidence, merge the
   fix through normal CI and repeat affected gates under
   [artifact reuse](evidence.md#resume-and-artifact-reuse) or
   [targeted recovery](evidence.md#targeted-recovery). Update the pinned SHA
   and notes as applicable. Ask the user when a fix affects a published artifact.
6. Complete each channel at its [boundary](#release-inventory-and-completion).
   Preserve and verify app/companion [tags, Releases and package assets](versioning.md#github-tag-and-release)
   when required by a channel or at closeout. Apply the
   [development safeguards](versioning.md#release-closeout-and-development).
7. Report channel states, public links, both Releases/source SHAs, the
   retained version and remaining actions from the [ledger](evidence.md#release-ledger).

### Early preflight

For remaining Apple, Android and web release work, follow the
[RaTeX dependency guide](../ratex-dependency.md#release-preflight-and-updates)
to compare sources and verify any replacement packages before repinning. Merge
any required consumer pin before affected release tests, builds or publication
and before or with the release version-alignment merge. Let the merge containing
a verified web pin trigger the normal deployment.

Check provider access, disk for the planned artifacts
and installed [iOS destinations](../ios-local-setup.md#local-testing-rules),
[Mac signing and desktop](macos.md#preflight-and-cloud-gates) and
[Android catalog destinations](../android-ci-cd.md#choose-the-device-run-devices)
as applicable. Resolve missing setup when needed.

### Optional Sentry monitoring and cleanup

Filter by project, environment and build. Archive only confirmed test noise
without production impact. Resolve verified fixes under the
[Sentry rules](../../AGENTS.md#data-sources-for-analysis) and record outcomes.

## Release Inventory and Completion

Inspect each [existing channel](mcp-and-plugins.md#release-inventory) before
updating it. Verify unchanged inputs and publication when applicable. Track
observed public availability separately from required operator actions.

| Channel | Operator completion boundary |
| --- | --- |
| iOS and macOS | Exact platform/version/build submitted for review with saved automatic release verified. In manual mode, complete available release actions and record actions awaiting approval as follow-up. |
| Android | Required CI and four Device Run sessions pass, applicable OS-specific checks or coverage decisions are recorded, and the exact production version is public at the intended rollout scope. |
| Web/backend and MCP Registry | Intended runtime or registry version verified. |
| Established connectors, plugins and directories | Required scans/checks pass and the exact update is accepted or unchanged publication is verified. For OpenAI, verify [hosted MCP and package](mcp-and-plugins.md#openai) separately. |

A user-reserved action or [reviewer-disabled plugin publication](mcp-and-plugins.md#reviewer-disabled-plugin-publication)
leaves that channel and the overall release pending. Record its owner and next
condition, complete independent work and retain required tags and assets.
External review and propagation are follow-up after the applicable operator
boundary. [Matching live mobile artifacts](evidence.md#reuse-existing-artifacts)
count complete with their retained evidence.

## Release Warning Policy

Before a new publication/submission, fix release errors, identifiable app/test failures,
applicable security vulnerabilities, and actionable first-party, configuration,
build, compiler, lint, and toolchain warnings. Apply the [standing policy](#standing-best-effort-release-policy) to unavailable testing; it does not waive these defects or security, signing and publication failures.
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
available. Reuse a retained diagnosis while the notice, relevant
component/toolchain versions and runtime context match; reinvestigate
materially changed evidence or behavior. Per-release assessments required
above, including the payment SDK upgrade/security check and the Sentry setter
recheck, still apply. Reuse documented qualifying decisions under this standing policy
without repeated user approval. Changes to product/security behavior, broader
dependency replacement, SDK forks or internal patches, and incompatible
dependency overrides require separate scope and authorization.
