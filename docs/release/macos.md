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
   New artifacts require all gates below. For a new coordinated version follow
   [release preparation](versioning.md#release-preparation); a same-version Mac
   release uses [Mac source/tag handling](versioning.md#mac-only-source-and-tags).
   Record target SHA and independent archive/test/build identities, never a
   fixed draft ID or Cloud run number used as the distribution build number.

## Preflight and Cloud gates

3. Require the normal strict `Repository static checks` gate on merged
   preparation/fixes. Pin intended `main` SHA with no uncommitted source changes.
   Inspect saved [Mac workflow configuration](../macos-ci-cd.md#xcode-cloud)
   API-first: **macOS Release Build** enabled, main-only manual eligibility,
   SCM repository/ref, current Xcode/SDK, shared project and original
   **Flashcards Open Source App** scheme, required `Archive - macOS` action,
   App Store eligible Release/managed signing and internal-testers postaction.
   Verify only the two [Apple release builds](../ios-ci-cd.md#native-release-gate)
   are enabled; preserve disabled test workflows/configuration/history.
   Verify production service values, secure-value presence, review-account access
   and Sentry archive hooks under [Cloud inputs](../ios-ci-cd.md#xcode-cloud-inputs).
   Preserve iOS configuration and masked secrets. Check disk, actual execution
   macOS and genuine local development certificate/profile before native work.
   Record host OS separately from SDK; a current SDK does not establish latest
   host OS. Diagnose API access before browser fallback; resolve missing factual
   declarations/access with the user.
4. Before Cloud dispatch, complete the [signed local native acceptance](../macos-ci-cd.md#signed-local-native-acceptance)
   on a registered real Mac with supported macOS and current Xcode.
   Use **Flashcards Native Acceptance** / **LocalMac** / **Acceptance**, Debug,
   production service values, genuine authorized development certificate/profile,
   original generated `.xctestrun` and the same built products. Require the full
   existing non-UI bundle and all Mac-eligible UI flows. Independently discover
   the full inventory from source, plan, target/configuration and destination;
   never infer it from green results or freeze a historical count.
   Every selected required case must execute and pass. Retain full logs,
   `.xcresult`, named non-UI/UI results, diagnostics and inspected
   [formula/focus screenshots](../macos-ci-cd.md#native-smoke-evidence).
   Investigate missing cases, unexpected skips, failures or interrupted runs; fix identifiable app/test defects and apply the standing policy to unavailable testing before dispatch.
   Keep genuine app provisioning, automatic test-runner signing, sandbox and
   private Keychain storage; do not fabricate identities, disable signing or
   filter required tests. Verify the app-process automation marker before
   interaction under [the automation marker](../ios-ci-cd.md#automation-marker).
5. During an authorized release, start only **macOS Release Build**
   (`9d704b65-5254-4f04-be24-bebc0f0cfc7d`) on that accepted `main` SHA.
   Save workflow/run/Archive action IDs, source SHA, Xcode/SDK/OS, configuration
   and times from actual resources; require successful archive, signing,
   hooks, upload and processing. Inspect full logs, actions, warnings and artifacts
   under [Cloud data access](../xcode-cloud-data-access.md). Apply the
   [warning policy](README.md#release-warning-policy). Archive/upload success
   never proves local test success; the TestFlight internal-testers postaction
   is distribution, not XCTest, App Review or proof of a current uploaded build.
6. Keep Cloud test workflows disabled; neither a prior Cloud failure nor a new
   retry is a prerequisite for local acceptance. Retain historical Cloud failures
   and signing/Keychain diagnoses unchanged, separately from current local
   evidence; no old failure becomes a pass. Record unavailable local acceptance under the standing policy; identifiable app/test failures still require fixes. Cloud distribution archive remains mandatory.
7. Fix all source/build/test failures through normal PR/CI and repeat the
   affected gates at corrected SHA. Retain a successful archive only under
   [bounded source equivalence](evidence.md#resume-and-artifact-reuse): compare
   app code/resources/localizations, dependencies/lockfiles, project/scheme/test plans,
   settings, relevant test source/selection, hooks, remote workflow values, toolchain/signing/distribution inputs.
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
   user-selected read-write file capabilities, with no distribution debug
   entitlement. Inspect nested signed code too. Default private Keychain access
   may omit an explicit sharing group; never invent one to silence a mismatch.
   Correlate these observations with the uploaded build's `buildBundles`
   metadata. Missing export/provenance or a mismatch blocks attachment for review.
9. Complete and record the [manual Mac checklist](../macos-ci-cd.md#manual-checklist-on-the-verified-mac-artifact)
   on the verified signed release app, with artifact/source/version/build, OS,
   steps and outcomes. Launch with `bash scripts/ios/launch-macos-test-app.sh "<path/Nibomo.app>"` and verify `automation_run_decided` reports `isAutomation=true` before interaction, including TestFlight. Cover resizing/dark layout, pointer/keyboard/composer focus,
   math, editor/speech, offline relaunch/sync, AI media/dictation permissions,
   notifications and sandbox subscriptions/purchase/restore/manage. Record
   unexecuted permission/payment checks and their coverage limits honestly;
   do not claim them passed. Resolve observed failures and required store
   blockers before submission; handle unavailable manual/native coverage under the standing policy.
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
