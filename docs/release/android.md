# Android

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

Apply [Reuse Existing Artifacts](evidence.md#reuse-existing-artifacts) and the
[Local Mobile Release Gate](evidence.md#local-mobile-release-gate) to this flow.

For a matching draft or submitted artifact, resume at the remaining
checks/publication steps without creating a duplicate. For an approved release,
verify retained gate evidence and continue at step 8. An already-published
matching release counts complete under the shared historical evidence rule;
record its identity and rollout scope at step 9 without reconstructing old logs.
Otherwise create a new artifact through every gate below.

1. Complete the [local parity commands](../android-ci-cd.md#local-parity-commands):
   run `bash scripts/android/run-android-ci.sh` from the repository root for
   the existing checks, debug/test APK builds, and lint; then run
   `scripts/android/run-android-release.sh` with the documented signing and
   Sentry inputs to build the optimized Release AAB. A debug build alone does
   not validate release compilation and R8. Use a local validation version code;
   the cloud workflow still assigns the published version code. Run the existing
   `LiveSmokeTest` on one local emulator at the supported Android target using
   the linked instructions. Inspect logs and lint/test reports under the [shared local
   gate](evidence.md#local-mobile-release-gate). A temporary validation-only keystore need not be the registered Play upload key; keep its bundle local and publish only the cloud-signed AAB.
2. Dispatch `Android Release` (`.github/workflows/android-release.yml`) with
   `Git SHA to release` (`target_sha`) set to the release commit. Record its
   target SHA, run/attempt, version code, and release identifier from the summary.
3. Require four sequential Device Run sessions from `device_run_submission`: the full
   package on API 37, then one four-method smoke session each on API 30, 31 and 33.
   The shared linked test account requires sequential workspace mutations.
   Verify all four current catalog IDs/APIs under
   [device preflight](../android-ci-cd.md#choose-the-device-run-devices).
   Record all four session IDs, selected targets, job labels and GCS results paths
   and retain the [workflow-defined artifacts](../../.github/workflows/android-release.yml).
   The workflow waits for terminal success before building/uploading the signed draft.
   Inspect the [CLI/GCS evidence](../android-ci-cd.md#device-run-results-and-release-correlation).
4. Require all four full reports to show `.sessionReport.status.statusType=DONE`
   and `.sessionReport.result.resultType=PASSED`, with every job and execution
   `DONE`/`PASSED`. A successful CLI `wait` exit is insufficient. Require one
   job per session on the exact configured API 37, 30, 31 and 33 destinations.
   Inspect every execution's named JUnit cases:
   API 37 must execute and pass the full automated selection; each older
   destination must execute and pass all four selected methods. Reconcile
   counts, failures, errors and skips; zero tests, missing destinations or
   unexpected skipped cases block publication. Retain full reports, per-case
   results and logcat with all four session identities for this SHA/run/attempt.
   Failed, cancelled, infrastructure-error or otherwise non-passing results
   block draft upload and publication. Fix the cause, merge, and repeat the workflow for the
   corrected SHA; preserve the failed attempt's evidence.
5. Require the complete GitHub workflow to succeed as well, including the
   signed Android App Bundle (AAB) upload to the production-track draft.
   Inspect build/lint logs and apply the
   [release warning policy](README.md#release-warning-policy) even if the run is green.
6. Open Google Play Console and select that draft by its
   `main-draft-<releaseIdentifier>` name and version code. Confirm it belongs
   to the same SHA/run/attempt as all four passing Device Run sessions. Confirm the uploaded
   AAB manifest advertises minimum API 30 and target API 37; source declarations
   alone do not prove the distributed minimum. Device Run exercises the
   debug APKs from that SHA; the production artifact is the signed AAB from
   the same release run.
   Before publishing the first API-30-compatible release, complete the
   [API 30 walkthrough](#first-release-api-30-walkthrough) and retain its evidence.
7. Fill the localized release notes from the chat, review the draft and required
   translations, and complete the production publication controls for that
   exact bundle. Keep its identity pinned; do not select a newer unrelated
   upload. If Play requires review first, submit and verify the resulting
   review status; complete any publication action already available.
8. Follow the exact version code through Play review and publication. With
   managed publishing enabled, approval leaves changes ready to publish:
   complete **Publish changes** for the intended release. Otherwise verify the
   automatic publication after approval. See Google's
   [review and managed publishing controls](https://support.google.com/googleplay/android-developer/answer/9859654?hl=en).
   Confirm the production rollout and intended countries/audience; record any
   staged percentage or hold rather than describing it as full rollout.
9. Verify the exact target version code is public to the intended production
   audience at the selected rollout scope using Play release and public
   availability evidence. Record the public URL, version/code, rollout scope
   and verification time. Do not add an installation, extra test, or wider
   propagation wait when available evidence already establishes this publication.
   Use an eligible installation/update only if needed to resolve uncertain
   availability. If approved but unavailable at the selected scope, keep the
   channel open as propagation pending or blocked according to evidence.

Completion: all four Device Run sessions, all four configured destinations, GitHub
and local gates pass before new publication, and the exact production version
is public at the intended rollout scope.
Already-published matching releases use the shared historical evidence rule.
Submission or review approval alone leaves this channel open
under the [canonical completion contract](README.md#release-inventory-and-completion).

Configuration, Device Run access, artifact correlation, and Play translation
checks: [Android CI/CD](../android-ci-cd.md).

## First-release API 30 walkthrough

Use an Android 11 / API 30 device with the release candidate for the same SHA,
record the build identity and device, and retain screenshots/logs for failures.
Keep the usual latest-device preflight and checks as well.

1. Open the intended linked test workspace, go offline, create a card with a
   question on the front and answer on the back, reveal/rate it and verify it
   in Cards.
2. Close and relaunch the app while still offline. Confirm the card and review
   state remain intact and the local workspace still opens.
3. Reconnect in the same test workspace. Wait for sync and
   verify the new card and review state on another client in that workspace.
4. Attach an image using the existing system media picker, return to the editor,
   save, and verify the attachment opens. Confirm there is no broad storage
   permission requirement.
5. Open reminder settings and verify native notification enablement is shown
   without a POST_NOTIFICATIONS runtime request. Disable/re-enable app
   notifications in Android notification settings, return to the app and
   verify the displayed status refreshes. Enable a study reminder, background
   the app, and verify a delivered reminder opens Review. Keep the configured
   reminder time and background delivery evidence; WorkManager delivery follows
   Android battery/background scheduling.

Failure blocks the first compatible release until fixed and rechecked.
