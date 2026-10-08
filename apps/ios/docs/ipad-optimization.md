# iPad layout

The app supports iOS/iPadOS 18.0 and later. The latest OS uses native glass controls; existing availability adapters retain the same screens, state, and actions on iOS 18.

## Decisions

- Five native tabs adapt to a sidebar. Selection and existing navigation stacks survive layout changes.
- Study content, review actions, AI transcript/composer, and Progress use bounded reading widths. Cards rows fit their text and metadata. The Review deck selector keeps its visible name.
- Review ratings use four columns with sufficient width, two otherwise. At accessibility sizes, they form one column inside the answer's scroll view. Show Answer stays anchored before reveal; controls have a 44-point minimum height.
- Card editors keep native scrolling and keyboard avoidance, with Command-S to save and Escape to cancel. Creating another card does not replace an active draft.
- Container space and size classes drive layout. Rotation alone does not establish correct window resizing. Multiwindow study ownership remains an existing product limitation.

## AI beside study and Progress

One `bubble.left.and.bubble.right` action shows or hides the companion. On iPad, the closed-chat opener belongs to the leading main toolbar; while open, the same hide action belongs to the chat header. The host never duplicates it. There is no side choice or Move control.

Native TabView and each NavigationStack retain their outer bounds. Regular iPad stack content reserves a leading chat column beside the native sidebar, preserving normal safe areas. There is no measured scene offset or custom bar geometry; physical direction mirrors in right-to-left languages. Review, Cards and Progress share the companion, including Progress's leaderboard section route. AI and Settings suppress the companion while remembering its presentation choice; full AI uses the same chat store. Leaderboard profile details retain their existing native modal sheet. Compact windows use the native inspector presentation inside the owning NavigationStack, with the iPad hide action still inside chat. Regular Duo uses the same stable content column on the trailing side, with a host-owned pinned action; compact hosts retain native inspector adaptation. Compact inspector content remains mounted; visibility follows shared intent and host eligibility.

Conversation, draft, and attachments remain in the shared AI store; the stable host preserves its revealed answer. Only the active pane and owning tab handle deferred requests, dictation completion and shared alerts. The host supplies presentation mode; inspector-local size class does not determine ownership. Layout transitions respect Reduce Motion.

A noninteractive scene-sized UIKit view reads `UIKeyboardLayoutGuide`, with `followsUndockedKeyboard` and `usesBottomSafeArea` disabled. Root, Review, and AI retain normal SwiftUI avoidance for a docked keyboard and ignore keyboard safe-area changes when it floats. No manual keyboard-height subtraction is used.

## Verification

`LiveSmokeIPadTests` uses disposable local fixtures and XCTest screenshots. The focused checks cover current Subscription/Accent color settings, compact card rows, card-to-AI handoff, single chat toggle, answer/draft retention across native navigation and sections, and an actual native floating keyboard. These checks do not send prompts or purchase subscriptions.

Run targeted methods through the normal [local setup](../../../docs/ios-local-setup.md) command, with the selected iPad destination and `-only-testing:'Flashcards Open Source App UI Tests/LiveSmokeIPadTests/<method>'`. Simulator Keychain fixtures require `CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`. Use the latest pinned packages and deployment target 18.0. If Finder metadata prevents bundle signing in a synced folder, use an unsynced temporary DerivedData path.

Final-source results and remaining hardware checks are recorded in [the device review](device-optimization-review.md). Earlier version 1.24 evidence is historical and does not validate the migrated 1.32 code.

A physical preview uses a separate local bundle identifier and development signing. Launch normally without fixture/reset arguments to preserve existing preview data. Keep signing overrides local; the production app is separate. Verify Pencil/Scribble, hardware keyboard/trackpad, VoiceOver, external displays, and actual window resizing on suitable hardware.

## Apple guidance

- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), and [multitasking](https://developer.apple.com/design/human-interface-guidelines/multitasking).
- [Adaptive inspectors](https://developer.apple.com/videos/play/wwdc2023/10161/) and [keyboard layout guides](https://developer.apple.com/documentation/uikit/uikeyboardlayoutguide).
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards), and [pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices).
