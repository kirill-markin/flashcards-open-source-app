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

Before each Apple release, follow the shared [RaTeX dependency preflight and
update procedure](ratex-dependency.md) before native testing or builds.
Flashcards build hooks consume the binary; they do not rebuild it.

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

Xcode Cloud owns distribution archives. Full signed local acceptance below, or its [targeted recovery](release/evidence.md#targeted-recovery), is the normal mandatory pre-dispatch path; PR static checks cannot establish Catalyst compatibility. Do not retry Cloud tests each release. Retain historical failed Cloud results and their signing diagnosis: Cloud's ad hoc Mac Test identity can fail to authorize the private Keychain identity ([Apple DTS](https://developer.apple.com/forums/thread/724812)). Local evidence never rewrites that failure.

<a id="signed-local-native-alternative"></a>

### Signed local native acceptance

Run only within the session's local-execution authorization. Prepare the
existing [local configuration](ios-local-setup.md#after-cloning) with the same
production service values. Use the current Xcode and a registered execution
Mac on a supported macOS, with an installed Apple Development certificate and private key. Record the actual host OS separately from Xcode/SDK.
[Create and install a genuine Mac development profile](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile)
for `com.flashcards-open-source-app.app.development`, that certificate and that Mac
(`MAC_CATALYST_APP_DEVELOPMENT` for Catalyst). A certificate alone is insufficient.

For an Xcode-managed profile, retain automatic signing and pass
`-allowProvisioningUpdates -allowProvisioningDeviceRegistration` to the build
below, omitting its manual `-xcconfig`. Xcode needs a signed-in account on the
intended team. Do not assign an Xcode-managed profile to manual signing; Xcode
rejects that combination. Apply the same identity/profile verification below.

For a manually created profile, keep a temporary signing xcconfig outside the repository, substituting the
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
UI-test scenarios reset that development installation's local data and credentials.
Do not run them against a development installation containing personal study state;
use safely isolated disposable state, or record nondestructive manual verification
and the unrun fixture cases explicitly. Release keeps the production
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
products for both phases; do not edit the generated manifest, and add test filters only for [targeted recovery](release/evidence.md#targeted-recovery).
Inspect the completed `.xcresult`, every selected named result, warnings and
attachments. Build/signature success, partial or interrupted runs do not count
as a passing suite. Every selected required non-UI/UI case must execute and pass; unexpected skips, missing cases or failures block release. Save actual local evidence, retaining any historical failed Cloud results separately, in the [release ledger](release/evidence.md#release-ledger).

## Native smoke evidence

### Input and window conventions

Keep Catalyst's shared screen state, forms and text interactions. Mac commands
live in one native unified toolbar whose standard items the system sizes and
styles; do not wrap them in custom glass or force label heights. Screens supply
items through [`macToolbarContribution`](../apps/ios/Flashcards/Flashcards/App/Navigation/MacToolbarConfiguration.swift)
and pushed titles through [`nativeNavigationTitle`](../apps/ios/Flashcards/Flashcards/NativeNavigationTitle.swift).
Sidebar selection identifies root pages, so their toolbar titles stay hidden;
pushed destinations keep their title and Back, and modal flows keep Save/Cancel.
See Apple's [Catalyst toolbar tutorial](https://developer.apple.com/tutorials/mac-catalyst/adding-a-toolbar)
and [SwiftUI Group Lab](https://developer.apple.com/videos/play/wwdc2026/8120/).

The sidebar is a native navigation split view with the system sidebar material
and selection; [`MacSidebarRowMetrics`](../apps/ios/Flashcards/Flashcards/App/Navigation/RootTabView.swift)
matches the System Settings row size. Do not add custom row fonts or insets,
overlay the window with a custom titlebar material, or suppress scroll-edge
effects globally. The window is one split view whose detail shows only the
selected section, so what must survive a section switch (open page, unsent
input, revealed answer, scroll) lives in the app-owned models injected by
[`FlashcardsApp`](../apps/ios/Flashcards/Flashcards/App/FlashcardsApp.swift).

On macOS 27 the toolbar is transparent at rest and shows a backdrop once content
scrolls under it ([WWDC26](https://developer.apple.com/videos/play/wwdc2026/102/)).
Catalyst's scroll-edge effect targets one scroll view and cannot span the AI
companion beside a page, so [`MacSharedToolbarBackdrop`](../apps/ios/Flashcards/Flashcards/NativeNavigationTitle.swift)
places one system bar material across the split detail, shown when either pane
scrolls under the toolbar; the sidebar keeps its own edge effect. Verify
rest/scrolled states, sidebar show/hide, pushed destinations and resizing visually.
See Apple's [Catalyst sidebar material](https://developer.apple.com/documentation/uikit/uisplitviewcontroller/primarybackgroundstyle)
and [scroll-edge guidance](https://developer.apple.com/design/human-interface-guidelines/scroll-views).

Glass is reserved primarily for toolbar and floating chat controls; reading
surfaces and inline actions stay restrained, Review answer/rating actions stay
prominent, and Edit sits beside the card metadata rather than among window
commands. Custom plain controls use [`appMinimumTouchTarget`](../apps/ios/Flashcards/Flashcards/NativeActionButtonStyles.swift);
it sets a pointer target, not a visible bezel or toolbar height. Preserve
iPhone/iPad target behavior separately. Check real outer-edge pointer actions,
native hover/press, disabled/inactive appearance, containment and narrow→wide
state restoration rather than AX frames alone.
See [Design for touch on Mac](https://developer.apple.com/videos/play/tech-talks/111456/)
and [pointing-device guidance](https://developer.apple.com/design/human-interface-guidelines/pointing-devices).

Navigation menu commands and their shortcuts live in [`MacNavigationCommands`](../apps/ios/Flashcards/Flashcards/App/Navigation/MacNavigationCommands.swift)
and the Review menu in [`ReviewCommands`](../apps/ios/Flashcards/Flashcards/Review/Keyboard/ReviewCommands.swift);
Review keys take priority over keyboard focus through
[`ReviewKeyCommandOwner`](../apps/ios/Flashcards/Flashcards/Review/Keyboard/ReviewKeyCommandOwner.swift),
while editors and AI keep their normal text input. Composer Escape is a UIKit key
command with [priority over text input](https://developer.apple.com/documentation/uikit/uikeycommand/wantspriorityoversystembehavior),
because a SwiftUI key handler alone can lose Escape to the native text system.
Verify Escape followed immediately by a rating key, including a multiline draft
and an app deactivation/reactivation.
See Apple's [keyboard focus guidance](https://developer.apple.com/videos/play/wwdc2021/10260/)
and [Mac Catalyst responder guidance](https://developer.apple.com/videos/play/wwdc2021/10053/).

For focused manual acceptance on isolated development data: resize narrow,
wide and tall windows with an unsent AI draft and revealed answer; verify both
survive. Exercise menu commands from each section and while an editor/picker is
open. Right-click/long-press a card, edit/cancel, attach it to AI, and cancel a
delete confirmation. Switch workspace or sync a changed card while a menu is
open; it must not act on another workspace or revision. Tab to Progress legend
buttons and activate them; scroll starting on a legend/card without activating
it. Check the outer edges of custom targets, native text selection, VoiceOver,
Reduce Motion, Reduce Transparency and Increase Contrast. Record unavailable
physical touch/Sidecar and accessibility checks as gaps.

Mac XCUITest flows activate the app and synthesize input; coordinate an idle
desktop before running them while someone works. Quit any installed development
copy before enumeration or XCTest so the runner owns the only process with that
bundle identity. Mac pointer synthesis does not verify physical touch. Headless
simulator checks can run independently. Report actual runtime and SDK separately.

### Existing native flows

The `LocalMac` plan selects the full existing non-UI bundle and every Mac-eligible UI flow without heavy GitHub PR jobs. Mac reuses real guest card creation/review, guest AI, Settings/Progress, notification routing, own-key persistence and linked account/workspace sync flows. The plan excludes the phone-only class and marketing capture; existing iPad keyboard, companion and wide consent flows apply. These exclusions are not skipped/passed results. The notification foreground-return smoke uses Command-H instead of the unavailable Home button.

`LiveSmokeMacCatalystTests` compiles only for Catalyst and adds:

- native toolbar containment and sizing, settled screenshots of every main
  section and the ready companion, and window tiling/restoration of an unsent
  draft and revealed answer;
- seven cards created through the real editor, with inline/display math; Space
  reveals, a pointer click rates, then Space reveals the next card without a
  focus click; keys 1–4 rate only a revealed answer; Space and Return reveal and
  1 rates while the sidebar holds focus;
- a wide AI companion with an attached review card; after hovering a rating,
  Space/1–4 must enter the focused composer and the unsent draft must survive
  Cards/Progress/Review navigation;
- nondestructive current-workspace checks without a fixture launch scenario,
  never rating, saving or sending personal content: sidebar focus and
  wide→narrow→wide restoration, toolbar backdrop over recreated Review/chat
  scroll views, toolbar search text, and Settings after AI history;
- a Library page opened from another section: Review's Edit decks before and
  after Library was shown.

The shared launcher passes `FLASHCARDS_AUTOMATION_RUN=1` to the app process.
Catalyst runs on a real Mac, so simulator detection alone is insufficient.
Verify `automation_run_decided` reports `isAutomation=true` before interaction. Keep the existing non-production Sentry override for these tests.

For app-bound computer use, bind the absolute installed development `.app` path.
Build products and retained backups share its bundle identifier, so bundle-ID
lookup can be ambiguous. Prefer background app-bound controls and screenshots;
serialize any foreground interval with other agents on the same desktop, and
never run desktop-driving XCTest concurrently. Retain fresh tool errors and
verification limits rather than counting an unavailable interaction as passed.

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
   screenshots for rendered formulas in card lists, previews and AI transcripts.
   Check selection/copy preserves formula source and technical disclosures stay literal.
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
