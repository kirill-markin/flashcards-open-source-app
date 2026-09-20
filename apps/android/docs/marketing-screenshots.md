# Android Marketing Screenshots

This document tracks repeatable Android screenshot scripts for marketing assets.

For the operational capture procedure, clean-emulator workflow, and verification checklist, use [`marketing-screenshot-runbook.md`](marketing-screenshot-runbook.md).

The existing locale configurations live in `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/marketing/screenshots/MarketingScreenshotCatalog.kt`; additional locales use the JSON packs described below.
Screenshot-only translated app resources belong in `apps/android/app/src/marketingScreenshot/res` and are packaged only in the dedicated `marketingScreenshot` build type used by the wrapper scripts.

## Current inventory

There is currently one supported Android manual capture flow and five expected generated output PNG targets.
Existing repository media can still contain the previous split-run assets or older cards-list numbering until the unified generator is run and the regenerated PNGs are reviewed.

The Kotlin screenshot catalog defines these locale prefixes:

- `en`
- `en-US`
- `ar`
- `zh-CN`
- `fr-FR`
- `de-DE`
- `hi-IN`
- `ja-JP`
- `pt-BR`
- `ru-RU`
- `es-419`
- `es-ES`
- `es-US`

The unified screenshot flow captures an exam-prep concept card about opportunity cost and the seeded study history in five store states:

- front-only before answer reveal
- revealed answer with the rating buttons visible
- progress screen with one deterministic 30-day-ish review history, `streakDays = 8`, `hasReviewedToday = true`, and `activeReviewDays = 16`
- AI handoff screen with the handed-off card attached plus an unsent draft request
- cards list with the shared opportunity-cost prompt pinned to the top

- Manual screenshot entrypoint: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/marketing/screenshots/MarketingAllScreenshotsScript.kt`
- Manual guest cleanup entrypoint: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/marketing/screenshots/MarketingScreenshotGuestCleanupScript.kt`
- Shared screenshot helpers: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/marketing/screenshots/MarketingScreenshotTestSupport.kt`
- Supported manual wrapper script: `scripts/android/capture-android-marketing-screenshots.sh`
- Expected generated output PNG targets:
  - `apps/android/docs/media/play-store-screenshots/en-1_review-card-front-google-play-opportunity-cost.png`
  - `apps/android/docs/media/play-store-screenshots/en-2_review-card-result-google-play-opportunity-cost.png`
  - `apps/android/docs/media/play-store-screenshots/en-3_progress-google-play-study-history.png`
  - `apps/android/docs/media/play-store-screenshots/en-4_review-card-ai-draft-google-play-opportunity-cost.png`
  - `apps/android/docs/media/play-store-screenshots/en-5_cards-list-google-play-vocabulary.png`

## Run the flow

Prerequisites:

- Start a local Android emulator or device on API 37.
- For a local headless emulator, prefer `emulator @Medium_Phone_API_37.0 -no-window -no-audio -gpu auto`.
- Run from the repository root.

Command:

```bash
bash scripts/android/capture-android-marketing-screenshots.sh
```

To target a configured locale other than the default `en`, set `FLASHCARDS_MARKETING_LOCALE_PREFIX` for the wrapper run:

```bash
FLASHCARDS_MARKETING_LOCALE_PREFIX=de-DE bash scripts/android/capture-android-marketing-screenshots.sh
```

These scripts are not part of Android CI, release gates, or default `androidTest` runs.
They exist only to generate marketing screenshots on demand.
They run `:app:connectedMarketingScreenshotAndroidTest`, not the normal debug instrumentation task, so screenshot-only translations do not affect the Play-first `debug` and `release` builds.
The wrapper verifies initial guest cleanup, capture, and final guest cleanup separately using fresh AGP test reports. It publishes the staged PNGs only after all three stages pass and attempts cleanup from an exit trap on failure. Keep the emulator’s owning session alive until the wrapper has exited; follow the [runbook](marketing-screenshot-runbook.md) for result evidence and shutdown sequencing.
The screenshot reset flow remains as an in-test defense: it deletes the guest cloud session remotely before it clears local screenshot state so the seeded guest workspace does not remain on the backend after the run.

The unified wrapper script runs one manual-only entrypoint, seeds one guest workspace, saves screenshots 1, 2, 3, 4, and 5 into `/sdcard/Download/flashcards-marketing-screenshots/`, and then pulls those files into the committed marketing media directory.

## JSON locale packs

Additional Play locales load UTF-8 fixtures from
`apps/android/app/src/androidTest/assets/marketing-locales/<Play-code>.json`.
`MarketingScreenshotLocaleLoader.kt` lists accepted Play codes and their exact
`appLocaleTag` mappings. Existing Kotlin configurations take precedence; the
default remains `en`. A requested pack that is missing or malformed fails capture.

Each fixture is an object with these required fields. Strings must be nonblank;
arrays must be nonempty. Unrelated extra fields are ignored.

| Field | Value |
| --- | --- |
| `localePrefix` | Exact Play code used in the filename and wrapper argument |
| `appLocaleTag` | Generic app language from the loader mapping, such as `bn`, `he`, or `id` |
| `uiText` | Object with all 16 string fields from `MarketingScreenshotUiText` in the catalog |
| `reviewCard` | Object with `frontText`, `backText`, and a string array `tags` |
| `reviewAiDraftMessage` | Unsent AI request text |
| `cards` | Array of objects with `frontText`, `backText`, and `subjectTag` |

Keep the seven concept cards in the existing scenario order.
`cards[0].frontText` must exactly match `reviewCard.frontText`, later cards must
not repeat that prompt, and `reviewCard.tags` must equal
`[cards[0].subjectTag]`. Prompts belong on the front and answers on the back.

Each new pack also needs translated UI overlays in
`apps/android/app/src/marketingScreenshot/res/values-<appLocaleTag>/strings.xml`.
Use Android's `values-iw` for Hebrew and `values-in` for Indonesian; Norwegian
uses `values-no`. Keep UI labels consistent with the fixture. Generic screenshot
language filters and their Android aliases are retained by
`app/build.gradle.kts` only when a marketing screenshot task is requested.
These packs and overlays do not change shipping translations or the advertised
app language list.

## Pattern for future flows

Future marketing screenshot flows should follow the same structure:

1. Add a dedicated manual screenshot entrypoint that creates or prepares the required in-app state.
2. Drive the UI to the exact screen that marketing needs.
3. Save the screenshot PNG or PNGs into `/sdcard/Download/flashcards-marketing-screenshots/` from instrumentation.
4. Add a small shell wrapper in `scripts/android/` that runs just that manual entrypoint and pulls the generated PNG file or files into `apps/android/docs/media/play-store-screenshots/`.

This keeps screenshot generation deterministic, reviewable, runnable without manual emulator interaction, and fully separate from the normal Android test suite and shipping Play-first localization flow.
