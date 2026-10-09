# Nibomo store-card design and independent processing

Mariia approved this design on 2026-10-09. This guide transfers the rules, code,
approved visual assets, localized text and image-editing prompts from the
marketing-site workspace into the app repository.

The flow is explicitly separate from native screenshot generation:

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

## Approved five-card contract

| Output card | Role | Native screenshot index | English heading | English caption |
| --- | --- | --- | --- | --- |
| 01 | AI creation | 4 | Nibomo App | Create flashcards with AI |
| 02 | Review question | 1 | Start Learning | Recall the answer yourself |
| 03 | Answer and intervals | 2 | Smart Reviews | Review at the right time |
| 04 | Progress | 3 | Your Progress | Track your study days |
| 05 | Card library | 5 | Your Cards | All your cards in one place |

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

The full original references are in
`scripts/store-screenshots/assets/app-store/reference/01.png` through `05.png`.
They are 519 × 1122 reference images. The clean header plates are separate from
them. The formatter overlays new editable typography and the real native capture;
the reference's old header text and old app screen are not used as the output UI.

## Format profiles

| Profile | Output size | Native input size | Shared font scale |
| --- | --- | --- | --- |
| iPhone | 1284 × 2778 | 1284 × 2778 | width / 519 |
| iPad | 2064 × 2752 | 2064 × 2752 | height / 1122 × 1.35 |
| Android phone | 1080 × 1920 | 1080 × 2400 | width / 519 |

The base heading is Arial/sans-serif 44 px, weight 700, line height 53 px. The
base caption is 24 px, weight 400, line height 28 px. The base number capsule is
50 × 30 px with 20 px text, 15 px radius and a 16 px gap to the heading. The
format scale multiplies those text measurements uniformly.

iOS keeps the approved reference proportions: heading row top `63 × scale`,
caption top `141 × scale`, frame top `212 × scale`, frame height `860 × scale`,
padding `18 × scale`. The iPad frame is wider to cover the old reference frame,
while its actual app screen retains its 3:4 proportion. The exact CSS and frame
geometry are in `render-ios.mts`.

Android uses a separate 9:16 canvas. Its heading row starts at 110 px, caption at
260 px and frame at 370 px. The entire native 1080 × 2400 capture is displayed
at 652.5 × 1450, with 30 px brown padding and a centered 712.5 × 1510 frame.
The marketing header occupies less than 20% of image height. The exact CSS is
in `render-android.mts`.

Export opaque **RGB PNGs**, not indexed/palette or alpha images. The processor
uses lossless PNG compression and does not apply the older horizontal builder's
`pngquant` palette-reduction step to store cards.

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
copy through their `copyTag` mapping. Platform listing maps are tracked separately
in each `store-locales.json`. These are marketing strings, not app-internal localization
resources. Keep the existing platform localization ownership intact.

The transfer contains 50 iOS capture tags (49 languages, with two Spanish regions)
and 51 Android listing variants (49 languages, with three Spanish regions).
The iOS mapping separates 42 listing locales from eight iPhone-only non-Store
languages. Android uses `en` as the raw capture prefix for listing `en-US` and
retains the app's existing exact Play listing codes. Zulu assets have
`consoleAvailability: unverified`, because Zulu is absent from Google's published
listing-language list; the gallery retains that distinction.

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

## Validation and visual review

The real browser layout checks group/caption centering to 0.1 px, safe margins,
single-line copy, shared font styles/positions, complete screen/frame bounds and
native proportions. It reads actual platform fonts on a localized heading and
rejects `LastResort` missing-glyph substitution. Browser requests are blocked;
HTML and images are supplied in memory.

The gallery builder then checks image hashes, translated pairs, complete five-card
sets and RGB dimensions. Incremental reruns retain other sets and verify them
again. The source-file hashes in the export manifest describe the exact saved
native PNGs that were processed; the formatter does not infer their capture date
or regenerate them to make them look fresh.

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
