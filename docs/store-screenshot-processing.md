# Nibomo store-card design and independent processing

Mariia approved this design on 2026-10-09. The flow is explicitly separate from
native screenshot generation:

1. Run the existing iOS or Android native capture flow when screenshots need to
   change. That flow continues to own simulators/emulators, fixture content,
   guest cleanup and original output files.
2. Later, run `npm run render --prefix scripts/store-screenshots` against the
   saved PNGs. This flow reads them, assembles the approved cards, verifies the
   layout and writes new files to adjacent `app-store-cards/` or
   `play-store-cards/` directories.
3. Review the derived gallery. Store upload remains a separate explicit action.

The processor does not call native capture even when an input is absent. There
is no network fetch of replacement screenshots and no generated app UI. See the
[processor README](../scripts/store-screenshots/README.md) for setup, selection,
paths, manual GitHub Actions dispatch and regeneration commands.

## Approved delivery

The finished images are public release assets; text metadata, the independent
processor and its canonical design inputs remain in Git. Download the relevant
bundles using [Media assets](media-assets.md) before reviewing or uploading.
The approved inventory is:

| Directory | Cards | Store status |
| --- | --- | --- |
| `apps/ios/docs/media/app-store-cards/ready/iphone/` | 210 | Uploaded to App Store Connect |
| `apps/ios/docs/media/app-store-cards/ready/ipad/` | 210 landscape | Prepared; existing store iPad screenshots unchanged |
| `apps/ios/docs/media/app-store-cards/ready/iphone-duo-outer/` | 5 | Prepared in English; not uploaded |
| `apps/ios/docs/media/app-store-cards/ready/iphone-duo-inner/` | 210 landscape | Uploaded to the iOS 1.33.0 listing in all 42 Store locales |
| `apps/ios/docs/media/app-store-cards/ready/macos/` | 210 landscape | Prepared in all 42 Store locales; not uploaded |
| `apps/ios/docs/media/app-store-cards/additional-languages/iphone/` | 40 | Prepared; these languages have no separate App Store listing |
| `apps/android/docs/media/play-store-cards/ready/*/phoneScreenshots/` | 255 | Uploaded to Google Play, including Zulu |

Each output's `export-manifest.json` records output/source SHA-256 hashes,
row-level processing provenance and rendering measurements. The
[iOS card provenance](../apps/ios/docs/media/app-store-cards/README.md) records the
current processing invocation and links the native-source manifests, including
[`duo-source-manifest.json`](../apps/ios/docs/media/app-store-cards/duo-source-manifest.json)
and [`macos-source-manifest.json`](../apps/ios/docs/media/app-store-cards/macos-source-manifest.json).
Every Mac original and full-size card was visually inspected.

The processor owns reusable backgrounds, copy, locale maps and image-generation
provenance under `scripts/store-screenshots/assets/`; output folders do not carry
redundant copies. Android gallery feature-graphic links point at the canonical
`play-store-feature-graphic/` files.

Use the [manual refresh procedure](../scripts/store-screenshots/README.md#manual-refresh-after-native-capture)
to render candidates in cloud, review them, and publish an updated media snapshot.
Cloud checks download pinned native sources, render into temporary output and do
not replace approved files. Require **Format existing native captures** to pass
before merge. Store upload remains separately authorized.

## Approved five-card contract

The five cards are, in order: AI creation, review question, answer and intervals,
progress, and card library. Their native screenshot order and slugs are in the
renderers, and their copy in `scripts/store-screenshots/assets/localized-copy.json`.

Preserve these requirements:

- Card 01's heading is **Nibomo App** in every language. Localize its caption.
- Use each card's own approved orange/yellow/red gradient placement. Reuse the
  supplied image assets; do not regenerate them on routine runs.
- All five headings have one family, size, weight, line height and vertical
  position within a device format. Captions have a separate shared style and
  vertical position. The shared format applies across language sets as well.
- Center the **number pill and heading together**, including their gap. A
  centered title with a number attached outside that group is incorrect.
- Center the caption independently on the same canvas axis. Keep it to one line.
- Keep the whole actual localized app screenshot visible and proportional,
  including status and bottom navigation. Do not redraw product UI.
- Shorten copy when it does not fit. Never shrink one card's font independently.
- Retain RTL text direction; card 01's brand remains LTR and the number pill's
  content remains LTR. Keep the whole heading group centered in either direction.
- Export opaque lossless **RGB PNGs**, not indexed/palette or alpha images.

The full original references are
`scripts/store-screenshots/assets/app-store/reference/01.png` through `05.png`.
The formatter overlays new editable typography and the real native capture on
separate clean header plates; the reference's old header text and old app screen
are not used as the output UI.

## Format profiles

The profiles are iPhone, iPad (landscape), iPhone Duo outer, iPhone Duo inner
(landscape) and Mac Catalyst (landscape) in
[`render-ios.mts`](../scripts/store-screenshots/render-ios.mts), and Android phone in
[`render-android.mts`](../scripts/store-screenshots/render-android.mts). Each
renderer holds its accepted native input sizes, output size and the exact CSS
geometry, and each export manifest records the measured result. iPad, Duo inner
and Mac cards keep the complete native screen in its own aspect ratio with equal
frame padding on all four sides; Android uses a separate 9:16 canvas whose
marketing header stays under 20% of the image height.

Format references checked on 2026-10-09:

- [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [Google Play preview asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en)

These are format/layout checks; successful rendering does not establish store
review approval or promotion eligibility. The actual Android notification/status
bar remains part of the unmodified source screenshot.

## Copy, locale mapping and LLM responsibilities

The saved English/Russian references establish the design and short-copy style.
Other language captions/headings were authored and shortened with LLM assistance
and checked for fit; a layout check is not a native-language editorial review.

Store copy has one shared source: five `[heading, caption]` pairs per canonical
capture tag in `assets/localized-copy.json`. Android listing variants select that
copy through their `copyTag` mapping, and each platform's listing map is its own
`store-locales.json`. These are marketing strings, not app-internal localization
resources. Keep the existing platform localization ownership intact.

LLM work is **authoring only**, outside the renderer:

1. For a new locale, draft short headings and one-line captions matching the five
   saved English meanings, preserving `Nibomo App` on card 01.
2. Save the chosen wording as data and run `--check-layout` for that locale.
3. If a phrase exceeds margins or wraps, revise its wording at the same font size.
4. Review the actual gallery, including RTL and scripts with system font coverage.
5. Commit the chosen copy and exact mapping. Routine processing reuses it without
   an LLM, API key, prompt execution or fresh translation.

A reusable authoring prompt is:

> Translate the five saved Nibomo store-card heading/caption pairs into the target
> locale. Keep card 01's heading exactly `Nibomo App`. Use concise natural headings
> and one-line captions with the same product meaning. Do not invent capabilities,
> prices, rankings or app-interface text. Return exactly five string pairs as JSON.
> If the layout check reports overflow, shorten the wording without changing the
> font settings, card roles, or approved design.

This authoring prompt describes the saved workflow; it is not claimed to be a
verbatim historical translation transcript. Actual historical image-editing
prompts are retained in `assets/app-store/header-generation.json` and
`assets/google-play/background-generation.json`.

ImageGen was used once to erase old marketing text from the iOS headers and to
prepare empty 9:16 Google gradient plates. Its outputs are committed assets.
Regenerating those assets is a design change, not a normal screenshot-refresh
step. Keep the existing gradients, produce background-only plates, and never ask
image generation to redraw the real app screen or final marketing typography.

## Visual review

The renderers check the layout in a real browser and reject missing-glyph
substitution, and the gallery builders check every packaged set. The source-file
hashes in the export manifest describe the exact saved native PNGs that were
processed; the formatter does not infer their capture date or regenerate them to
make them look fresh.

Before a design update or browser/font-environment change, process representative
English, Russian, RTL, CJK and Indic sets. Review all five full-size cards on
iPhone, iPad and Android. Compare number/title grouping, caption positions,
background placement, border shape and complete UI visibility. A new browser/OS
font environment can alter glyph rendering even with the same declared CSS.

## Remaining native input work

Android tablet captures are not currently provided. Add a genuine native tablet
capture flow and its own approved layout profile before creating tablet assets;
do not stretch phone cards or use iPad captures. Existing Android feature-graphic
generation is a separate flow and remains unchanged by this processor.

The formatter does not change the App Store uploader defaults. Its iOS `ready/`
folder preserves the uploader's existing family/prefix/index contract. Point an
explicit upload operation at that prepared folder only after review. The
processor itself has no publication code or credentials.
