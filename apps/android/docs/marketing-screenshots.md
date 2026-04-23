# Android Marketing Screenshots

This document tracks repeatable Android screenshot scripts for marketing assets.

For the operational capture procedure, clean-emulator workflow, and verification checklist, use [`marketing-screenshot-runbook.md`](marketing-screenshot-runbook.md).

The locale-specific screenshot texts, file-name prefixes, and UI labels currently live in `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingScreenshotCatalog.kt`.
Screenshot-only translated app resources belong in `apps/android/app/src/marketingScreenshot/res` and are packaged only in the dedicated `marketingScreenshot` build type used by the wrapper scripts.

## Current inventory

There are currently three Android manual capture flows and five expected generated output PNG targets.
Existing repository media can still contain the previous four-shot assets until the flows are run and the generated PNGs are reviewed.

The screenshot catalog currently defines these locale prefixes:

- `en`
- `en-US`
- `ar`
- `zh-CN`
- `de-DE`
- `hi-IN`
- `ja-JP`
- `ru-RU`
- `es-419`
- `es-ES`
- `es-US`

The review screenshot chain captures an exam-prep concept card about opportunity cost in three states:

- front-only before answer reveal
- revealed answer with the rating buttons visible
- AI handoff screen with the handed-off card attached plus an unsent draft request

- Manual screenshot entrypoint: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingReviewScreenshotScript.kt`
- Shared screenshot helpers: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingScreenshotTestSupport.kt`
- Manual wrapper script: `scripts/capture-android-review-screenshot.sh`
- Expected generated output PNG targets:
  - `apps/android/docs/media/play-store-screenshots/en-1_review-card-front-google-play-opportunity-cost.png`
  - `apps/android/docs/media/play-store-screenshots/en-2_review-card-result-google-play-opportunity-cost.png`
  - `apps/android/docs/media/play-store-screenshots/en-4_review-card-ai-draft-google-play-opportunity-cost.png`

The progress screenshot flow captures the `Progress` tab with deterministic study-history data.

- Manual screenshot entrypoint: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingProgressScreenshotScript.kt`
- Shared screenshot helpers: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingScreenshotTestSupport.kt`
- Manual wrapper script: `scripts/capture-android-progress-screenshot.sh`
- Expected generated output PNG target: `apps/android/docs/media/play-store-screenshots/en-3_progress-google-play-study-history.png`

The cards screenshot flow captures the `Cards` tab filled with exam-prep concept cards across multiple subjects.

- Manual screenshot entrypoint: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingCardsScreenshotScript.kt`
- Shared screenshot helpers: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/MarketingScreenshotTestSupport.kt`
- Manual wrapper script: `scripts/capture-android-cards-screenshot.sh`
- Expected generated output PNG target: `apps/android/docs/media/play-store-screenshots/en-5_cards-list-google-play-vocabulary.png`

## Run the flows

Prerequisites:

- Start a local Android emulator or device on API 36.
- Run from the repository root.

Command:

```bash
bash scripts/capture-android-review-screenshot.sh
bash scripts/capture-android-progress-screenshot.sh
bash scripts/capture-android-cards-screenshot.sh
```

To target a configured locale other than the default `en`, set `FLASHCARDS_MARKETING_LOCALE_PREFIX` for the wrapper run:

```bash
FLASHCARDS_MARKETING_LOCALE_PREFIX=de-DE bash scripts/capture-android-review-screenshot.sh
```

These scripts are not part of Android CI, release gates, or default `androidTest` runs.
They exist only to generate marketing screenshots on demand.
They run `:app:connectedMarketingScreenshotAndroidTest`, not the normal debug instrumentation task, so screenshot-only translations do not affect the Play-first `debug` and `release` builds.

The review wrapper script runs the combined manual-only review-chain entrypoint, saves screenshots 1, 2, and 4 into `/sdcard/Download/flashcards-marketing-screenshots/`, and then pulls those files into the committed marketing media directory.

The progress wrapper script runs the manual-only Progress screenshot entrypoint, saves screenshot 3 into the same device directory, and then pulls that file into the committed marketing media directory.

The cards wrapper script runs the manual-only cards screenshot entrypoint, saves screenshot 5 into the same device directory, and then pulls that file into the committed marketing media directory.

Run the wrappers sequentially. Do not start the Progress or Cards wrapper until the previous wrapper has exited.

## Pattern for future flows

Future marketing screenshot flows should follow the same structure:

1. Add a dedicated manual screenshot entrypoint that creates or prepares the required in-app state.
2. Drive the UI to the exact screen that marketing needs.
3. Save the screenshot PNG or PNGs into `/sdcard/Download/flashcards-marketing-screenshots/` from instrumentation.
4. Add a small shell wrapper in `scripts/` that runs just that manual entrypoint and pulls the generated PNG file or files into `apps/android/docs/media/play-store-screenshots/`.

This keeps screenshot generation deterministic, reviewable, runnable without manual emulator interaction, and fully separate from the normal Android test suite and shipping Play-first localization flow.
