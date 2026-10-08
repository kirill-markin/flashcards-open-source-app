# Native device optimization review

## Acceptance list

- [x] Current iPad sidebar Cards/Progress actions, one toolbar row, aligned visible controls, draft/answer retention and floating/docked input: seven focused native passes.
- [x] Positive iPad Review 1–4 keys: native pass for all four ratings. Guarded Space/editor/filter coverage also passed. Composer Return/Shift–Return has an automation timeout, recorded below.
- [x] Corrected signed 1.32.0 preview installed and launched normally. Alex personally checked all on his iPad, reported that it looked good, and disconnected it. No further physical session is needed for this continuation.
- [x] Current ordinary-phone 14 local cases: actual Front/Back/Tags, exact saved Back, portrait/full-AI handoff and all nine queued local regressions; zero failures/skips.
- [x] Current Duo Open native navigation across Review/Cards/Progress/AI/Settings.
- [ ] Duo exact unsent draft with actual native keys: Open and genuine Closed outer checks fail keyboard reachability; cause remains unresolved.
- [ ] Real Duo Closed/Open/Closed with identical long-card fixtures and actual filter interaction; genuine outer and Partial poses.
- [ ] Scoped cleanup, integrated diff review, pinned upstream integration and affected required checks; combined PR with maintainer edits and verified normal checks.

Preserve minimum iOS 18, all 50 languages, Subscription/Accent, ordinary-phone portrait/full AI, physical-left eligible Duo chat, iPad RTL and shared state. No native Mac support claim. No live AI prompts, purchases, cloud dispatch, merge, release or store upload are authorized.

## Candidate and behavior

Checkout: `flashcards-open-source-app-ipad-latest`, branch `codex/ipad-latest`. Initial HEAD: `afaf03d3d03b628f77cb0ab5e12a614cef2d48ad`; original base: `f2e9a625c6aa3635ad705485718d7864daac797b`. All 52 iOS paths imported from pinned upstream `914b96ff946635ae3109ba88ed57967c1020434b` matched exactly before integration.

Initial tested application source SHA256: `a3c75f68472d98da2a33d64c2a22cbb827937e7f3b431ce3a2adece64a8bd99f`. The original source/tests inventory `1deb7cb0…` exactly matched before continuation testing. The current native Closed→Open test preserved draft text but returned to the card form, losing the active editor destination. A targeted fix retains its NavigationPath with CardFormState for both Cards and Review editors, clearing it at session completion. That four-file application change has source SHA256 `25ec67f18955f9ded4e92bcd1f53ddd059e01d4347e204bff08b7ce2b11c8b70`; affected validation is in progress. Earlier runtime passes and physical acceptance apply to `a3c75f68…`. Fingerprints use sorted path + ASCII space + file hash + LF; the original inventory is preserved in ignored `tmp/ipad-review/final-2026-10-08/sidebar-shared-final-frozen-source.json`.

Native tabs adapt to a sidebar. Review, Cards and Progress share the AI companion in an owning window with regular width, landscape proportions and at least 900 × 600 points. Ordinary phones, Duo’s outer display and smaller windows use full-screen AI. Window changes preserve selection, revealed study state and shared conversation/drafts. iPad mirrors content in RTL; eligible Duo chat stays on the physical left.

Paired iPad sections retain a single native toolbar row. Cards keeps Filter/Add/Search and Progress navigation beside the sidebar. Native editor destinations preserve Front/Back/Tags bindings and unsaved drafts. Enlarged-text ratings scroll with the answer; docked input uses native avoidance and floating iPad input leaves bottom controls in place. Review keyboard commands are guarded against text entry and modal presentations.

The isolated preview bundle `com.flashcards-open-source-app.app.ipadpreview` retains the existing physical app data. The corrected signed build passed signature verification with normal Keychain access, installed as 1.32.0 and launched with no fixture/reset arguments. A private original-resolution Device Hub capture (2388 × 1668) shows normal landscape Review/sidebar and existing study content. Alex’s subsequent iPad acceptance is personal evidence; it does not turn an incomplete automated per-key check into a native test pass. The physical iPad is now disconnected.

## Verification

| Check | Current result and scope |
| --- | --- |
| iPad sidebar/top-tab continuity | PASS 323.685 s, 1 passed/0 failed/0 skipped; `/private/tmp/nibomo-sidebar-shared-final-native.xcresult`. Actual Cards Filter/Cancel, Add/Front/Cancel, Search/Clear, Progress return, sidebar and companion toggles retain the exact draft, revealed answer and ratings. Visible toolbar geometry was reviewed from full-screen pixels. |
| Six affected iPad cases | PASS 6/6, zero failed/skipped; `/private/tmp/nibomo-a3-final-affected-native.xcresult`. Compact Cards, paired floating/docked input, Subscription/Accent, New Chat, guarded Review Space and standalone floating input. |
| Positive iPad rating keys | PASS 59.586 s, 1 passed/0 failed/0 skipped; `/private/tmp/nibomo-continuation-rating-keys.xcresult`, iPad mini on iPadOS 27.0. Actual 1–4 keys each advance a revealed card. |
| Composer hardware keys | Incomplete: the existing 180-second test timed out during repeated animation-idle waits; `/private/tmp/nibomo-a3-composer-hardware-native.xcresult`. No unchanged retry or automated Return/Shift–Return pass is claimed. |
| Ordinary iPhone local selection | PASS 14/14, zero failed/skipped; `/private/tmp/nibomo-continuation-phone14.xcresult`, iPhone 18 Pro on iOS 27.0, Xcode 27.0 (27A266a). Cards 4 + portrait/full-AI 1 + queued local 9. Includes exact saved multiline Back, largest-text editing/readability/ratings, own-key persistence, Arabic navigation, Review filters/reminders, guest settings and notification routing. Built source/tests `1deb7cb0…`; subsequent Duo-only fixture edits preserve these selected flows. |
| Duo Open navigation | PASS 105.971 s, 1 passed/0 failed/0 skipped; `/private/tmp/nibomo-continuation-duo-open.xcresult`. Native Open control, eligible 951 × 669-point window, physical-left chat and reachable native destinations retain the revealed card. |
| Duo focused composer | FAIL, 1 failed/0 skipped in the Open bundle: the exact draft is entered, but Q/Delete native keys lie below the owning window (keyboard y=713, window bottom=669). `/private/tmp/nibomo-continuation-duo-outer.xcresult` also fails 1/1 with no skip: genuine Closed 466 × 678-point geometry reaches full AI, then its keyboard lies at y=722 below the window. No native-key pass is claimed; app versus simulator cause is unresolved. Apple Settings exposed no usable input for comparison. |
| Duo native transitions | Current source compiles with Xcode 27.1 (27A9275), iOS 27.1 (24A94232), dedicated model `iPhone19,4`. Initial long-fixture Closed→Open failed (276.408 s) after the genuine 466 × 678 → 951 × 669 handoff because the active Front editor disappeared; `/private/tmp/nibomo-continuation-duo-fold.xcresult`. Draft text remained on the card form. The targeted path fix and Partial checks remain in progress. Boot initially reported Data Migration Failed; native Device Hub pose controls became usable without reset. |
| Static checks | Six pre-merge checks passed on the original candidate. Required checks will be repeated after pinned upstream integration. |
| Full latest-OS mobile smoke | Not run. The 14 local cases exclude five live AI/account contracts and do not replace the complete repository smoke selection. No live prompts or cloud tests were dispatched. |
| Minimum iOS 18 | Deployment target remains 18.0; only 27.x runtimes are installed. Minimum-target compilation does not establish iOS 18 runtime behavior. |

Historical phone/Duo results, interrupted batches, previous missing postfold filter, offscreen keyboard, skipped outer precondition and capture errors remain in ignored `tmp/duo-review/`. They are not current passes. Private physical captures, build products, result bundles and diagnostic sources remain outside the PR; normal install/launch records and the physical screenshot are in ignored `tmp/ipad-review/final-2026-10-08/continuation-*` files.

## Remaining manual and release checks

Native hardware composer automation remains incomplete. Alex accepted the physical iPad preview; exact hardware send/stop behavior remains separate from the safe unsent-draft checks. Full Keyboard Access, VoiceOver, Pencil/Scribble, dictation, external displays and complete accessibility coverage are not established by the targeted checks. Mini’s docked keyboard leaves a short Review viewport; reachable controls do not prove spacious study content.

The complete latest-OS live/account smoke selection and actual iOS 18 compatibility smoke remain release requirements. No unavailable, interrupted or skipped check is counted as a pass. The prior physical authentication cancellation was not bypassed.

## PR and publication

Alex authorized one combined PR against upstream `main`, with **Allow edits by maintainers** enabled. No PR is open yet. This session owns implementation, compiler/simulator, integration and PR work; old chats are parked and their supervision automation is disabled. No merge, release, store upload or Xcode Cloud dispatch is authorized.

**New landscape iPad App Store screenshots must be captured, reviewed and uploaded before publication.** Use the existing localized five-shot workflow and canonical iPad target in [marketing screenshots](marketing-screenshots.md), validating landscape dimensions. Marketing montages, private device captures and simulator QA captures do not replace these assets.
