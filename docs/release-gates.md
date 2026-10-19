# Release Gates and Monitoring

For AWS stack boundaries, resource ownership or deployment-role changes, follow
the [AWS infrastructure change procedure](aws-infrastructure-changes.md).

## Merging pull requests

`Repository static checks` is the strict required aggregate PR gate; [Android CI/CD](android-ci-cd.md) explains the Android scope and its tradeoff. Auto-merge is enabled but never updates a `BEHIND` branch, so it cannot rescue a pull request on its own: update the branch once server-side, then queue `gh pr merge --auto` so the merge lands unattended once the gate passes instead of racing `main` with repeated updates, and still watch the post-merge deploy to completion.

## Release streams

Apply the [standing best-effort release policy](release/README.md#standing-best-effort-release-policy) to unavailable testing in the normal gates below; preserve actual failures and coverage gaps.

Pushes to `main` use independent release and check streams:

- `.github/workflows/aws-web-release.yml` handles AWS/backend/web release work
- it deploys only the components that changed since each one's last successful production release: `platform` (everything CDK deploys, with its verification steps and the agent API and MCP smokes), `web` (web assets), and `admin` (admin assets); the public custom-domain check, which probes the hosted web and admin roots, runs whenever any component deploys
- it finishes healthy only when every selected component deployed and passed its smokes: the native Playwright smoke in `apps/web/e2e/live-smoke.spec.ts` runs when `web` or `platform` deployed and gates both, and the external agent API smoke in `scripts/checks/check-agent-api-smoke.sh` and the MCP endpoint smoke in `scripts/checks/check-mcp-smoke.sh` gate `platform`; a smoke skipped because no component that needs it was selected is not a failure
- rollback is automatic only when the failed AWS release did not include new DB migrations
- migration-bearing AWS failures are explicit fix-forward cases; the next push must still be allowed to run
- Android production draft upload is manual-only through `.github/workflows/android-release.yml` ([where Android CI runs](android-ci-cd.md)); that workflow requires terminal success from all four sequential Device Run sessions before the signed Play draft upload starts
- for an iOS release, complete full local native acceptance (latest iPhone UI and existing non-UI, focused latest iPad, actual iOS 18) and unsigned device Release compilation, then explicitly start and monitor **iOS Release Build** archive/signing under the [iOS release procedure](release/ios.md#ios); require all five schema-4 gates green before App Review submission; Mac requires complete signed `LocalMac` acceptance before **macOS Release Build**. Only these two Cloud release builds remain enabled; test workflows/configuration/history remain disabled and are not routine release gates

Automatic web/backend deployments continue between coordinated releases while
source versions stay unchanged. Use deployed component SHAs and CI run/artifact
identities to identify code; shared semver records the coordinated release. See
[release versioning](release/versioning.md#release-preparation) for version selection.

## Component selection

`scripts/deploy/select-release-components.sh` owns the path-to-component
mapping and the fallbacks. Each component diffs its last released SHA, stored
in SSM at `/FlashcardsOpenSourceApp/release/deployed-sha/{platform,web,admin}`,
against the run's commit, so every merge since that release lands in one diff.
A selected component whose deploy job failed or was cancelled, or whose smokes
did not pass, may already run unverified code, so its parameter is cleared to a
`cleared-by-run:<run id>` marker and the next run deploys it in full; keeping
the old SHA would let a revert to that tree select nothing. A failed SSM read
at record time also clears the parameter instead of writing.
`workflow_dispatch`, any selection error, and a failed AWS login or SSM read,
which leaves all three parameters unreadable, deploy everything; a missing,
cleared, or unreadable parameter, or rewritten history, deploys only that
component in full. The
`Select release components` job summary shows each component's deployed SHA,
the decision, and its reason; `Record deployed component SHAs` shows what the
run recorded. The `main-release` concurrency group serializes runs, so a run
reads the SHAs only after the previous run has written them. Each write is a
compare-and-set against the value the run read at selection or the run's own
marker, so a passing "re-run failed jobs" attempt still records its SHA. When a
rerun of an older run finds a newer value already recorded, it clears the
parameter instead, and the next run deploys that component in full.

The release does not repeat the lint, build, test and synth checks: the strict
`Repository static checks` PR gate already ran them on the same tree. The
PostgreSQL integration job runs beside the deploy. A release whose platform diff
touches migrations or the migration runner waits for it before CDK applies them,
because an applied migration cannot be rolled back; other releases deploy
without waiting. A failure turns the release red and clears the platform SHA, so
the next run redeploys the platform. Seeding and post-deploy checks run beside
the smokes, and a failure clears every selected SHA, like a failed deploy. The deploy job
reuses only the integrity-checked Lambda asset cache and regenerates its private
CDK context and templates. Build-stage summaries report elapsed seconds,
restored cache keys, and built/reused Lambda counts.

The same cumulative platform diff selects the migration gates and the isolated
MCP capacity experiment. The exact conservative path classes live in
`scripts/deploy/select-release-components.sh`. A release that changes migrations
also stages cleanup as disable -> migrate/verify -> enable, so old cleanup code
never deletes media against the new schema; every other release deploys once
with cleanup enabled. Both paths keep the CloudFormation migration dependency
and latest-migration verification. Full/manual/unknown platform selections
retain the migration gates and capacity checks. Every platform release still
checks the deployed MCP endpoint contract; selected capacity experiments must
also pass proxy/capacity probes and temporary-stack cleanup. Pure web/admin uploads skip the PostgreSQL job.

Repository variables such as `vars.CDK_*` and `vars.VITE_SENTRY_*` never appear
in a diff, so a change to one ships with no push. Set the variable first, then
dispatch `AWS/Web Release` manually: variables bind when the run is created.

The `Web post-deploy smoke` job never loads the deployed web assets: it serves a
`dist` built from the merge commit on `app.nibomo.com` through `/etc/hosts`, so
only `auth.` and `api.` reach deployed infrastructure.
Read it as a check of the merge commit's web client against the deployed
backend, not of the hosted web deployment. A failed run uploads
`web-live-smoke-failure-diagnostics` with the Playwright failure diagnostics and
the static server log, which records one line per request with the resolved
content type and whether the SPA `index.html` fallback was served. Those
artifacts are public, and the two halves stay credential-free for different
reasons. `apps/web/e2e/live-smoke.diagnostics.ts` redacts the Playwright
diagnostics before it writes them: header values outside its request and
response allowlists are dropped fail-closed, URL user info and fragments are
dropped, and a URL query value is masked when its parameter name looks
sensitive. The same treatment covers URLs embedded in console text, error
messages and stack traces. Query parameter names and non-sensitive values stay
readable on purpose, because the diagnostics are read through them. The static
server log carries no credential because
`apps/web/scripts/serve-dist-https.mjs` records only the sanitized pathname and
never the query string; nothing redacts that log afterwards, so anything added
to it must be safe to publish as written.

The MCP endpoint smoke in `AWS/Web Release` verifies the deployed MCP HTTP
contract. The companion repository owns [`server.json`](https://github.com/kirill-markin/nibomo-plugins/blob/main/server.json),
the automatic [MCP Registry Validate](https://github.com/kirill-markin/nibomo-plugins/actions/workflows/mcp-registry-validate.yml)
check, and manual [MCP Registry Publish](https://github.com/kirill-markin/nibomo-plugins/actions/workflows/mcp-registry-publish.yml)
workflow. Align manifest/plugin and core versions during
[release preparation](release/versioning.md#release-preparation), then follow
[the MCP gate and explicit companion dispatch command](release/mcp-and-plugins.md#mcp)
to publish an absent version from companion `main`. Registry versions are
immutable; reuse a matching publication and its evidence.

Release order and authorization belong to the [full release runbook](release/README.md).
Platform gates and console actions are in [Platform Release Procedures](release/README.md#required-reading).
Apply the canonical [operator completion boundaries](release/README.md#release-inventory-and-completion)
and record observed public availability separately. External review/propagation
follow-up does not hold closeout open after the applicable boundary is reached.
On resume, use the documented source comparison and
[artifact reuse rules](release/evidence.md#reuse-existing-artifacts), including
the rule for historical gaps on already-published matching mobile artifacts.
New publication/submission actions retain every required gate and apply the
[release warning policy](release/README.md#release-warning-policy).

When a change lands on `main`, monitor `AWS/Web Release` for backend/web outcome when AWS-impacting files changed, including the post-deploy smoke jobs of the selected components. Reading and monitoring Xcode Cloud runs, results, and artifacts is always allowed; dispatching Xcode Cloud workflows requires a full-release request or an explicit request for those actions, as defined in the release runbook.
For Android, a green normal-mode manual `Android Release` means the GitHub-hosted gate and all four Device Run sessions, jobs and executions passed, and CI uploaded a production-track Play draft. Inspect all four sessions, configured destinations and named test results before publication under [the Android release procedure](release/android.md). Translation review, Play-delivered build verification and final publication remain in Play Console; a non-green workflow blocks publication.
The explicit [known Device Run network route](android-device-run-network-issue.md) records physical sessions as waived/not executed and requires separate operator readiness under the standing policy.
For Android release identity, session CLI/GCS inspection and named-case evidence, follow [Android CI/CD](android-ci-cd.md#device-run-results-and-release-correlation).
For Xcode Cloud inspection, use `docs/xcode-cloud-data-access.md`. It documents the local `.env` secrets, App Store Connect API flow, example commands, returned data formats, artifact types, and how to extract timing/debugging insights from cloud test runs.

Cross-client live smoke references:

- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift`
- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/LiveSmokeTest.kt`
- Android notification tap gate: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/notifications/NotificationTapSmokeTest.kt`
- Web: `apps/web/e2e/live-smoke.spec.ts`
- Manual managed image sync: [docs/managed-media-cross-client-smoke.md](./managed-media-cross-client-smoke.md)

These live smoke flows are the highest-confidence checks in the repository because they exercise the real app closest to production conditions.
On Android, these live smoke flows run as part of the broader Device Run app instrumentation suite in the manual `Android Release` workflow.
When a code change affects a primary user flow, main screen, or cross-client navigation path, check the relevant live smoke or targeted integration tests in the same change and update them when the expected behavior changed. We do not try to guard every internal detail with tests. For small internal or low-risk changes that do not affect the main user journey, updating those tests is optional.
