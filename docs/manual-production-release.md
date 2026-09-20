# Platform Release Procedures

Execute these platform flows in parallel during
[Release All Platforms and Start the Next Development Version](release-current-version.md).
That runbook owns authorization, release notes, retries, GitHub publication,
and the next-version bump. Here, "manual" means explicitly dispatched rather
than automatically triggered by a push; either a human or an authorized AI can
operate the workflows and consoles.

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

1. Dispatch `Android Release` (`.github/workflows/android-release.yml`) with
   `Git SHA to release` (`target_sha`) set to the release commit. Record its
   target SHA, run/attempt, version code, and release identifier from the summary.
2. Wait for Firebase Test Lab submission. Use the summary's matrix ID and
   results path to follow that exact test run through the Firebase API/CLI or
   web console. Submission is asynchronous: a green GitHub workflow does not
   mean Firebase tests passed.
3. Wait until the Firebase matrix finishes with all required tests passing.
   A failed, cancelled, inconclusive, or otherwise non-passing result blocks
   Android publication. Inspect the failures, fix the cause, merge, and repeat
   the release workflow for the corrected SHA; do not publish the failed draft.
4. Require the complete GitHub workflow to succeed as well, including the
   signed Android App Bundle (AAB) upload to the production-track draft.
5. Open Google Play Console and select that draft by its
   `main-draft-<releaseIdentifier>` name and version code. Confirm it belongs
   to the same SHA/run as the passing Firebase matrix. Firebase exercises the
   debug APKs from that SHA; the production artifact is the signed AAB from
   the same release run.
6. Fill the localized release notes from the chat, review the draft and required
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

1. Access the app and Xcode Cloud through the App Store Connect API using
   [local credentials](xcode-cloud-data-access.md#required-local-secrets). Use
   the browser for unsupported operations or diagnosed API access blockers;
   ask the user to complete Apple login/MFA if needed, then resume.
2. Identify the two configured workflows for release build/archive and tests.
   Start both for the same release SHA and monitor them in parallel. Record
   their run links and source commit; do not infer test success from the build.
3. While they run, create or verify the App Store version draft for the current
   version. Fill and save What's New for every locale using the texts already
   in the chat. For localized listing text and iPhone/iPad screenshot uploads,
   follow [App Store metadata](app-store-connect-metadata.md); its editable-draft
   requirements apply. Verify each saved field and required metadata; request
   help for missing declarations or unexpected store requirements.
4. Wait for both workflows to finish green. Inspect the actual passed, failed,
   and skipped test results, plus errors and warnings even if the overall run
   is green. Record skipped cases, their reasons, and the resulting coverage
   limits. Distinguish deliberate [manual marketing exclusions](../apps/ios/docs/marketing-screenshots.md#prerequisites)
   from unexpected skips; investigate unexpected skips rather than counting
   them as passed. Fix code/build/test issues, merge and deploy
   through normal CI, then repeat both workflows for the corrected release SHA.
   Do not submit with unresolved errors or warnings; ask for help when they
   cannot be resolved autonomously.
5. Wait for the successful archive to finish processing in App Store Connect.
   Verify its [uploaded binary localizations](ios-localization.md#bundlebuild-validation)
   before submission.
   Attach the latest successful release build from that SHA to the version
   draft, with matching green test evidence. Verify the build number/version,
   saved localized notes, and required fields; choose **Add for Review** to
   place the version in a **Ready for Review** draft submission.
6. Verify the exact version/build in that submission, then choose **Submit for
   Review**. Confirm **Waiting for Review** and record the submission identity
   with its version/build. A **Ready for Review** draft or an attached build
   alone does not complete submission.

Completion: both workflows passed without unresolved warnings and the matching
build/version was submitted for App Review. Do not wait for Apple's review
verdict before continuing to the GitHub Release and next-version bump.

Build configuration: [iOS CI/CD](ios-ci-cd.md). API diagnostics and result
bundles: [Xcode Cloud data access](xcode-cloud-data-access.md).

## Web and Backend

`AWS/Web Release` deploys from `main` automatically when relevant files change.
Verify the release commit's applicable deployment and Web, Agent API, and MCP
smoke jobs succeeded. Fix failures before declaring this platform complete;
AWS deploys and their artifacts stay in CI/CD.

Completion: the applicable automatic release/checks are green. See
[Release Gates](release-gates.md) for monitoring and migration/rollback rules.
