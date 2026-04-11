# iOS App

Read this file before making any iOS change.

If your change touches iOS localization or adds a new language, also read [`docs/ios-localization.md`](../../docs/ios-localization.md) before editing.

## Goal

The iOS app should feel fully native to Apple platforms. We prefer Apple system components, Apple interaction patterns, and Apple visual conventions over custom design systems or cross-platform visual alignment.

The product should stay aligned with the shared flashcards domain, but the iOS UI should remain an iOS UI.
We align the functional contract across iOS and Android, but we do not synchronize the designs between them.
On iOS, the UI and interaction design should stay maximally native to iOS.

## Platform Baseline

- Language and UI stack: Swift + SwiftUI
- Current deployment target: iOS 26.0
- Default visual direction: dark appearance with the existing orange accent color
- Primary local storage: SQLite on device
- Product scope should stay aligned with the supported top-level flows: Review, Cards, AI, Settings

We intentionally optimize for the latest supported iOS release instead of spending time on older system behavior.

## Design Rule

Use Apple-provided components and behaviors whenever they can solve the problem cleanly.

Prefer:

- `TabView`, `NavigationStack`, `List`, `Toolbar`, `sheet`, `fullScreenCover`, `Menu`, `Picker`, `TextField`, `Toggle`, and other standard SwiftUI components
- SF Symbols, system typography, system spacing, system feedback, and default navigation patterns
- Platform-standard gestures, transitions, and interaction timing

Avoid:

- custom containers when standard SwiftUI containers already fit
- custom controls that restyle a standard Apple control into something non-native
- bespoke navigation models when built-in navigation primitives are enough
- extra abstraction layers that hide normal SwiftUI behavior without strong product value

If an implementation starts needing custom design or custom logic on top of a standard Apple component, stop and propose a simpler native alternative first.

## Engineering Rule

Prefer platform-native solutions before inventing framework code.

Prefer:

- SwiftUI state and navigation patterns
- Apple-recommended APIs for storage, accessibility, permissions, text input, and media picking
- simple explicit code over framework-like indirection

Avoid:

- custom infrastructure that duplicates platform behavior
- compatibility work for old iOS versions that we do not support
- adding third-party dependencies when Apple APIs already cover the use case

For nested push-style settings and detail menus in SwiftUI, use one navigation model consistently within the same stack:

- prefer `NavigationStack`
- prefer value-based `NavigationLink(value:)`
- declare destinations with `navigationDestination(for:)`
- when explicit deep-link or back-stack state is needed, drive the stack from `path`

Do not mix destination-based `NavigationLink { ... }` pushes with value-based or path-driven pushes inside the same nested menu flow. That can desynchronize the visible screen hierarchy from the real back stack.

## Testing Rule

Only test the app against the final supported iOS target.

- Do not try to cover the iOS app exhaustively with tests
- Do not add isolated unit tests by default
- Prefer native integration, parity, or UI tests when they validate a real module boundary or user flow
- Do not spend time validating older iOS versions
- Do not add compatibility code for older iOS versions unless explicitly requested
- If tests are requested, use one locally available iPhone simulator runtime only
- Prefer an already booted local iPhone simulator on the final supported runtime
- Prefer background CLI runs with `simctl` and `xcodebuild` instead of opening heavy Xcode UI flows
- Do not open a visible Simulator window for test runs unless the user explicitly asks for a visible simulator at that time
- Prefer `xcodebuild ... test` so each run validates the current sources and build settings on the selected simulator
- If a test fails, inspect the generated `.xcresult` bundle and read the relevant screenshots, attachments, and logs before changing code
- If no suitable local runtime is already installed, stop and ask the user how to proceed instead of downloading extra simulator runtimes

The most trusted iOS checks are the simulator-backed native smoke flows because they exercise the real app closest to production behavior.

## Local Test Workflow

For local iOS test runs, prefer this sequence:

1. Reuse an already booted iPhone simulator when available.
2. Wait for that simulator with `xcrun simctl bootstatus <device-uuid> -b`.
3. Run the requested suite or individual test with `xcodebuild ... test`.
4. If the run fails, inspect the `.xcresult` failure artifacts before attempting a fix.

For simulator-backed XCUITest runs that edit text inputs, keep the software keyboard available and do not rely on `Connect Hardware Keyboard`. Text entry is materially less stable when the simulator does not surface the on-screen keyboard.

Preferred command pattern:

```bash
xcrun simctl list devices available
xcrun simctl bootstatus <device-uuid> -b
xcodebuild -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" -scheme "Flashcards Open Source App" -destination 'platform=iOS Simulator,id=<device-uuid>' test
xcodebuild -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" -scheme "Flashcards Open Source App" -destination 'platform=iOS Simulator,id=<device-uuid>' -only-testing:'Flashcards Open Source App UI Tests/LiveSmokeSettingsTests/testLiveSmokeLocalNavigationFlow' test
```

## Native Test Stack

The iOS app uses native Apple test tooling only:

- FSRS parity and scheduler-focused tests live in `apps/ios/Flashcards/FlashcardsTests` as targeted native verification, not as an exhaustive safety net
- release-gate UI coverage lives in the grouped `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift` files, with shared smoke infrastructure in `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport`
- accessibility identifiers used by the live smoke flows live in `apps/ios/Flashcards/Flashcards/UITestIdentifiers.swift`

The iOS release-gate smoke coverage is split into independent grouped flows across Review, Cards, AI, and Settings. Only one grouped smoke signs into the linked demo account and verifies linked workspace lifecycle. The remaining grouped smokes stay guest/local and do not perform login.

Guest AI availability is part of the iOS release contract. The guest AI smoke must pass without login, and a guest-AI-disabled or guest-quota-exhausted response is a real release-gate failure.

The grouped smoke suite still maps to the same top-level live-smoke contract as the other clients:

- Android equivalent: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt`
- Web equivalent: `apps/web/e2e/live-smoke.spec.ts`

## Marketing Screenshots

The iOS App Store screenshot generator is documented in [`docs/marketing-screenshots.md`](docs/marketing-screenshots.md).

Use that document when you need to regenerate localized marketing PNGs. It explains the manual XCUITest entrypoints, wrapper scripts, locale selection, the requirement to use `iPhone 14 Plus` for the committed iPhone screenshot set, simulator-family-to-output-folder behavior, and the expected output paths under `apps/ios/docs/media/app-store-screenshots/`.

## CI/CD

iOS CI/CD is documented in [`docs/ios-ci-cd.md`](../../docs/ios-ci-cd.md).
App Store release-note drafting guidance is documented in [`docs/version-bump.md`](../../docs/version-bump.md#app-store-release-notes).

The expected release gate is:

1. Native XCUITest grouped live smoke
2. Xcode Cloud archive and distribution

When a change lands on `main`, follow the Xcode Cloud workflow until the release either completes or fails with a concrete error. Do not assume the iOS release finished just because the GitHub-side AWS/Web release workflow is green.

## Respect Existing Code

Before making any change, read the existing screens and components in the area you are touching.

Follow the patterns already present:

- match the view structure, state ownership, and data flow used in neighboring screens
- use the same naming conventions for views, view models, and identifiers already established in the codebase
- if a helper, extension, or modifier already exists for what you need, use it instead of adding a new one
- do not introduce a new architecture pattern or abstraction unless the existing one is clearly broken for the task at hand

If you are unsure how something is done, read two or three existing screens first. The answer is almost always already there.

## Review Standard

When reviewing or implementing iOS changes, challenge complexity early.

If the proposed approach introduces custom design, custom behavior, or custom infrastructure where Apple already provides a clear native pattern, propose the simpler Apple-native version before writing more code.
