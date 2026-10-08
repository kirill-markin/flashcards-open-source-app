# iPad layout

The app supports iOS/iPadOS 18.0 and later. The latest OS uses native glass controls; existing availability adapters retain the same screens, state, and actions on iOS 18.

## Decisions

- Five native tabs adapt to a sidebar. Selection, card forms and conversation drafts remain with their existing state owners.
- Study content, review actions, AI transcript/composer, and Progress use bounded reading widths. Cards rows fit their text and metadata. Review shows the filter name except in the compact paired toolbar, where its icon exposes the selected value to accessibility.
- Review ratings use four columns with sufficient width, two otherwise. At accessibility sizes, they form one column inside the answer's scroll view. Show Answer stays anchored before reveal; controls have a 44-point minimum height.
- Card editors keep native scrolling and keyboard avoidance, with Command-S to save and Escape to cancel. Creating another card does not replace an active draft.
- Container space and size classes drive layout. Rotation alone does not establish correct window resizing. Multiwindow study ownership remains an existing product limitation.

## AI beside study and Progress

One `bubble.left.and.bubble.right` action shows or hides the companion. On iPad, the closed-chat opener belongs to the leading main toolbar; while open, the same hide action belongs to the chat header. The host never duplicates it. There is no side choice or Move control.

Native TabView owns top-level navigation. Top tabs share one native bar across the companion and host. Cards and Progress also use a shared native bar beside the sidebar, with chat actions leading and section actions trailing; the selected sidebar item identifies the section. Review retains its column headers. Existing state owners and sheet presenters remain stable. Eligible iPad columns divide the space beside the native sidebar equally and mirror in right-to-left languages. Review, Cards and Progress share the companion; AI and Settings suppress it while remembering its presentation choice. Leaderboard profile details retain their native modal sheet.

Pairing requires the owning window to be landscape, at least 900 × 600 points, and regular width. Portrait, narrow windows, ordinary phones and Duo's outer display use full-screen AI without a pairing toggle. Keyboard-reduced content does not determine eligibility. Resizing preserves the tab, revealed answer and companion preference. Eligible Duo places chat on the physical-left half, with its host-owned action at the outer right.

With native top tabs, one row contains chat actions on the left, native tabs in the center and section controls on the right. Review uses its filter icon and score/streak; Cards uses native filter, Add and compact search actions. The Review icon opens the existing filter and exposes its selected value to accessibility. Redundant Cards and Progress titles are omitted in this layout. With the sidebar visible, Review's named filter, centered title and badges stay in the Review column. Native material and matching control heights align the adjacent headers. Enlarged text adapts without removing actions. Closing chat restores the ordinary Review toolbar.

Paired iPad Review and full-screen AI keep their footers in the content column's vertical layout, so an undocked keyboard cannot independently reposition the bottom accessory. Unpaired Review retains its native safe-area footer. Other devices retain the existing native bar adapters. Foreground controls keep container safe areas; only decorative backgrounds extend to screen edges.

Conversation, draft, and attachments remain in the shared AI store; the stable host preserves its revealed answer. Only the active pane and owning tab handle deferred requests, dictation completion and shared alerts. The owning native window supplies pairing eligibility; child content and keyboard size do not determine it. Layout transitions respect Reduce Motion.

A noninteractive scene-sized UIKit view reads `UIKeyboardLayoutGuide`, with `followsUndockedKeyboard` and `usesBottomSafeArea` disabled. The iPad correction places floating-keyboard handling at the owning column boundary and retains native avoidance for docked input. Other device paths retain their existing bottom-edge behavior. No manual keyboard-height subtraction is used. Exact source-qualified results and remaining checks are in the device review. Paired iPad bottom padding is 8 pt for AI and 4 pt for Review. The noninteractive divider starts below the shared header and extends through the bottom safe area. iPad Review actions use a clear background.

## Verification

`LiveSmokeIPadTests` uses disposable local fixtures and XCTest screenshots. The focused checks cover current Subscription/Accent color settings, compact card rows, card-to-AI handoff, single chat toggle, answer/draft retention across native navigation and sections, and an actual native floating keyboard. These checks do not send prompts or purchase subscriptions.

Run targeted methods through the normal [local setup](../../../docs/ios-local-setup.md) command, with the selected iPad destination and `-only-testing:'Flashcards Open Source App UI Tests/LiveSmokeIPadTests/<method>'`. Simulator Keychain fixtures require `CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`. Use the latest pinned packages and deployment target 18.0. If Finder metadata prevents bundle signing in a synced folder, use an unsynced temporary DerivedData path.

The current 1.32 candidate passed seven focused iPad cases plus all four positive rating keys; Alex accepted the corrected signed physical preview. Exact results, the composer automation timeout and remaining coverage are recorded in [the device review](device-optimization-review.md).

A physical preview uses a separate local bundle identifier and development signing. Launch normally without fixture/reset arguments to preserve existing preview data. Keep signing overrides local; the production app is separate. Verify Pencil/Scribble, hardware keyboard/trackpad, VoiceOver, external displays, and actual window resizing on suitable hardware.

## Apple guidance

- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), and [multitasking](https://developer.apple.com/design/human-interface-guidelines/multitasking).
- [Keyboard layout guides](https://developer.apple.com/documentation/uikit/uikeyboardlayoutguide).
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards), and [pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices).

## Keyboard parity

The website's real shortcut inventory is `apps/web/src/screens/review/input/reviewShortcutKeys.ts`, `useReviewKeyboardShortcuts.ts` and `apps/web/src/chat/composer/useChatComposerKeyboard.ts`.

| Focused surface | Hardware key | Action |
| --- | --- | --- |
| Review | Space | Reveal the answer |
| Review, revealed answer | 1 / 2 / 3 / 4 | Again / Hard / Good / Easy |
| AI composer on iPad | Return | Same send/stop action as its touch button |
| AI composer on iPad | Shift–Return | Insert a line break at the current selection |

The composer keyboard rows describe implemented handlers; native Return/Shift–Return validation remains unresolved. Tap the Review question/card to return keyboard focus from chat. Review keys require the active Review tab and scene, prepared card, no pending submission and no presented editor/filter/queue/alert/auth/paywall. They act on initial key-down only, leaving modifier combinations and held-key repeats alone. Editor and composer text input keeps Space and digits. Native menu/dialog navigation remains system-owned; the web has no global new-card, save-card or chat-toggle key to duplicate.

An iPad-only modifier attaches SwiftUI `focusable`, `FocusState` and `onKeyPress` to the actual study ScrollView within the iOS 18 baseline; ordinary phone/Duo focus behavior remains unchanged. A native FocusState binding reacquires study input when the card is tapped, while the event handler relies on the active context rather than rejecting native events using that binding's reported value. Touch buttons call the same reveal/rating/composer actions. Keyboard checks use the public XCTest `typeKey(_:modifierFlags:)` hardware event API against the real app. Live AI send/stop and physical keyboard behavior remain separate checks; no test prompt or purchase is sent from a personal workspace.

No native macOS/Catalyst target or verified Mac support is added.
