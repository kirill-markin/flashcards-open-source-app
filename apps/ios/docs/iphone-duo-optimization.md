# iPhone Duo layout

The shared adaptive layout uses the owning native window and horizontal size class.
An eligible landscape window at least 900 × 600 points places the AI companion
on the physical-left half; smaller or portrait windows use the full AI destination.
The threshold is an app layout policy rather than device or fold-state detection.
Review, Cards, and Progress share the existing AI store and retain the companion
preference. Ordinary iPhones retain the declared portrait orientation policy.
See the [iPad layout](ipad-optimization.md) for shared state and accessibility.

Physical Duo behavior remains unverified. On suitable hardware, check Closed,
Open, and partially folded transitions with an unsaved card draft and an unsent
AI draft. Confirm exact text and selection retention, revealed-answer continuity,
native tabs, keyboard input and avoidance, dictation ownership, and reachable
review/filter actions. Simulator rotation or synthetic resizing does not establish
physical display-handoff correctness.

The compact ordinary-phone regression lives in
[LiveSmokeOrdinaryIPhoneTests.swift](../Flashcards/FlashcardsUITests/LiveSmokeOrdinaryIPhoneTests.swift).
Run it using the [local setup](../../../docs/ios-local-setup.md); it verifies the
full AI card handoff and retained revealed answer, without qualifying Duo hardware.
