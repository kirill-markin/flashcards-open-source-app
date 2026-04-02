# Android Marketing Screenshots

This document tracks repeatable Android screenshot scripts for marketing assets.

## Current flow

The first manual screenshot flow captures the review screen with the `mitigate` vocabulary card and the four rating buttons visible.

- Manual screenshot entrypoint: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingReviewScreenshotScript.kt`
- Shared screenshot helpers: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingScreenshotTestSupport.kt`
- Manual wrapper script: `scripts/capture-android-review-screenshot.sh`
- Output PNG: `apps/android/docs/media/play-store-screenshots/review-card-result-google-play-mitigate.png`

The second manual screenshot flow captures the `Cards` tab filled with exam-vocabulary cards on the same topic family.

- Manual screenshot entrypoint: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingCardsScreenshotScript.kt`
- Shared screenshot helpers: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingScreenshotTestSupport.kt`
- Manual wrapper script: `scripts/capture-android-cards-screenshot.sh`
- Output PNG: `apps/android/docs/media/play-store-screenshots/cards-list-google-play-vocabulary.png`

## Run the flow

Prerequisites:

- Start a local Android emulator or device on API 36.
- Run from the repository root.

Command:

```bash
bash scripts/capture-android-review-screenshot.sh
bash scripts/capture-android-cards-screenshot.sh
```

These scripts are not part of Android CI, release gates, or default `androidTest` runs.
They exist only to generate marketing screenshots on demand.

Each script runs a manual-only screenshot entrypoint, waits for the app to reach the target state, saves a PNG into `/sdcard/Download/flashcards-marketing-screenshots/`, and then pulls that PNG into the committed marketing media directory.

## Pattern for future flows

Future marketing screenshot flows should follow the same structure:

1. Add a dedicated manual screenshot entrypoint that creates or prepares the required in-app state.
2. Drive the UI to the exact screen that marketing needs.
3. Save the screenshot PNG into `/sdcard/Download/flashcards-marketing-screenshots/` from instrumentation.
4. Add a small shell wrapper in `scripts/` that runs just that manual entrypoint and pulls the PNG into `apps/android/docs/media/play-store-screenshots/`.

This keeps screenshot generation deterministic, reviewable, runnable without manual emulator interaction, and fully separate from the normal Android test suite.
