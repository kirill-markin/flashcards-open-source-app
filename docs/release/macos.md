# macOS

Read the [release entry point](README.md), [shared evidence](evidence.md) and
[versioning](versioning.md). This is the release procedure for the dedicated
Mac Catalyst app; [Mac CI/CD](../macos-ci-cd.md) owns workflow identities,
signing instructions and native/manual checks. Editing these docs does not
authorize dispatch, signed local execution, submission or publication.

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
   New artifacts require all gates below. For a new coordinated version follow
   [release preparation](versioning.md#release-preparation); a same-version Mac
   release uses [Mac source/tag handling](versioning.md#mac-only-source-and-tags).
   Record target SHA and independent archive/test/build identities, never a
   fixed draft ID or Cloud run number used as the distribution build number.

## Preflight and Cloud gates

3. Require the normal strict `Repository static checks` gate on merged
   preparation/fixes. Pin intended `main` SHA with no uncommitted source changes.
   Inspect both saved [Mac workflows](../macos-ci-cd.md#xcode-cloud) API-first:
   main-only manual start eligibility, SCM repository/ref, shared project/scheme,
   current Xcode/SDK and latest builder macOS destination, unfiltered scheme
   selection, Release App Store archive/managed signing and internal-testers
   postaction, and required Mac Test action using scheme settings. Verify
   production service values, secure-value presence, review-account access and
   Sentry archive hooks under [Cloud inputs](../ios-ci-cd.md#xcode-cloud-inputs).
   Preserve iOS configuration and masked secrets. Check disk for retained
   exports/results; diagnose API access before browser fallback. Resolve missing
   declarations/access with the user instead of guessing.
4. During an authorized release, start `macos-build-workflow` and
   `macos-tests-workflow` independently on that `main` SHA and monitor both.
   Save workflow/run/action IDs, source SHA, Xcode/SDK/OS, selected destination,
   configurations and times from actual resources. Verify accepted runs resolved
   the intended SHA. Archive/upload success never proves test success; the
   internal-testers postaction never proves App Review or public availability.
5. Require successful Cloud archive, signing, upload and processing, and a
   complete passing native test gate. Inspect full logs, every action, paginated
   `ciTestResults` and native `.xcresult` evidence under
   [Cloud data access](../xcode-cloud-data-access.md). Independently enumerate
   the full configured inventory at its source from the shared scheme,
   selected UI bundle and source declarations, including Catalyst-only methods,
   inherited cases, configurations, guards and manual marketing cases. Do not
   freeze a historical case count or derive inventory from green results.
   Record every named pass/fail/skip/pending result per destination, exact skip
   reason and counts; reconcile native exports and API pages. Every eligible
   required case must execute and pass. Keep deliberate marketing exclusions
   and the source-guarded phone-only skip distinct; neither is a passed test.
   Investigate unexpected skips, missing cases and interrupted actions; they
   block readiness. Inspect retained screenshots, attachments and diagnostics,
   including the [Mac formula/focus evidence](../macos-ci-cd.md#native-smoke-evidence).
   Adjudicate warnings under [release policy](README.md#release-warning-policy).
6. Retain failed Cloud results unchanged. Only a diagnosed restricted private
   Keychain failure caused by Cloud's ad hoc Mac Test signing may use the
   [genuinely signed local native alternative](../macos-ci-cd.md#signed-local-native-alternative)
   within applicable local-execution authorization. Save the actual entitlement,
   profile, signing and Keychain error evidence establishing that limitation;
   an arbitrary test/signing failure does not qualify. Run the unchanged full
   selection on a real Mac with current Xcode and latest supported macOS,
   production values and a
   genuine authorized development certificate/profile, original generated
   `.xctestrun` and same built products. Retain the full `.xcresult`, named cases,
   skips, diagnostics and attachment inspection. No fabricated app identity,
   Keychain/security bypass, test filtering, Apple Firebase testing or rewritten
   Cloud status is permitted. The record must say Cloud failed and the separate
   local native gate passed. Cloud distribution archive remains mandatory.
   If the full local suite cannot pass, block submission. Recheck Cloud testing
   on each future release rather than making the local route unconditional.
7. Fix all other source/build/test failures through normal PR/CI and repeat the
   affected gates at corrected SHA. Retain a successful archive only under
   [bounded source equivalence](evidence.md#resume-and-artifact-reuse): compare
   app code/resources/localizations, dependencies/lockfiles, project/scheme,
   settings, hooks, remote workflow values, toolchain/signing/distribution inputs.
   Save original archive SHA/run and corrected test SHA/run, exact scope/diff
   and why each retained gate applies. Test-only fixes still require a fresh
   complete native suite; equivalence never changes a failure to a pass.

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
   user-selected read-only file capabilities, with no distribution debug
   entitlement. Inspect nested signed code too. Default private Keychain access
   may omit an explicit sharing group; never invent one to silence a mismatch.
   Correlate these observations with the uploaded build's `buildBundles`
   metadata. Missing export/provenance or a mismatch blocks attachment for review.
9. Complete and record the [manual Mac checklist](../macos-ci-cd.md#manual-checklist-on-the-verified-mac-artifact)
   on the verified signed release app, with artifact/source/version/build, OS,
   steps and outcomes: resizing/dark layout, pointer/keyboard/composer focus,
   math, editor/speech, offline relaunch/sync, AI media/dictation permissions,
   notifications and sandbox subscriptions/purchase/restore/manage. Record
   unexecuted permission/payment checks and their coverage limits honestly;
   do not claim them passed. Resolve observed failures and required store
   blockers before submission; a manual gap never excuses the full native gate.
10. Create or resume only the intended editable `MAC_OS` version draft. Review
    localized Mac fields and every locale's [release notes](release-notes.md),
    privacy/support/legal URLs, review credentials and Mac-specific capability
    instructions; copied iOS notes require inspection. Use
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
    verify the saved setting. Add for Review, then Submit for Review only that
    platform. Record the submission ID, accepted Waiting for Review/In Review
    or approved state, saved mode, observation time and native/artifact evidence.
    A Ready for Review draft is not submitted; rejection blocks completion.
    If the user reserved final Submit, leave that exact action pending with
    the verified draft/submission identity and handoff; do not submit via API.
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
