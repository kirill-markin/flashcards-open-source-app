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
- Current deployment target: iOS/iPadOS 18.0; build with the current Xcode/SDK and pinned packages
- Dedicated Mac app: Mac Catalyst on macOS 15.0+, Scale Interface to Match iPad; shared Apple target, bundle ID, version, offline data and product flows. See [Mac Catalyst CI/CD and release](../../docs/macos-ci-cd.md).
- Default visual direction: dark appearance with the existing orange accent color
- Primary local storage: SQLite on device
- Product scope should stay aligned with the supported top-level flows: Review, Progress, AI, Cards, Settings

We optimize for the latest supported iOS release. Small native availability adapters preserve the same flows on iOS 18: glass buttons and bottom bars on 26+, bordered buttons and safe-area insets on 18. Keep state, navigation, domain logic and storage shared.

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

Follow the [local native acceptance procedure](../../docs/ios-local-setup.md#local-native-acceptance): full latest-iPhone UI and existing non-UI tests, focused latest-iPad tests, and the minimum iOS 18 compatibility selection. The [Cloud backstop](../../docs/ios-ci-cd.md#native-release-gate) uses its own small plan. Apple testing stays in Xcode Cloud or local Xcode; local execution follows the [repository testing policy](../../AGENTS.md#testing-philosophy).

- Do not try to cover the iOS app exhaustively with tests
- Do not add isolated unit tests by default
- Prefer native integration, parity, or UI tests when they validate a real module boundary or user flow
- Use narrow native availability handling for iOS 18; do not duplicate screens or business logic
- Use one latest iPhone, one latest iPad and one actual iOS 18 destination for their respective plans
- Prefer an already booted local iPhone simulator on the selected runtime
- Prefer background CLI runs with `simctl` and `xcodebuild` instead of opening heavy Xcode UI flows
- Do not open a visible Simulator window for test runs unless the user explicitly asks for a visible simulator at that time
- Prefer `xcodebuild ... test` so each run validates the current sources and build settings on the selected simulator
- Pass `-derivedDataPath "tmp/ios-derived-data"` for local CLI builds and tests so repeated runs reuse repo-local build artifacts instead of creating new global DerivedData directories
- If a test fails, inspect the generated `.xcresult` bundle and read the relevant screenshots, attachments, and logs before changing code
- If no suitable local runtime is already installed, tell the user before downloading an extra simulator runtime

The most trusted iOS checks are the simulator-backed native smoke flows because they exercise the real app closest to production behavior.

## Local Test Workflow

Use the exact scheme, plans, configuration, signing overrides and single-destination commands in [iOS Local Setup](../../docs/ios-local-setup.md#local-native-acceptance). Reuse warmed simulators, wait for `simctl bootstatus`, and inspect failure artifacts before fixing code. Keep the software keyboard available for text-entry flows.

## Native Test Stack

The iOS app uses native Apple test tooling only:

- FSRS parity and scheduler-focused tests live in `apps/ios/Flashcards/FlashcardsTests/Review` as targeted native verification, not as an exhaustive safety net
- release-gate UI coverage lives in the grouped `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift` files, with shared smoke infrastructure in `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport`
- accessibility identifiers used by the live smoke flows live in `apps/ios/Flashcards/Flashcards/App/UITestIdentifiers.swift`, and because the test target cannot import the app target, `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeSupport/Configuration/LiveSmokeIdentifiers.swift` re-declares only the identifiers its own flows use, where a value present in both must match exactly

An accessibility identifier reaches XCUITest only on an accessibility element, usually a leaf such as `Text`, `Button`, or `TextField`, or a plain container whose descendants inherit it. A system container such as `ContentUnavailableView` can merge its subtree and drop the identifier, even from a `Text` inside it, so the smoke query silently finds nothing. `.accessibilityElement(children: .contain)` is the container pattern, used in `apps/ios/Flashcards/Flashcards/AI/Views/Transcript/AIChatMessageViews.swift`, but on some surfaces it fails to expose the identifier or crashes the app outright, so confirm a new identifier on a simulator before a live smoke flow uses it.

The iOS release-gate smoke coverage is split into independent grouped flows across Review, Cards, AI, and Settings. The linked workspace and AI consent-transfer flows sign into the configured review account; retain the complete plan inventory, including guest/local flows.

Guest AI availability is part of the iOS release contract. The guest AI smoke must pass without login, and a guest-AI-disabled or guest-quota-exhausted response is a real release-gate failure.

The grouped smoke suite still maps to the same top-level live-smoke contract as the other clients:

- Android equivalent: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/LiveSmokeTest.kt`
- Web equivalent: `apps/web/e2e/live-smoke.spec.ts`

## App Icon

The Apple app icon is the Icon Composer document `Flashcards/Flashcards/AppIcon.icon`, with a light alternate beside it.
See [App icon](docs/app-icon.md) before changing either.

## Marketing Screenshots

The iOS App Store screenshot generator and the derived iOS marketing-material builder are documented in [`docs/marketing-screenshots.md`](docs/marketing-screenshots.md).

Use that document when you need to regenerate localized App Store screenshots or build the derived horizontal marketing materials from screenshots 1, 2, 3, 4, and 5. It explains the manual XCUITest entrypoints, the supported sequential wrapper script for the unified five-shot run, locale selection, the requirement to use `iPhone 14 Plus` for the iPhone screenshot set, simulator-family-to-output-folder behavior, and the expected generated output paths under `apps/ios/docs/media/app-store-screenshots/` and `apps/ios/docs/media/marketing-materials/`. Optional iPhone Duo capture uses the same scenarios with an explicit outer or inner display selection; the document records its Xcode prerequisite, separate output folders, and current asset status.

Marketing images are ignored public release assets; see [Media assets](../../docs/media-assets.md)
for explicit downloads. Normal app builds need no media download.

## CI/CD

iOS CI/CD is documented in [`docs/ios-ci-cd.md`](../../docs/ios-ci-cd.md).
Native sign-in acceptance is documented in [Native Apple sign-in](../../docs/native-apple-sign-in.md).
Release notes and release authorization are documented in [Release All Platforms](../../docs/release/README.md).
Follow the [iOS release procedure](../../docs/release/ios.md#ios) for full local acceptance, parallel Xcode Cloud archive/small-smoke runs and App Review submission.

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
