# Release Evidence

Read the [release entry point](README.md) for authorization, completion, and
required reading. These common gates apply to the linked platform procedures.

## Release Ledger

Keep a separate release ledger in the operator's chat or release record, not a
historical status table in these permanent docs. Use one small row per channel:

| Channel / target | Source and artifact | Gate evidence | Operator completion | Observed public state | Follow-up |
| --- | --- | --- | --- | --- | --- |
| Name / version | SHA, build/package identity, run | CI, smoke, skip/warning evidence or historical gaps | Complete/pending/blocked/excluded; accepted request or publication identity/time | Submitted/review pending/approved/propagation pending/live/unchanged verified; URL, version, time, storefront/rollout scope | External review or later operator action; future fixes |

Keep secrets and reviewer credentials out. Mark operator completion only at the
[canonical boundary](README.md#release-inventory-and-completion); it does not
change the observed public state. Record exclusions and their scope. OpenAI
initial publication is excluded by the routine-release policy until a separately
scoped initial launch; preserve its existing submission identity through the
[companion procedure](https://github.com/kirill-markin/nibomo-plugins/blob/main/docs/publishing.md).

Before a new mobile submission/publication, follow the [recorded mobile readiness procedure](readiness.md)
and retain its manifest and JSON report alongside the ledger in the operator's
release record, outside tracked release history. Preserve the referenced native
evidence durably. Its offline result covers recorded build/test gates only;
manual diagnostics, store checks and completion remain governed by the platform
procedures and canonical boundaries above.

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
case results. For iOS, recover both archive and test
workflows and the uploaded build identity. Record passed/failed/skipped cases,
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

Local success does not replace any cloud gate in its platform procedure. Cloud signing, build
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
native results or signed-binary verification.

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
