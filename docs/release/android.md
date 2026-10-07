# Android

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

Apply [Reuse Existing Artifacts](evidence.md#reuse-existing-artifacts) and the
[Android Cloud Release Gate](evidence.md#android-cloud-release-gate) to this flow.

For a matching draft or submitted artifact, resume at the remaining
checks/publication steps without creating a duplicate. For an approved release,
verify retained gate evidence and continue at step 8. An already-published
matching release counts complete under the shared historical evidence rule;
record its identity and rollout scope at step 9 without reconstructing old logs.
Otherwise create a new artifact through every gate below.

1. Pin the intended release SHA and confirm its required
   `Repository static checks` passed. Use a checkout with no uncommitted source
   changes and apply the [cloud-first gate](evidence.md#android-cloud-release-gate).
   Use the linked local parity commands only for diagnosis or uncovered
   OS-specific behavior; routine dispatch does not require duplicate local CI,
   Release builds or emulator smokes. Check whether the
   [API 30 walkthrough](#first-release-api-30-walkthrough) is applicable and
   retain or plan its evidence before publication.
2. Before dispatch, inspect Play Console's Publishing overview for all pending
   changes and active reviews. The upload commits an app-wide edit;
   `status: draft` alone does not prevent other pending changes from entering review.
   The workflow explicitly sets `changesNotSentForReview: true` to hold changes
   for manual submission. Google's [edit commit API](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit)
   can still affect an existing review under its default behavior. If an unrelated
   review is active, stop and resolve the upload scope with the release owner;
   do not cancel or replace that review just to continue the workflow.
   Dispatch `Android Release` (`.github/workflows/android-release.yml`) with
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
   Check Publishing overview again: the intended changes must remain not yet
   sent for review, and other pending changes or reviews must not have been
   unexpectedly submitted, cancelled or replaced by the upload.
   Before publishing the first API-30-compatible release or a change affecting
   its OS-specific behavior, complete the applicable
   [API 30 walkthrough](#first-release-api-30-walkthrough) checks and retain their evidence.
   Reuse completed first-release evidence when that behavior is unchanged.
7. Fill the localized release notes from the chat, review the draft and required
   translations, and complete the production publication controls for that
   exact bundle. Keep its identity pinned; do not select a newer unrelated
   upload. Only after all release gates pass, inspect the complete app-wide
   change set and manually submit the intended changes for review. Verify the
   resulting review status; complete any publication action already available.
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
and applicable OS-specific checks pass before new publication, and the exact
production version is public at the intended rollout scope.
Already-published matching releases use the shared historical evidence rule.
Submission or review approval alone leaves this channel open
under the [canonical completion contract](README.md#release-inventory-and-completion).

Configuration, Device Run access, artifact correlation, and Play translation
checks: [Android CI/CD](../android-ci-cd.md).

## First-release API 30 walkthrough

Complete this walkthrough for the first API-30-compatible release. For later
releases, repeat only steps affected by OS-specific behavior changes; unchanged
behavior does not require recurring manual scrolling, reset or offline checks.
Reuse the completed first-release evidence, recording its source/build/device,
results and why the current changes leave the exercised behavior applicable.
Use the shared source-comparison rules when the artifact source differs.

When applicable, use an Android 11 / API 30 device with the release candidate
for the same SHA, record the build identity and device, and retain
screenshots/logs for failures. Keep the full latest Device Run selection and
all three older-OS smoke sessions as well.

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

Failure blocks the applicable release until fixed and rechecked.
