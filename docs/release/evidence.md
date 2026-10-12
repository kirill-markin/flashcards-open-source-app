# Release Evidence

Read the [release entry point](README.md) for authorization, completion, and
required reading. These common gates apply to the linked platform procedures.

## Release Ledger

Keep a separate release ledger in the operator's chat or release record, not a
historical status table in these permanent docs. Use one small row per channel:

| Channel / target | Source and artifact | Gate evidence | Required operator actions | Provider/store state and publishing mode | Observed public availability | Remaining action |
| --- | --- | --- | --- | --- | --- | --- |
| Name / version | SHA, build/package identity, run | CI, smoke, skip/warning evidence or historical gaps | Complete/pending/blocked/excluded at the canonical boundary; accepted or pending submission/request/publication identity, exact source and time | Submitted/review pending/approved/rejected; saved automatic/manual/managed mode, or not applicable | Pending/live/unchanged verified; URL, observed version/time and storefront/rollout scope | External dependency or exact human/operator action, owner, observation time and next condition; future fixes |

Keep secrets and reviewer credentials out. Mark operator completion only at the
[canonical boundary](README.md#release-inventory-and-completion); it does not
change the observed public state. Record exclusions and their scope.

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
Preserve any failed Cloud action and Keychain diagnosis separately from the
genuinely signed full local native result; the Cloud failure never becomes a
pass. Include bounded source comparisons, reviewer, inspection time and the
submission/publication decision with durable private evidence references.

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
evidence; never mark an unexecuted test passed. Apply the
[platform reuse rules](#reuse-existing-artifacts) to already-published artifacts.

## Reuse Existing Artifacts

Inspect the current store/registry state before starting the numbered flows.
Follow the canonical [source comparison and ledger rules](#resume-and-artifact-reuse)
when reusing an artifact, including when later docs-only or unrelated commits
changed the root SHA. For a matching artifact, continue at the next unfinished
step; an approved or live binary does not need another build or submission.

For an artifact awaiting a new publication/submission, retain the original
gates and their recorded contract: recover required local preflight logs,
cloud runs, artifact identity, and actual smoke/test results. New Android
artifacts use the cloud-first gates below; retained schema-1 readiness records
keep their original local and cloud requirements. For Android, correlate the
signed AAB, version code, GitHub
run/attempt and all four exact completed Device Run sessions, job labels and named
case results. For iOS and macOS, recover both archive and test
workflows and each platform's uploaded build identity. Mac additionally retains
its exact export and [full native/manual evidence](macos.md), including any
diagnosed Cloud signing limitation and authorized local alternative. Record
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

Newly dispatched artifacts must still pass every required gate in their platform procedures.
Before a new publication/submission, apply the
[release warning policy](README.md#release-warning-policy), including its required
evidence for qualifying notices. Reuse valid results when relevant inputs have
not changed; repeat only affected gates after a fix.
A source-affecting fix invalidates affected evidence and requires the corrected
artifact's gates. Read APIs/CLIs first; use the browser for unsupported actions
or diagnosed access blockers, including final store publication.

## Local Mobile Release Gate

Before dispatching an iOS cloud release, complete its local preflight in the
[iOS](ios.md) procedure on the intended release SHA with no uncommitted source changes.
Use the platform's supported SDK/toolchain and production build configuration.
This local release gate is mandatory even when PR checks are already green.

Keep full build logs and test reports; when piping output through `tee`, enable
`set -o pipefail` so logging cannot hide a failed command. Inspect compiler,
linker, Gradle, and lint warnings even after a successful exit. Apply the
[release warning policy](README.md#release-warning-policy), fix blocking issues
and smoke failures, merge fixes through normal CI, and repeat the
affected local preflight on the corrected release SHA before cloud dispatch.
Record the SHA, commands, toolchain versions, and results in the chat. Missing
local SDKs or build inputs block that platform's dispatch until resolved; do
not silently substitute a cloud build for the local check.

For iOS, local success does not replace any cloud gate in its platform procedure.
Cloud signing, build
environments, managed-device tests, and store processing can fail independently;
still run and inspect them, including their errors and warnings. After cloud
failures require source fixes, repeat the affected local preflight before
retrying the cloud flow.

## Android Cloud Release Gate

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
ledger. A known failure still blocks publication until resolved.

After a source-affecting fix, merge through normal CI and repeat affected cloud
gates for the corrected SHA under the reuse rules above. Repeat applicable
OS-specific checks when their exercised behavior changes; reuse the completed
first API 30 walkthrough when those inputs remain applicable. Store checks and
publication completion remain mandatory under the platform procedure.
