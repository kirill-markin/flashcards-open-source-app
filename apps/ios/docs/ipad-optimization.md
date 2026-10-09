# iPad layout

The app supports iPadOS 18 and later with native adaptive tabs, navigation stacks,
and bounded reading widths. Review ratings use four or two columns at standard
text sizes and one scrollable column at accessibility sizes. Controls retain
44-point tap targets.

Review, Cards, and Progress share an AI companion when the owning window is
landscape, regular width, and at least 900 × 600 points. Portrait and narrower
windows use the full AI destination. AI and Settings hide the companion while
remembering its presentation preference. The existing AI store owns conversation,
draft, attachments, and text selection; the active presentation owns dictation
completion and alerts. Review retains its revealed answer across section changes.
The companion architecture is documented by
[RootTabView.swift](../Flashcards/Flashcards/App/Navigation/RootTabView.swift).

Study hardware shortcuts are Space to reveal and 1–4 to rate a revealed card.
They require active Review without a presented editor, filter, queue, alert,
authentication flow, or paywall. Text inputs retain their native key handling.
The keyboard layout guide distinguishes docked and floating input while preserving
native docked-keyboard avoidance.

The compact primary-flow tests are in
[LiveSmokeIPadTests.swift](../Flashcards/FlashcardsUITests/LiveSmokeIPadTests.swift).
Use the [local setup](../../../docs/ios-local-setup.md) for simulator runs.
Verify Pencil/Scribble, hardware keyboard/trackpad, VoiceOver, floating keyboards,
external displays, and actual window resizing on suitable hardware. Multiwindow
study ownership remains a product limitation. A simulator pass alone does not
qualify physical-device input behavior.
