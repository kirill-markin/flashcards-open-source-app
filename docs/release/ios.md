# iOS

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

Apply [Reuse Existing Artifacts](evidence.md#reuse-existing-artifacts) and the
[Local Mobile Release Gate](evidence.md#local-mobile-release-gate) to this flow.

Read the current version/build and review state through the App Store Connect
API first. Reuse a matching approved/live build with its gate evidence: for
`PENDING_DEVELOPER_RELEASE` continue at step 8; for an already distributed build,
continue at step 9. Preserve an existing review submission and monitor it instead
of uploading or resubmitting the same artifact. New artifacts follow all steps.

1. Prepare production build values using [iOS Local Setup](../ios-local-setup.md).
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
   simulator using [Local Testing Rules](../ios-local-setup.md#local-testing-rules),
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

   Inspect build logs and the `.xcresult` under the [shared local gate](evidence.md#local-mobile-release-gate). Require
   `testLiveSmokeGuestNavigationFlow` to have executed and passed before cloud
   dispatch; a skipped or unselected test does not satisfy this gate. The archive
   validates device Release compilation without uploading anything; signing
   and distribution remain mandatory Xcode Cloud checks.
2. Access the app and Xcode Cloud through the App Store Connect API using
   [local credentials](../xcode-cloud-data-access.md#required-local-secrets). Use
   the browser for unsupported operations or diagnosed API access blockers;
   ask the user to complete Apple login/MFA if needed, then resume.
3. Identify the two configured workflows for release build/archive and tests.
   Start both for the same release SHA and monitor them in parallel. Record
   their run links and source commit; do not infer test success from the build.
4. While they run, create or verify the App Store version draft for the current
   version. Fill and save What's New for every locale using the texts already
   in the chat. For localized listing text and iPhone/iPad screenshot uploads,
   follow [App Store metadata](../app-store-connect-metadata.md); its editable-draft
   requirements apply. Verify each saved field and required metadata; request
   help for missing declarations or unexpected store requirements.
5. Wait for both workflows to finish green. Inspect the actual passed, failed,
   and skipped test results, plus errors and warnings even if the overall run
   is green. Record skipped cases, their reasons, and the resulting coverage
   limits. Distinguish deliberate [manual marketing exclusions](../../apps/ios/docs/marketing-screenshots.md#prerequisites)
   from unexpected skips; investigate unexpected skips rather than counting
   them as passed. Fix code/build/test issues, merge and deploy
   through normal CI, then repeat both workflows for the corrected release SHA.
   Do not submit with unresolved errors or warnings; ask for help when they
   cannot be resolved autonomously.
6. Wait for the successful archive to finish processing in App Store Connect.
   Verify its [uploaded binary localizations](../ios-localization.md#bundlebuild-validation)
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
under the [canonical completion contract](README.md#release-inventory-and-completion),
including its rule for any exception before the next-development bump.

Build configuration: [iOS CI/CD](../ios-ci-cd.md). API diagnostics and result
bundles: [Xcode Cloud data access](../xcode-cloud-data-access.md).
