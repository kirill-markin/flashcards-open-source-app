# iOS Marketing Screenshots

This document explains the manual iOS App Store screenshot generator and the derived iOS marketing-material builder.

The generator is a small manual pipeline built from:

- manual-only XCUITest entrypoints in `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/`
- one shared wrapper script, `scripts/capture-ios-marketing-screenshot.sh`
- one supported unified five-shot wrapper in `scripts/`
- one marketing-material wrapper in `scripts/`
- deterministic localized fixture data used by both the UI tests and app-side UI-test seeding

It writes into the directories used for committed App Store marketing PNG assets and derived marketing compositions, but it is not part of CI or release-gate validation.
The generator configuration now targets five-shot outputs. Existing repository media can still contain the previous four-shot assets until the screenshot flows and derived-material builder are run and the generated PNGs are reviewed.

## What is included

The expected generated inventory is five screenshot outputs per locale:

1. Review front state
2. Review revealed-answer state
3. Progress tab state
4. Review AI draft state
5. Cards list state

One unified scenario seeds one guest workspace from one locale fixture, writes the canonical 30-day-ish study-history pattern onto support cards, keeps the untouched opportunity-cost card at the top of Review and Cards, and captures screenshots 1, 2, 3, 4, and 5 in one supported run. The shared history pattern yields `currentStreakDays=8`, `hasReviewedToday=true`, and `activeReviewDays=16`.

The derived marketing-material flow then takes those five localized screenshots and builds one horizontal PNG per locale in the same order:

1. screenshot 1
2. screenshot 2
3. screenshot 3
4. screenshot 4
5. screenshot 5

All five screenshots sit on one dark-gray background with equal spacing between screenshots and all four outer edges.

## Files involved

Main scripts:

- `scripts/capture-ios-marketing-screenshot.sh`
- `scripts/capture-ios-marketing-screenshots.sh`
- `scripts/build-ios-marketing-materials.sh`

Manual XCUITest entrypoints:

- `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingReviewScreenshotsTests.swift`
- `Flashcards Open Source App UI Tests/MarketingScreenshotsTests/testGenerateMarketingScreenshots`

Shared screenshot support:

- `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingManualScreenshotTestCase.swift`
- `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingScreenshotFixtures.swift`
- `apps/ios/Flashcards/Flashcards/Cloud/FlashcardsStore+CloudUITest.swift`

What each layer does:

- `capture-ios-marketing-screenshot.sh` resolves the locale, selects the already booted simulator, derives the device family, runs one `-only-testing` XCUITest target, and verifies that each expected screenshot index produced exactly one PNG.
- `capture-ios-marketing-screenshots.sh` runs the supported unified marketing scenario and verifies screenshots 1, 2, 3, 4, and 5 in one pass.
- `build-ios-marketing-materials.sh` can regenerate raw localized screenshots, compose the horizontal derived PNGs, and optimize the final files.
- `MarketingManualScreenshotTestCase.swift` gates these tests behind the wrapper-provided runtime configuration, falls back to the launch environment only if that file is absent, and writes the PNG file.
- `MarketingScreenshotFixtures.swift` defines the canonical locale list, locale aliases, localized fixture text, and the generated output filenames.
- `FlashcardsStore+CloudUITest.swift` seeds the localized UI-test content used by the screenshot flows and defines the dedicated guest-session cleanup launch scenario used at the end of each manual test.

## Guest cloud cleanup lifecycle

The manual screenshot flows now treat guest cloud sessions as short-lived per-run fixtures:

- before each marketing screenshot bootstrap, the app deletes any stored guest session remotely through `POST /guest-auth/session/delete` and then performs the existing local identity reset
- after each manual screenshot test, XCTest relaunches the app in a dedicated cleanup scenario and waits for the UI-test readiness marker before finishing teardown
- the cleanup relaunch clears the final guest session remotely and then runs the same local reset path, so both cloud and local screenshot state are removed predictably

This is why the screenshot wrappers must still run sequentially. The cleanup relaunch is part of the supported lifecycle, not an optional background best effort.

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

- boot `iPhone 14 Plus` if you want iPhone screenshots
- boot an iPad simulator if you want iPad screenshots
- if more than one simulator is booted, set `FLASHCARDS_IOS_SIMULATOR_ID=<device-uuid>`

The scripts do not boot or switch simulators for you. They only resolve a booted simulator, wait for `bootstatus`, and run the selected manual test.

For the committed iPhone App Store assets, treat `iPhone 14 Plus` as the canonical simulator target. Do not regenerate the iPhone PNG set on a different iPhone model unless the screenshot policy is intentionally changed in this document.

## Output paths and filenames

Outputs are written directly into:

- `apps/ios/docs/media/app-store-screenshots/iphone/`
- `apps/ios/docs/media/app-store-screenshots/ipad/`
- `apps/ios/docs/media/marketing-materials/iphone/`
- `apps/ios/docs/media/marketing-materials/ipad/`

There are no locale subdirectories. Locale and screenshot index are encoded in the file name:

- `<locale>-<index>_<slug>.png`

The slug is owned by the XCUITest fixture code and can change when a screenshot scenario is renamed. The builder resolves raw inputs by locale and index, so it expects these filename patterns:

- `<locale>-1_*.png`
- `<locale>-2_*.png`
- `<locale>-3_*.png`
- `<locale>-4_*.png`
- `<locale>-5_*.png`

Expected generated raw screenshot path examples:

- `apps/ios/docs/media/app-store-screenshots/iphone/en-US-1_review-card-front-app-store-opportunity-cost.png`
- `apps/ios/docs/media/app-store-screenshots/ipad/ar-4_review-card-ai-draft-app-store-opportunity-cost.png`
- `apps/ios/docs/media/app-store-screenshots/iphone/en-US-5_cards-list-app-store-vocabulary.png`

Expected generated derived marketing-material filenames:

- `<locale>-1-2-3-4-5-horizontal-dark-gray.png`

Expected generated derived marketing-material path examples:

- `apps/ios/docs/media/marketing-materials/iphone/en-US-1-2-3-4-5-horizontal-dark-gray.png`
- `apps/ios/docs/media/marketing-materials/ipad/es-ES-1-2-3-4-5-horizontal-dark-gray.png`

Do not reference a five-shot derived PNG from a README or other always-rendered document until that exact generated file exists in the repository.

## Prerequisites

Before running any screenshot script:

- start from the repository root
- boot exactly one local iOS simulator manually
- use `iPhone 14 Plus` for iPhone output or an iPad simulator for iPad output
- if multiple simulators are already booted, set `FLASHCARDS_IOS_SIMULATOR_ID`
- keep the simulator UI hidden while the generator runs; do not keep `Simulator.app` visible on screen during screenshot capture

These flows are manual on purpose:

- they are not part of default `xcodebuild test`
- they are not part of iOS CI
- they are not part of the release-gate smoke suite

Before running the derived marketing-material builder:

- install `ImageMagick` so `magick` is available
- install `pngquant` if you want the `visually-lossless` optimization mode
- keep using one booted simulator family if you want the builder to regenerate raw screenshots first

## Run supported scenarios

The supported wrapper generates all five PNGs from one seeded guest workspace run:

```bash
bash scripts/capture-ios-marketing-screenshots.sh
```

That one run writes:

- screenshot 1: review front
- screenshot 2: review result
- screenshot 3: progress
- screenshot 4: review AI draft
- screenshot 5: cards list

Run the unified scenario for a specific locale:

```bash
bash scripts/capture-ios-marketing-screenshots.sh --locale es-ES
```

Or use the environment variable instead:

```bash
FLASHCARDS_MARKETING_SCREENSHOT_LOCALE=zh-Hans bash scripts/capture-ios-marketing-screenshots.sh
```

## Generate all five screenshots for one locale

Use one locale explicitly and run the supported wrapper once:

```bash
bash scripts/capture-ios-marketing-screenshots.sh --locale es-ES
```

Or set the locale once in the environment:

```bash
export FLASHCARDS_MARKETING_SCREENSHOT_LOCALE=es-ES

bash scripts/capture-ios-marketing-screenshots.sh
```

## Build derived marketing materials

The derived-material builder is the wrapper that turns the five localized screenshots into one horizontal PNG on a dark-gray background.

Default behavior:

- locale scope defaults to all supported locales
- raw screenshot regeneration is enabled
- optimization mode defaults to `visually-lossless`
- output family is inferred from the currently booted simulator unless you pass `--skip-screenshots`, in which case `--family` becomes required

Run the full pipeline for every supported locale on the currently booted simulator family:

```bash
bash scripts/build-ios-marketing-materials.sh --all-locales
```

Build one locale only:

```bash
bash scripts/build-ios-marketing-materials.sh --locale es-ES
```

Reuse already generated raw screenshots and only rebuild the derived assets for the iPhone family:

```bash
bash scripts/build-ios-marketing-materials.sh --all-locales --skip-screenshots --family iphone
```

Use strict lossless PNG optimization instead of the higher-compression visually lossless mode:

```bash
bash scripts/build-ios-marketing-materials.sh --all-locales --optimization-mode lossless
```

Skip optimization entirely:

```bash
bash scripts/build-ios-marketing-materials.sh --all-locales --optimization-mode none
```

The builder intentionally keeps PNG as the output format. These assets are UI-heavy screenshots with text and sharp edges, so JPEG is not the default because it tends to introduce visible artifacts around text and thin UI lines.

## Generate for multiple locales

For a clean multi-locale run, keep one simulator family booted and loop through the locales:

```bash
for locale in en-US ar zh-Hans de hi ja ru es-MX es-ES; do
  bash scripts/capture-ios-marketing-screenshots.sh --locale "$locale"
done
```

If you need both iPhone and iPad assets, run the full locale loop twice:

1. once with one booted iPhone simulator
2. once with one booted iPad simulator

That keeps filenames predictable and ensures outputs land in the correct family folder.

If you also want the derived marketing-material outputs, prefer the dedicated wrapper instead of hand-rolling a second locale loop:

```bash
bash scripts/build-ios-marketing-materials.sh --all-locales
```

## Important constraints and caveats

- Only one booted simulator is allowed unless you set `FLASHCARDS_IOS_SIMULATOR_ID`.
- Device family is inferred from the simulator name, so the booted simulator directly controls whether output lands in `iphone/` or `ipad/`.
- Run screenshot wrappers sequentially, not in parallel. The current generator uses one shared runtime configuration file at `/tmp/flashcards-open-source-app-ios-marketing-screenshot-config.json`, so overlapping runs can make one flow skip or read the wrong configuration.
- Prefer running the generator without a visible simulator window. The wrappers do not require interactive simulator UI, and hiding `Simulator.app` avoids unnecessary rendering load on the local machine.
- The scripts expect every declared screenshot index to resolve to exactly one PNG after the XCUITest finishes and fail if a generated PNG is missing or ambiguous.
- Manual screenshot tests run only through the wrapper scripts because the wrapper writes the required runtime configuration file and also provides environment fallback values.
- Locale-specific content is deterministic and comes from the fixture files listed above. Update those files if the screenshot copy or seeded cards need to change.
- The derived marketing-material builder depends on the raw screenshot filename prefixes staying aligned with screenshots 1, 2, 3, 4, and 5.
- The `visually-lossless` optimization mode is not mathematically lossless. It is a high-quality palette reduction step intended to reduce PNG size aggressively while keeping UI screenshots visually unchanged in normal review.
- The `lossless` optimization mode keeps pixels unchanged but usually saves less space than `visually-lossless`.

## Pattern for future screenshot flows

Future marketing screenshot flows should keep the same shape:

1. Add one dedicated manual XCUITest entrypoint for the new surface.
2. Seed deterministic locale-aware data through the existing UI-test reset-state path.
3. Drive the UI only as far as needed for the exact marketing surface.
4. Save the PNG directly into `apps/ios/docs/media/app-store-screenshots/<family>/`.
5. Add one small wrapper in `scripts/` that calls `capture-ios-marketing-screenshot.sh` with the new test identifier and every expected screenshot index for that scenario.
6. If the new raw screenshots should also produce a derived composition, update `scripts/build-ios-marketing-materials.sh` and document the new output in this file.

That keeps the pipeline reviewable, deterministic, localized, and separate from the normal iOS smoke suite.
