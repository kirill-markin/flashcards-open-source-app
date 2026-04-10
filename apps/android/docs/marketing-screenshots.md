# Android Marketing Screenshots

This document tracks repeatable Android screenshot scripts for marketing assets.

## Current inventory

There are currently two Android marketing screenshot themes and three tracked output PNG targets.

The review screenshot flow captures an exam-prep concept card about opportunity cost in two states:

- front-only before answer reveal
- revealed answer with the rating buttons visible

- Manual screenshot entrypoints:
  - `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingReviewFrontScreenshotScript.kt`
  - `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingReviewScreenshotScript.kt`
- Shared screenshot helpers: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingScreenshotTestSupport.kt`
- Manual wrapper scripts:
  - `scripts/capture-android-review-front-screenshot.sh`
  - `scripts/capture-android-review-screenshot.sh`
- Output PNG targets:
  - `apps/android/docs/media/play-store-screenshots/review-card-front-google-play-opportunity-cost.png`
  - `apps/android/docs/media/play-store-screenshots/review-card-result-google-play-opportunity-cost.png`

The cards screenshot flow captures the `Cards` tab filled with study-oriented vocabulary cards.

- Manual screenshot entrypoint: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingCardsScreenshotScript.kt`
- Shared screenshot helpers: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingScreenshotTestSupport.kt`
- Manual wrapper script: `scripts/capture-android-cards-screenshot.sh`
- Output PNG target: `apps/android/docs/media/play-store-screenshots/cards-list-google-play-vocabulary.png`

## Run the flows

Prerequisites:

- Start a local Android emulator or device on API 36.
- Run from the repository root.

Command:

```bash
bash scripts/capture-android-review-front-screenshot.sh
bash scripts/capture-android-review-screenshot.sh
bash scripts/capture-android-cards-screenshot.sh
```

These scripts are not part of Android CI, release gates, or default `androidTest` runs.
They exist only to generate marketing screenshots on demand.

The review front wrapper script runs the manual-only pre-reveal review entrypoint, saves the front-only PNG into `/sdcard/Download/flashcards-marketing-screenshots/`, and then pulls that file into the committed marketing media directory.

The review result wrapper script runs the manual-only revealed-answer review entrypoint, saves the revealed-answer PNG into the same device directory, and then pulls that file into the committed marketing media directory.

The cards wrapper script runs the manual-only cards screenshot entrypoint, saves the cards PNG into the same device directory, and then pulls that file into the committed marketing media directory.

## Pattern for future flows

Future marketing screenshot flows should follow the same structure:

1. Add a dedicated manual screenshot entrypoint that creates or prepares the required in-app state.
2. Drive the UI to the exact screen that marketing needs.
3. Save the screenshot PNG into `/sdcard/Download/flashcards-marketing-screenshots/` from instrumentation.
4. Add a small shell wrapper in `scripts/` that runs just that manual entrypoint and pulls the generated PNG file or files into `apps/android/docs/media/play-store-screenshots/`.

This keeps screenshot generation deterministic, reviewable, runnable without manual emulator interaction, and fully separate from the normal Android test suite.
