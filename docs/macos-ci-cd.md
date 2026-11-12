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

Follow the [macOS release sequence](release/macos.md#preflight-and-cloud-gates)
for Cloud archives and signed local acceptance. Retain historical Cloud failures
and their signing diagnosis. Cloud's ad hoc Mac Test identity can fail to authorize
the private Keychain identity ([Apple DTS](https://developer.apple.com/forums/thread/724812)).

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

Use **Flashcards Native Acceptance**, [LocalMacCritical](../apps/ios/Flashcards/LocalMacCritical.xctestplan),
**Acceptance**, Debug. Keep the full existing non-UI bundle and three foreground
journeys. Discover the complete selected inventory from the pinned plan, source
and actual Xcode destination before reviewing results. Run the Cloud archive in
parallel on the release track.

Use the original generated `.xctestrun` under `tmp/macos-derived-data/Build/Products` for the same built products:

```bash
set -o pipefail
mkdir -p tmp
xcodebuild -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Native Acceptance" -configuration Debug \
  -testPlan LocalMacCritical -only-test-configuration Acceptance \
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
Run the [desktop launch preflight](#desktop-launch-preflight) before starting
the suite below.

```bash
TEST_RUNNER_FLASHCARDS_LIVE_REVIEW_EMAIL='<configured-review-email>' \
xcodebuild -xctestrun '<generated-LocalMacCritical-xctestrun>' \
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
as a passing suite. Apply the [local result rules](release/macos.md#preflight-and-cloud-gates)
and save actual evidence in the [release ledger](release/evidence.md#release-ledger).

#### Desktop launch preflight

Reserve a dedicated, idle, logged-in Mac desktop for this preflight and the
foreground suite. Quit other development app instances. Confirm the desktop observation tool can
show system dialogs outside Nibomo's window and check the full desktop.
If clear, start `log stream --predicate 'category == "automation_run"'` in a
separate terminal and launch the verified signed Debug app from the build above
with disposable development state:

```bash
bash scripts/ios/launch-macos-test-app.sh '<absolute-path-to-built-Nibomo.app>'
```

Within one minute of launch, verify the fresh process's [automation marker](ios-ci-cd.md#automation-marker)
(`automation_run_decided`, `isAutomation=true`). Bring its window forward,
confirm it responds and recheck the desktop for blocking system dialogs,
including screen or audio recording prompts. Quit the app before XCTest.
If a dialog appears before or during launch, or the check times out, record the
outcome and stop for diagnosis.
Leave privacy settings to the desktop owner. Record the preflight separately
from suite results.

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
prominent, and Edit sits with the card's own actions at the bottom of the card
rather than among window commands. Custom plain controls use [`appMinimumTouchTarget`](../apps/ios/Flashcards/Flashcards/NativeActionButtonStyles.swift);
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

[LocalMacCritical](../apps/ios/Flashcards/LocalMacCritical.xctestplan) selects
these foreground journeys alongside the non-UI bundle:

- Sign in to the configured review account, link an isolated workspace and
  confirm the Keychain-backed session survives process relaunch.
- Reveal with Space and rate Good with the pointer. Reveal and rate Easy with
  the keyboard without clicking to regain focus. Verify both saved ratings in
  local Progress.
- Keep an AI companion draft and typing focus through hide/reactivate. Inspect
  the retained `mac-ai-companion-focus` screenshots.

Use `LocalMac` or an explicit `-only-testing` filter for affected behavior.
Examples include toolbar and window changes, localized hover hints and all
rating keys, rich review content and formula rendering, or shared Settings,
notifications, own-key, consent and iPad companion changes. Inspect the
relevant screenshots, including `mac-review-formulas` when changing math.
Pointer synthesis covers pointer events. Use hardware for physical touch or
Sidecar changes. Report actual runtime and SDK separately.

For app-bound computer use, bind the absolute installed development `.app` path.
Build products and retained backups can share a bundle ID. Serialize foreground
interaction with XCTest on the dedicated desktop.

For localized store originals, use
[native Mac marketing capture](../apps/ios/docs/marketing-screenshots.md#native-mac-catalyst-capture)
with its capture-only bundle/profile, runtime file and
`tmp/macos-marketing-derived-data`. That route checks isolation before guest
cleanup. Inspect pixels before reuse. Apple accepts 2880×1800, 2560×1600,
1440×900 or 1280×800 Mac images. Capture the verified Mac artifact at an accepted
size when the native attachment is unsuitable.

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
4. Retain the signed native results and the automation marker as described in
   [signed local acceptance](#signed-local-native-acceptance).

## Manual checklist on the verified Mac artifact

Use the exact correlated, signed TestFlight app on the dedicated Mac desktop.
Record source, artifact, version/build, actual macOS and outcome. Launch and
relaunch using `bash scripts/ios/launch-macos-test-app.sh "<path/Nibomo.app>"`.
Verify `automation_run_decided` reports `isAutomation=true` before interacting
with each process.

Start the [independent-client sync check](release/evidence.md#independent-client-sync-check)
and record its baseline before going offline. Create and rate the check card
offline, then relaunch offline and confirm that the card and rating persist.
Reconnect and complete the sync check with the same card and rating.
Record anything unavailable under the [release policy](release/README.md#standing-best-effort-release-policy).

Exercise additional checks on the signed artifact when a change affects them:

- Installation, naming, Spotlight or upgrade. Check Finder/Dock names and
  localized search terms, then verify an upgrade preserves workspaces and cards.
- Window layout, appearance, pointer targets or keyboard focus. Use the
  [input and window checklist](#input-and-window-conventions).
- Card editing, speech or formulas. Exercise save/cancel, speech and selection
  or copying of inline/display math in cards and AI transcripts.
- AI media/dictation. Check permission grant/denial, supported capture or file
  selection, sending and cancel before upload.
- Reminders. Allow or deny permission and open a delivered reminder in warm
  and cold app states. Review opens once.
- Billing. Use the Apple sandbox to load, purchase, restore and manage a
  subscription and verify the [paid-access contract](premium-entitlements.md).

## Mac App Review procedure

Follow [macOS release](release/macos.md) for the reusable release sequence,
exact-artifact gates, platform-specific submission and publication, and
[shared versioning](release/versioning.md#ios-and-macos) for Apple identities.
Keep current draft/build/review status in the execution ledger.
