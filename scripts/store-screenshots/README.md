# Store screenshot processing

An independent post-processing flow for **already generated** native screenshots.
It adds Nibomo's approved store-card backgrounds and localized marketing copy,
checks the layout, and writes five portrait cards plus a review gallery into a
new adjacent directory. It never calls screenshot capture, simulators, emulators,
guest-session APIs, image-generation services, or store upload commands.

Read the complete [design and processing guide](../../docs/store-screenshot-processing.md)
before changing the layout or translations.

## Install once

Use the repository's Node version (`.nvmrc`; Node 22.18+ is required) and macOS
with Arial and the system fonts for the supported scripts. The approved outputs
were rendered on macOS; other operating systems can produce different glyphs
and text measurements. The renderer checks the actual layout and rejects missing
heading glyphs instead of silently resizing a title.

```bash
npm ci --prefix scripts/store-screenshots
cd scripts/store-screenshots
npx playwright install chromium
cd ../..
```

The lockfile pins Playwright, Chromium's package revision, Sharp, and the checking
tools. `--chromium-executable '/absolute/path/to/Chromium'` explicitly selects an
already installed browser; it is optional and does not control existing tabs.

## Run after native capture

```bash
# Process every configured existing iPhone, iPad and Android phone set.
npm run render --prefix scripts/store-screenshots

# Process selected iPhone sets only.
npm run render --prefix scripts/store-screenshots -- \
  --platform ios --family iphone --locales en-US,ar,ru

# Process an existing iPad set without needing any iPhone captures.
npm run render --prefix scripts/store-screenshots -- \
  --platform ios --family ipad --locales en-US

# Process selected existing Android phone sets.
npm run render --prefix scripts/store-screenshots -- \
  --platform android --locales en-US,ar,ru-RU

# Check text, fonts, margins and geometry without writing derived files.
npm run render --prefix scripts/store-screenshots -- \
  --platform ios --locales en-US,ar --check-layout
```

Leave the existing capture commands as separate operations. This command has no
option that runs capture, and does not invoke the older iOS horizontal-material
builder (which can regenerate native captures).

## Inputs and outputs

| Platform | Existing native input | New derived output |
| --- | --- | --- |
| iOS | `apps/ios/docs/media/app-store-screenshots/` | `apps/ios/docs/media/app-store-cards/` |
| Android | `apps/android/docs/media/play-store-screenshots/` | `apps/android/docs/media/play-store-cards/` |

Open `index.html` in either output directory to review available languages and
devices. `previews/` contains five-card overviews. Full cards are under:

- iOS Store locales: `ready/iphone/<capture-tag>-<card>_<slug>.png` and
  `ready/ipad/<capture-tag>-<card>_<slug>.png`.
- Additional iPhone languages: `additional-languages/iphone/`.
- Android: `ready/<Play-listing-locale>/phoneScreenshots/<card>_<slug>.png`.

Derived output folders are Git-ignored; approved templates and copy are tracked.
The independent **Process Store Screenshots** GitHub Actions workflow processes
the committed native inputs and saves the derived folders as an artifact. It
runs only on manual dispatch, not inside capture, native builds, or releases.
It has read-only repository permissions and performs no publication.

Missing or ambiguous native PNGs are an error. All selected screenshots are
rendered into a temporary staging directory before any new card is published.
An input/layout/render failure leaves the previous card files unchanged. The
staging directory is removed on completion or failure. Disk errors while copying
the validated results are reported explicitly; multi-file publication is not a
filesystem transaction.

Selected reruns replace those files in `export-manifest.json` and retain other
previously rendered sets. The gallery rechecks every retained image checksum
and copy pair. After changing shared design or copy, rerender the affected sets;
inconsistent Android font settings or stale copy fail gallery validation.

## Options and checks

- `--platform all|ios|android`: defaults to all.
- `--family all|iphone|ipad`: selects iOS families; Android supports phones only.
- `--locales <comma-separated IDs>`: capture tags or matching listing IDs. An
  unknown or empty identifier is an error, and aliases are resolved from the
  tracked mapping rather than guessed.
- `--input-root` and `--output-root`: directory overrides for one platform.
  Relative paths resolve from the repository root. Input/output trees must be
  separate, including existing symlink aliases.
- `--verify-existing`: iOS only; reuse an existing encoded PNG only when its
  decoded pixels equal the freshly rendered image.
- `--check-layout`: validate without writing cards, manifests, or galleries.

```bash
npm run check --prefix scripts/store-screenshots
npm run smoke --prefix scripts/store-screenshots
```

The smoke flow exercises the actual command, saved native inputs, Chromium,
PNG exports and interactive galleries in temporary directories. It checks
source immutability, selected/incremental device sets, missing-input preservation
of existing output, and refusal to write into a raw-input tree. It does not run
or alter either native app.

`export-manifest.json` records exact source/output SHA-256 hashes, source names,
locale/device mapping, dimensions, typography and measured bounds. Its
`sourceRevision` is the processing checkout revision, **not evidence of a fresh
native capture**. Font reports describe the current rendering invocation.

## Files

- `render.mts`: platform/locale selection and orchestration of processing only.
- `render-ios.mts`, `render-android.mts`: the transferred approved layouts and
  rendering checks, adapted to app-repository inputs and adjacent outputs.
- `package-ios.mts`, `package-android.mts`: checksums, overviews and galleries.
- `output.mts`: source/output separation and incremental manifest merging.
- `assets/`: approved backgrounds, references, copy, listing maps, language labels,
  exact historical image-editing prompts and three five-card visual baselines.

Feature-graphic generation remains in its existing Android flow. This processor
does not require or regenerate banners. Native Android tablet captures are not
available in the current inventory; no phone/iPad files are relabeled as tablets.
