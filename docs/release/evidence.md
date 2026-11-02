# Release Evidence

Read the [release entry point](README.md) for authorization, completion, and
required reading. These common gates apply to the linked platform procedures under the [standing best-effort policy](README.md#standing-best-effort-release-policy).

## Release Ledger

Keep a separate release ledger in the operator's chat or release record, not a
historical status table in these permanent docs. Use one small row per channel:

| Channel / target | Source and artifact | Gate evidence | Required operator actions | Provider/store state and publishing mode | Observed public availability | Remaining action |
| --- | --- | --- | --- | --- | --- | --- |
| Name / version | SHA, build/package identity, run | CI, smoke, skip/warning evidence or historical gaps | Complete/pending/blocked/excluded at the canonical boundary; accepted or pending submission/request/publication identity, exact source and time | Submitted/review pending/approved/rejected; saved automatic/manual/managed mode, or not applicable | Pending/live/unchanged verified; URL, observed version/time and storefront/rollout scope | External dependency or exact human/operator action, owner, observation time and next condition; future fixes |

Keep secrets and reviewer credentials out. Mark operator completion only at the
[canonical boundary](README.md#release-inventory-and-completion); it does not
change the observed public state. Record exclusions and their scope.
Record measured build, test, diagnosis and provider-wait durations here too.

For [OpenAI](mcp-and-plugins.md#openai), retain separate hosted MCP and package
observations on every coordinated release. Record publisher login
`kirill@kirill-markin.com`, owning organization/project, verified developer
identity and existing plugin/submission ID; keep reviewer access private.
Record the app's deployed backend SHA and runtime verification separately from
MCP scan identity/time, findings, held updates, live definitions and tool
availability. Record companion source SHA, selected package version, exact
successful CI run, ZIP SHA-256 digest, package decision (**no update needed**,
**submitted**, **live**, **pending**, or **blocked**), accepted request identity/time,
review/approval and publication state, and immediate public listing/installed
version and skills evidence. Unknown or unexecuted observations remain explicit
gaps. Package CI, a server version, an MCP-only listing, and a private import
cannot establish public bundled-skill availability. Follow the
[companion procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md#openai)
and record the remaining action and next condition independently for each state.

Use these same rows for handoff. While external review is pending, preserve the
submission identity and next action instead of extending the run with polling
or rebuilding/resubmitting an unchanged artifact. Follow the
[user-reserved iOS handoff](ios.md#user-reserved-final-submit) and
[reviewer-disabled plugin rules](mcp-and-plugins.md#reviewer-disabled-plugin-publication).
Record later external submission/publication observations without claiming
agent execution or identifying an actor without evidence.
Android remains open until public at its selected rollout scope; iOS automatic
submission can be operator-complete while review/public availability remains pending.
macOS uses a separate `MAC_OS` row under the [Mac procedure](macos.md), even
when its marketing version and app ID match iOS.

Before a new mobile submission/publication, follow the [recorded mobile readiness procedure](readiness.md)
and retain its manifest and JSON report alongside the ledger in the operator's
release record, outside tracked release history. Preserve the referenced native
evidence durably. Its offline result covers recorded build/test gates only;
manual diagnostics, store checks and completion remain governed by the platform
procedures and canonical boundaries above.

## macOS Evidence

Before a new Mac submission/publication, retain a separate readiness manifest
and operator inspection decision under [macOS release](macos.md). The
[mobile-readiness CLI](readiness.md) supports only iOS/Android; do not relabel
Mac evidence or claim a CLI pass. Record target/archive/test source SHAs,
version/build, workflow/run/action/artifact and uploaded `MAC_OS` build IDs,
export checksum, both architectures' signing/profile/capability evidence, full
independently reviewed native inventory and named results, exact skip reasons,
diagnostics/warning decisions, screenshot/manual-check results and gaps.
Record **Flashcards Native Acceptance** / **LocalMac** / **Acceptance**, both non-UI/UI bundles, actual macOS/Xcode/SDK and genuine development profile/certificate. Full signed local acceptance, or its [targeted recovery](#targeted-recovery), is the normal required gate. Preserve historical failed Cloud actions and Keychain diagnoses separately; a Cloud failure never becomes a pass. Include bounded source comparisons, reviewer, inspection time and the
submission/publication decision with durable private evidence references.

## Validation Activities

1. **Local diagnosis** on uncommitted changes needs no commit or merge; [local-execution authorization](../macos-ci-cd.md#signed-local-native-acceptance) and the [preflight](#local-mobile-release-gate) desktop, test-data and automation-marker rules still apply.
2. **Accepted validation evidence** binds results to a precisely recorded [source snapshot](#source-snapshots), committed or not; Android gates keep the [Android procedure](android.md)'s pinned SHA and clean checkout.
3. **Distribution builds and publication** use only clean, accepted merged source, retaining exact archive/uploaded-artifact provenance and the platform's signed-artifact checks.

## Resume and Artifact Reuse

Resume a prepared or partly published release at its recorded target version;
do not bump again. For a new release, first complete [release preparation](versioning.md#release-preparation).
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
Source-affecting changes invalidate reuse for the new target and require its
affected gates. Before a new publication/submission, resolve missing required
evidence or record unavailable testing under the standing policy; never mark an unexecuted test passed. Apply the
[platform reuse rules](#reuse-existing-artifacts) to already-published artifacts.

### Source snapshots

At execution time, record the base commit, Git tree IDs of the relevant paths (including new untracked files), configuration, toolchain, destination, environment, built-product identities and native result references. Keep credentials out of retained manifests and records. Compute tree IDs from the working tree through a temporary index; no commit is needed:

```bash
tmp=$(mktemp)
GIT_INDEX_FILE="$tmp" git read-tree HEAD
GIT_INDEX_FILE="$tmp" git add -A
tree=$(GIT_INDEX_FILE="$tmp" git write-tree)
rm "$tmp"
git rev-parse "$tree:apps/ios"
```

Tree IDs omit ignored files such as local xcconfig and service values; equal trees never replace the configuration comparison. After commit or merge, compare `git rev-parse <merged-sha>:<path>` for the same paths. Equal relevant trees carry the evidence to that commit even though commit SHAs differ; record both. In a readiness manifest, use that verified commit as the result `identity.sourceSha` and the gate's `inventorySourceSha`, and reference the snapshot record from its `evidenceRef`. For an attempt whose snapshot matches no commit, such as a failed attempt before an uncommitted test fix, record its base commit in both fields, still establish the inventory from the executed snapshot, reference the snapshot and note the mismatch in the [recovery record](#targeted-recovery). Rerun affected checks when any relevant tree or other input differs or equivalence is uncertain. A change confined to `#if targetEnvironment(macCatalyst)` leaves iOS gates applicable when the recorded comparison shows the non-Mac path textually unchanged, and vice versa for iOS-only branches.

## Reuse Existing Artifacts

Inspect the current store/registry state before starting the numbered flows.
Follow the canonical [source comparison and ledger rules](#resume-and-artifact-reuse)
when reusing an artifact, including when later docs-only or unrelated commits
changed the root SHA. For a matching artifact, continue at the next unfinished
step; an approved or live binary does not need another build or submission.

For an artifact awaiting a new publication/submission, retain the original
gates and their recorded contract: recover required local preflight logs,
cloud runs, artifact identity, and actual smoke/test results. New iOS artifacts use schema 4 with full local acceptance and Cloud archive; new Android artifacts use schema 2 with the cloud-first gates below. Retained schema-1/3 readiness records keep their original local and Cloud requirements; never relabel historical evidence to erase a required gate or failed history. For Android, correlate the
signed AAB, version code, GitHub
run/attempt and all four exact completed Device Run sessions, job labels and named
case results. For iOS, recover complete local-plan results, the Cloud release archive and uploaded build identity; historical records keep their recorded selection. For macOS, recover the Cloud release archive, full signed local acceptance (or its [targeted recovery](#targeted-recovery)) and uploaded build identity. Mac additionally retains
its exact export and [full native/manual evidence](macos.md), including any
historical Cloud signing diagnosis retained separately from current mandatory local acceptance. Record
passed/failed/skipped cases,
skip reasons, coverage limits, and inspected warnings. Investigate unexpected
skips; a green summary or unexecuted test is not a pass.

An already-published matching mobile artifact counts complete once its
source/build identity and publication at the intended scope are established.
Missing historical logs, additional unexecuted tests, or known warnings on that
published binary become future work, not a request for a waiver, rebuild, or
retrospective preflight. Record the evidence honestly; do not reopen completed
publication for optional tests. This does not waive fixes before the next
release, or turn an identity mismatch into a matching artifact.

Newly dispatched artifacts follow their platform gates and the standing policy for unavailable testing.
Before a new publication/submission, apply the
[release warning policy](README.md#release-warning-policy), including its required
evidence for qualifying notices. Reuse valid results when relevant inputs have
not changed; repeat only affected gates after a fix.
A source-affecting fix invalidates affected evidence and requires the corrected
artifact's gates. Read APIs/CLIs first; use the browser for unsupported actions
or diagnosed access blockers, including final store publication.

## Targeted Recovery

After a failed, interrupted or passed native attempt of an Apple local acceptance gate (`local-full`, `local-ipad`, `local-ios18` or `LocalMac`), a later test-automation-only change may rerun only affected cases when:

- app source, resources, dependencies, build settings, relevant environment and distribution inputs are unchanged or proven equivalent under [source snapshots](#source-snapshots);
- the change repairs test interaction, setup or diagnostics without weakening assertions, removing required cases or changing the product contract;
- the affected test chain is enumerable, including all callers of changed helpers/fixtures, with shared mutable state and test-ordering effects considered.

Keep the complete independently established inventory and every original native attempt with its failures, statuses and artifacts. On the corrected snapshot, execute all failed, missing, interrupted and affected cases; reuse earlier passes only while their inputs remain valid. Account for every required case with the attempt that supplies it. If impact cannot be bounded, run the complete affected plan; app changes follow normal affected-plan acceptance. Never call the original failed attempt passed, and label readiness assembled from several attempts as such. A filtered diagnostic run alone is not acceptance.

For `local-full`, `local-ipad` and `local-ios18`, the latest full-plan attempt whose app inputs remain valid stays the gate's `results` entry with its real status and source, and the [mobile readiness](readiness.md) report stays blocked; never merge attempts into one passed result. Like the [Device Run exception](#android-cloud-release-gate), retain next to that manifest/report in the ledger a recovery record and an explicit operator readiness decision. The record lists:

- gate; every attempt with its real overall status, source snapshot/artifact identity and native result references;
- changed files and the enumerated affected chain;
- per required case, its status and supplying attempt;
- equivalence reasoning and the warning review of every contributing attempt;
- the operator decision.

Mac uses the same record beside its [manually inspected readiness](#macos-evidence), never relabelled as a mobile CLI pass. Android keeps its Device Run and [exact-bundle](android.md#exact-bundle-upload-recovery) rules.

Example: `LocalMac` failed on a clipped workspace-picker row. Commit `87031c682` changed only `LiveSmokeWorkspaceFlows.swift` inside `#if targetEnvironment(macCatalyst)`: a new private helper `tapCreateWorkspaceInCurrentPicker`, called once from `createWorkspaceFromCurrentWorkspaceSelection`, which `runGuestToLinkedWorkspaceScenario` reaches from `LiveSmokeSettingsTests/testLiveSmokeResetWorkspaceProgressFlow()`, `LiveSmokeSettingsTests/testLiveSmokeLoginAndLinkedWorkspaceFlow()` and `LiveSmokeAIConsentTests/testGuestReceiptTransfersThroughVerifiedReviewAccountAndLogoutClearsAdmission()`. Rerun those three plus every failed, missing or interrupted case on the corrected snapshot, reuse the original attempt's other passes and keep its failure recorded. iOS gates are unaffected because the non-Mac path is textually unchanged.

## Local Mobile Release Gate

Before dispatching an iOS cloud release, complete its local preflight in the
[iOS](ios.md) procedure on a recorded [source snapshot](#source-snapshots) matching the intended release source.
Use the supported SDK/toolchain and production service values: Release for the device archive, and the acceptance scheme's Debug build configuration for its test plans.
This is the normal local release gate even when PR checks are already green; apply the standing policy when testing is unavailable. Require the unsigned device Release archive, full latest-iPhone UI and existing non-UI plan, three focused latest-iPad flows, and three actual iOS 18 compatibility flows under the [canonical plan commands](../ios-local-setup.md#local-native-acceptance). Every configured required case must pass in one complete attempt or under [targeted recovery](#targeted-recovery). Preserve every failure artifact.

Before expensive native work, check the [early preflight](README.md#early-preflight), Mac [signing and disposable test data](../macos-ci-cd.md#signed-local-native-acceptance), an [exclusive desktop](macos.md#preflight-and-cloud-gates) for Mac UI and the [automation marker](../ios-ci-cd.md#automation-marker). No extra suite or warm-up run is required; a recently repaired fragile flow may run first.

Keep full build logs and test reports; when piping output through `tee`, enable
`set -o pipefail` so logging cannot hide a failed command. Inspect compiler,
linker, Gradle, and lint warnings even after a successful exit. Apply the
[release warning policy](README.md#release-warning-policy), fix blocking issues
and smoke failures, repeat the affected local preflight on the corrected
snapshot, and merge fixes through normal CI before cloud dispatch.
Record the snapshot, commands, toolchain versions, and results in the chat. Record unavailable local test tooling and any feasible alternative under the standing policy; a cloud archive does not establish a local test pass. Missing inputs needed to produce/sign the release artifact still block dispatch.

For iOS, local success does not replace any cloud gate in its platform procedure.
Cloud signing/archive, build environments and store processing can fail independently;
still run and inspect them, including their errors and warnings. After cloud
failures require source fixes, repeat the affected local preflight before
retrying the cloud flow.

## Android Cloud Release Gate

Use the [standing known Device Run network procedure](../android-device-run-network-issue.md)
when preflight selects the alternative to the normal four-session acceptance requirement.
Retain its explicit dispatch/policy provenance, truthful failed/skipped records
and separate operator readiness decision alongside the unchanged mobile-readiness
manifest/report. No native failure becomes a pass; other gates and public
rollout completion remain mandatory. Exact-bundle recovery retains its original contract.

For new Android artifacts, follow the [Android procedure](android.md) on the
intended release SHA with no uncommitted source changes. Require the complete
`Android Release` workflow, cloud checks and optimized signed Release AAB,
and all four sequential Device Run sessions with their complete named results.
Retain full logs and reports, inspect diagnostics under the
[release warning policy](README.md#release-warning-policy), and preserve
source/run/attempt/artifact correlation. A green summary does not replace
native results or signed-binary verification. A publisher-only failure can use
[exact-bundle recovery](android.md#exact-bundle-upload-recovery): keep the original
passing build/native gates and failed workflow conclusion, plus the separate
successful publisher workflow bound to the same signed AAB hash and code.

The [local parity commands](../android-ci-cd.md#local-parity-commands) remain
available for diagnosis and OS-specific behavior that cloud selection does not
cover. Local CI, Release builds and emulator smokes are not recurring
pre-dispatch prerequisites; missing local Android SDKs or upload keys do not
block cloud dispatch. Record any diagnostic execution and its outcome in the
ledger. Fix identifiable app/test defects before publication under the standing policy.

After a source-affecting fix, merge through normal CI and repeat affected cloud
gates for the corrected SHA under the reuse rules above. Repeat applicable
OS-specific checks when their exercised behavior changes; reuse the completed
first API 30 walkthrough when those inputs remain applicable. Store checks and
publication completion remain mandatory under the platform procedure.
