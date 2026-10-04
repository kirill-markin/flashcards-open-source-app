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
3. Wait for Firebase Test Lab submission. Use the summary's matrix ID and
   results path to follow that exact test run through the Firebase API/CLI or
   web console. Submission is asynchronous: a green GitHub workflow does not
   mean Firebase tests passed.
4. Wait until the Firebase matrix finishes with all required tests passing.
   A failed, cancelled, inconclusive, or otherwise non-passing result blocks
   Android publication. Inspect the failures, fix the cause, merge, and repeat
   the release workflow for the corrected SHA; do not publish the failed draft.
5. Require the complete GitHub workflow to succeed as well, including the
   signed Android App Bundle (AAB) upload to the production-track draft.
   Inspect build/lint logs and resolve errors and warnings even if the run is green.
6. Open Google Play Console and select that draft by its
   `main-draft-<releaseIdentifier>` name and version code. Confirm it belongs
   to the same SHA/run as the passing Firebase matrix. Firebase exercises the
   debug APKs from that SHA; the production artifact is the signed AAB from
   the same release run.
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

Completion: required Firebase/GitHub and local gates pass before new publication,
and the exact production version is public at the intended rollout scope.
Already-published matching releases use the shared historical evidence rule.
Submission or review approval alone leaves this channel open
under the [canonical completion contract](README.md#release-inventory-and-completion).

Configuration, Firebase access, artifact correlation, and Play translation
checks: [Android CI/CD](../android-ci-cd.md).
