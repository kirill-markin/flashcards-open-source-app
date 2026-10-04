# Release Evidence

Read the [release entry point](README.md) for authorization, completion, and
required reading. These common gates apply to the linked platform procedures.

## Release Ledger

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
Source-affecting changes invalidate the affected artifacts/evidence; rerun their
gates. Missing evidence is a gap to resolve or explicitly accept with the user,
not a silent waiver. Use the [platform reuse rules](#reuse-existing-artifacts)
for mobile test, skip, and warning evidence.

## Reuse Existing Artifacts

Inspect the current store/registry state before starting the numbered flows.
Follow the canonical [source comparison and ledger rules](#resume-and-artifact-reuse)
when reusing an artifact, including when later docs-only or unrelated commits
changed the root SHA. For a matching artifact, continue at the next unfinished
step; an approved or live binary does not need another build or submission.

Reuse retains the original gates: recover local preflight logs, cloud runs,
artifact identity, and actual smoke/test results. For Android, correlate the
signed AAB, version code, GitHub run and exact completed Firebase matrix. For
iOS, recover both archive and test workflows and the uploaded build identity.
Record passed/failed/skipped cases, skip reasons, coverage limits, and inspected
warnings. A green summary alone is insufficient; missing evidence or unexpected
skips remain gaps to investigate, never implicit passes. If evidence cannot be
recovered, report the gap and obtain an explicit scoped exception before
counting that gate complete. Do not manufacture retrospective preflight results.

Newly dispatched artifacts must still pass every local and cloud gate in their platform procedures.
A source-affecting fix invalidates affected evidence and requires the corrected
artifact's gates. Read APIs/CLIs first; use the browser for unsupported actions
or diagnosed access blockers, including final store publication.

## Local Mobile Release Gate

Before dispatching either mobile platform's cloud release, complete its local
preflight in the [iOS](ios.md) or [Android](android.md) procedure on the intended release SHA with no uncommitted source changes.
Use the platform's supported SDK/toolchain and production build configuration.
This local release gate is mandatory even when PR checks are already green.

Keep full build logs and test reports; when piping output through `tee`, enable
`set -o pipefail` so logging cannot hide a failed command. Inspect compiler,
linker, Gradle, and lint warnings even after a successful exit. Fix errors,
warnings, and smoke failures, merge fixes through normal CI, and repeat the
affected local preflight on the corrected release SHA before cloud dispatch.
Record the SHA, commands, toolchain versions, and results in the chat. Missing
local SDKs or build inputs block that platform's dispatch until resolved; do
not silently substitute a cloud build for the local check.

Local success does not replace any cloud gate in its platform procedure. Cloud signing, build
environments, managed-device tests, and store processing can fail independently;
still run and inspect them, including their errors and warnings. After cloud
failures require source fixes, repeat the affected local preflight before
retrying the cloud flow.
