# macOS

Read the [release entry point](README.md), [shared evidence](evidence.md) and
[versioning](versioning.md). This is the release procedure for the dedicated
Mac Catalyst app; [Mac CI/CD](../macos-ci-cd.md) owns workflow identities,
signing instructions and native/manual checks. Editing these docs does not
authorize dispatch, signed local execution, submission or publication. Apply the [standing best-effort policy](README.md#standing-best-effort-release-policy) to unavailable testing throughout this procedure.

## Resume and platform identity

1. Inspect the ledger and App Store Connect API first under
   [Xcode Cloud access](../xcode-cloud-data-access.md#required-local-secrets).
   Read the existing app's versions, builds, submissions and saved release modes,
   selecting platform `MAC_OS`. The app shares its Apple target, bundle ID
   `com.flashcards-open-source-app.app` and marketing version with iOS, but has
   separate platform builds and review drafts. Preserve every pending submission
   on other platforms. A Mac-only request does not dispatch their workflows.
2. Resume the recorded target and exact artifact under
   [reuse rules](evidence.md#reuse-existing-artifacts). Verify a matching submitted
   version and its saved release mode without resubmission; a matching approved
   `PENDING_DEVELOPER_RELEASE` build goes to publication below. Record an
   already-live matching artifact without reconstructing historical native logs.
   Handle an older `MAC_OS` version still in review in step 10.
   New artifacts require all gates below. For a new coordinated version follow
   [release preparation](versioning.md#release-preparation); a same-version Mac
   release uses [Mac source/tag handling](versioning.md#mac-only-source-and-tags).
   Record target SHA and independent archive/test/build identities, never a
   fixed draft ID or Cloud run number used as the distribution build number.

## Preflight and Cloud gates

3. Merge release preparation through `Repository static checks` and pin the
   intended `main` SHA. Use a matching [local source snapshot](evidence.md#source-snapshots).
   Inspect saved [Mac workflow configuration](../macos-ci-cd.md#xcode-cloud)
   API-first: **macOS Release Build** enabled, main-only manual eligibility,
   SCM repository/ref, current Xcode/SDK, shared project and original
   **Flashcards Open Source App** scheme, required `Archive - macOS` action,
   App Store eligible Release/managed signing and internal-testers postaction.
   Verify only the two [Apple release builds](../ios-ci-cd.md#native-release-gate)
   are enabled; preserve disabled test workflows/configuration/history.
   Verify production service values, secure-value presence, review-account access
   and Sentry archive hooks under [Cloud inputs](../ios-ci-cd.md#xcode-cloud-inputs).
   Preserve iOS configuration and masked secrets. Diagnose API access before
   browser fallback and resolve missing factual declarations/access with the user.
4. Run [signed local native acceptance](../macos-ci-cd.md#signed-local-native-acceptance)
   in parallel with step 5. Check disk, host macOS and local signing first.
   On the dedicated, logged-in desktop, complete the
   [launch preflight](../macos-ci-cd.md#desktop-launch-preflight) before starting
   `LocalMacCritical`. Retain the discovered inventory, named results,
   logs, `.xcresult`, diagnostics and [focus screenshots](../macos-ci-cd.md#existing-native-flows).
5. After step 3, dispatch only **macOS Release Build**
   (`9d704b65-5254-4f04-be24-bebc0f0cfc7d`) on the pinned merged `main` SHA.
   Verify the accepted run source. Save workflow/run/Archive action IDs, source
   SHA, Xcode/SDK/OS, configuration and times. Inspect full logs, actions,
   warnings and artifacts under [Cloud data access](../xcode-cloud-data-access.md).
   Require archive, signing, hooks, upload and processing. Keep TestFlight
   distribution internal during acceptance.
6. Before review preparation, reconcile signed `LocalMacCritical` and Cloud results.
   Require every available selected case to pass, in a complete attempt or under
   [targeted recovery](evidence.md#targeted-recovery). Investigate missing cases,
   unexpected skips, failures and interruptions. Record any unavailable coverage
   for the decision in step 9. Apply the [warning policy](README.md#release-warning-policy)
   and preserve historical Cloud test results separately.
7. If either track finds a blocking defect, hold review, merge the fix through
   normal PR/CI and repeat affected gates on the corrected
   [source snapshot](evidence.md#source-snapshots). If app or archive inputs
   change, archive the corrected merged source. Retain a successful archive
   only under [bounded source equivalence](evidence.md#resume-and-artifact-reuse),
   including saved workflow inputs, toolchain, signing and distribution settings.
   Save original archive SHA/run and corrected test SHA/run, exact scope/diff
   and why each retained gate applies. Test-only fixes follow
   [targeted recovery](evidence.md#targeted-recovery).

## Exact artifact and review preparation

8. Establish the exact
   [archive/run/uploaded-build chain](../xcode-cloud-data-access.md#correlate-an-archive-with-the-uploaded-build).
   Require the correlated uploaded build's platform `MAC_OS`, app ID, version,
   distribution build number and successful processing. Retain the actual App
   Store export produced from that archive, artifact ID and checksum. Extract
   its signed app for inspection, preserving the export; an unrelated Debug
   app, source entitlements or TestFlight postaction artifact is insufficient.
   Inspect generated bundle metadata/localizations and both `arm64`/`x86_64`
   executable slices with `lipo`/`vtool`. Reconcile minimum-OS metadata with
   the [macOS baseline](../../apps/ios/README.md#platform-baseline), including
   embedded dependencies; do not infer compatibility from source settings alone.
   Verify signatures and signed entitlements for both architectures with
   `codesign`, and decode the embedded provisioning profile with `security cms`.
   Require the correct bundle/team and profile-authorized private identity
   (`application-identifier` / `com.apple.application-identifier`), valid App
   Store signing/provisioning, sandbox, outgoing network, microphone/camera and
   user-selected read-write file capabilities, with no distribution debug
   entitlement. Inspect nested signed code too. Default private Keychain access
   may omit an explicit sharing group; never invent one to silence a mismatch.
   Correlate these observations with the uploaded build's `buildBundles`
   metadata. Missing export/provenance or a mismatch blocks attachment for review.
9. Record the [signed TestFlight smoke](../macos-ci-cd.md#manual-checklist-on-the-verified-mac-artifact)
   and any diagnostics relevant to the changes. Require all available
   exact-artifact checks to pass and resolve blocking failures before withdrawing
   an older submission or attaching the verified build. For unavailable coverage,
   record the unexecuted checks and a dated
   [standing-policy](README.md#standing-best-effort-release-policy) decision
   bound to the verified source and artifact before either action. Resolve
   required store blockers before submission.
10. Re-read the current Mac version and submission state through the App Store
    Connect API. If an older version is in `PENDING_DEVELOPER_RELEASE`,
    complete its manual publication in step 12 before continuing, honoring any
    [user reservation](README.md).
    If an older Mac version is still in review, follow the
    [replacement procedure](ios.md#replacing-a-version-still-in-review).
    Otherwise, create or resume the intended editable `MAC_OS` version draft.
    Before saving What's New, recheck the last Mac version actually released to
    users. If step 12 just published an older version, confirm it as the baseline
    first. Regenerate every locale's [release notes](release-notes.md) if the
    baseline or target changed since preparation.
    Review every locale's notes and other localized Mac fields, privacy/support/legal
    URLs, review credentials and Mac-specific capability instructions. Inspect any
    copied iOS notes. Use
    [locale mapping/source text](../app-store-connect-metadata.md) as inputs,
    but do not run the iOS-only screenshot uploader on Mac. Inspect actual Mac
    screenshots and upload accepted-size Mac images per
    [native screenshot guidance](../macos-ci-cd.md#native-smoke-evidence).
    Verify saved order, locales and processing; an iPad screenshot or arbitrary
    native attachment is not a Mac store image. Verify privacy, age/content,
    encryption/export-compliance, rights and subscription declarations against
    the artifact. Ask for missing factual/legal decisions. Retain separate
    [Mac readiness and inspection evidence](evidence.md#macos-evidence);
    the [mobile CLI does not support Mac](readiness.md#macos-readiness-boundary).

## Submission, publication and closeout

11. Attach the exact verified Mac build and read back its ID/version/build,
    `MAC_OS` version ID, localized fields and required declarations. Choose
    automatic release after approval unless manual mode is explicitly intended;
    verify the saved setting. Choose **Add for Review** for Mac only. If
    authorized Add for Review API requests repeatedly fail after
    diagnosis, reconcile the existing `MAC_OS` draft, review submission and items
    before using the existing authenticated main browser. Reuse matching records;
    avoid duplicate or cross-platform submissions. If the user reserved final
    Submit, stop at the [Ready for Review handoff](ios.md#user-reserved-final-submit)
    with the exact Mac version, build and submission. Otherwise choose
    **Submit for Review** and verify the exact platform/version/build and accepted
    **Waiting for Review**, **In Review** or approved state. Record the submission
    ID, saved release mode, observation time and native/artifact evidence.
    Rejection blocks completion.
12. In manual mode, complete an available `PENDING_DEVELOPER_RELEASE` action
    through the supported API or Release This Version, then verify success.
    If approval is pending, record the operator's later action and condition
    without replacing the submission. On resume, inspect state first and reuse
    an externally submitted/published matching artifact. Record observations
    without attributing an actor absent evidence.
13. Record Mac provider state separately from actual regional public availability.
    Verify the version's build relationship still references the checked build;
    inspect the Mac storefront's version/compatibility and install availability
    in intended regions, with URL and observation time. Approval or
    `READY_FOR_DISTRIBUTION` alone does not establish public availability.
    Review/propagation remains follow-up after the
    [operator boundary](README.md#release-inventory-and-completion).
14. Preserve [tags/Releases/source provenance](versioning.md#github-tag-and-release)
    for the authorized coordinated or Mac-only scope, complete its available
    actions and retain version/source/evidence in the ledger. Keep every other
    channel's pending submission and remaining action intact. Report Cloud and
    local outcomes separately, manual coverage limits, saved publication mode,
    current review/public states and the precise owner/next action. Closeout
    does not call a pending Mac build live or a partial coordinated release complete.
