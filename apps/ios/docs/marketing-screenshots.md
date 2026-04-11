# iOS Marketing Screenshots

This document tracks repeatable iOS screenshot scripts for App Store marketing assets.

## Current inventory

There are currently three iOS marketing screenshot themes and four tracked output PNG targets.

The review screenshot flow captures an exam-prep concept card about opportunity cost in two states:

- front-only before answer reveal
- revealed answer with the rating buttons visible

- Manual screenshot entrypoints:
  - `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingReviewFrontScreenshotTests.swift`
  - `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingReviewResultScreenshotTests.swift`
- Shared screenshot helpers:
  - `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingManualScreenshotTestCase.swift`
  - `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingScreenshotFixtures.swift`
- Manual wrapper scripts:
  - `scripts/capture-ios-review-front-screenshot.sh`
  - `scripts/capture-ios-review-screenshot.sh`
- Output PNG targets:
  - `apps/ios/docs/media/app-store-screenshots/iphone/en-1_review-card-front-app-store-opportunity-cost.png`
  - `apps/ios/docs/media/app-store-screenshots/ipad/en-1_review-card-front-app-store-opportunity-cost.png`
  - `apps/ios/docs/media/app-store-screenshots/iphone/en-2_review-card-result-app-store-opportunity-cost.png`
  - `apps/ios/docs/media/app-store-screenshots/ipad/en-2_review-card-result-app-store-opportunity-cost.png`

The AI draft screenshot flow starts from the same opportunity-cost review card, reveals the answer, opens the AI handoff from the review card, and captures the AI screen with the handed-off card attached plus an unsent draft request.

- Manual screenshot entrypoint: `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingReviewAiDraftScreenshotTests.swift`
- Shared screenshot helpers:
  - `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingManualScreenshotTestCase.swift`
  - `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingScreenshotFixtures.swift`
- Manual wrapper script: `scripts/capture-ios-review-ai-draft-screenshot.sh`
- Output PNG targets:
  - `apps/ios/docs/media/app-store-screenshots/iphone/en-4_review-card-ai-draft-app-store-opportunity-cost.png`
  - `apps/ios/docs/media/app-store-screenshots/ipad/en-4_review-card-ai-draft-app-store-opportunity-cost.png`

The cards screenshot flow captures the `Cards` tab filled with exam-prep concept cards across multiple subjects.

- Manual screenshot entrypoint: `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingCardsScreenshotTests.swift`
- Shared screenshot helpers:
  - `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingManualScreenshotTestCase.swift`
  - `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingScreenshotFixtures.swift`
- Manual wrapper script: `scripts/capture-ios-cards-screenshot.sh`
- Output PNG targets:
  - `apps/ios/docs/media/app-store-screenshots/iphone/en-3_cards-list-app-store-vocabulary.png`
  - `apps/ios/docs/media/app-store-screenshots/ipad/en-3_cards-list-app-store-vocabulary.png`

## Run the flows

Prerequisites:

- Boot one local iOS 26 simulator manually before running a wrapper script.
- If more than one simulator is booted, set `FLASHCARDS_IOS_SIMULATOR_ID=<device-uuid>` explicitly.
- Run from the repository root.

Command:

```bash
bash scripts/capture-ios-review-front-screenshot.sh
bash scripts/capture-ios-review-screenshot.sh
bash scripts/capture-ios-cards-screenshot.sh
bash scripts/capture-ios-review-ai-draft-screenshot.sh
```

These scripts are not part of iOS CI, release gates, or default `xcodebuild test` runs.
They execute only when the wrapper script sets `FLASHCARDS_INCLUDE_MANUAL_SCREENSHOT_TESTS=true`.

Each wrapper script:

1. Resolves one already booted simulator.
2. Detects whether that simulator is an iPhone or iPad.
3. Runs one manual-only XCUITest entrypoint with `-only-testing`.
4. Saves the PNG directly into `apps/ios/docs/media/app-store-screenshots/<iphone|ipad>/`.

## Pattern for future flows

Future iOS marketing screenshot flows should follow the same structure:

1. Add a dedicated manual screenshot entrypoint that prepares the required in-app state.
2. Seed deterministic data through the existing UI-test reset-state mechanism when possible.
3. Drive the UI only as far as needed for the exact marketing surface.
4. Save the PNG directly from XCUITest into the committed iOS marketing media directory.
5. Add a small shell wrapper in `scripts/` that runs only that entrypoint with `-only-testing`.

This keeps screenshot generation deterministic, reviewable, runnable without manual simulator interaction after boot, and fully separate from the normal iOS smoke suite.
