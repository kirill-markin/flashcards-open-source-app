# iPhone Duo optimization

Apple guidance checked October 8, 2026. Current baseline: **Nibomo 1.32.0**, upstream `f2e9a625c6aa3635ad705485718d7864daac797b`, deployment minimum **iOS 18.0**.

## Implementation

- Native adaptive tabs and navigation stacks retain shared review, draft, and selection state. Reading widths are bounded independently of device orientation.
- TabView and host NavigationStack keep full native outer bounds. iPad reserves a leading content column beside its native sidebar; regular Duo reserves a trailing content column inside its full-bounds NavigationStack; compact hosts retain the native inspector. Review, Cards and Progress share the same chat store. Compact inspector content is unconditional; ownership remains guarded by selected host and host-supplied mode. One bubbles action is pane-owned on iPad while open and host-owned on Duo. AI and Settings suppress the companion while remembering its presentation choice; draft selection and alerts remain owned by the active presentation.
- Accessibility-size ratings scroll below the answer in a single column. Default-size layouts remain adaptive. Review, AI, editor, and Progress controls use 44-point touch targets.
- Review filters adapt natively, wrap long labels, and provide a localized Done action. iPhone landscape declarations are consistent across configuration and plist.
- Banners follow the local safe area. The native keyboard guide distinguishes floating and docked keyboards; docked input retains normal avoidance.
- Existing subscription, accent-color, own-key, and iOS 18 compatibility behavior is preserved. New glass/bar APIs use narrow availability adapters.

Sources: [Duo HIG](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo), [Apple preparation guide](https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo), [native bars](https://developer.apple.com/videos/play/tech-talks/111462/), [inspector placement](https://developer.apple.com/videos/play/wwdc2023/10161/).

## Verification

The stable trailing content-column refinement passed the strict repeated Review/Cards/Progress/AI/Settings sequence (99.273s), preserving the exact revealed answer, visible chat and outer native rail. Original Review/Progress active-display captures were reviewed. Two affected ordinary-phone checks passed: editor→AI and largest-text editor/keyboard/ratings; all twelve established local phone flows were validated, with the initial saved-key missed tap preserved and an unchanged isolated retry passing. Keyboard behavior is supported by interaction and accessibility geometry; exported editor rasters do not reliably show the asserted keyboard. See [the shared device review](device-optimization-review.md) for exact source mapping, current status and qualified historical evidence.

Native Closed/Open/Partial transitions and personal click-through were blocked at the earlier checkpoint. The latest personal click-through attempt encountered the Mac lock screen; independent review of the new hierarchy remains pending. Cursor/dictation handoff and quota presentation have source corrections but still need interaction verification. An iOS 18 simulator is not installed; minimum-target compilation does not prove runtime behavior there. Earlier 1.24.0 results remain historical evidence in the preserved checkout. Alex reviews the app before any PR or release.

## Local procedure

Use Xcode 27.1 RC (27A9275) through task-specific `DEVELOPER_DIR`; retain the global Xcode selection. Runtime: iOS 27.1 (24A94232). Use a dedicated Duo simulator, model `iPhone19,4`. Unsynced temporary DerivedData avoids Finder resource-fork signing failures.

Run focused `LiveSmokeIPhoneDuoTests/testDuoCompanionKeepsNativeTabsReachable` on the actual regular inner display. Run `testPhoneLargestTextKeepsLongDraftKeyboardAndReviewReachable` on Duo and an ordinary phone.

Operator-driven tests require `TEST_RUNNER_FLASHCARDS_RUN_MANUAL_DUO_TRANSITIONS=1` before `xcodebuild`. Select `testDuoDraftAndRevealedAnswerSurviveNativeDisplayTransitions` and `testDuoPartialFoldAndLandscapeKeepRevealedReviewReachable`, start Closed with the software keyboard available, and operate Device Hub at each printed checkpoint. Unsupported models skip; synthetic resizing or rotation does not establish a display handoff.

Capture the app scene and every public `XCUIScreen`, then select the image with actual pixels. App/main screenshots may bind the inactive Duo display and appear black. Screen-array indices are not simulator display IDs. Anchor Review gestures to its own ScrollView, rather than SpringBoard coordinates that can target the inactive display. Use the native window containing the active host for scene geometry; `XCUIApplication.frame` can retain portrait bounds while its native window is landscape.
