# iOS App

Read this file before making any iOS change.

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

## Testing Rule

Only test the app against the final supported iOS target.

- Do not spend time validating older iOS versions
- Do not add compatibility code for older iOS versions unless explicitly requested
- If tests are requested, use one locally available iPhone simulator runtime only

## Native Test Stack

The iOS app uses native Apple test tooling only:

- unit and app-hosted tests live in `apps/ios/Flashcards/FlashcardsTests`
- release-gate UI coverage lives in `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift`
- accessibility identifiers used by the live smoke flow live in `apps/ios/Flashcards/Flashcards/UITestIdentifiers.swift`

The iOS live smoke test is intentionally one connected story across Review, Cards, AI, and Settings. It uses the same linked-account smoke contract as the other clients:

- Android equivalent: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt`
- Web equivalent: `apps/web/e2e/live-smoke.spec.ts`

## CI/CD

iOS CI/CD is documented in [`docs/ios-ci-cd.md`](../../docs/ios-ci-cd.md).

The expected release gate is:

1. Native unit/build checks
2. Native XCUITest live smoke
3. Xcode Cloud archive and distribution

When a change lands on `main`, follow the Xcode Cloud workflow until the release either completes or fails with a concrete error. Do not assume the iOS release finished just because GitHub-side jobs are green.

## Review Standard

When reviewing or implementing iOS changes, challenge complexity early.

If the proposed approach introduces custom design, custom behavior, or custom infrastructure where Apple already provides a clear native pattern, propose the simpler Apple-native version before writing more code.
