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
[publishing procedure](../plugin-publishing.md#openai)
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

## Independent Client Sync Check

Use this check when passing native results do not show the card and rating on
a second client. Use web as the separate client by default. Use another client
only if you can provide equivalent proof of both successful server refreshes.

1. Sign in to the exact candidate and a separate client with the same disposable
   account. Use a disposable linked workspace and keep all other review activity
   off the account across workspaces. Refresh Progress on the separate client.
   After the server refresh succeeds, record the expected grade's count and
   reporting range before creating the card or taking the candidate offline.
2. Create a card with a unique question on the front and its answer on the back,
   then reveal and rate it once on the candidate. Use the same card and rating
   for any applicable offline relaunch or upgrade check.
3. Sync the candidate, then sync the separate client and find the card in Cards.
   Refresh Progress again on the separate client. After the server refresh
   succeeds, verify that the expected grade's count increased by exactly one
   over the same reporting range.

On web, use Refresh in Progress and confirm a successful
`GET /v1/me/progress/series` in the browser's Network panel for each count.

In the [ledger](#release-ledger), keep the candidate SHA and artifact, both
clients' versions/builds and OS versions, account, workspace and card
identifiers, expected grade, reporting range, before and after counts, time
and outcome. Retain screenshots or a native result showing the observations.
Reuse evidence for the same candidate and scope.

## macOS Evidence

Before a new Mac submission/publication, retain a separate readiness manifest
and operator inspection decision under [macOS release](macos.md). The
[mobile-readiness CLI](readiness.md) supports only iOS/Android; do not relabel
Mac evidence or claim a CLI pass. Record target/archive/test source SHAs,
version/build, workflow/run/action/artifact and uploaded `MAC_OS` build IDs,
export checksum, both architectures' signing/profile/capability evidence, full
independently reviewed native inventory and named results, exact skip reasons,
diagnostics/warning decisions, screenshot/manual-check results and gaps.
Record the [signed `LocalMacCritical` selection](../macos-ci-cd.md#signed-local-native-acceptance),
actual macOS/Xcode/SDK and development profile/certificate. Retained Mac
records keep their original plan. Keep any
[targeted recovery](#targeted-recovery) and bounded source comparisons.
Preserve historical failed Cloud actions and Keychain diagnoses separately.
Include the reviewer, inspection time and submission/publication decision
with durable private evidence references.

## Validation Activities

1. **Local diagnosis** can run on uncommitted changes. Follow
   [Mac local signing, desktop and test-data rules](../macos-ci-cd.md#signed-local-native-acceptance)
   and the Apple [automation marker](../ios-ci-cd.md#automation-marker).
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

For an artifact awaiting a new publication/submission, recover the original
gates and evidence under its recorded contract. Use the [iOS and Android
readiness contracts](readiness.md#input-contract) or [Mac evidence](#macos-evidence).
Keep the original source selection, build and test identities, all named
results and skip reasons, coverage limits and inspected warnings. Historical
Apple manifests keep their original local and Cloud requirements. Historical
Android evidence retains every device and named case selected at its pinned
source, including four-device runs under readiness schema 2. Preserve all
failed attempts. Investigate unexpected skips and missing cases.

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

After a failed, interrupted or passed attempt of an [iOS local acceptance
plan](readiness.md#ios-critical-release-schema-5), a historical schema-3/4
local plan or signed Mac acceptance, a test-automation-only change may rerun
only affected cases when:

- app source, resources, dependencies, build settings, relevant environment and distribution inputs are unchanged or proven equivalent under [source snapshots](#source-snapshots);
- the change repairs test interaction, setup or diagnostics without weakening assertions, removing required cases or changing the product contract;
- the affected test chain is enumerable, including all callers of changed helpers/fixtures, with shared mutable state and test-ordering effects considered.

Keep the complete independently established inventory and every original native attempt with its failures, statuses and artifacts. On the corrected snapshot, execute all failed, missing, interrupted and affected cases; reuse earlier passes only while their inputs remain valid. Account for every required case with the attempt that supplies it. If impact cannot be bounded, run the complete affected plan; app changes follow normal affected-plan acceptance. Never call the original failed attempt passed, and label readiness assembled from several attempts as such. A filtered diagnostic run alone is not acceptance.

For iOS, use the latest complete-plan attempt whose app inputs remain valid
as the gate's `results` entry, with its real status and source. The [mobile
readiness](readiness.md) report stays blocked when acceptance depends on
combining attempts. Retain a recovery record and an explicit operator
readiness decision alongside the manifest and report in the ledger. Record:

- gate; every attempt with its real overall status, source snapshot/artifact identity and native result references;
- changed files and the enumerated affected chain;
- per required case, its status and supplying attempt;
- equivalence reasoning and the warning review of every contributing attempt;
- the operator decision.

Mac uses the same record beside its [manually inspected readiness](#macos-evidence), never relabelled as a mobile CLI pass. Android keeps its Device Run and [exact-bundle](android.md#exact-bundle-upload-recovery) rules.

Historical example: `LocalMac` failed on a clipped workspace-picker row. Commit `87031c682` changed only `LiveSmokeWorkspaceFlows.swift` inside `#if targetEnvironment(macCatalyst)`: a new private helper `tapCreateWorkspaceInCurrentPicker`, called once from `createWorkspaceFromCurrentWorkspaceSelection`, which `runGuestToLinkedWorkspaceScenario` reaches from `LiveSmokeSettingsTests/testLiveSmokeResetWorkspaceProgressFlow()`, `LiveSmokeSettingsTests/testLiveSmokeLoginAndLinkedWorkspaceFlow()` and `LiveSmokeAIConsentTests/testGuestReceiptTransfersThroughVerifiedReviewAccountAndLogoutClearsAdmission()`. Rerun those three plus every failed, missing or interrupted case on the corrected snapshot, reuse the original attempt's other passes and keep its failure recorded. iOS gates are unaffected because the non-Mac path is textually unchanged.

## Local Mobile Release Gate

Follow the [iOS release procedure](ios.md) for the local archive, critical
plans and signed Cloud archive. Keep build logs, native reports, toolchain
versions, [source snapshots](#source-snapshots) and every failed attempt.
Use `set -o pipefail` when recording logs through `tee`.

## Android Cloud Release Gate

Follow the [Android release procedure](android.md) for required cloud CI,
the signed AAB and both sequential physical Device Run gates. Generate
[recorded readiness](readiness.md#generate-the-android-manifest) from the exact
signed build, native summary and publisher provenance. Record any diagnostic
execution and its outcome in the ledger. Use [exact-bundle
recovery](android.md#exact-bundle-upload-recovery) for a publisher-only failure.
