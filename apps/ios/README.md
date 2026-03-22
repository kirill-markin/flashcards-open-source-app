# iOS App

Read this file before making any iOS change.

## Goal

The iOS app should feel fully native to Apple platforms. We prefer Apple system components, Apple interaction patterns, and Apple visual conventions over custom design systems or cross-platform visual alignment.

The product should stay aligned with the shared flashcards domain, but the iOS UI should remain an iOS UI.

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

## Partial Implementation Rule

When work is intentionally incomplete, leave explicit comments in English using this format:

`TODO: Port <specific logic> from <specific iOS file or feature>`

The comment must say exactly what is missing. Do not leave vague TODOs.

## Testing Rule

Only test the app against the final supported iOS target.

- Do not spend time validating older iOS versions
- Do not add compatibility code for older iOS versions unless explicitly requested
- If tests are requested, use one locally available iPhone simulator runtime only

## Review Standard

When reviewing or implementing iOS changes, challenge complexity early.

If the proposed approach introduces custom design, custom behavior, or custom infrastructure where Apple already provides a clear native pattern, propose the simpler Apple-native version before writing more code.
