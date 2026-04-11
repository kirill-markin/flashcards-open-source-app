# iOS Marketing Screenshots

This document explains the manual iOS App Store screenshot generator.

The generator is a small manual pipeline built from:

- manual-only XCUITest entrypoints in `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/`
- one shared wrapper script, `scripts/capture-ios-marketing-screenshot.sh`
- one combined review wrapper and one cards wrapper in `scripts/`
- deterministic localized fixture data used by both the UI tests and app-side UI-test seeding

It is meant for committed App Store marketing PNG assets, not for CI or release-gate validation.

## What is included

The current inventory is four screenshot outputs per locale:

1. Review front state
2. Review revealed-answer state
3. Cards list state
4. Review AI draft state

One combined review scenario seeds the opportunity-cost card once, then captures screenshot 1, screenshot 2, and screenshot 4 sequentially. The cards screenshot remains a separate localized concept-card list scenario.

## Files involved

Main scripts:

- `scripts/capture-ios-marketing-screenshot.sh`
- `scripts/capture-ios-review-screenshots.sh`
- `scripts/capture-ios-cards-screenshot.sh`

Manual XCUITest entrypoints:

- `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingReviewScreenshotsTests.swift`
- `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingCardsScreenshotTests.swift`

Shared screenshot support:

- `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingManualScreenshotTestCase.swift`
- `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingScreenshotFixtures.swift`
- `apps/ios/Flashcards/Flashcards/Cloud/FlashcardsStore+CloudUITest.swift`

What each layer does:

- `capture-ios-marketing-screenshot.sh` resolves the locale, selects the already booted simulator, derives the device family, runs one `-only-testing` XCUITest target, and verifies that each expected PNG was written.
- `capture-ios-review-screenshots.sh` runs the combined review scenario and verifies screenshots 1, 2, and 4 in one pass.
- `capture-ios-cards-screenshot.sh` runs the separate cards-list scenario and verifies screenshot 3.
- `MarketingManualScreenshotTestCase.swift` gates these tests behind `FLASHCARDS_INCLUDE_MANUAL_SCREENSHOT_TESTS=true`, applies the launch environment, and writes the PNG file.
- `MarketingScreenshotFixtures.swift` defines the canonical locale list, locale aliases, localized fixture text, and the expected output filenames.
- `FlashcardsStore+CloudUITest.swift` seeds the localized UI-test content used by the screenshot flows.

## Supported locales

Canonical supported locale codes:

- `en-US`
- `ar`
- `zh-Hans`
- `de`
- `hi`
- `ja`
- `ru`
- `es-MX`
- `es-ES`

Default locale:

- `en-US`

Supported input aliases:

- `en` -> `en-US`
- `zh-CN` -> `zh-Hans`
- `de-DE` -> `de`
- `hi-IN` -> `hi`
- `ja-JP` -> `ja`
- `ru-RU` -> `ru`
- `es-419` -> `es-MX`

How locale selection works:

1. `--locale <code>` wins if you pass it.
2. Otherwise `FLASHCARDS_MARKETING_SCREENSHOT_LOCALE` is used if set.
3. Otherwise the generator falls back to `en-US`.

List the canonical locale codes with:

```bash
bash scripts/capture-ios-marketing-screenshot.sh --list-locales
```

If you pass an unsupported locale or alias, the wrapper exits with an error before running XCUITest.

## iPhone vs iPad output selection

The generator does not have a `--family` flag.

It derives the output family from the one already booted simulator:

- simulator name contains `iPhone` -> writes into `iphone/`
- simulator name contains `iPad` -> writes into `ipad/`

This means:

- boot an iPhone simulator if you want iPhone screenshots
- boot an iPad simulator if you want iPad screenshots
- if more than one simulator is booted, set `FLASHCARDS_IOS_SIMULATOR_ID=<device-uuid>`

The scripts do not boot or switch simulators for you. They only resolve a booted simulator, wait for `bootstatus`, and run the selected manual test.

## Output paths and filenames

Outputs are written directly into:

- `apps/ios/docs/media/app-store-screenshots/iphone/`
- `apps/ios/docs/media/app-store-screenshots/ipad/`

There are no locale subdirectories. Locale is encoded in the file name:

- `<locale>-<index>_<slug>.png`

Current filenames:

- `<locale>-1_review-card-front-app-store-opportunity-cost.png`
- `<locale>-2_review-card-result-app-store-opportunity-cost.png`
- `<locale>-3_cards-list-app-store-vocabulary.png`
- `<locale>-4_review-card-ai-draft-app-store-opportunity-cost.png`

Examples:

- `apps/ios/docs/media/app-store-screenshots/iphone/en-US-1_review-card-front-app-store-opportunity-cost.png`
- `apps/ios/docs/media/app-store-screenshots/ipad/ar-4_review-card-ai-draft-app-store-opportunity-cost.png`

## Prerequisites

Before running any screenshot script:

- start from the repository root
- boot exactly one local iOS simulator manually
- use an iPhone simulator for iPhone output or an iPad simulator for iPad output
- if multiple simulators are already booted, set `FLASHCARDS_IOS_SIMULATOR_ID`

These flows are manual on purpose:

- they are not part of default `xcodebuild test`
- they are not part of iOS CI
- they are not part of the release-gate smoke suite

## Run supported scenarios

The supported review wrapper generates three PNGs from one seeded review run:

```bash
bash scripts/capture-ios-review-screenshots.sh
```

That one review run writes:

- screenshot 1: review front
- screenshot 2: review result
- screenshot 4: review AI draft

Cards list remains a separate one-PNG run:

```bash
bash scripts/capture-ios-cards-screenshot.sh
```

Run the combined review scenario for a specific locale:

```bash
bash scripts/capture-ios-review-screenshots.sh --locale es-ES
```

Or use the environment variable instead:

```bash
FLASHCARDS_MARKETING_SCREENSHOT_LOCALE=zh-Hans bash scripts/capture-ios-cards-screenshot.sh
```

## Generate all four screenshots for one locale

Use one locale explicitly and run the two supported wrappers in order:

```bash
bash scripts/capture-ios-review-screenshots.sh --locale es-ES
bash scripts/capture-ios-cards-screenshot.sh --locale es-ES
```

Do not run these two wrappers at the same time. Run the second command only after the first one exits.

Or set the locale once in the environment:

```bash
export FLASHCARDS_MARKETING_SCREENSHOT_LOCALE=es-ES

bash scripts/capture-ios-review-screenshots.sh
bash scripts/capture-ios-cards-screenshot.sh
```

## Generate for multiple locales

For a clean multi-locale run, keep one simulator family booted and loop through the locales:

```bash
for locale in en-US ar zh-Hans de hi ja ru es-MX es-ES; do
  bash scripts/capture-ios-review-screenshots.sh --locale "$locale"
  bash scripts/capture-ios-cards-screenshot.sh --locale "$locale"
done
```

If you need both iPhone and iPad assets, run the full locale loop twice:

1. once with one booted iPhone simulator
2. once with one booted iPad simulator

That keeps filenames predictable and ensures outputs land in the correct family folder.

## Important constraints and caveats

- Only one booted simulator is allowed unless you set `FLASHCARDS_IOS_SIMULATOR_ID`.
- Device family is inferred from the simulator name, so the booted simulator directly controls whether output lands in `iphone/` or `ipad/`.
- Run screenshot wrappers sequentially, not in parallel. The current generator uses one shared runtime configuration file in `/tmp`, so overlapping runs can make one flow skip or read the wrong configuration.
- The scripts expect every declared screenshot file to exist after the XCUITest finishes and fail if any expected PNG was not written.
- Manual screenshot tests run only through the wrapper scripts because the wrapper sets the required environment variables.
- Locale-specific content is deterministic and comes from the fixture files listed above. Update those files if the screenshot copy or seeded cards need to change.

## Pattern for future screenshot flows

Future marketing screenshot flows should keep the same shape:

1. Add one dedicated manual XCUITest entrypoint for the new surface.
2. Seed deterministic locale-aware data through the existing UI-test reset-state path.
3. Drive the UI only as far as needed for the exact marketing surface.
4. Save the PNG directly into `apps/ios/docs/media/app-store-screenshots/<family>/`.
5. Add one small wrapper in `scripts/` that calls `capture-ios-marketing-screenshot.sh` with the new test identifier and every expected index/slug pair for that scenario.

That keeps the pipeline reviewable, deterministic, localized, and separate from the normal iOS smoke suite.
