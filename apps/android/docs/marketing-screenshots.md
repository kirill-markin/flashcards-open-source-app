# Android Marketing Screenshots

This document tracks repeatable Android screenshot flows for marketing assets.

## Current flow

The first screenshot flow captures the review screen with the `mitigate` vocabulary card and the four rating buttons visible.

- Instrumentation test: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingReviewScreenshotTest.kt`
- Shared screenshot helpers: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingScreenshotTestSupport.kt`
- Wrapper script: `scripts/capture-android-review-screenshot.sh`
- Output PNG: `apps/android/docs/media/play-store-screenshots/review-card-result-google-play-mitigate.png`

## Run the flow

Prerequisites:

- Start a local Android emulator or device on API 36.
- Run from the repository root.

Command:

```bash
bash scripts/capture-android-review-screenshot.sh
```

The script runs the dedicated `androidTest`, waits for the app to reach the target review state, saves a PNG into `/sdcard/Download/flashcards-marketing-screenshots/`, and then pulls that PNG into the committed marketing media directory.

## Pattern for future flows

Future marketing screenshot flows should follow the same structure:

1. Add a dedicated `androidTest` that creates or prepares the required in-app state.
2. Drive the UI to the exact screen that marketing needs.
3. Save the screenshot PNG into `/sdcard/Download/flashcards-marketing-screenshots/` from instrumentation.
4. Add a small shell wrapper in `scripts/` that runs just that test and pulls the PNG into `apps/android/docs/media/play-store-screenshots/`.

This keeps screenshot generation deterministic, reviewable, and runnable without manual emulator interaction.
