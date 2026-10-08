# iPhone Duo optimization

Apple guidance checked October 8, 2026. Original baseline: **Nibomo 1.32.0**, upstream `f2e9a625c6aa3635ad705485718d7864daac797b`. The pinned upstream integration is `914b96ff946635ae3109ba88ed57967c1020434b`; deployment minimum remains **iOS 18.0**.

## Implementation

- Native adaptive tabs and navigation stacks retain shared review, draft, and selection state. Reading widths are bounded independently of device orientation.
- TabView and host NavigationStack keep full native outer bounds. The companion lives inside host content. On an eligible Duo inner landscape window, chat occupies the physical-left half of the window, accounting for native edge-bar safe areas; iPad retains a leading content column beside its native sidebar.
- Companion eligibility uses the app's own window: width ≥900 points, height ≥600 points, landscape, and regular horizontal size class. Ordinary phones and Duo's outer display have a short side below 600 points. Portrait, narrow, and smaller windows use the full AI destination when the person requests chat. Resizing never selects another tab automatically: companion preference, shared chat draft, and revealed Review state remain intact. Review, Cards and Progress share the chat store; AI and Settings suppress the pane while retaining its preference. Draft selection and alerts belong to the active presentation.
- Accessibility-size ratings scroll below the answer in a single column. Default-size layouts remain adaptive. Review, AI, editor, and Progress controls use 44-point touch targets.
- Review filters adapt natively, wrap long labels, and provide a localized Done action. Ordinary iPhones retain upstream's portrait-only orientation policy in both configuration and plist. Verify Duo's inner-display rotation independently through native display controls.
- Banners follow the local safe area. The native keyboard guide distinguishes floating and docked keyboards; docked input retains normal avoidance.
- Existing subscription, accent-color, own-key, and iOS 18 compatibility behavior is preserved. New glass/bar APIs use narrow availability adapters.

Sources: [Duo HIG](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo), [Apple preparation guide](https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo), [native bars](https://developer.apple.com/videos/play/tech-talks/111462/), [adaptive content arrangements](https://developer.apple.com/videos/play/tech-talks/111463/). The 900 × 600 eligibility threshold is Nibomo's layout policy, not an Apple device-detection API.

## Verification

The application baseline `a3c75f68…` passed all 14 local ordinary-phone cases on iPhone 18 Pro/iOS 27.0, including portrait/full-AI handoff, exact saved multiline Back, largest-text editing/readability/ratings and local navigation/settings regressions. Native Duo Open navigation on that baseline also passed. Earlier Open/Closed software-key checks placed the keyboard below the window. The current Open retry has an onscreen keyboard but still fails the strict native-key guard; the current genuine Closed case stops on transcript-container hit testing before its key assertion. Captures show usable-looking input, but no native-key pass is established. The targeted editor-path fix retains the active field and exact draft through a genuine Closed→Open handoff, which then fails keyboard retention before its close/filter section. The genuine Partial-pose check passes with the identical long card, readable scrolling and all four ratings. Exact results and limitations are consolidated in [the device review](device-optimization-review.md).

The two operator-driven transition checks now use identical longer Front/Back text, with exact draft and saved-answer assertions. Earlier `8e6775d6…` Duo results and failures remain historical evidence, not current passes.

Keyboard evidence must combine visible native key input and accessibility geometry. Exported editor rasters can omit the keyboard, and an offscreen accessibility keyboard does not prove usable input. Cursor/dictation handoff, quota presentation and minimum-iOS runtime behavior remain separate interaction checks. An iOS 18 runtime is not installed. Private captures, builds and diagnostic history stay outside the PR.

## Local procedure

Use Xcode 27.1 RC (27A9275) through task-specific `DEVELOPER_DIR`; retain the global Xcode selection. Runtime: iOS 27.1 (24A94232). Use a dedicated Duo simulator, model `iPhone19,4`. Unsynced temporary DerivedData avoids Finder resource-fork signing failures.

Run `LiveSmokeIPhoneDuoTests/testDuoCompanionKeepsNativeTabsReachable` on the actual eligible inner landscape display, checking chat's physical-left half and native navigation at the outer edge. Run `LiveSmokeOrdinaryIPhoneTests/testOrdinaryPhoneReviewAIHandoffPreservesPortraitOrientation` on an ordinary phone and `testDuoSmallWindowUsesFullScreenAIHandoffAcrossRotation` on the actual closed outer display. Verify full AI handoff, revealed-answer continuity and the declared portrait policy after a physical rotation request; a skipped geometry precondition is not a pass. Run `testPhoneLargestTextKeepsLongDraftKeyboardAndReviewReachable` on Duo and an ordinary phone.

Operator-driven tests require `TEST_RUNNER_FLASHCARDS_RUN_MANUAL_DUO_TRANSITIONS=1` before `xcodebuild`. Select `testDuoDraftAndRevealedAnswerSurviveNativeDisplayTransitions` and `testDuoPartialFoldAndLandscapeKeepRevealedReviewReachable`, start Closed with the software keyboard available, and operate Device Hub at each printed checkpoint. Unsupported models skip; synthetic resizing or rotation does not establish a display handoff.

Capture the app scene and every public `XCUIScreen`, then select the image with actual pixels. App/main screenshots may bind the inactive Duo display and appear black. Screen-array indices are not simulator display IDs. Anchor Review gestures to its own ScrollView, rather than SpringBoard coordinates that can target the inactive display. Use the native window containing the active host for scene geometry; `XCUIApplication.frame` can retain portrait bounds while its native window is landscape.
