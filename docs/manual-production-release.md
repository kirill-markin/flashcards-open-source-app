# Platform Release Procedures

Execute these platform flows in parallel during
[Release All Platforms and Start the Next Development Version](release-current-version.md).
That runbook owns authorization, release notes, retries, GitHub publication,
and the next-version bump. Here, "manual" means explicitly dispatched rather
than automatically triggered by a push; either a human or an authorized AI can
operate the workflows and consoles.

## Reuse Existing Artifacts

Inspect the current store/registry state before starting the numbered flows.
Follow the canonical [source comparison and ledger rules](release-current-version.md#resume-and-artifact-reuse)
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

Newly dispatched artifacts must still pass every local and cloud gate below.
A source-affecting fix invalidates affected evidence and requires the corrected
artifact's gates. Read APIs/CLIs first; use the browser for unsupported actions
or diagnosed access blockers, including final store publication.

## Local Mobile Release Gate

Before dispatching either mobile platform's cloud release, complete its local
preflight below on the intended release SHA with no uncommitted source changes.
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

Local success does not replace any cloud gate below. Cloud signing, build
environments, managed-device tests, and store processing can fail independently;
still run and inspect them, including their errors and warnings. After cloud
failures require source fixes, repeat the affected local preflight before
retrying the cloud flow.

## MCP

First inspect the public registry for the target `server.json.version` and
compare its manifest with the intended release. Reuse a matching publication
and its workflow evidence. Only if that version is absent, run
`MCP Registry Publish` (`.github/workflows/mcp-registry-publish.yml`) on
`main` while `server.json.version` still names the current release. Check that
the run used the intended manifest/version and completed successfully; the
workflow validates, publishes, and verifies the registry entry. No console
publication step follows. See [publisher details](mcp-registry-publishing.md)
only for troubleshooting or credential setup.

Completion: the intended version and manifest are verified at the public
registry endpoint and linked to successful workflow evidence. Registry versions
are immutable: do not republish a version or bump just to retry. A conflicting
published manifest blocks this channel and needs an explicit resolution.

## Android

For a matching draft or submitted artifact, resume at the remaining
checks/publication steps without creating a duplicate. For an
approved or live release, verify retained gate evidence and continue at step 8;
otherwise create a new artifact through every gate below.

1. Complete the [local parity commands](android-ci-cd.md#local-parity-commands):
   run `bash scripts/android/run-android-ci.sh` from the repository root for
   the existing checks, debug/test APK builds, and lint; then run
   `scripts/android/run-android-release.sh` with the documented signing and
   Sentry inputs to build the optimized Release AAB. A debug build alone does
   not validate release compilation and R8. Use a local validation version code;
   the cloud workflow still assigns the published version code. Run the existing
   `LiveSmokeTest` on one local emulator at the supported Android target using
   the linked instructions. Inspect logs and lint/test reports under the local
   gate above. A temporary validation-only keystore need not be the registered Play upload key; keep its bundle local and publish only the cloud-signed AAB.
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
9. Verify the target version on the public Play listing and availability to
   the intended production audience (use an eligible installation/update when
   listing metadata alone cannot establish the version). Record the public URL,
   version, rollout scope and verification time. If approved but unavailable,
   keep the channel open as propagation pending or blocked according to evidence.

Completion: retained or new Firebase/GitHub and local gate evidence is valid,
and the matching production version is publicly verified at the intended
rollout scope. Submission or review approval alone leaves this channel open
under the [canonical completion contract](release-current-version.md#release-inventory-and-completion).

Configuration, Firebase access, artifact correlation, and Play translation
checks: [Android CI/CD](android-ci-cd.md).

## iOS

Read the current version/build and review state through the App Store Connect
API first. Reuse a matching approved/live build with its gate evidence: for
`PENDING_DEVELOPER_RELEASE` continue at step 8; for an already distributed build,
continue at step 9. Preserve an existing review submission and monitor it instead
of uploading or resubmitting the same artifact. New artifacts follow all steps.

1. Prepare production build values using [iOS Local Setup](ios-local-setup.md).
   From the repository root, compile an unsigned device Release archive:

   ```bash
   xcodebuild \
     -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
     -scheme "Flashcards Open Source App" \
     -configuration Release \
     -derivedDataPath "tmp/ios-derived-data" \
     -destination "generic/platform=iOS" \
     -archivePath "tmp/ios-archives/Flashcards-Preflight.xcarchive" \
     CODE_SIGNING_ALLOWED=NO \
     archive
   ```

   Use a fresh archive output path on retries. Prepare one supported iPhone
   simulator using [Local Testing Rules](ios-local-setup.md#local-testing-rules),
   replace `<device-uuid>` below with its UUID, and run this smoke command from
   the repository root; it also compiles the shared scheme's UI test bundle:

   ```bash
   xcrun simctl bootstatus <device-uuid> -b
   xcodebuild \
     -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
     -scheme "Flashcards Open Source App" \
     -derivedDataPath "tmp/ios-derived-data" \
     -destination 'platform=iOS Simulator,id=<device-uuid>' \
     -only-testing:'Flashcards Open Source App UI Tests/LiveSmokeSettingsTests/testLiveSmokeGuestNavigationFlow' \
     test
   ```

   Inspect build logs and the `.xcresult` under the local gate above. Require
   `testLiveSmokeGuestNavigationFlow` to have executed and passed before cloud
   dispatch; a skipped or unselected test does not satisfy this gate. The archive
   validates device Release compilation without uploading anything; signing
   and distribution remain mandatory Xcode Cloud checks.
2. Access the app and Xcode Cloud through the App Store Connect API using
   [local credentials](xcode-cloud-data-access.md#required-local-secrets). Use
   the browser for unsupported operations or diagnosed API access blockers;
   ask the user to complete Apple login/MFA if needed, then resume.
3. Identify the two configured workflows for release build/archive and tests.
   Start both for the same release SHA and monitor them in parallel. Record
   their run links and source commit; do not infer test success from the build.
4. While they run, create or verify the App Store version draft for the current
   version. Fill and save What's New for every locale using the texts already
   in the chat. For localized listing text and iPhone/iPad screenshot uploads,
   follow [App Store metadata](app-store-connect-metadata.md); its editable-draft
   requirements apply. Verify each saved field and required metadata; request
   help for missing declarations or unexpected store requirements.
5. Wait for both workflows to finish green. Inspect the actual passed, failed,
   and skipped test results, plus errors and warnings even if the overall run
   is green. Record skipped cases, their reasons, and the resulting coverage
   limits. Distinguish deliberate [manual marketing exclusions](../apps/ios/docs/marketing-screenshots.md#prerequisites)
   from unexpected skips; investigate unexpected skips rather than counting
   them as passed. Fix code/build/test issues, merge and deploy
   through normal CI, then repeat both workflows for the corrected release SHA.
   Do not submit with unresolved errors or warnings; ask for help when they
   cannot be resolved autonomously.
6. Wait for the successful archive to finish processing in App Store Connect.
   Verify its [uploaded binary localizations](ios-localization.md#bundlebuild-validation)
   before submission.
   Attach the latest successful release build from that SHA to the version
   draft, with matching green test evidence. Verify the build number/version,
   saved localized notes, and required fields; choose **Add for Review** to
   place the version in a **Ready for Review** draft submission.
7. Verify the exact version/build in that submission, then choose **Submit for
   Review**. Confirm **Waiting for Review** and record the submission identity
   with its version/build. A **Ready for Review** draft or an attached build
   alone does not complete submission.
8. Monitor review while independent release work continues. When the approved
   version is `PENDING_DEVELOPER_RELEASE`, manually publish that same build
   using the supported App Store Connect API action or **Release This Version**
   in the browser and confirm. For an automatic release, verify that publication
   actually started. Follow Apple's
   [release procedure](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/);
   do not create a replacement submission merely to release an approved build.
9. Verify `READY_FOR_DISTRIBUTION` (legacy `READY_FOR_SALE`) and the matching
   version on the public storefront in the intended regions. Record the app URL,
   public version and verification time alongside the build identity. Apple
   [availability statuses](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-submission-statuses)
   distinguish readiness from regional availability. Public lookup/storefront
   propagation can lag the API: record propagation pending and check again,
   rather than declaring the release live from the API status alone.

Completion: retained or new local/cloud gate evidence is valid, both cloud
workflows passed without unresolved warnings, and the matching build/version is
publicly available. Submission, approval, and propagation pending remain open
under the [canonical completion contract](release-current-version.md#release-inventory-and-completion),
including its rule for any exception before the next-development bump.

Build configuration: [iOS CI/CD](ios-ci-cd.md). API diagnostics and result
bundles: [Xcode Cloud data access](xcode-cloud-data-access.md).

## Web and Backend

`AWS/Web Release` deploys from `main` automatically when relevant files change,
limited to the components that changed since their last release.
Verify the release commit's applicable deployment and smoke jobs succeeded. Fix failures before declaring this platform complete;
AWS deploys and their artifacts stay in CI/CD.

Verify public web access and the machine discovery entrypoint
`https://api.flashcards-open-source-app.com/v1/`, with deployed MCP evidence for
`https://mcp.nibomo.com/mcp`. Record component SHAs and the relevant successful
deployment/smoke runs; use the canonical source comparison rules for unchanged
components. The web smoke serves CI-built assets against production APIs, so it
does not by itself prove hosted web availability.

Completion: applicable automatic release/checks are green and the intended
public web/backend/machine runtime is verified. See [Release Gates](release-gates.md)
for component selection, smoke limits, and migration/rollback rules.
