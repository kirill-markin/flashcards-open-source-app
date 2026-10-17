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
For a user-reserved final Submit, apply the [handoff and resume rules](#user-reserved-final-submit).

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

   Use a fresh archive output path on retries and retain full build logs. The archive validates device Release compilation without upload; Cloud signing and distribution remain mandatory.

   Complete all three [local native acceptance plans](../ios-local-setup.md#local-native-acceptance): `LocalFull` on one latest iPhone (full eligible UI plus the entire existing non-UI bundle), `LocalIPad` on one latest iPad (three eligible flows), and `IOS18Compatibility` on one actual 18.x iPhone or iPad (three compatibility flows). Use scheme `Flashcards Native Acceptance`, test-plan configuration `Acceptance`, and the exact commands/signing and runner-email setup there. Require complete all-green inventories before Cloud dispatch; filtered diagnostic reruns, unexpected skips and missing cases cannot satisfy acceptance. If a required destination is unavailable, block release. Record exact source, toolchain, plan/configuration, destinations, named results, logs and `.xcresult` evidence in the [ledger](evidence.md#release-ledger), applying the [local gate](evidence.md#local-mobile-release-gate) and warning policy. Valid unchanged evidence may be reused under step 5; a docs-only root SHA change alone does not force native reruns.
2. Access the app and Xcode Cloud through the App Store Connect API using
   [local credentials](../xcode-cloud-data-access.md#required-local-secrets). Use
   the browser for unsupported operations or diagnosed API access blockers;
   ask the user to complete Apple login/MFA if needed, then resume.
3. Identify the two configured workflows for release build/archive and tests.
   Complete the [cloud configuration preflight](../ios-ci-cd.md#cloud-configuration-preflight)
   and every local gate in step 1 before dispatch. Verify the saved Test action selects `Flashcards Native Acceptance` / `CloudSmoke` / `Acceptance` on exactly one latest iPhone, while the required Build/archive action and Catalyst workflows retain their settings. Initially
   start both for the same release SHA and monitor them in parallel. Record
   their run links and source commits; do not infer
   test success from the build. Retries may retain an unchanged successful
   archive only under step 5 and the shared reuse rules.
4. While they run, create or verify the App Store version draft for the current
   version. Fill and save What's New for every locale using the texts already
   in the chat. For localized listing text and iPhone/iPad screenshot uploads,
   follow [App Store metadata](../app-store-connect-metadata.md); its editable-draft
   requirements apply. Verify each saved field and required metadata; request
   help for missing declarations or unexpected store requirements.
5. Require all six [schema-3 readiness gates](readiness.md#ios-local-acceptance-schema-3): unsigned `local-archive`, `local-full`, `local-ipad`, `local-ios18`, signed `cloud-archive`, and the three-test `cloud-smoke`. Inspect every named native result, action status, error and warning even when the overall summary is green. The focused Cloud selection supplements complete local acceptance; it does not waive any local test. All selected required methods must execute and pass. Preserve failure artifacts and investigate unexpected skips or missing cases. The acceptance plans exclude marketing and ineligible device methods through explicit selection; do not invent passed/skipped records for unselected methods or use historical destination exclusions to excuse current required tests.

   Complete the [iOS 18 manual checklist](../ios-local-setup.md#ios-18-compatibility-smoke) for the first expanded release or changes affecting OS-specific behavior. Fix blocking code/build/test issues through normal PR/CI, then repeat affected complete local plans before retrying affected Cloud gates. Targeted reruns help diagnosis but do not replace all-green complete acceptance on corrected inputs.

   Reuse successful archives or test gates only under [bounded source comparison](evidence.md#resume-and-artifact-reuse): compare app source, resources/localizations, relevant test source and plan selections, dependencies/lockfiles, project/settings/schemes, CI hooks, remote workflow values, toolchain, signing and distribution inputs. Record original source/run/action/build/artifact identities, corrected source and exact comparison scope/diff, reviewer, and why each named gate remains valid. Docs-only/unrelated changes do not require native reruns when that comparison proves unchanged native inputs; a filename or version match alone is insufficient. Test-only changes may retain an unchanged signed archive, but require complete corrected affected test-plan evidence. Never rewrite old failures as passes. Production/archive changes or uncertain equivalence require a fresh archive and affected gates. Historical manifests retain their original contract under [readiness](readiness.md).

   Restore any temporary workflow filters after the accepted runs finish, with saved readback under the configuration preflight. Apply the [release warning policy](README.md#release-warning-policy) before submission; ask for help when blocking issues cannot be resolved autonomously. Record measured elapsed times; Cloud runtime savings are unmeasured until the authorized small-plan run completes.
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
   in the submission. If the user reserved final Submit, stop at the
   [handoff](#user-reserved-final-submit). Otherwise choose **Submit for Review** and confirm **Waiting for
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

## User-Reserved Final Submit

After all required gates and preparation pass, verify the **Ready for Review**
draft's exact version, version ID, build number/build ID and submission ID.
Verify the saved automatic-release-after-approval setting, unless manual mode
was explicitly intended. Record these identities, gate evidence, saved mode
and observation timestamp in the [ledger](evidence.md#release-ledger), with
the user's precise remaining action: **Submit for Review** on that submission.
Leave it pending; this handoff is neither submitted nor operator-complete.
The [authorization rule](README.md) also prohibits an equivalent API submission.

On resume, read the current version/build/submission state first. Reuse that
matching submission if it was submitted externally; verify its saved release
mode and continue from the observed state without a duplicate submission.
Record the observation time and any provider-reported submission time separately.
Attribute the submitting actor only with evidence; observing an external
submission does not establish that the agent or the user executed it.
