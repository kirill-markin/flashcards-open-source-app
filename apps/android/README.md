# Android App

Read this file before making any Android change.

## Goal

The Android app should match the iOS app in product scope, but it must feel fully native to Android.
We align the functional contract across Android and iOS, but we do not synchronize the designs between them.
On Android, the UI and interaction design should stay maximally native to Android and Material 3.

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

The Android app should mirror the current top-level product structure:

- Review
- Cards
- AI
- Settings

The goal is a working Android app that can run in an emulator and on-device while staying aligned with the shared product contract.

Keep the UI structure, navigation, and local storage foundation aligned with the current Android app architecture.

## Local Commands

Run commands from `apps/android/`.

- Build the debug app: `./gradlew :app:assembleDebug`
- Build AndroidTest APKs: `./gradlew :app:assembleDebugAndroidTest :data:local:assembleDebugAndroidTest`

## Media Assets

Store committed Android marketing assets and reference screenshots in `apps/android/docs/media/`.

Use that directory for assets such as:

- Google Play screenshots
- feature graphic source files
- exported PNGs used in store listings

These files are updated manually and are part of the repository on purpose.
Media-only changes inside `apps/android/docs/media/` must not trigger Android CI builds.

When it is faster, ask an LLM to create or capture these assets directly on a local virtual Android device.
That workflow works well for:

- opening the current app build in an emulator
- creating realistic demo cards and AI chats
- taking clean store screenshots by hand
- generating a feature graphic source and exporting the final PNG

The current local Android app uses:

- `compileSdk = 36`
- `targetSdk = 36`
- `minSdk = 34`
- Room on top of SQLite for local storage
- Material 3 + Compose + Navigation Compose + `NavigationSuiteScaffold`

## Testing Rule

Test only on the final supported Android target.

- Do not try to cover the Android app exhaustively with tests
- Do not add isolated unit tests by default
- Prefer native integration, parity, and instrumentation tests when they validate a real module boundary or user flow
- Run Android tests only against Android 16 / API 36
- Do not spend time on test matrices for older API levels
- Do not add compatibility code for older Android versions unless explicitly requested
- Prefer background local emulator runs without a visible emulator window by default
- Preserve the usual test artifacts, logs, screenshots, and reports when running Android tests in the background
- Open a visible Android emulator only when the user explicitly asks for it at that time

The most trusted Android checks are the emulator or managed-device smoke flows because they exercise the real app closest to production behavior.

## Native Test Stack

The Android app uses native Android and Compose testing:

- targeted integration coverage runs through native instrumentation and Compose UI testing in `apps/android/app/src/androidTest` and `apps/android/data/local/src/androidTest`
- shared FSRS scheduler parity stays in `apps/android/data/local/src/test/java/com/flashcardsopensourceapp/data/local/model/FsrsSchedulerParityTest.kt` and uses `tests/fsrs-full-vectors.json`
- release-gate UI coverage runs through native instrumentation and Compose UI testing in `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt`
- the live smoke flow relies on stable Compose test tags from the production UI modules, not on a separate mock shell

The Android live smoke scenario matches the other clients on purpose:

- iOS equivalent: `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift`
- Web equivalent: `apps/web/e2e/live-smoke.spec.ts`

## CI/CD

Android CI/CD is documented in [`docs/android-ci-cd.md`](../../docs/android-ci-cd.md).

That document also lists the required GitHub repository variables for Google Cloud authentication and Firebase Test Lab, plus the helper sync command `bash scripts/setup-github-android.sh`.

The repository policy for Android CI/CD is:

- GitHub Actions is the primary CI entrypoint
- Firebase Test Lab is the cloud device test runner
- `cloudbuild.android.yaml` is the Google-native Cloud Build entrypoint
- Google auth from GitHub must use Workload Identity Federation, not a JSON key
- the release gate order is native build/lint checks first, then the native Firebase Test Lab live smoke, then Google Play release
- after pushing to `main`, watch `Android Release` when Android-impacting files changed; it runs independently from the AWS/Web release workflow
- manual Android workflow runs also go through `Android Release`, and Google Play publish stays opt-in there

## Review Standard

When reviewing or implementing Android changes, challenge complexity early.

If the proposed approach introduces custom design, custom behavior, or custom infrastructure where Android already provides a clear native pattern, propose the simpler Android-native version before writing more code.
