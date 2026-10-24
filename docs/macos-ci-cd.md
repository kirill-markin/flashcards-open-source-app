# Mac Catalyst CI/CD

Release authorization, dispatch, App Review, publication and closeout belong to
[macOS release](release/macos.md). This file owns the technical configuration,
signed local acceptance and native/manual checklist.

Nibomo's Mac app uses the existing Apple target, SwiftUI/UIKit iPad interface,
SQLite, offline outbox, sync, authentication and StoreKit implementation under
`apps/ios/Flashcards`. Mac Catalyst uses **Scale Interface to Match iPad**
(`TARGETED_DEVICE_FAMILY = 1,2`), with macOS 15.0 as the baseline. iPhone/iPad
remain on iOS 18.0. Release uses
`com.flashcards-open-source-app.app` and the coordinated version from
`Config/Base.xcconfig`; do not derive a `maccatalyst.` bundle ID.

Mac SDK builds produce `Nibomo.app`; iPhone/iPad builds retain the
`Flashcards Open Source App` product name. The shared project, target, scheme
and `Flashcards` Swift module retain their technical names.

`Config/MacCatalyst.entitlements` applies only to the app's `macosx` SDK builds.
The sandbox permits outgoing connections, microphone/camera access and read
access to user-selected files. Localized usage descriptions and security-scoped
file import remain shared. Camera presentation checks UIKit's source
availability; unsupported alternate icons are omitted from Settings. Audio,
subscriptions and notifications use their existing Catalyst-supported APIs.

## Dependencies

The project and `Package.resolved` pin
[the RaTeX fork](https://github.com/kirill-markin/RaTeX/tree/v0.1.15-catalyst.1)
to exact version `0.1.15-catalyst.1`, revision
`a3421dd6b00975c0f72cb9ce4ab1b7a4d7c9ab17`. Its manifest consumes the immutable
[Catalyst binary](https://github.com/kirill-markin/RaTeX/releases/download/catalyst-binary-0.1.15-1/RaTeX.xcframework.zip),
SHA-256 `cf7eb8f7623a2baedc6710e7829184571698bbebb1f5878d3522c7b6c7b457f5`.
The [binary release](https://github.com/kirill-markin/RaTeX/releases/tag/catalyst-binary-0.1.15-1)
also retains its checksum and `provenance.json`.

Before each Apple release, check the dependency before native testing or builds:

1. Select a reviewed source commit in Kirill's fork and compare the **full diff**
   from the pinned binary's `provenance.json` `source_sha` to that commit.
   Keep using the fork until a deliberate migration; never follow moving `main`.
2. Reuse the binary for documentation or URL/checksum-only packaging differences
   only when native source, Swift wrapper, fonts/resources, dependencies,
   toolchain and other build inputs are unchanged. Otherwise run the fork's
   existing Catalyst XCFramework workflow at the selected source and verify its
   native artifacts.
3. When rebuilding, publish the exact verified CI bytes, checksum and provenance
   under a **new immutable binary tag**. Update the manifest's URL/checksum
   through a PR and CI when needed, then publish a **new immutable package tag**
   at the merged manifest commit. Reuse the existing package if unchanged;
   never overwrite published tags or assets.
4. Update the shared Apple project's exact requirement when selecting a new
   package; regenerate `Package.resolved` with Xcode/SwiftPM, preserving other
   pins and letting SwiftPM generate `originHash`. Commit and
   merge through normal CI, then run the affected existing native gates before
   publication. Flashcards build hooks consume the binary; they do not rebuild it.

Upstream synchronization is a separate manual process: review and merge the
original repository into the fork, reconciling retained patches against those
already accepted upstream, before selecting fork source. A normal Flashcards
release does not automatically sync upstream or require a fresh binary.

## Xcode Cloud

The manual, main-only Mac release workflow uses the existing project container and
shared **Flashcards Open Source App** scheme and
[cloud inputs/hooks](ios-ci-cd.md#xcode-cloud-inputs), Sentry project and secure values.
Local Debug acceptance uses the development bundle identity below.
Archives use Release and managed App Store signing. Mac test bundles enable
signing only for `macosx`; iOS test signing settings remain unchanged.

| Workflow | ID | State / actions |
| --- | --- | --- |
| `macOS Release Build` | `9d704b65-5254-4f04-be24-bebc0f0cfc7d` | Enabled; Archive: macOS / Any Mac Catalyst, App Store eligible; internal testers postaction |
| `macos-tests-workflow` | `b737acb2-4548-45bb-a7a3-8ac26bc8f111` | Disabled; Build/Test configuration and history retained |

Inspect saved settings through [Xcode Cloud access](xcode-cloud-data-access.md); the [macOS release procedure](release/macos.md) owns preflight and dispatch. Only the two [Apple release builds](ios-ci-cd.md#native-release-gate) stay enabled; preserve disabled test workflows and masked secrets. TestFlight internal distribution is not XCTest or proof of the new uploaded build.

Xcode Cloud owns distribution archives. Full signed local acceptance below is the normal mandatory pre-dispatch path; PR static checks cannot establish Catalyst compatibility. Do not retry Cloud tests each release. Retain historical failed Cloud results and their signing diagnosis: Cloud's ad hoc Mac Test identity can fail to authorize the private Keychain identity ([Apple DTS](https://developer.apple.com/forums/thread/724812)). Local evidence never rewrites that failure.

<a id="signed-local-native-alternative"></a>

### Signed local native acceptance

Run only within the session's local-execution authorization. Prepare the
existing [local configuration](ios-local-setup.md#after-cloning) with the same
production service values. Use the current Xcode and a registered execution
Mac on a supported macOS, with an installed Apple Development certificate and private key. Record the actual host OS separately from Xcode/SDK.
[Create and install a genuine Mac development profile](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile)
for `com.flashcards-open-source-app.app.development`, that certificate and that Mac
(`MAC_CATALYST_APP_DEVELOPMENT` for Catalyst). A certificate alone is insufficient.

Keep a temporary signing xcconfig outside the repository, substituting the
installed, unexpired profile's UUID. This dispatches on `PRODUCT_MODULE_NAME`: only
`Flashcards` uses manual provisioning; `FlashcardsUITests` and `FlashcardsTests`
retain automatic signing with no app profile assigned to the UI runner.

```xcconfig
_LOCAL_MANUAL_Flashcards = YES
_LOCAL_SIGN_STYLE_ = Automatic
_LOCAL_SIGN_STYLE_YES = Manual
_LOCAL_PROFILE_Flashcards = <genuine-profile-uuid>
CODE_SIGN_STYLE[sdk=macosx*][config=Debug] = $(_LOCAL_SIGN_STYLE_$(_LOCAL_MANUAL_$(PRODUCT_MODULE_NAME)))
PROVISIONING_PROFILE_SPECIFIER[sdk=macosx*][config=Debug] = $(_LOCAL_PROFILE_$(PRODUCT_MODULE_NAME))
CODE_SIGN_INJECT_BASE_ENTITLEMENTS[sdk=macosx*][config=Debug] = YES
```

Debug uses `com.flashcards-open-source-app.app.development` on every Apple platform,
with its own sandbox, database, preferences and private Keychain credential services.
UI-test resets affect that development installation. Release keeps the production
identity. External marketing-capture signing configuration retains its explicit
capture-only bundle override. Do not override ordinary Debug tests to production.

Build shared scheme **Flashcards Native Acceptance**, plan **LocalMac**, test-plan configuration **Acceptance**, Debug. The plan includes the entire existing **Flashcards Open Source App Tests** non-UI bundle and all Mac-eligible **Flashcards Open Source App UI Tests** flows, excluding only marketing capture and the phone-only class. Independently discover the complete selected inventory from the pinned source, plan and actual Xcode destination before reviewing results; do not freeze a historical count or use the original archive scheme's UI-only selection.

Use the original generated `.xctestrun` under `tmp/macos-derived-data/Build/Products` for the same built products:

```bash
set -o pipefail
mkdir -p tmp
xcodebuild -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Native Acceptance" -configuration Debug \
  -testPlan LocalMac -only-test-configuration Acceptance \
  -destination 'platform=macOS,variant=Mac Catalyst,id=<registered-mac-id>' \
  -derivedDataPath "tmp/macos-derived-data" -xcconfig '<external-signing-xcconfig>' \
  DEVELOPMENT_TEAM='<team-id>' CODE_SIGN_IDENTITY='Apple Development' build-for-testing \
  2>&1 | tee 'tmp/macos-build-for-testing-<unique-run>.log'
```

Before testing, inspect the built app with `codesign -d --entitlements :- '<built-app>'`
and decode its embedded profile with `security cms -D -i '<embedded-profile>'`. Require both
`application-identifier` and `com.apple.application-identifier` to match the
profile-authorized private app identity. Confirm the profile includes the
current signing certificate and execution Mac.
An absent explicit Keychain access group is valid for default private access.

```bash
TEST_RUNNER_FLASHCARDS_LIVE_REVIEW_EMAIL='<configured-review-email>' \
xcodebuild -xctestrun '<generated-LocalMac-xctestrun>' \
  -only-test-configuration Acceptance \
  -destination 'platform=macOS,variant=Mac Catalyst,id=<registered-mac-id>' \
  -parallel-testing-enabled NO \
  -resultBundlePath 'tmp/macos-acceptance-<unique-run>.xcresult' test-without-building \
  2>&1 | tee 'tmp/macos-acceptance-<unique-run>.log'
```

Keep the sandbox and secure storage; do not add sharing, fabricate identifiers,
disable signing or bypass Keychain cleanup. Keep the same Xcode and built
products for both phases; do not edit the generated manifest or add test filters.
Inspect the completed `.xcresult`, every selected named result, warnings and
attachments. Build/signature success, partial or interrupted runs do not count
as a passing suite. Every selected required non-UI/UI case must execute and pass; unexpected skips, missing cases or failures block release. Save actual local evidence, retaining any historical failed Cloud results separately, in the [release ledger](release/evidence.md#release-ledger).

## Native smoke evidence

The `LocalMac` plan selects the full existing non-UI bundle and every Mac-eligible UI flow without adding tests or heavy GitHub PR jobs. Mac reuses real guest card creation/review, guest AI, Settings/Progress, notification routing, own-key persistence and linked account/workspace sync flows. The plan excludes the phone-only class and marketing capture; existing iPad keyboard, companion and wide consent flows apply. These exclusions are not skipped/passed results. The notification foreground-return smoke uses Command-H instead of the unavailable Home button.

`LiveSmokeMacCatalystTests` compiles only for Catalyst and adds:

- five cards created through the real editor, with inline/display math; Space
  reveals, a pointer click rates, then Space reveals the next card without a
  focus click; keys 1–4 rate only a revealed answer;
- a wide AI companion with an attached review card; after hovering a rating,
  Space/1–4 must enter the focused composer and the unsent draft must survive
  Cards/Progress/Review navigation.

The shared launcher passes `FLASHCARDS_AUTOMATION_RUN=1` to the app process.
Catalyst runs on a real Mac, so simulator detection alone is insufficient.
Verify `automation_run_decided` reports `isAutomation=true` before interaction. Keep the existing non-production Sentry override for these tests.

Successful Mac smokes retain `mac-review-formulas` and
`mac-ai-companion-focus` window/screen image attachments. Inspect rendered
formulas and actual layout; control assertions alone do not prove visual
correctness. Record the result bundle and attachment names. For repeatable localized store originals, use the separate
[native Mac marketing capture](../apps/ios/docs/marketing-screenshots.md#native-mac-catalyst-capture)
with its genuine capture-only bundle/profile, separate runtime file and
`tmp/macos-marketing-derived-data`. That route checks isolation before guest
cleanup and preserves the installed production container. Inspect pixels before
reuse: Apple accepts 2880×1800, 2560×1600, 1440×900 or 1280×800. The Mac display
and window determine capture dimensions; an attachment is not automatically
store-ready. If size/content is unsuitable, capture the verified Mac artifact
at an accepted size before submission. Never substitute an iPad screenshot.

## Development analytics verification

Run on a genuinely signed Debug app from the final source SHA, using the development
profile above. Record SHA, bundle/signature, OS, UTC start/end and native results.
Static CI does not establish these outcomes.

1. Keep a production installation with a synced card, sign-in and analytics preference.
   Launch Debug with `bash scripts/ios/launch-macos-test-app.sh "<path/Nibomo.app>"`; verify `automation_run_decided` before interaction and require
   `isDebugBuild=true`, `isSimulator=false`, `isUITestLaunch=false`, `isAutomation=true`
   in the `automation_run` log. Development must start with separate local data and
   credentials; production must retain its card, sign-in and preference after testing.
2. Start a fresh development guest, create a card with a unique question such as
   `Development analytics smoke <UTC timestamp>?`, reveal and rate it, and complete
   guest cloud sync. Connect as `reporting_readonly` through the current
   [SSM procedure](analytics-db-access.md#operator-path-ssm-port-forwarding), using
   the `flashcards-open-source-app` AWS profile. Find the exact card and its installation:

   ```sql
   SELECT c.card_id, c.workspace_id, i.installation_id, i.user_id, i.is_automation,
          (SELECT count(*) FROM content.review_events r
           WHERE r.card_id = c.card_id) AS stored_reviews
   FROM content.cards c
   JOIN sync.workspace_replicas p ON p.replica_id = c.last_modified_by_replica_id
   JOIN sync.installations i ON i.installation_id = p.installation_id
   WHERE c.front_text = '<exact unique question>';
   ```

   Require one matching card, at least one stored review, and `is_automation=true`.
   Using that fresh guest user ID, require zero rows from:

   ```sql
   SELECT event_name, origin, occurred_at
   FROM analytics.product_events
   WHERE (subject_user_id::text = '<guest user ID>' OR user_id::text = '<guest user ID>')
     AND (origin = 'client' OR event_name IN ('card_created', 'review_answered'));
   ```

3. Refresh account preferences, relaunch, and attempt both analytics toggle values.
   The switch must remain off. Sign into the configured review account and repeat;
   compare its `org.user_settings.product_analytics_enabled` before/after and require
   no change. Do not count unrelated server producers as a marker failure; see
   [automation coverage](analytics-audience.md#automation-installations).
4. Run the complete signed `LocalMac` selection above and retain every named non-UI/UI result, logs and attachments. All manual/automated checks use `FLASHCARDS_AUTOMATION_RUN=1` and verified `isAutomation=true`; do not generate real product analytics for test activity.

## Manual checklist on the verified Mac artifact

Record version/build, SHA, OS, steps and results alongside native smoke evidence
before App Review. Use the actual correlated signed release/TestFlight artifact, preserving its archive/export provenance; a Debug acceptance app does not satisfy these checks. Launch with `bash scripts/ios/launch-macos-test-app.sh "<path/Nibomo.app>"` and verify `automation_run_decided` reports `isAutomation=true` before interaction. Reapply the flag and verify every new process, including relaunch/notification checks; stop if marking cannot be established. These short checks exercise the signed app and actual services.

1. Confirm the installed bundle is `Nibomo.app`, its `CFBundleName` and
   `CFBundleDisplayName` are `Nibomo`, and its `CFBundleExecutable` is `Nibomo`.
   Verify Finder and Dock show Nibomo. With English selected, search Spotlight
   for `Nibomo`, `flashcards`, `flash cards`, `study cards`, and `revision cards`
   separately and launch the installed app from each result. Repeat with another
   supported system language using its study/revision terms from `MDItemKeywords`;
   record the language and exact queries. Upgrade an existing installation and
   confirm local workspaces and cards remain available.
2. Resize between narrow and wide landscape layouts. Open/close AI beside
   Review, Progress, Cards and Settings; preserve the draft and revealed answer.
   Verify dark appearance and scrolling.
3. Reveal with Space and rate with 1–4. Click a rating, then press Space on the
   next card without clicking elsewhere. Inspect localized reveal/rating hover
   hints in English and another supported locale. Type Space/1–4 in AI and card
   editors while hovering review controls; focus and reviews must stay intact.
4. Create/edit a card; verify save and cancel. Inspect inline and display math,
   including fractions, in cards. Play/stop review speech. Inspect native
   screenshots for rendered card formulas rather than raw TeX; AI transcripts
   retain the shared Apple plaintext presentation.
5. Disconnect networking, create/edit/review locally, quit and relaunch. Confirm
   persistence. Reconnect, sign in, sync and verify changes on another client.
   Inspect failed sync errors.
6. Send AI text, dictate with microphone access allowed/denied, attach a photo
   and user-selected file, then send. Exercise camera when UIKit offers it;
   otherwise verify the localized unavailable error and photo/file selection.
   Confirm cancelling does not upload anything.
7. Allow/deny notifications, schedule a review reminder and open its delivered
   notification with the app running and after quitting. Review must open once;
   foregrounding again must preserve the current section.
8. Using an Apple sandbox account, load Premium, purchase, restore and manage
   subscriptions. Verify backend entitlement and offline cosmetics follow the
   [paid-access contract](premium-entitlements.md).

## Mac App Review procedure

Follow [macOS release](release/macos.md) for the reusable release sequence,
exact-artifact gates, platform-specific submission and publication, and
[shared versioning](release/versioning.md#ios-and-macos) for Apple identities.
Keep current draft/build/review status in the execution ledger.
