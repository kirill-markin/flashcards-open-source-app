# Native device optimization review

## Source checkpoint

The integration is based on Kirill Markin's `origin/main` commit `f2e9a625c6aa3635ad705485718d7864daac797b`, containing release `v1.32.0` (`bd6cab5534ec478236d98105b713c471b0d4aa93`). The app version remains **1.32.0**, with deployment target **iOS/iPadOS 18.0** and all 50 upstream languages.

The earlier preview used version **1.24.0**. Its original checkout and complete working-change backup are preserved separately; historical screenshots do not validate the migrated app.

Upstream Subscription, Accent color, Premium, Review Animations, AI Chat Suggestions, language resources, authentication, and billing remain part of the latest source. The preview uses its own bundle ID, `com.flashcards-open-source-app.app.ipadpreview`, and a gitignored local config generated from the latest public example. The App Store app is a separate installation.

## Requested behavior

- Short Cards rows use their content height; Review's deck selector uses its named native control.
- One `bubble.left.and.bubble.right` toolbar button toggles AI chat. It is separated from ranking/streak controls; the pane has no second Close button.
- On iPad, AI may move to the leading side while native navigation is collapsed. Opening navigation returns it to the trailing side. Physical directions mirror in right-to-left languages. Both placements preserve chat state and Review's revealed answer.
- Companion actions stay inside their pane, preserving the host title and toolbar. Left/right pane appearance must match.
- Floating keyboard must leave Review actions and the chat composer at the bottom; docked keyboard avoidance remains active. Resize transitions respect Reduce Motion.
- Duo and ordinary iPhone retain native navigation adaptation and the latest supported-OS adapters.

## Verification status

The final 1.32.0 preview built, passed strict signing/profile checks, installed and launched normally on the physical iPad. A native capture shows the existing named deck/card, existing green accent, left chat and separate bubbles control. No fixture or reset arguments were used.

| Check | Result and qualification |
| --- | --- |
| iPad Pro, iPadOS 27.0 | Seven focused checks passed: compact rows/handoff, chat relocation/sidebar dismissal, rotation/draft retention, Arabic placement, largest text, floating keyboard and current Settings destinations |
| Final native toolbar/pane changes | Mini compact/handoff/reveal passed (57.345s), mini floating keyboard passed (23.761s), Pro full relocation/draft/reveal sequence passed (46.643s); actual images show separate chat glass, vertical divider and matching panels |
| Keyboard scope | Final mini starts in restored floating mode; bottom anchoring and hide-chat passed. Earlier docked → floating geometry assertions passed before the old overflow button failed. A complete final docked → floating → redocked sequence remains a hardware check |
| Subscription and Accent color | Navigation/layout passed. Subscription capture shows Loading; product retrieval and billing were not tested |
| Duo, iOS 27.1 | Final companion check passed (45.169s): visible content, Cards → Review continuity, all five destinations, reveal/hide/rate. Chat target measured 52 × 52 points. Largest-text draft/keyboard/answer/ratings check also passed before final toolbar-only changes |
| Ordinary iPhone, iOS 27.0 | 12 selected local smokes passed, 3 expected Duo-only skips, 0 failures. Later changes affect the regular-window companion toolbar/divider, covered separately above |
| Repository checks | All six passed. Minimum-target API availability is checked by the builds, separately from these checks |
| Physical preview | Version 1.32.0, minimum 18.0, separate preview bundle; build, signature, profile coverage, installation, normal launch and native visual capture passed |

Review branch: `codex/ipad-latest`. Tested/installed source fingerprint: `17e0e02045c54a540507ca8f55611e6077b6ffcaf7ee9a2130957864cd2016b2`. Final source fingerprint: `ad240387aa93d3ad945585ebdb38bf84bf0e63841639afd2191b49eb18a6f62f`; its only differences are two comment corrections. The seven-check Pro/12-check phone runs used the preceding candidate; the final executable differences are limited to native companion toolbar grouping and pane dividers, with affected checks rerun above.

Exact run paths, source manifests and local commit identity are retained in `tmp/ipad-final-handoff-manifest.json`; reviewed captures are in `tmp/ipad-review/1.32-verified/`. Both locations are ignored. Personal native UI click-through, final native Duo Closed/Open/Partial transitions and real window resizing remain unverified because Mac capture repeatedly failed with ScreenCaptureKit −3811; a later attempt explicitly reported the Mac locked. Cursor/dictation relocation and quota-dialog interactions, linked-account/AI-send release gates, Pencil, hardware input and VoiceOver need separate checks.

Only iOS 27.0 and 27.1 simulator runtimes are installed. Building with minimum deployment target 18.0 checks API availability, but is not evidence of runtime behavior on iOS 18. No runtime download or public release is requested.

No purchase, production-account reset, public release, or PR is part of this checkpoint.

## Morning test drive

1. Unlock the iPad and open **Nibomo iPad Preview**. Confirm version 1.32.0 and open Settings → Subscription and Style → Accent color.
2. In Review, reveal an answer, toggle chat twice, move chat left, then open navigation. Check answer/draft retention, one visible bubbles toggle, and matching pane material.
3. Compare docked and floating keyboard modes. Floating mode should leave both bottom controls anchored.
4. Open Cards with chat, edit a card, rotate, and try a narrower window. Check compact rows and preserved drafts.
5. On Duo/ordinary iPhone, switch all tabs and check Review actions and card-to-AI handoff at enlarged text sizes.
