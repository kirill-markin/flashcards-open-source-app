# iPhone Duo optimization

Apple guidance checked October 8, 2026. Current baseline: **Nibomo 1.32.0**, upstream `f2e9a625c6aa3635ad705485718d7864daac797b`, deployment minimum **iOS 18.0**.

## Implementation

- Native adaptive tabs and navigation stacks retain shared review, draft, and selection state. Reading widths are bounded independently of device orientation.
- Regular windows reserve space beside a stable native TabView and share one AI pane across Review and Cards. Native inspector trials covered iPad review controls or lost Duo content after returning to a cached host. Compact windows retain the native inspector within each host NavigationStack’s content; leading-side placement is available only on iPad with top navigation. A shared pane-local header preserves the host title; one bubble shows or hides chat. Outgoing presentations cannot consume dictation or quota events. Draft selection is shared across chat presentations.
- Accessibility-size ratings scroll below the answer in a single column. Default-size layouts remain adaptive. Review, AI, editor, and Progress controls use 44-point touch targets.
- Review filters adapt natively, wrap long labels, and provide a localized Done action. iPhone landscape declarations are consistent across configuration and plist.
- Banners follow the local safe area. The native keyboard guide distinguishes floating and docked keyboards; docked input retains normal avoidance.
- Existing subscription, accent-color, own-key, and iOS 18 compatibility behavior is preserved. New glass/bar APIs use narrow availability adapters.

Sources: [Duo HIG](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo), [Apple preparation guide](https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo), [native bars](https://developer.apple.com/videos/play/tech-talks/111462/), [inspector placement](https://developer.apple.com/videos/play/wwdc2023/10161/).

## Verification

The final `17e0e020` source passes the actual Duo inner-display companion test and visual review with the native divider and independent glass chat button: visible chat content, one reachable toggle, all five native destinations, Cards → Review continuity, retained revealed answer, and hide/rate. Largest-text verification passed on the earlier `d71360a1` candidate, before the final toolbar/divider changes: exact multiline drafts, keyboard access, the full answer, growing speech/AI controls, and readable rating labels.

See [the shared device review](device-optimization-review.md) for ordinary iPhone, iPad, physical preview, and current verification status. Exact source fingerprints, run paths, and captures are kept in the ignored local handoff.

Native Closed/Open/Partial transitions and personal click-through remain blocked by Mac screen capture. Cursor/dictation handoff and quota presentation have source corrections but still need interaction verification. An iOS 18 simulator is not installed; minimum-target compilation does not prove runtime behavior there. Earlier 1.24.0 results remain historical evidence in the preserved checkout. Alex reviews the app before any PR or release.

## Local procedure

Use Xcode 27.1 RC (27A9275) through task-specific `DEVELOPER_DIR`; retain the global Xcode selection. Runtime: iOS 27.1 (24A94232). Use a dedicated Duo simulator, model `iPhone19,4`. Unsynced temporary DerivedData avoids Finder resource-fork signing failures.

Run focused `LiveSmokeIPhoneDuoTests/testDuoCompanionKeepsNativeTabsReachable` on the actual regular inner display. Run `testPhoneLargestTextKeepsLongDraftKeyboardAndReviewReachable` on Duo and an ordinary phone.

Operator-driven tests require `TEST_RUNNER_FLASHCARDS_RUN_MANUAL_DUO_TRANSITIONS=1` before `xcodebuild`. Select `testDuoDraftAndRevealedAnswerSurviveNativeDisplayTransitions` and `testDuoPartialFoldAndLandscapeKeepRevealedReviewReachable`, start Closed with the software keyboard available, and operate Device Hub at each printed checkpoint. Unsupported models skip; synthetic resizing or rotation does not establish a display handoff.

Capture the app scene and every public `XCUIScreen`, then select the image with actual pixels. App/main screenshots may bind the inactive Duo display and appear black. Screen-array indices are not simulator display IDs. Anchor Review gestures to its own ScrollView, rather than SpringBoard coordinates that can target the inactive display. Use the native window containing the active host for scene geometry; `XCUIApplication.frame` can retain portrait bounds while its native window is landscape.
