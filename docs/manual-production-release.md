# Platform Release Procedures

Execute these platform flows in parallel during
[Release All Platforms and Start the Next Development Version](release-current-version.md).
That runbook owns authorization, release notes, retries, GitHub publication,
and the next-version bump. Here, "manual" means explicitly dispatched rather
than automatically triggered by a push; either a human or an authorized AI can
operate the workflows and consoles.

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

Run `MCP Registry Publish` (`.github/workflows/mcp-registry-publish.yml`) on
`main` while `server.json.version` still names the current release. Check that
the run used the intended manifest/version and completed successfully; the
workflow validates, publishes, and verifies the registry entry. No console
publication step follows. See [publisher details](mcp-registry-publishing.md)
only for troubleshooting or credential setup.

Completion: the workflow verified the intended published version. On resume,
reuse an already verified publication; registry versions are immutable, so do
not publish the same version again or bump just to retry.

## Android

1. Complete the [local parity commands](android-ci-cd.md#local-parity-commands):
   run `bash scripts/android/run-android-ci.sh` from the repository root for
   the existing checks, debug/test APK builds, and lint; then run
   `scripts/android/run-android-release.sh` with the documented signing and
   Sentry inputs to build the optimized Release AAB. A debug build alone does
   not validate release compilation and R8. Use a local validation version code;
   the cloud workflow still assigns the published version code. Run the existing
   `LiveSmokeTest` on one local emulator at the supported Android target using
   the linked instructions. Inspect logs and lint/test reports under the local
   gate above. Keep the bundle local; publication uses the cloud-built AAB.
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

Completion: Firebase and GitHub are green and the matching production release
has been published or submitted for required Play review. A draft alone does
not complete this gate; report review pending separately from live rollout.

Configuration, Firebase access, artifact correlation, and Play translation
checks: [Android CI/CD](android-ci-cd.md).

## iOS

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

Completion: both workflows passed without unresolved warnings and the matching
build/version was submitted for App Review. Do not wait for Apple's review
verdict before continuing to the GitHub Release and next-version bump.

Build configuration: [iOS CI/CD](ios-ci-cd.md). API diagnostics and result
bundles: [Xcode Cloud data access](xcode-cloud-data-access.md).

## Web and Backend

`AWS/Web Release` deploys from `main` automatically when relevant files change,
limited to the components that changed since their last release.
Verify the release commit's applicable deployment and smoke jobs succeeded. Fix failures before declaring this platform complete;
AWS deploys and their artifacts stay in CI/CD.

Completion: the applicable automatic release/checks are green. See
[Release Gates](release-gates.md) for monitoring and migration/rollback rules.
