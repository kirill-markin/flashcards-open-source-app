# Android App

Read this file before making any Android change.

## Goal

The Android app should match the iOS app in product scope, but it must feel fully native to Android.

We do not want an Android app that imitates iPhone UI. We want a modern Android app built with current Google-recommended patterns, official libraries, and minimal custom behavior.

## Platform Baseline

- Language: Kotlin
- UI stack: Jetpack Compose
- Design system: Material 3
- Minimum supported Android version: Android 14, `minSdk = 34`
- Compile target: Android 16, `compileSdk = 36`
- Runtime target: Android 16, `targetSdk = 36`
- Testing focus: Android 16 / API 36 only
- Primary local storage: Room on top of SQLite

The development focus is Android 14, 15, and 16. We do not spend effort validating or polishing older Android versions.

## Design Rule

Use Google-provided Android components and Android interaction patterns whenever they fit the problem.

Prefer:

- Jetpack Compose
- Material 3 components, tokens, layout patterns, and theming
- `NavigationSuiteScaffold`, `NavigationBar`, `NavigationRail`, `TopAppBar`, `Scaffold`, sheets, dialogs, and standard Compose state handling
- Android-standard navigation, motion, typography, feedback, and accessibility behavior

Keep the visual direction simple:

- dark theme by default
- keep the orange control color aligned with the iOS app
- do not force iOS visuals onto Android
- prefer native Material presentation over custom chrome

If an implementation starts needing custom design or custom logic on top of a standard Android component, stop and propose a simpler platform-native alternative first.

## Engineering Rule

Prefer official AndroidX and Google libraries before considering external dependencies.

Default stack:

- Jetpack Compose
- Material 3
- Navigation Compose
- `ViewModel` + `StateFlow`
- Room for local persistence
- WorkManager for future sync and outbox work

Avoid:

- third-party UI kits
- custom design systems that fight Material 3
- hand-rolled database layers when Room already fits
- extra framework layers that duplicate standard Android architecture guidance

If Google already provides a supported solution, use it unless there is a concrete product requirement not covered by it.

## Product Scope

The first Android draft should mirror the current top-level product structure:

- Review
- Cards
- AI
- Settings

The goal of the first iteration is a working draft that can run in an emulator and be clicked through.

Missing business logic is acceptable in the draft as long as the UI structure, navigation, and local storage foundation are in place.

## Partial Implementation Rule

When work is intentionally incomplete, leave explicit comments in English using this format:

`TODO: Port <specific logic> from <specific iOS file or feature>`

The comment must identify the exact logic that still needs to be ported from iOS. Do not leave vague TODOs.

## Testing Rule

Test only on the final supported Android target.

- Run Android tests only against Android 16 / API 36
- Do not spend time on test matrices for older API levels
- Do not add compatibility code for older Android versions unless explicitly requested

## Review Standard

When reviewing or implementing Android changes, challenge complexity early.

If the proposed approach introduces custom design, custom behavior, or custom infrastructure where Android already provides a clear native pattern, propose the simpler Android-native version before writing more code.
