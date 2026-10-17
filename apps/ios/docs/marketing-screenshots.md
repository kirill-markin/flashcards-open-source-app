# Apple Marketing Screenshots

This document explains native iOS and Mac Catalyst App Store capture and the derived iOS marketing-material builder.

The generator is a small manual pipeline built from:

- manual-only XCUITest entrypoints in `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/`
- one shared wrapper script, `scripts/ios/capture-ios-marketing-screenshot.sh`
- one supported unified five-shot wrapper in `scripts/ios/`
- one marketing-material wrapper in `scripts/ios/`
- deterministic localized fixture data used by both the UI tests and app-side UI-test seeding

It writes into the directories used for local App Store marketing PNG assets and derived marketing compositions, but it is not part of CI or release-gate validation.
This generator drives local iOS simulator-backed XCUITest flows and regenerates the local screenshot assets.

## What is included

The capture catalog supports 50 capture tags (49 languages): the 42 Store locales
plus `bg`, `et`, `fa`, `is`, `lt`, `lv`, `sw`, and `zu`. The expected raw
inventory is five screenshots per tag per captured device family: 250 iPhone PNGs
and 210 iPad PNGs, because the eight non-Store tags are captured on iPhone only.
The optional iPhone Duo inner family has 210 archived native PNGs for the 42
Store locales. The outer family has five archived English native PNGs; its
remaining locales have not been captured. Their capture provenance is in
the separate
[`duo-source-manifest.json`](media/app-store-cards/duo-source-manifest.json).
The complete Mac inventory and its provenance are recorded under
[Native Mac Catalyst capture](#native-mac-catalyst-capture).
The prepared inner cards have been uploaded to the iOS 1.33.0 listing for all
42 Store locales. The English outer cards have not been placed.

Each locale captures:

1. Review front state
2. Review revealed-answer state
3. Progress tab state
4. Review AI draft state
5. Cards list state

One unified scenario seeds one guest workspace from one locale fixture, writes the canonical 30-day-ish study-history pattern onto support cards, keeps the untouched opportunity-cost card at the top of Review and Cards, and captures screenshots 1, 2, 3, 4, and 5 in one supported run. The shared history pattern yields `currentStreakDays=12`, `hasReviewedToday=true`, and `activeReviewDays=16`.

The derived marketing-material flow then takes those five localized screenshots and builds one horizontal PNG per locale in the same order:

1. screenshot 1
2. screenshot 2
3. screenshot 3
4. screenshot 4
5. screenshot 5

All five screenshots sit on one dark-gray background with equal spacing between screenshots and all four outer edges.

## Files involved

Main scripts:

- `scripts/ios/capture-ios-marketing-screenshot.sh`
- `scripts/ios/capture-ios-marketing-screenshots.sh`
- `scripts/ios/build-ios-marketing-materials.sh`

Manual XCUITest entrypoints:

- `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingReviewScreenshotsTests.swift`
- `Flashcards Open Source App UI Tests/MarketingScreenshotsTests/testGenerateMarketingScreenshots`

Shared screenshot support:

- `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingManualScreenshotTestCase.swift`
- `apps/ios/Flashcards/FlashcardsUITests/MarketingScreenshots/MarketingScreenshotFixtures.swift`
- `apps/ios/Flashcards/Flashcards/Cloud/Store/UITestSupport/FlashcardsStore+CloudUITest.swift`

What each layer does:

- `capture-ios-marketing-screenshot.sh` resolves the locale, selects the already booted simulator, derives the device family, runs one `-only-testing` XCUITest target, and verifies that each expected screenshot index produced exactly one PNG.
- `capture-ios-marketing-screenshots.sh` runs the supported unified marketing scenario and verifies screenshots 1, 2, 3, 4, and 5 in one pass.
- `build-ios-marketing-materials.sh` can regenerate raw localized screenshots, compose the horizontal derived PNGs, and optimize the final files.
- `MarketingManualScreenshotTestCase.swift` gates these tests behind the wrapper-provided runtime configuration, falls back to the launch environment only if that file is absent, and writes the PNG file.
- `MarketingScreenshotFixtures.swift` holds the test-side locale catalog (`MarketingScreenshotLocaleCatalog`): the supported locale list, the locale alias map, and the localized fixture card text. The generated output filenames come from the `MarketingScreenshotLocaleFixture` file-name properties and the screenshot slug constants on `MarketingScreenshotFixture`.
- `FlashcardsStore+CloudUITest.swift` holds the app-side mirror of that catalog (`FlashcardsUITestMarketingFixtures`), seeds the localized UI-test content used by the screenshot flows, and defines the dedicated guest-session cleanup launch scenario used at the end of each manual test.

Keep locale codes, aliases, and shared seeded card text and tags identical in the
two Swift catalogs. The unsent AI drafts belong only to the test-side catalog.
The shell layer also owns locale maps: `capture-ios-marketing-screenshot.sh`
has `supported_locales`, `iphone_only_locales`, and `canonicalize_locale`, and
`build-ios-marketing-materials.sh` has another `canonicalize_locale`.

Add every capture tag to both Swift catalogs, to `supported_locales`, and to both
`canonicalize_locale` maps in the same change. Add it to `iphone_only_locales` if
and only if Apple has no listing locale for it, in which case it must stay out of
the uploader's
[locale mapping](../../../scripts/ios/app-store-localization-inputs.mts); every
other tag belongs in that map. Store IDs differ from some capture tags. Missing
shell support fails argument validation; missing app-side support fails fixture
seeding before the first screenshot.

## Guest cloud cleanup lifecycle

The manual screenshot flows treat guest cloud sessions as short-lived per-run fixtures:

- before each marketing screenshot bootstrap, the wrapper runs a dedicated cleanup XCUITest entrypoint that relaunches the app, deletes any stored guest session remotely through `POST /guest-auth/session/delete`, and performs the existing local identity reset
- after each manual screenshot test, XCTest still relaunches the app in the same dedicated cleanup scenario and waits for the UI-test readiness marker before finishing teardown
- the wrapper also registers an exit trap that runs the dedicated cleanup XCUITest entrypoint after `xcodebuild` exits, including failure exits, before it removes the runtime configuration file
- capture writes to a fresh staging directory under `tmp/`; the wrapper publishes the expected PNGs only after the full capture, output verification, final guest cleanup, and runtime configuration removal succeed, preserving the previous locale PNGs if any of those steps fail
- for Duo only, the wrapper starts a host `simctl` screenshot service after initial cleanup; each test screenshot waits for its matching full native display frame before advancing, and the wrapper stops the service before final cleanup
- the cleanup relaunch clears the final guest session remotely and then runs the same local reset path, so both cloud and local screenshot state are removed predictably

This is why the screenshot wrappers must still run sequentially. The cleanup relaunch is part of the supported lifecycle, not an optional background best effort.

## Supported locales

The canonical list is the `supported_locales` array in
[capture-ios-marketing-screenshot.sh](../../../scripts/ios/capture-ios-marketing-screenshot.sh).
Use `--list-locales` below instead of copying a fixed list into capture loops.
`en-US` is the default and the only capture tag that differs from its iOS bundle
tag (`en`). Norwegian captures use `nb`; both Spanish regions remain separate.
Eight tags have no App Store listing locale: `bg`, `et`, `fa`, `is`, `lt`, `lv`,
`sw`, and `zu`. They are declared in the `iphone_only_locales` array of the same
script, feed website marketing assets, and are never upload inputs; see the
[locale mapping](../../../docs/app-store-connect-metadata.md). The iPad tag set is
the canonical list minus those eight, so iPad capture loops use
`--list-ipad-locales` and the derived-material builder subtracts them whenever the
resolved family is `ipad`, `iphone-duo-outer`, or `iphone-duo-inner`.

Store aliases use the
[App Store locale map](../../../docs/app-store-connect-metadata.md): for example
`ar-SA` becomes `ar`, `bn-BD` becomes `bn`, and `no` becomes `nb`. Both shell
canonicalizers also accept these non-Store aliases:

| Input | Canonical capture tag |
| --- | --- |
| `en` | `en-US` |
| `zh-CN` | `zh-Hans` |
| `hi-IN` | `hi` |
| `ja-JP` | `ja` |
| `pt` | `pt-BR` |
| `ru-RU` | `ru` |
| `es-419` | `es-MX` |

How locale selection works:

1. `--locale <code>` wins if you pass it.
2. Otherwise `FLASHCARDS_MARKETING_SCREENSHOT_LOCALE` is used if set.
3. Otherwise the generator falls back to `en-US`.

List the canonical locale codes with:

```bash
bash scripts/ios/capture-ios-marketing-screenshot.sh --list-locales
```

List the iPad subset with:

```bash
bash scripts/ios/capture-ios-marketing-screenshot.sh --list-ipad-locales
```

If you pass an unsupported locale or alias, the wrapper exits with an error before running XCUITest.

## Device family and Duo display selection

The capture generator does not have a `--family` flag.

It derives the output family from the one already booted simulator:

- simulator name contains `iPhone` -> writes into `iphone/`
- simulator name contains `iPad` -> writes into `ipad/`, except for an iPhone-only tag from [Supported locales](#supported-locales), which fails before anything is written
- simulator name contains both `iPhone` and `Duo` -> requires `--duo-display outer|inner` and writes into `iphone-duo-outer/` or `iphone-duo-inner/`; an iPhone-only tag is refused

This means:

- boot `iPhone 14 Plus` if you want iPhone screenshots
- boot `iPad Pro 13-inch (M5)` for the iPad App Store set
- if more than one simulator is booted, set `FLASHCARDS_IOS_SIMULATOR_ID=<device-uuid>`

The scripts do not boot or switch simulators for you. They only resolve a booted simulator, wait for `bootstatus`, and run the selected manual test.

Use these canonical targets for App Store assets:

| Family | Simulator | Capture pixels | Upload display slot |
| --- | --- | --- | --- |
| iPhone | `iPhone 14 Plus` | `1284 × 2778` | `APP_IPHONE_65` |
| iPad | `iPad Pro 13-inch (M5)` | `2752 × 2064` landscape | `APP_IPAD_PRO_3GEN_129` |
| iPhone Duo outer | `iPhone Duo` with outer display selected | `1398 × 2034` portrait | Duo outer display |
| iPhone Duo inner | `iPhone Duo` with inner display selected | `2853 × 2007` landscape | Duo inner display |

The Duo capture wrapper checks every staged PNG against the selected display's
native pixel dimensions before guest cleanup can publish it. A wrong pose or
display fails while previously published screenshots stay in place. The
horizontal builder applies the same dimension check to saved Duo raw inputs.
The ordinary iPhone and iPad capture paths and output folders remain separate.

The uploader also accepts `2048 × 2732` portrait and `2732 × 2048` landscape iPad PNGs, matching [Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications). Keep every image opaque: no
alpha channel or PNG `tRNS` chunk, even if it looks opaque on screen. Inspect
exported files before upload; use the
[upload procedure](../../../docs/app-store-connect-metadata.md) for preflight and
recovery. Do not change the canonical capture device without updating this policy.

## Output paths and filenames

Final outputs are published into:

- `apps/ios/docs/media/app-store-screenshots/iphone/`
- `apps/ios/docs/media/app-store-screenshots/ipad/`
- `apps/ios/docs/media/app-store-screenshots/iphone-duo-outer/`
- `apps/ios/docs/media/app-store-screenshots/iphone-duo-inner/`
- `apps/ios/docs/media/marketing-materials/iphone/`
- `apps/ios/docs/media/marketing-materials/ipad/`
- `apps/ios/docs/media/marketing-materials/iphone-duo-outer/`
- `apps/ios/docs/media/marketing-materials/iphone-duo-inner/`

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
- use the canonical simulator for the selected family from the table above
- for Duo, use Xcode 27.1 or newer with the iPhone Duo simulator installed;
  select the outer or inner display in Device Hub before the matching command
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
bash scripts/ios/capture-ios-marketing-screenshots.sh
```

That one run writes:

- screenshot 1: review front
- screenshot 2: review result
- screenshot 3: progress
- screenshot 4: review AI draft
- screenshot 5: cards list

Run the unified scenario for a specific locale:

```bash
bash scripts/ios/capture-ios-marketing-screenshots.sh --locale es-ES
```

Capture orientation is landscape on iPad and Duo inner, portrait on ordinary
iPhone and Duo outer. `--orientation` or
`FLASHCARDS_MARKETING_SCREENSHOT_ORIENTATION` may declare the required orientation;
the CLI option wins. iPad and Duo inner refuse portrait. Ordinary iPhone and
Duo outer refuse landscape. Each capture
asserts the requested orientation before publishing; do not rotate exported
portrait pixels. For a local filesystem that adds signing resource forks, set
`FLASHCARDS_IOS_DERIVED_DATA_PATH` to an unsynced DerivedData path while retaining
the pinned packages.

Capture the two Duo displays sequentially after selecting each one in Device
Hub. Xcode 27.1 or newer must expose exactly one integrated screen with the
selected display's native pixel size through `simctl io enumerate`. The host
captures that screen with public `simctl io screenshot --display`; missing or
ambiguous displays and undersized frames fail the run. These commands reuse
the existing five scenarios and guest cleanup:

```bash
bash scripts/ios/capture-ios-marketing-screenshots.sh --locale en-US --duo-display outer
# Select the inner display in Device Hub before the next command.
bash scripts/ios/capture-ios-marketing-screenshots.sh --locale en-US --duo-display inner
```

For all Duo Store locales, use `--list-ipad-locales` for the locale loop and
pass the same `--duo-display` on every invocation. No command currently switches
the Duo pose automatically. The English outer and inner captures used the iOS
27.1 iPhone Duo simulator; physical Duo behavior remains unverified.

For a sequential bulk capture from frozen sources, first run one locale with
the default `test` action to build and validate the current app and test runner.
Subsequent runs can use `FLASHCARDS_IOS_MARKETING_TEST_WITHOUT_BUILDING=1` with
the same simulator and DerivedData. They still run every capture and cleanup
test; the shared runtime configuration selects each locale. Remove the flag
and rebuild after any application or test-source change.

```bash
bash scripts/ios/capture-ios-marketing-screenshots.sh --locale en-US --orientation landscape
```

Or use the environment variable instead:

```bash
FLASHCARDS_MARKETING_SCREENSHOT_LOCALE=zh-Hans bash scripts/ios/capture-ios-marketing-screenshots.sh
```

## Build derived marketing materials

### Separate store-card processing

The approved orange/yellow store cards have their own independent
[processing flow](../../../docs/store-screenshot-processing.md).
[`render-ios.mts`](../../../scripts/store-screenshots/render-ios.mts) holds the
supported native dimensions (`nativeDimensions`) and frames. It reads saved native
PNGs and writes `apps/ios/docs/media/app-store-cards/`, without invoking
XCUITest, guest cleanup, this horizontal builder, or store upload:

```bash
npm run render --prefix scripts/store-screenshots -- --platform ios
```

Approved outputs in `app-store-cards/` are ignored public release assets.
Download inputs with `python3 scripts/media/download.py ios-native` from the
repository root; see [Media assets](../../../docs/media-assets.md). For the
finished inventory, upload status and reviewed refresh procedure, use the
[processing guide](../../../docs/store-screenshot-processing.md#approved-delivery).

Install the processor dependencies once using its
[README](../../../scripts/store-screenshots/README.md). Native capture and
card processing are separate commands; run capture first only when new original
screenshots are needed.

### Existing horizontal-material builder

The derived-material builder is the wrapper that turns the five localized screenshots into one horizontal PNG on a dark-gray background.

Default behavior:

- locale scope defaults to every capture tag of the resolved family, and the iPad family excludes the iPhone-only capture tags
- raw screenshot regeneration is enabled
- optimization mode defaults to `visually-lossless`
- output family is inferred from the currently booted simulator unless you pass `--skip-screenshots`, in which case `--family` becomes required
- Duo material builds require `--skip-screenshots`, `--duo-display outer|inner`,
  and the matching `--family iphone-duo-outer|iphone-duo-inner`. Capture the
  native PNGs with the separate capture wrapper first

Run the full pipeline for every capture tag of the currently booted simulator family:

```bash
bash scripts/ios/build-ios-marketing-materials.sh --all-locales
```

Build one locale only:

```bash
bash scripts/ios/build-ios-marketing-materials.sh --locale es-ES
```

Reuse already generated raw screenshots and only rebuild the derived assets for the iPhone family:

```bash
bash scripts/ios/build-ios-marketing-materials.sh --all-locales --skip-screenshots --family iphone
```

After genuine Duo raw captures exist, build a display's horizontal material
independently, for example:

```bash
bash scripts/ios/build-ios-marketing-materials.sh --locale en-US --skip-screenshots --family iphone-duo-inner --duo-display inner
```

Use strict lossless PNG optimization instead of the higher-compression visually lossless mode:

```bash
bash scripts/ios/build-ios-marketing-materials.sh --all-locales --optimization-mode lossless
```

Skip optimization entirely:

```bash
bash scripts/ios/build-ios-marketing-materials.sh --all-locales --optimization-mode none
```

The builder intentionally keeps PNG as the output format. These assets are UI-heavy screenshots with text and sharp edges, so JPEG is not the default because it tends to introduce visible artifacts around text and thin UI lines.

## Generate for multiple locales

Before a bulk capture, generate representative English, RTL, and long-translation
sets on both canonical device families. Visually inspect them using the checklist
below and resolve any issues before starting the full locale loops.

For a clean multi-locale run, keep one simulator family booted and loop through the locales:

```bash
capture_locales="$(bash scripts/ios/capture-ios-marketing-screenshot.sh --list-locales)" || exit 1
while IFS= read -r locale; do
  bash scripts/ios/capture-ios-marketing-screenshots.sh --locale "$locale" || exit 1
done <<< "$capture_locales"
```

If you need both iPhone and iPad assets, run the full locale loop twice:

1. once with the canonical iPhone simulator selected
2. once with the canonical iPad simulator selected and `--list-locales` replaced
   by `--list-ipad-locales`, so the iPhone-only tags stay out of `ipad/`. A
   forgotten substitution is not silent: the capture script refuses an
   iPhone-only tag on a booted iPad before it writes anything

Inspect all five images per locale in each family for untranslated copy, clipping,
RTL layout, and the expected screen state. Include runtime-generated labels such
as the AI card-attachment chip; catalog parity cannot catch hardcoded English
outside the catalogs. Keep capture queries on stable accessibility IDs. For the
attached card, the current fixture checks one chip and the exact card-text suffix
without assuming its localized prefix is English. Foundation can wrap formatted
snippets in FSI (`U+2068`) and PDI (`U+2069`); the fixture accepts the exact plain
suffix or that exact isolated form. Preserve those controls in production
rendering and user content. Inspect the translated prefix and the
[iOS viewport requirements](../../../docs/ios-localization.md#manual-runtime-validation)
visually; a hittable element can still extend beyond the screen.
Do not infer capture freshness from fixture coverage or a successful build.
Record the source SHA and completed locale/family inventory with the delivery evidence. If a capture exposes a code
or translation defect, stop at the wrapper's cleanup boundary, preserve the
failure evidence, deliver the scoped repair, then regenerate affected assets
from the final capture revision before treating the inventory as complete.

If you also want the derived marketing-material outputs, prefer the dedicated wrapper instead of hand-rolling a second locale loop:

```bash
bash scripts/ios/build-ios-marketing-materials.sh --all-locales
```

## Important constraints and caveats

- Only one booted simulator is allowed unless you set `FLASHCARDS_IOS_SIMULATOR_ID`.
- Capture registers real guest installations against the deployed backend. The XCUITest launch marks
  them as automation so they never become product analytics; see the automation marker section of
  [`docs/ios-ci-cd.md`](../../../docs/ios-ci-cd.md#automation-marker).
- Device family is inferred from the simulator name, so the booted simulator directly controls whether output lands in `iphone/` or `ipad/`.
- Preserve `rootTab.*.item` accessibility IDs and query them across native containers: iPhone tabs are in a `TabBar`, while iPad top-tab buttons can be under `Other` containers.
- Run screenshot wrappers sequentially, not in parallel. The current generator uses one shared runtime configuration file at `/tmp/flashcards-open-source-app-ios-marketing-screenshot-config.json`, so overlapping runs can make one flow skip or read the wrong configuration.
- Prefer running the generator without a visible simulator window. The wrappers do not require interactive simulator UI, and hiding `Simulator.app` avoids unnecessary rendering load on the local machine.
- The scripts expect every declared screenshot index to resolve to exactly one PNG after the XCUITest finishes and fail if a generated PNG is missing or ambiguous.
- Manual screenshot tests run only through the wrapper scripts because the wrapper writes the required runtime configuration file and also provides environment fallback values.
- Locale-specific content is deterministic and comes from the fixture files listed above. Update those files if the screenshot copy or seeded cards need to change.
- The AI screenshot launch passes the existing localized fixture text into the real unsent composer after the review-card handoff completes. Only this marketing fixture leaves the composer unfocused; capture asserts the exact draft, attached review card, and absence of messages, keyboard, and overlays without typing or opening keyboard onboarding.
- The derived marketing-material builder depends on the raw screenshot filename prefixes staying aligned with screenshots 1, 2, 3, 4, and 5.
- The `visually-lossless` optimization mode is not mathematically lossless. It is a high-quality palette reduction step intended to reduce PNG size aggressively while keeping UI screenshots visually unchanged in normal review.
- The `lossless` optimization mode keeps pixels unchanged but usually saves less space than `visually-lossless`.

## Pattern for future screenshot flows

Future marketing screenshot flows should keep the same shape:

1. Add one dedicated manual XCUITest entrypoint for the new surface.
2. Seed deterministic locale-aware data through the existing UI-test reset-state path.
3. Drive the UI only as far as needed for the exact marketing surface.
4. Save the PNG through `captureMarketingScreenshotAndAssertWritten` into the wrapper-provided staging directory; the wrapper publishes it into `apps/ios/docs/media/app-store-screenshots/<family>/` after capture and cleanup succeed.
5. Add one small wrapper in `scripts/ios/` that calls `capture-ios-marketing-screenshot.sh` with the new test identifier and every expected screenshot index for that scenario.
6. If the new raw screenshots should also produce a derived composition, update `scripts/ios/build-ios-marketing-materials.sh` and document the new output in this file.

That keeps the pipeline reviewable, deterministic, localized, and separate from the normal iOS smoke suite.

## Native Mac Catalyst capture

Mac capture uses the same five localized fixtures and genuine product screens,
with native filename indices 1 front, 2 answer, 3 progress, 4 AI draft, 5 cards.
The independent [store-card processor](../../../docs/store-screenshot-processing.md)
orders the cards as 4, 1, 2, 3, 5. Capture never processes or uploads images.
The complete 42-locale inventory is saved in
`media/app-store-screenshots/macos/`: five opaque RGB 1440 × 900 native windows
per locale, captured on 2026-10-12 from
`4fb044b41043b4c0344ef6763253f8e3d2c0bb0f`. All originals and corresponding
landscape store cards were visually inspected. The separate
[`macos-source-manifest.json`](media/app-store-cards/macos-source-manifest.json)
records the genuine capture-only build identity, toolchain and original hashes;
the [processing guide](../../../docs/store-screenshot-processing.md#approved-delivery)
owns decorated inventory and upload status.

Prepare the gitignored `Config/Local.xcconfig` with the service values from
[local setup](../../../docs/ios-local-setup.md). Follow the
[signed Mac prerequisites](../../../docs/macos-ci-cd.md#signed-local-native-alternative)
with a separately registered `com.flashcards-open-source-app.app.marketing-capture`
identifier and genuine matching development profile. The external signing
xcconfig must override `APP_BUNDLE_IDENTIFIER`, `DEVELOPMENT_TEAM` and
`CODE_SIGN_IDENTITY = Apple Development`, assigning the capture app profile only
to the `Flashcards` module. This external override takes precedence over Debug's
ordinary `.development` identity; keep the capture profile matched to the capture ID.
Keep production target settings unchanged. The
wrapper checks the built bundle, its signature, both private app identities and
the registered Mac before any guest reset. It refuses the production bundle;
its container and pending outbox are never capture inputs.

Run from the repository root on an unlocked Mac with a display large enough for
the complete app window. Do not interact with that window while XCTest drives it:

```bash
bash scripts/ios/capture-macos-marketing-screenshots.sh \
  --signing-xcconfig /absolute/path/mac-capture-signing.xcconfig \
  --mac-id <registered-mac-id> --locale en-US
```

`--list-locales` prints the existing 42 Store capture tags; `--locale` accepts a
capture tag or its Store locale ID. `--all-locales` captures them sequentially
using one build. `--skip-build` reuses the original generated `.xctestrun` only
when application/test sources and signing inputs remain unchanged. Rebuild after
any change. Mac products use `tmp/macos-marketing-derived-data`; an unsynced
alternative may be supplied through `FLASHCARDS_MACOS_MARKETING_DERIVED_DATA_PATH`.

The default native window size is 1440 × 900 pixels. `--size` also accepts
1280x800, 2560x1600 and 2880x1800. Public XCTest mouse drags resize the genuine
Catalyst window before each scenario launch; capture reads the native window element’s `screenshot()`.
Every exported PNG must contain the complete window at exactly the requested
size, with opaque native pixels and no desktop. The wrapper fails on a size
mismatch; it never stretches, crops or substitutes an iPad image.

Outputs publish to `apps/ios/docs/media/app-store-screenshots/macos/`, using
`<locale>-<index>_<slug>.png`. For an untracked pilot use
`--output-directory /absolute/tmp/path`. Each locale stages under
`tmp/macos-marketing-capture.*`. The sandboxed UI runner writes native opaque
PNGs into its own temporary directory, records them as named XCTest attachments
and removes those private temporary files. The wrapper exports the five PNGs
with `xcresulttool`, runs guest cleanup before and after capture, checks all five
PNGs and removes runtime configuration before publishing. An
exit trap retries pending cleanup after failures. Existing locale originals
remain untouched on capture, verification or cleanup failure. Staging and
`.xcresult` bundles are retained there as evidence, including failed runs.

Mac runtime configuration lives at
`/tmp/flashcards-open-source-app-macos-marketing-screenshot-config.json`, with a
capture lock beside it. It is independent of the iOS/Duo runtime file. Capture
only one Mac sequence at a time; a stale lock requires checking that its previous
run has ended before removal. Native Mac capture is manual and excluded from
ordinary CI, unrelated smoke selections, release and store upload.
