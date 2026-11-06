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
resubmitting the same artifact. If an older version is still in review, complete
the [exact-artifact checks in step 6](#exact-artifact-checks) before replacing it.
New artifacts follow all pre-submission gates under the [standing best-effort policy](README.md#standing-best-effort-release-policy), including its separate operator decision for unavailable testing.
For a user-reserved final Submit, apply the [handoff and resume rules](#user-reserved-final-submit).

1. Merge release preparation through `Repository static checks` and pin the
   intended `main` SHA. Use matching [local source snapshots](evidence.md#source-snapshots).
   Access App Store Connect [API-first](../xcode-cloud-data-access.md#required-local-secrets).
   After the [saved Cloud configuration preflight](../ios-ci-cd.md#cloud-configuration-preflight),
   run steps 2 and 3 in parallel.
2. Dispatch only **iOS Release Build** (`97ECE547-B59E-4970-ACFA-52ED8F6F7B29`)
   on the pinned SHA. Verify the accepted run source, record workflow/run/action
   IDs, and monitor `Archive - iOS`, Release signing, upload and the internal
   TestFlight postaction. Keep distribution internal during acceptance.
   Correlate the exact processed upload in step 6.
3. Prepare production build values using [iOS Local Setup](../ios-local-setup.md).
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

   Run all three [local native acceptance plans](../ios-local-setup.md#local-native-acceptance)
   with the selections, signing and review-email setup there. Record the
   [local gate evidence](evidence.md#local-mobile-release-gate) in the ledger.
4. While both tracks run, prepare [What's New for every iOS locale](release-notes.md)
   locally and record the released version used as the baseline. Update the
   App Store draft in step 6.
5. Reconcile all five [schema-4 gates](readiness.md#ios-local-acceptance-schema-4):
   unsigned `local-archive`, `local-full`, `local-ipad`, `local-ios18` and signed
   `cloud-archive`. Inspect every named result, warning and failure artifact.
   Require every available selected case to pass, with
   [targeted recovery](evidence.md#targeted-recovery) for affected cases. Record
   any unavailable coverage for the decision in step 6. Apply the
   [iOS 18 manual checklist](../ios-local-setup.md#ios-18-compatibility-smoke)
   for the first expanded release or changes affecting OS-specific behavior.

   If either track finds a blocking defect, hold review, merge the fix through
   normal PR/CI, and repeat affected gates. If app or archive inputs change,
   archive the corrected merged source before proceeding. Retain an unchanged
   archive or test result only with [bounded source comparison](evidence.md#resume-and-artifact-reuse).
   Compare production, test and saved workflow inputs, toolchain, signing and
   distribution settings. Record both SHAs, original identities, exact scope/diff,
   reviewer and why each retained gate still applies. Test-only fixes use
   targeted recovery. Preserve the original results and readiness contracts.

   Restore any temporary workflow filters after the accepted runs finish, with saved readback under the configuration preflight. Apply the [release warning policy](README.md#release-warning-policy) before submission; ask for help when blocking issues cannot be resolved autonomously. Record actual local-test/Cloud-archive elapsed times and evidence sizes.
6. <a id="exact-artifact-checks"></a>
   Wait for the successful archive to finish processing in App Store Connect.
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
   Before attachment, run short checks on that exact signed Release/TestFlight artifact: launch with `FLASHCARDS_AUTOMATION_RUN=1` in the app process, verify `automation_run_decided` reports `isAutomation=true`, then navigate, create/reveal/rate a disposable card, and confirm offline relaunch persistence. Record artifact/version/build, actual OS, steps and outcomes, and complete applicable [iOS 18 manual checks](../ios-local-setup.md#ios-18-compatibility-smoke).
   Require all available exact-artifact checks to pass and resolve any observed
   blocking failure before withdrawing an older submission or attaching the
   verified build. For unavailable coverage only, record the unexecuted checks
   and a dated [standing-policy](README.md#standing-best-effort-release-policy)
   decision bound to the verified source and artifact before either action.
   Re-read the current iOS version and submission state through the App Store
   Connect API. If an older version is in `PENDING_DEVELOPER_RELEASE`, complete
   its manual publication in step 8 before continuing, honoring any
   [user reservation](README.md).
   If the older version is still in review, [replace it](#replacing-a-version-still-in-review).
   Otherwise, create or reuse the intended editable iOS draft.

   Before saving What's New, recheck the last iOS version actually released to
   users. If step 8 just published an older version, confirm it as the baseline
   first. Regenerate every locale if the baseline or target changed since step 4.

   After creating, reusing or renaming the draft, read the intended app's versions
   again with `GET /v1/apps/{appId}/appStoreVersions`. Require the resolved draft
   ID to have platform `IOS`, the target `versionString` and an `appVersionState`
   of `PREPARE_FOR_SUBMISSION` or `DEVELOPER_REJECTED`. Stop on any mismatch.

   List all localizations on the verified draft with
   `GET /v1/appStoreVersions/{versionId}/appStoreVersionLocalizations`, following
   pagination. Before the first notes-only PATCH, require exactly one localization
   ID for each planned [App Store locale](../app-store-connect-metadata.md).
   Stop on duplicates. Follow that guide's full upload procedure for missing
   locales or changes to other listing fields or screenshots. For notes-only
   updates, use `PATCH /v1/appStoreVersionLocalizations/{id}` with the
   localization type and ID and only `whatsNew` in `data.attributes`.
   List the draft's localizations again and compare every locale's
   saved text with the prepared notes. Attach the verified build and verify its
   ID, build number/version and required fields.
   Choose **Add for Review** to place the version in a **Ready for Review**
   draft submission.
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
required gates pass or unavailable testing is recorded under the standing policy before submission, the exact submission and saved
release setting are verified, and any currently available manual publication
action is completed. Already-published matching builds use the shared historical
evidence rule. Public availability is a separate observed state.

Build configuration: [iOS CI/CD](../ios-ci-cd.md). API diagnostics and result
bundles: [Xcode Cloud data access](../xcode-cloud-data-access.md).

## Replacing a Version Still in Review

Complete the replacement's checks in [iOS step 6](#exact-artifact-checks) or
[macOS steps 8–9](macos.md#exact-artifact-and-review-preparation), as applicable,
before cancelling an older submission still **Waiting for Review** or **In Review**.

1. Cancel its submission (`PATCH /v1/reviewSubmissions/{id}` with
   `canceled: true`, or **Remove from Review**); the release request authorizes
   this. Record it in the [ledger](evidence.md#release-ledger).
2. Reuse that version record (one open version per platform) and set the new
   version string.
3. Each locale's What's New covers its saved unreleased notes plus the new
   changes.

Return to the platform procedure to attach the verified build and submit.
Release approved versions and keep the existing GitHub tag and Release.

## User-Reserved Final Submit

After native and exact-artifact gates are resolved under the platform procedure,
verify the **Ready for Review** draft's platform, version, version ID, build
number, build ID and submission ID.
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
