# Native device optimization review

## Source checkpoint

The integration is based on Kirill Markin's `origin/main` commit `f2e9a625c6aa3635ad705485718d7864daac797b`, containing release `v1.32.0` (`bd6cab5534ec478236d98105b713c471b0d4aa93`). The app version remains **1.32.0**, with deployment target **iOS/iPadOS 18.0** and all 50 upstream languages.

The earlier preview used version **1.24.0**. Its original checkout and complete working-change backup are preserved separately; historical screenshots do not validate the migrated app.

Upstream Subscription, Accent color, Premium, Review Animations, AI Chat Suggestions, language resources, authentication, and billing remain part of the latest source. The preview uses its own bundle ID, `com.flashcards-open-source-app.app.ipadpreview`, and a gitignored local config generated from the latest public example. The App Store app is a separate installation.

## Requested behavior

- Short Cards rows use their content height; Review's deck selector uses its named native control.
- One `bubble.left.and.bubble.right` action toggles AI chat. On iPad it opens chat from the leading host toolbar, and hides chat from the pane header while open; no duplicate Close or Move control.
- TabView and NavigationStack keep their outer native bounds. Regular iPad chat stays leading beside the native sidebar when navigation opens. Physical directions mirror in right-to-left languages. Shared chat state and Review's revealed answer survive section changes.
- Review, Cards and Progress share the companion, including the leaderboard section route. AI and Settings suppress it while remembering the presentation choice. Compact windows retain native inspector adaptation, and leaderboard profile details retain native modal sheets.
- Floating keyboard must leave Review actions and the chat composer at the bottom; docked keyboard avoidance remains active. Resize transitions respect Reduce Motion.
- Duo and ordinary iPhone retain native navigation adaptation and the latest supported-OS adapters.

## Verification checkpoint

| Surface | Current evidence |
| --- | --- |
| Source | Upstream HEAD/main rechecked: `f2e9a625c6aa3635ad705485718d7864daac797b`; version 1.32.0, minimum 18.0, 50 languages |
| iPad Pro 27.0 | Five checks passed: compact Cards, Arabic placement, floating keyboard, current Settings, and full section continuity (107.532s). Original captures reviewed |
| Native sidebar | Three separate columns on roomy windows; native navigation collapses in mini portrait. No-overlap and state continuity passed on Pro and mini |
| iPad mini 27.0 | Both final-source checks passed: landscape/portrait draft+revealed-answer+ratings retention (60.090s), and largest-text editor/navigation/answer/ratings (76.589s). Native sidebar collapses in portrait; actual images reviewed |
| Duo 27.1 | Final stable-column strict return-sequence passed (99.273s); Review/Progress active-display originals reviewed, native rail remains at outer right. Failed inspector candidates removed |
| Ordinary iPhone 27.0 | Twelve unique local flows validated: two affected cases, nine remaining passes, and unchanged saved-key retry (59.356s). Initial remaining batch was 9 pass/1 missed toggle tap; failure retained, no app or assertion fix. Live AI/login excluded |
| Repository | All six passed on final source |
| Physical preview | Final source built/signed/profile verified, installed and launched normally on physical iPad. Device metadata confirms 1.32.0; native capture shows existing deck/card and green accent. No fixture/reset arguments |
| Personal click-through | Latest native UI attempt encountered the Mac lock screen; independent click-through remains pending |

Branch: `codex/ipad-latest`. Final source: `dc37d102bb2b7ec27e01ea1c9a15e233d11c8e6002e82e4c95831e7c9f75dcba`. Pro/mini tested source: `1d2f27481abc181de892fef3bbf636d04ff1c804d55fb0f5b934e95a7a6048e2`; Duo/phone compiled source: `cd8eac9c82d69b0d0fb77e645f897056cc83c5cd893471c789f1365eeef4fde7`. Final app differences are blank-line cleanup only; harness differences are the corrected native portrait-collapse assertion and a variable rename. Exact source manifests, runs, signing proof and final local commit identity are in ignored `tmp/ipad-final-handoff-manifest.json` and `tmp/ipad-final-refinement-source.json`. Independent mini captures are in `tmp/ipad-review/supervisor-mini-2026-10-08/`.

Earlier verified 1.32 results and qualified superseded runs are retained in ignored `tmp/ipad-review/1.32-refinement-history.md` and `tmp/ipad-review/previous-1.32-handoff.json`; they do not validate the current refinement. The rejected first layout moved native navigation; the current hierarchy keeps TabView and NavigationStack at their outer bounds. Regular hosts use one stable content layout; compact hosts retain the native inspector. Failed cached-inspector lifecycle candidates were removed. No custom rail, measured scene offset, or side choice remains.

Only simulator runtimes 27.0 and 27.1 are installed. Minimum-18 compilation does not verify iOS 18 runtime behavior. Native Duo fold/display transitions and actual window resizing are unverified on this refinement. Subscription product retrieval/purchases, linked-account/AI-send release gates, Pencil, hardware input, VoiceOver, cursor/dictation and quota-dialog interactions need separate checks. No public release or PR is part of this preview.

## Test drive

1. Unlock the iPad and open **Nibomo iPad Preview**. Confirm version 1.32.0 and open Settings → Subscription and Style → Accent color.
2. In Review, reveal an answer and open chat from the leading toolbar. Type a draft, open navigation and visit Cards → Progress → AI → Settings → Review. Check separate native sidebar/chat/study columns, retained answer/draft, and one bubbles action in the chat header while open.
3. Compare docked and floating keyboard modes. Floating mode should leave both bottom controls anchored.
4. Open Cards with chat, edit a card, rotate, and try a narrower window. Check compact rows and preserved drafts.
5. On Duo/ordinary iPhone, switch all tabs and check Review actions and card-to-AI handoff at enlarged text sizes.
