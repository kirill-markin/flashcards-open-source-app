# Mac Catalyst CI/CD

Release authorization, dispatch, App Review, publication and closeout belong to
[macOS release](release/macos.md). This file owns the technical configuration,
signing alternative and native/manual checklist.

Nibomo's Mac app uses the existing Apple target, SwiftUI/UIKit iPad interface,
SQLite, offline outbox, sync, authentication and StoreKit implementation under
`apps/ios/Flashcards`. Mac Catalyst uses **Scale Interface to Match iPad**
(`TARGETED_DEVICE_FAMILY = 1,2`), with macOS 15.0 as the baseline. iPhone/iPad
remain on iOS 18.0. The dedicated Catalyst app uses
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
[the RaTeX fork](https://github.com/kirill-markin/RaTeX/tree/v0.1.14-catalyst.1)
to exact version `0.1.14-catalyst.1`, revision
`d22e916b54cb1422ac823c129d540295e3f0b616`. Its manifest consumes the immutable
[Catalyst binary](https://github.com/kirill-markin/RaTeX/releases/download/catalyst-binary-0.1.14-1/RaTeX.xcframework.zip),
SHA-256 `37deca19f15dff2c330dea5c7b06c4a337462902f510fbea141f5dc30e5ed80a`.
Keep the other committed pins. SwiftPM owns the generated `originHash`; do not
invent it when editing the pin or move published tags/artifacts.

## Xcode Cloud

The manual, main-only Mac workflows use the existing project container and
shared **Flashcards Open Source App** scheme, production configuration and
[cloud inputs/hooks](ios-ci-cd.md#xcode-cloud-inputs), including the same bundle
ID, Sentry project and secure values. No extra local helper is required.
Archives use Release and managed App Store signing. Mac test bundles enable
signing only for `macosx`; iOS test signing settings remain unchanged.

| Workflow | ID | Actions |
| --- | --- | --- |
| `macos-build-workflow` | `9d704b65-5254-4f04-be24-bebc0f0cfc7d` | Archive: macOS / Any Mac Catalyst, App Store eligible; internal testers postaction |
| `macos-tests-workflow` | `b737acb2-4548-45bb-a7a3-8ac26bc8f111` | Build: Any Mac Catalyst; required Test: Mac (Mac Catalyst), latest builder OS, use scheme settings |

Inspect saved settings through [Xcode Cloud access](xcode-cloud-data-access.md);
the [macOS release procedure](release/macos.md) owns preflight and dispatch.
Preserve the iOS workflows and masked secrets.

Xcode Cloud owns distribution archives. PR static checks cannot establish
Catalyst compatibility. Inspect exact logs, warnings, named test results and
`.xcresult` artifacts from both runs. Cloud's Mac Test action can inject an
ad hoc identity that cannot authorize the app's private Keychain identity;
[Apple DTS describes the restricted-entitlement limitation](https://developer.apple.com/forums/thread/724812).
Retain failed Cloud results and their signing diagnosis. For this limitation,
use the signed local native route below; other failures require a narrow
reviewed fix and fresh native evidence for the resulting SHA.

### Signed local native alternative

Run only within the session's local-execution authorization. Prepare the
existing [local configuration](ios-local-setup.md#after-cloning) with the same
production service values. Use the current Xcode and a registered execution
Mac, with an installed Apple Development certificate and private key.
[Create and install a genuine Mac development profile](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile)
for the existing app ID, that certificate and that Mac
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

Quit any installed App Store or TestFlight copy before building and testing.
The Debug build shares that copy's bundle ID, sandbox container, database and
Keychain sign-in, and UI-test scenario launches reset them. Quitting only
prevents concurrent access: the run still erases the copy's local data and signs
it out, so sync it first, keep no guest or unsynced data, then sign back in.

Build the unchanged shared scheme's full selection, then use its original
generated `.xctestrun` under `tmp/macos-derived-data/Build/Products`:

```bash
xcodebuild -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Open Source App" -configuration Debug \
  -destination 'platform=macOS,variant=Mac Catalyst,id=<registered-mac-id>' \
  -derivedDataPath "tmp/macos-derived-data" -xcconfig '<external-signing-xcconfig>' \
  DEVELOPMENT_TEAM='<team-id>' CODE_SIGN_IDENTITY='Apple Development' build-for-testing
TEST_RUNNER_FLASHCARDS_LIVE_REVIEW_EMAIL='<configured-review-email>' \
xcodebuild -xctestrun '<generated-xctestrun>' \
  -destination 'platform=macOS,variant=Mac Catalyst,id=<registered-mac-id>' \
  -resultBundlePath 'tmp/macos-smoke-<unique-run>.xcresult' test-without-building
```

Before testing, inspect the built app with `codesign -d --entitlements :- '<built-app>'`
and decode its embedded profile with `security cms -D -i '<embedded-profile>'`. Require both
`application-identifier` and `com.apple.application-identifier` to match the
profile-authorized private app identity. Confirm the profile includes the
current signing certificate and execution Mac.
An absent explicit Keychain access group is valid for default private access.
Keep the sandbox and secure storage; do not add sharing, fabricate identifiers,
disable signing or bypass Keychain cleanup. Keep the same Xcode and built
products for both phases; do not edit the scheme/manifest or filter tests.
Inspect the completed `.xcresult`, every selected named result, warnings and
attachments. Build/signature success, partial or interrupted runs do not count
as a passing suite. Save actual local evidence alongside failed Cloud results
in the [release ledger](release/evidence.md#release-ledger).

## Native smoke evidence

The shared scheme keeps its full existing UI smoke selection, with no new unit
selection or heavy GitHub PR jobs. Mac reuses real guest card creation/review,
guest AI, Settings/Progress, notification routing, own-key persistence and
linked account/workspace sync flows. The phone-only flow skips on the iPad
idiom; existing iPad keyboard and companion flows apply. The notification
foreground-return smoke uses Command-H instead of the unavailable Home button.

`LiveSmokeMacCatalystTests` compiles only for Catalyst and adds:

- five cards created through the real editor, with inline/display math; Space
  reveals, a pointer click rates, then Space reveals the next card without a
  focus click; keys 1–4 rate only a revealed answer;
- a wide AI companion with an attached review card; after hovering a rating,
  Space/1–4 must enter the focused composer and the unsent draft must survive
  Cards/Progress/Review navigation.

The shared launcher passes `FLASHCARDS_AUTOMATION_RUN=1` to the app process.
Catalyst runs on a real Mac, so simulator detection alone is insufficient.
Keep the existing non-production Sentry override for these tests.

Successful Mac smokes retain `mac-review-formulas` and
`mac-ai-companion-focus` window/screen image attachments. Inspect rendered
formulas and actual layout; control assertions alone do not prove visual
correctness. Record the result bundle and attachment names. These are also
the shortest source of actual Mac store screenshots. Inspect pixels before
reuse: Apple accepts 2880×1800, 2560×1600, 1440×900 or 1280×800. The Mac display
and window determine capture dimensions; an attachment is not automatically
store-ready. If size/content is unsuitable, capture the verified Mac artifact
at an accepted size before submission. Never substitute an iPad screenshot.

## Manual checklist on the verified Mac artifact

Record version/build, SHA, OS, steps and results alongside native smoke evidence
before App Review. These checks exercise the signed app and actual services.

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
