# Android

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

Apply [Reuse Existing Artifacts](evidence.md#reuse-existing-artifacts) and the
[Android Cloud Release Gate](evidence.md#android-cloud-release-gate) to this flow.

Keep Google Play managed publishing **OFF** by default so approved changes
publish automatically as soon as Google approves them. Fix product issues
discovered after publication in later updates. Existing release gates
still apply before submission/publication. Enable a manual publishing hold only
when the user explicitly requests it, and preserve any user-reserved final action
under the [release authorization rules](README.md).

For a matching draft or submitted artifact, resume at the remaining
checks/publication steps without creating a duplicate. For an approved release,
verify retained gate evidence and continue at step 8. An already-published
matching release counts complete under the shared historical evidence rule;
record its identity and rollout scope at step 9 without reconstructing old logs.
Otherwise create a new artifact through every gate below.

Apply the [standing best-effort policy](README.md#standing-best-effort-release-policy) to unavailable testing outside the mandatory physical Device Run sessions.

1. Pin the intended release SHA and confirm its required
   `Repository static checks` passed. Use a checkout with no uncommitted source
   changes and apply the [cloud-first gate](evidence.md#android-cloud-release-gate).
   Use local parity commands only for diagnosis or uncovered OS-specific behavior; routine dispatch does not require duplicate local CI, Release builds or emulator smokes. Check whether the
   [API 30 walkthrough](#first-release-api-30-walkthrough) is applicable and
   retain or plan its evidence before publication.
2. Before dispatch, inspect Play Console's Publishing overview for all pending
   changes and active reviews. The upload commits an app-wide edit;
   `status: draft` alone does not prevent other pending changes from entering review.
   Require managed publishing OFF unless the user requested a manual hold above,
   no active review and an empty ready-to-submit queue before upload; resolve
   unrelated pending changes with the release owner.
   The publisher uses `ERROR_IF_IN_REVIEW` in Google's
   [edit commit API](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit)
   and fails if a review starts during the run. It omits `changesNotSentForReview`,
   which Google supports conditionally after rejection and can reject for apps
   whose changes enter review automatically. The API guard protects active reviews;
   it does not isolate other pending changes or guarantee a manual-review hold.
   Dispatch `Android Release` (`.github/workflows/android-release.yml`) with
   `Git SHA to release` (`target_sha`) set to the release commit and optionally
   supply the [localized notes JSON](release-notes.md#android-draft-upload-input). Record its
   target SHA, run/attempt, version code, and release identifier from the summary.
3. Device Run runs the [named critical journeys and compatibility smoke](../android-ci-cd.md#choose-the-device-run-devices)
   sequentially on physical API 37 and API 30 devices. The signed AAB build and
   R8 gate run in parallel. The Play draft upload waits for hosted CI, the
   signed build and both passing sessions.
4. Verify the effective physical sessions, every job/execution and every
   selected named case using the [Device Run evidence](../android-ci-cd.md#device-run-results-and-release-correlation).
   Preserve any original failed attempt and inspect the reason and destination
   of its retry. Failed, missing or unexpectedly skipped required results
   block publication. Record the release candidate's
   [independent-client card and rating sync check](evidence.md#independent-client-sync-check).
5. Require green `Android Release` and signed AAB publisher provenance, or
   [recover an exact bundle](#exact-bundle-upload-recovery) after a publisher-only
   failure. If only the Wear OS upload failed after the phone draft committed,
   dispatch a new release instead of publishing that phone draft: re-running
   failed jobs cannot work, because the Wear OS job downloads its own attempt's bundle. Inspect build/lint and native diagnostics under the
   [warning policy](README.md#release-warning-policy), then retain the
   [readiness manifest and report](readiness.md#generate-the-android-manifest).
6. Open Google Play Console and select that draft by its
   `main-draft-<releaseIdentifier>` name and version code, and the Wear OS
   `wear:production` draft by its wear name and version code from the run summary.
   Confirm both belong to the same SHA/run/attempt as the passing Device Run sessions. Confirm the uploaded
   phone AAB manifest advertises minimum API 30 and target API 37; source declarations
   alone do not prove the distributed minimum. Device Run exercises the
   debug APKs from that SHA; the production artifact is the signed AAB from
   the same release run.
   Check Publishing overview again: verify the exact intended draft and saved
   publishing mode under the policy above, and that unrelated changes or reviews
   were not unexpectedly submitted, cancelled or replaced. App policy may send changes for review
   automatically; record the actual state rather than assuming a manual-review hold.
   Before publishing the first API-30-compatible release or a change affecting
   its OS-specific behavior, complete the applicable
   [API 30 walkthrough](#first-release-api-30-walkthrough) checks and retain their evidence.
   Reuse completed first-release evidence when that behavior is unchanged.
7. Compare the uploaded localized notes with the retained input, or fill them
   from the chat when the dispatch input was empty. Review the draft and required
   translations, and complete the production publication controls for that
   exact bundle and its `wear:production` draft. Keep its identity pinned; do not select a newer unrelated
   upload. After required release gates pass and any other unavailable testing is recorded under the standing policy, inspect the complete app-wide
   change set and submit the intended changes when a manual submission is
   required. Verify the actual review status; complete any publication action
   already available.
8. Follow the exact version code through Play review and publication. Verify
   managed publishing remains OFF and automatic publication follows approval.
   If the user explicitly requested a manual hold, approval leaves changes ready
   to publish: complete **Publish changes** when authorized, preserving any
   user-reserved final action. See Google's
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

Completion requires passing GitHub and physical Device Run gates, applicable
OS-specific acceptance or an unavailability record under the standing policy,
and public availability of the exact production version at the intended scope.
Already-published matching releases use the shared historical evidence rule.
Submission or review approval alone leaves this channel open
under the [canonical completion contract](README.md#release-inventory-and-completion).

Configuration, Device Run access, artifact correlation, and Play translation
checks: [Android CI/CD](../android-ci-cd.md).

## Intermittent Play translation failures

Play can report unsupported languages or failed translations despite enabled
languages. The [reported incident](https://support.google.com/googleplay/android-developer/thread/473681791?hl=en)
recovered with the unchanged AAB about 18 hours later; this is not a guaranteed
wait. Preserve all languages/settings and the exact bundle/hash. Wait, then make
one authorized retry through the applicable recovery route; stop if it fails
again. For a manual Console retry, reuse the draft and original signed AAB.
Reload after saving to distinguish an old failed-upload message from the
persisted candidate; verify its identity, translations and remaining gates.

Restore the pinned localized notes, save, use **Next** through preview and
confirmation, then inspect Publishing overview and submit only the intended
change. Verify the saved publishing mode and follow step 8 through quick checks,
approval and publication under the policy above.
Verify the exact production version is public before calling Android complete.

## Exact-bundle upload recovery

Use `Android Release Upload Recovery`
([workflow](../../.github/workflows/android-release-upload-recovery.yml)) only
when the original release's CI, required Device Run sessions, signed build and R8
checks passed and only its Play publisher failed. This includes a failed
upload or, with a separate signed-build job, a skipped upload following a
failed publisher configuration, checkout, artifact/notes download or Play
authentication step. Resolve the cause, merge any publisher code fix through
green PR checks and retain the failed run.
Source changes require the bounded comparisons and affected gates in
[artifact reuse](evidence.md#resume-and-artifact-reuse).

1. Retain the original full native reports, named inventory, diagnostics,
   signed AAB, signing verification and resolved failure. Record the original
   source SHA, run/attempt, version/code, signed bundle and native-summary artifact IDs,
   and independently verified AAB and summary SHA-256 values. For workflows with
   localized-notes support, also retain the separate original run/attempt notes
   artifact and its preflight SHA-256, including an explicitly empty input.
2. Immediately before dispatch, verify managed publishing OFF unless the user
   requested a manual hold above, no active review and an empty ready-to-submit
   queue. Resolve unrelated pending changes first.
   Play's **Save for later** is a temporary exclusion: saved changes can return
   after another review starts. Inspect them again after upload and before
   publication; see Google's [publishing controls](https://support.google.com/googleplay/android-developer/answer/9859654?hl=en).
3. Supply the pinned identities and hashes to the recovery workflow and confirm
   the preflight only after all retained gates are reviewed. It downloads exact
   artifact IDs, verifies GitHub ZIP digests, original successful gates and
   the named selections at the original source SHA. Historical four-device
   runs retain all four required selections. It discovers the original
   attempt notes artifact by
   exact name/ID and creation time, verifies its ZIP digest, logged manifest hash
   and source/version/run/attempt binding, and supplies identical notes to the
   publisher. Missing or mismatched notes evidence blocks recovery. No new notes
   can be supplied; legacy workflows without notes support remain recoverable.
   It builds nothing and preserves the original code/name.
   Play must return the same bundle code and SHA-256, whether already present
   or uploaded from those original bytes. A mismatch or failed API call stops
   recovery; never remint a code, choose a newer artifact or retry blindly.
4. Require the recovery workflow to succeed and its publisher provenance to
   show a committed single production draft for the pinned code. Retain both
   workflow identities: original failed release/build/native attempt and separate
   successful upload recovery. Keep the original release identity on the
   [readiness gates](readiness.md), with compound evidence references covering
   the original passing gates and recovered publisher. Do not change the
   original workflow conclusion or relabel its native sessions.
5. Resume step 6 above with the exact recovered bundle. Recheck app-wide Play
   state, delivered translations, processing and publication controls; upload
   recovery alone does not establish readiness or public availability.
   Recovery re-uploads only the phone bundle, so a recovered release has no
   `wear:production` draft: publish the phone draft alone; the Wear OS bundle
   ships with the next normal release.

## First-release API 30 walkthrough

Complete this walkthrough for the first API-30-compatible release. For later
releases, repeat steps 1–3 together whenever an OS-specific behavior change
affects any of them. Repeat step 4 or 5 only if the change affects that step.
Reuse the completed first-release evidence, recording its source/build/device,
results and why the current changes leave the exercised behavior applicable.
Use the shared source-comparison rules when the artifact source differs.

When applicable, use an Android 11 / API 30 device with the release candidate
for the same SHA, record the build identity and device, and retain
screenshots/logs for failures.

1. Start the [independent-client sync check](evidence.md#independent-client-sync-check)
   and record its baseline before going offline. Create and rate the check card
   offline and verify it in Cards.
2. Close and relaunch the app while still offline. Confirm the card and review
   state remain intact and the local workspace still opens.
3. Reconnect and complete the sync check with the same card and rating.
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

Fix observed app/test failures and recheck; handle unavailable walkthrough coverage under the [standing policy](README.md#standing-best-effort-release-policy).
