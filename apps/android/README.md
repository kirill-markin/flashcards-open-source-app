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

## Android Docs

- Add a new app language safely: [`docs/add-language-checklist.md`](docs/add-language-checklist.md)
- Run Android marketing screenshot captures reliably: [`docs/marketing-screenshot-runbook.md`](docs/marketing-screenshot-runbook.md)
- Track current Android marketing screenshot inventory: [`docs/marketing-screenshots.md`](docs/marketing-screenshots.md)

The marketing screenshot docs cover locale-prefixed runs as well.
Use them when adding or validating multi-language Play screenshot content.

## Localization Rule

Android app-internal translations are Play-first.

- Keep the Android source tree authoritative for the base English strings, stable string keys/plurals, base locale metadata, and the explicit supported-language list used to advertise app languages to Android system settings.
- Google Play App strings translation is the source of truth for translated Android UI copy. Do not sync Play-managed translations back into repository-owned Android `values-xx` trees.
- Do not rely on AGP locale generation from checked-in resources as the source of supported translated languages. Play-managed languages must still be advertised explicitly from the checked-in Android locale plumbing so Android's per-app language settings can list them.
- Keep the explicit Android supported-language list aligned with the languages enabled for Play App strings in the release you are shipping.
- Keep store listing text, screenshots, and other marketing localization separate from in-app Android strings. Those are Play Console and media-asset concerns, not a reason to reintroduce repository-managed Android UI translations.
- When a new Android app language is needed, add the English source strings or locale-ready formatting in repo, update the explicit locale-advertising config, upload a draft release to Google Play, review the Play-managed translations there, verify the Play-delivered build, and publish later from Play Console.
- A local debug build is useful only for base-resource sanity and locale-plumbing checks. Treat the Play-delivered draft build as the source of truth for translated UI copy and final per-app language availability.

## Media Assets

Store committed Android marketing assets and reference screenshots in `apps/android/docs/media/`.

Use that directory for assets such as:

- Google Play screenshots
- feature graphic source files
- exported PNGs used in store listings

Current committed Android feature graphic files:

- source HTML template: `apps/android/docs/media/play-store-feature-graphic/index.html`
- exported store PNGs: `apps/android/docs/media/play-store-feature-graphic/<locale>-feature-graphic.png`
- supported locales: `en-US`, `ar`, `zh-CN`, `de-DE`, `hi-IN`, `ja-JP`, `ru-RU`, `es-419`, `es-ES`, `es-US`

These files are updated manually and are part of the repository on purpose.
Media-only changes inside `apps/android/docs/media/` must not trigger Android CI builds.

When it is faster, ask an LLM to create or capture these assets directly on a local virtual Android device.
That workflow works well for:

- opening the current app build in an emulator
- creating realistic demo cards and AI chats
- taking clean store screenshots by hand
- generating a feature graphic source and exporting the final PNG

For the current Android Play Store feature graphics, the expected workflow is:

1. Edit `apps/android/docs/media/play-store-feature-graphic/index.html`.
2. Run `bash scripts/export-android-feature-graphic.sh <locale>` for one locale, or `bash scripts/export-android-feature-graphics.sh` for the full supported set.
3. Verify that each exported file in `apps/android/docs/media/play-store-feature-graphic/` is 1024 x 500.

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
- Before a local instrumentation run, stop all other Android emulators, verify `adb devices` shows only the one target emulator, and prefer a clean rebuild plus one clean test run so stale emulator state does not contaminate the result

The most trusted Android checks are the managed-device app instrumentation flows because they exercise the real app closest to production behavior.

## Native Test Stack

The Android app uses native Android and Compose testing:

- targeted integration coverage runs through native instrumentation and Compose UI testing in `apps/android/app/src/androidTest` and `apps/android/data/local/src/androidTest`
- shared FSRS scheduler parity stays in `apps/android/data/local/src/test/java/com/flashcardsopensourceapp/data/local/model/FsrsSchedulerParityTest.kt` and uses `tests/fsrs-full-vectors.json`
- release-gate app UI instrumentation runs through the full `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app` package in Firebase Test Lab, with `LiveSmokeTest.kt` and `NotificationTapSmokeTest.kt` kept as the highest-confidence stateful flows inside that package
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
- the GitHub-hosted Android release gate is unit tests plus build/lint first, then GitHub-hosted `data:local` instrumentation; after that succeeds, CI uploads a Google Play production-track draft
- one shared `ANDROID_VERSION_CODE` is resolved once per release run and reused across Android release artifacts and the Play draft bundle
- one shared manager-readable release identifier, currently `vc<versionCode>-r<runId>a<attempt>-s<shortSha>`, is reused in the Play release name and Firebase Test Lab result naming so the same release stays traceable across GitHub, Play, and Firebase
- Firebase Test Lab still runs the full app UI instrumentation suite for the same SHA and release metadata from the top-level `firebase_test_lab_submission` job, but its submission and completion do not block the Play draft upload path; review those results before publishing from Play Console
- after pushing to `main`, watch `Android Release` when Android-impacting files changed; it runs independently from the AWS/Web release workflow
- after the workflow uploads the AAB, review Play App strings translations in Play Console, confirm the Play language set still matches the app's explicit supported-language list, verify the Play-delivered build, and publish the release there manually
- manual Android workflow runs also go through `Android Release`, and Play draft upload stays opt-in there

## Respect Existing Code

Before making any change, read the existing screens and composables in the area you are touching.

Follow the patterns already present:

- match the composable structure, ViewModel wiring, and StateFlow usage already established in neighboring screens
- use the same naming conventions for composables, view models, state classes, and Compose test tags already in the codebase
- if a shared composable, utility, or extension already exists for what you need, use it instead of adding a new one
- do not introduce a new architecture layer or pattern unless the existing one is clearly broken for the task at hand

If you are unsure how something is done, read two or three existing screens first. The answer is almost always already there.

## Review Standard

When reviewing or implementing Android changes, challenge complexity early.

If the proposed approach introduces custom design, custom behavior, or custom infrastructure where Android already provides a clear native pattern, propose the simpler Android-native version before writing more code.
