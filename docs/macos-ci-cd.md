# Mac Catalyst CI/CD and release

Nibomo's Mac app uses the existing Apple target, SwiftUI/UIKit iPad interface,
SQLite, offline outbox, sync, authentication and StoreKit implementation under
`apps/ios/Flashcards`. Mac Catalyst uses **Scale Interface to Match iPad**
(`TARGETED_DEVICE_FAMILY = 1,2`), with macOS 15.0 as the baseline. iPhone/iPad
remain on iOS 18.0. The dedicated Catalyst app uses
`com.flashcards-open-source-app.app` and the coordinated version from
`Config/Base.xcconfig`; do not derive a `maccatalyst.` bundle ID.

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

Before authorized dispatch, inspect the saved workflows, exact `main` SHA,
toolchain, destinations, production values and secret presence via the
[Xcode Cloud access procedure](xcode-cloud-data-access.md). Preserve the iOS
workflows and masked secrets. Dispatch the independent Mac archive and tests
concurrently only after the Catalyst patch reaches `main`.

Native compilation and runtime checks belong to Xcode Cloud. PR static checks
cannot establish Catalyst compatibility. Inspect exact logs, warnings, named
test results and `.xcresult` artifacts from both runs. Failures require a
narrow reviewed fix and new cloud evidence for the resulting SHA.

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
reuse: Apple accepts 2880×1800, 2560×1600, 1440×900 or 1280×800. The cloud display
and window determine capture dimensions; an attachment is not automatically
store-ready. If size/content is unsuitable, capture the verified Mac artifact
at an accepted size before submission. Never substitute an iPad screenshot.

## Manual checklist on the verified Mac artifact

Record version/build, SHA, OS, steps and results alongside cloud-native evidence
before App Review. These checks exercise the signed app and actual services.

1. Resize between narrow and wide landscape layouts. Open/close AI beside
   Review, Progress, Cards and Settings; preserve the draft and revealed answer.
   Verify dark appearance and scrolling.
2. Reveal with Space and rate with 1–4. Click a rating, then press Space on the
   next card without clicking elsewhere. Inspect localized reveal/rating hover
   hints in English and another supported locale. Type Space/1–4 in AI and card
   editors while hovering review controls; focus and reviews must stay intact.
3. Create/edit a card; verify save and cancel. Inspect inline and display math,
   including fractions, in cards and AI messages. Play/stop review speech.
   Inspect native screenshots for rendered formulas rather than raw TeX.
4. Disconnect networking, create/edit/review locally, quit and relaunch. Confirm
   persistence. Reconnect, sign in, sync and verify changes on another client.
   Inspect failed sync errors.
5. Send AI text, dictate with microphone access allowed/denied, attach a photo
   and user-selected file, then send. Exercise camera when UIKit offers it;
   otherwise verify the localized unavailable error and photo/file selection.
   Confirm cancelling does not upload anything.
6. Allow/deny notifications, schedule a review reminder and open its delivered
   notification with the app running and after quitting. Review must open once;
   foregrounding again must preserve the current section.
7. Using an Apple sandbox account, load Premium, purchase, restore and manage
   subscriptions. Verify backend entitlement and offline cosmetics follow the
   [paid-access contract](premium-entitlements.md).

## Mac App Review procedure

This is the single dedicated Mac procedure. Coordinated releases use the
[shared authorization rules](release/README.md). A Mac-only release must not
dispatch iOS/Android release workflows or replace an in-review iOS version.

1. Require green repository static checks, a successful Mac archive and complete
   native smoke evidence for the intended merged code. Resolve warnings and
   runtime failures before preparing submission.
2. Select the exact verified Mac version/build under the existing ASC app.
   The initial Mac **1.33.0** draft is
   `dc402853-988e-418c-aa71-9f59d46c0d89`, with **After Approval** release mode.
   Do not withdraw, replace or resubmit the iOS **1.33.0** awaiting review.
3. Verify localized Mac metadata, accepted-size screenshots, review credentials,
   privacy/compliance and final capability notes. Review Apple's copied iOS
   review notes against the actual Mac artifact. Select the verified Mac build
   and submit only that platform after its recorded gates pass.
4. Save platform, version/build, SHA, workflow/run IDs, named smoke results,
   screenshot evidence and saved release mode in the execution ledger.
   Submission, approval and public availability are separate states; monitor
   Mac without disturbing the pending iOS submission.
