# iOS

Read the [release entry point](README.md) for authorization, completion, and
required reading, and the mandatory [shared evidence rules](evidence.md) before
following this procedure.

Apply [Reuse Existing Artifacts](evidence.md#reuse-existing-artifacts) and the
[Local Mobile Release Gate](evidence.md#local-mobile-release-gate) to this flow.

Read the current version/build and review state through the App Store Connect
API first. For a matching approved build in `PENDING_DEVELOPER_RELEASE`,
continue at step 8. An already-published matching build counts complete under
the shared reuse rules; record its identity and observed availability in step 9
without reconstructing historical logs. Preserve an existing review submission
and verify its identity and release setting at step 7 instead of uploading or
resubmitting the same artifact. New artifacts follow all pre-submission gates.

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
   Complete the [cloud configuration preflight](../ios-ci-cd.md#cloud-configuration-preflight)
   before dispatch. Initially start both for the same release SHA and monitor
   them in parallel. Record their run links and source commits; do not infer
   test success from the build. Retries may retain an unchanged successful
   archive only under step 5 and the shared reuse rules.
4. While they run, create or verify the App Store version draft for the current
   version. Fill and save What's New for every locale using the texts already
   in the chat. For localized listing text and iPhone/iPad screenshot uploads,
   follow [App Store metadata](../app-store-connect-metadata.md); its editable-draft
   requirements apply. Verify each saved field and required metadata; request
   help for missing declarations or unexpected store requirements.
5. Require successful archive and test workflows, with complete test evidence.
   Keep the full existing latest-OS smoke selection. Before the first public
   release expanding compatibility to iOS/iPadOS 18, also require the three
   [iOS 18 compatibility smokes and manual checklist](../ios-local-setup.md#ios-18-compatibility-smoke)
   on an actual 18.x destination. Use one Cloud destination only when its saved
   catalog and independent test selection permit it; otherwise use local Xcode
   or an actual OS-18 device. Record the SHA, destination/OS, Xcode/SDK and result
   evidence. If no 18 destination is available, defer expanded public release;
   a lower deployment setting or static PR success does not satisfy this gate.
   Inspect the actual passed, failed, and skipped test results, plus errors and
   warnings even if the overall run is green. Record skipped cases, their reasons, and the resulting coverage
   limits. Distinguish deliberate [manual marketing exclusions](../../apps/ios/docs/marketing-screenshots.md#prerequisites)
   from unexpected skips; investigate unexpected skips rather than counting
   them as passed. Fix code/build/test issues, merge and deploy
   through normal CI, then repeat affected local and cloud gates for the
   corrected release SHA. After test-only or docs-only fixes, retain the
   original successful signed archive only when the
   [shared source comparison](evidence.md#resume-and-artifact-reuse) proves its
   production/archive inputs unchanged: app source, resources and localizations,
   dependencies and lockfiles, project/settings/scheme, CI hooks, remote
   workflow values, toolchain, signing, and distribution configuration. A
   test-only filename or unchanged version is insufficient. Record the original
   archive SHA/run/action and uploaded build identity, corrected test SHA/run,
   comparison scope/diff, and why each retained gate still applies. Test fixes
   require a corrected complete cloud test execution; failed or unexecuted tests
   cannot be reused. Any production/archive-affecting change, or inability to
   establish equivalence, requires a new archive and the appropriate tests and
   local gates. Restore any temporary workflow filters after the accepted runs
   finish, with saved readback as required by the configuration preflight.
   Apply the [release warning policy](README.md#release-warning-policy) before
   submission; ask for help when blocking issues cannot be resolved autonomously.
6. Wait for the successful archive to finish processing in App Store Connect.
   Establish its exact [run/archive/uploaded-build correlation](../xcode-cloud-data-access.md#correlate-an-archive-with-the-uploaded-build).
   Verify its [uploaded binary localizations](../ios-localization.md#bundlebuild-validation)
   before submission. For the exact correlated archive, read the app bundle's
   generated `Info.plist` `MinimumOSVersion` and the executable's
   `LC_BUILD_VERSION` `minos` using `xcrun vtool -show-build`; both must report
   18.0. Check bundled dependencies do not require a higher minimum. Read
   `GET /v1/builds/{buildId}?include=buildBundles` and require that exact uploaded
   build's `minOsVersion` and app bundle's `minimumOsVersion` to report 18.0
   (Apple's [build metadata fields](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds)).
   Do not infer binary compatibility from source settings or another build.
   Attach that verified build to the version draft, with successful test
   evidence from the same SHA or the proven unchanged-archive reuse in step 5.
   Verify the uploaded build ID, build number/version,
   saved localized notes, and required fields; choose **Add for Review** to
   place the version in a **Ready for Review** draft submission.
7. Select automatic release after approval unless manual release is explicitly
   intended, and verify the saved release setting. Verify the exact version/build
   in the submission, then choose **Submit for Review**. Confirm **Waiting for
   Review**, **In Review**, or an approved state and record the submission
   identity, version/build, and saved release mode. A rejected submission needs
   correction and does not satisfy this boundary. A **Ready for Review** draft or an
   attached build alone does not complete submission. Successful submission
   with automatic release enabled completes our iOS work; review is follow-up.
8. In manual mode, complete any final release action already available. For
   `PENDING_DEVELOPER_RELEASE`, publish that same build using the supported
   App Store Connect API action or **Release This Version** and confirm the
   action succeeded. If approval is still pending, record the later manual
   release action as follow-up; it does not hold overall closeout open. Follow
   Apple's [release procedure](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/);
   do not create a replacement submission merely to release an approved build.
9. Record the current App Store Connect and public storefront states in the
   intended regions, with the app URL, observed version/time and build identity.
   For the expanded release, read `GET /v1/appStoreVersions/{versionId}/build`
   to verify the public version references the checked build ID, and observe
   that the regional listing declares iOS/iPadOS 18.0 compatibility. Record
   mismatches or propagation delay; do not claim public 18 support from upload
   or approval alone.
   `READY_FOR_DISTRIBUTION` (legacy `READY_FOR_SALE`) and Apple's
   [availability statuses](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-submission-statuses)
   distinguish readiness from regional availability. If review or storefront
   propagation remains pending, record it as external follow-up; do not wait
   for propagation or declare the release live from the API status alone.

Completion follows the [canonical boundary](README.md#release-inventory-and-completion):
all required gates pass before submission, the exact submission and saved
release setting are verified, and any currently available manual publication
action is completed. Already-published matching builds use the shared historical
evidence rule. Public availability is a separate observed state.

Build configuration: [iOS CI/CD](../ios-ci-cd.md). API diagnostics and result
bundles: [Xcode Cloud data access](../xcode-cloud-data-access.md).
