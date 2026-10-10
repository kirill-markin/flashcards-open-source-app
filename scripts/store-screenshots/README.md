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

## Manual refresh after native capture

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

Supported native input dimensions and the fixed portrait output geometry are in
the [format profiles](../../docs/store-screenshot-processing.md#format-profiles).
Both portrait and landscape iPad captures keep their complete native proportions
inside the same approved frame.

Open `index.html` in either output directory to review available languages and
devices. `previews/` contains five-card overviews. Full cards are under:

- iOS Store locales: `ready/iphone/<capture-tag>-<card>_<slug>.png` and
  `ready/ipad/<capture-tag>-<card>_<slug>.png`.
- Additional iPhone languages: `additional-languages/iphone/`.
- Android: `ready/<Play-listing-locale>/phoneScreenshots/<card>_<slug>.png`.

Both output directories are ordinary tracked Git files. The approved inventory
contains 460 iOS cards (210 iPhone Store cards, 210 prepared iPad cards and 40
additional-language iPhone cards) and 255 Android phone cards. Store-upload status
and original delivery provenance are recorded in the
[processing guide](../../docs/store-screenshot-processing.md#tracked-approved-delivery).

The independent **Process Store Screenshots** GitHub Actions workflow runs for
processor, native-input and finished-output pull requests, and on manual dispatch.
It typechecks the processor, runs the real export/gallery smoke, and renders the
selected current committed native sources into runner-temporary directories.
Pull requests render every configured set. Its **Format existing native captures**
check must succeed before merging these changes. It saves the candidate output as
an artifact, has read-only repository permissions and performs no publication.
Native capture/build/release workflows remain separate.

For a refresh, manually dispatch the workflow on the intended source revision.
Use platform/family selection and optional comma-separated locales to review a
candidate subset. To replace a platform delivery, render that platform with
family `all` and empty locales so its export manifest and gallery cover the full
inventory. Download its artifact, review all five full-size cards and previews
for each changed set, and copy the approved complete platform output into the
corresponding tracked output directory. A subset artifact is not a complete
replacement manifest or gallery. Retain original delivery source/export manifests
as provenance before replacing export metadata; commit reviewed PNGs, export
metadata and gallery changes together. Keep native capture provenance separate
from the processing checkout revision.
Do not treat a successful render or a Git commit as evidence of a store upload.
Use `--output-root` for a separate candidate directory when running the processor
commands above; rendering at the default path explicitly replaces selected
tracked output files.

Canonical backgrounds, translations and locale mappings remain under `assets/`.
Android feature graphics remain in `apps/android/docs/media/play-store-feature-graphic/`;
the delivered gallery links to them without copying banners into `ready/`.

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
PNG exports and interactive galleries in temporary directories. It also renders
the saved real portrait iPad [fixtures](fixtures/ios-portrait/README.md) alongside
current landscape captures and compares their frame/header geometry. It checks
source immutability, selected/incremental device sets, missing-input preservation
of existing output, and refusal to write into a raw-input tree. It does not run
or alter either native app.

Newly rendered `export-manifest.json` files record exact source/output SHA-256
hashes, source names, locale/device mapping, dimensions, typography and measured
bounds. Their `sourceRevision` is the processing checkout revision, **not evidence
of a fresh native capture**. The approved delivery retains its original export
manifest and separate Git-blob `source-manifest.json`; see the processing guide.
Font reports describe the recorded rendering invocation.

The top-level `inputRoot` is the resolved absolute directory read by that
invocation, including overrides. Each new result records its own `inputRoot` and
`sourceRevision`; incremental runs retain those fields for unchanged results.
Older results inherit only explicitly recorded manifest provenance. If no input
root was recorded, their `inputRoot` is `null`; consult their retained revision
and original source manifest rather than assuming the latest invocation's root.
iOS `source` is relative to its input root; Android retains the historical
`play-store-screenshots/` label, with its filename relative to the input root.

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
