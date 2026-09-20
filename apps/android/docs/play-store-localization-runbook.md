# Google Play Listing Localization

Use this procedure to prepare, review, deliver, and publish localized Play listing
text and images. For a new shipping Android UI language, use the separate
[app-language checklist](add-language-checklist.md).

## 1. Confirm the surface and locale set

- Google Play App strings/Gemini owns shipping translated Android UI copy.
- The repository owns authored listing text, feature graphics, native marketing
  screenshots, and their source inputs.
- `marketingScreenshot` XML overlays translate only the screenshot build. They
  do not establish shipping language support. Listing-only work changes neither
  the advertised app locales nor the AAB and does not require `Android Release`.

Compare the requested languages with the current
[app locale config](../app/src/main/res/xml/locales_config.xml), existing listing
sections in [canonical metadata](../../../docs/google-play-store-metadata.md),
and the exact language names/codes offered in Play Console. Preserve existing
listings. The current tree has 49 app languages and 51 authored Play listings:
the single app language `es` has three listings, `es-ES`, `es-419`, and `es-US`.
Recount from these sources when changing the set.

Resolve each surface's spelling before authoring; do not copy the app tag into
every filename or Android qualifier. Use these existing maps:

- [Screenshot catalog](../app/src/androidTest/java/com/flashcardsopensourceapp/app/marketing/screenshots/MarketingScreenshotCatalog.kt)
  for built-in configurations: English app `en` uses Play listing `en-US`, while
  the committed screenshot prefix is `en` (the catalog also accepts `en-US`).
- [JSON loader](../app/src/androidTest/java/com/flashcardsopensourceapp/app/marketing/screenshots/MarketingScreenshotLocaleLoader.kt)
  for accepted additional Play codes and their `appLocaleTag` values.
- [Screenshot resource rules](marketing-screenshots.md#json-locale-packs) and
  [build locale filters](../app/build.gradle.kts) for Android resource aliases.
- [Device locale helper](../../../scripts/android/android-set-device-locale.sh)
  for required regions/scripts: Hebrew app `he`, listing/prefix `iw-IL`, resources
  `values-iw`, device `he-IL`; Norwegian app `no`, listing/prefix `no-NO`, resources
  `values-no`, device `nb-NO`; Punjabi listing/prefix `pa`, device `pa-Guru-IN`.

Check Google's current [localization help and available languages](https://support.google.com/googleplay/android-developer/answer/9844778?hl=en)
against the Console picker instead of assuming a generic app tag is selectable.

## 2. Complete each locale's repository artifacts

| Artifact | Source and required output |
| --- | --- |
| Listing text | One exact-code section in [canonical metadata](../../../docs/google-play-store-metadata.md): app name, short description, full description. |
| Feature graphic source | Locale content in [`localeConfigs` in the HTML template](media/play-store-feature-graphic/index.html); matching supported code in both the [single exporter](../../../scripts/android/export-android-feature-graphic.sh) and [batch exporter](../../../scripts/android/export-android-feature-graphics.sh). |
| Screenshot content | Existing catalog entry, or an accepted loader mapping plus [`marketing-locales/<Play-code>.json`](../app/src/androidTest/assets/marketing-locales) fixture. Follow the [fixture contract](marketing-screenshots.md#json-locale-packs). |
| Screenshot UI | Matching `strings.xml` under [`src/marketingScreenshot/res`](../app/src/marketingScreenshot/res), retained by the screenshot build's locale filters; confirm the device helper mapping. |
| Exported banner | [`media/play-store-feature-graphic/<Play-code>-feature-graphic.png`](media/play-store-feature-graphic), 1024 × 500. |
| Native phone screenshots | Five PNGs under [`media/play-store-screenshots`](media/play-store-screenshots), with the chosen locale prefix and the ordered filenames in the [inventory](marketing-screenshots.md#current-inventory). |

Use the [feature export procedure](../README.md#media-assets) and
[screenshot capture runbook](marketing-screenshot-runbook.md) for generation,
emulator ownership, locale refresh, cleanup, and capture evidence. Keep all source
inputs and rendered outputs in the repository. The common app icon may be shared.

Open every banner and all five screenshots. Check translation and glyphs,
clipping, RTL layout, native status-bar digits/separator, blocking dialogs,
missing content, and unintended English. The screenshot order is front, revealed
answer, progress, AI draft, cards list. A passing capture alone is insufficient;
use the [stale-image markers](../../../docs/add-language.md#identify-stale-marketing-screenshots)
when reusing older assets. Check current [Google preview-asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en).

## 3. Deliver the reviewed repository version

Review the complete text/source/image diff, commit the intended files, and merge
the PR into `main` after applicable CI passes. Follow the repository's
[release gates](../../../docs/release-gates.md) and watch any triggered post-merge
CI. Capture inputs or script changes can trigger Android checks even though
docs/media paths alone are excluded from Android builds.

Use those reviewed, merged files for the final Play submission. Identify the
merge commit and each locale's filenames/order; use SHA-256 checksums when copies,
duplicate filenames, or different worktrees make file identity uncertain.
Staging a Console draft is a separate state and never substitutes for delivery.

## 4. Populate the Play listing

1. Open the app in Play Console, then **Grow users → Store presence → Main store
   listing** (or the current Store listings entry). Inspect the current UI; use
   its translation/language controls to add the precise requested locales without
   removing existing ones.
2. Enter the three canonical text fields. If using the available AI import flow,
   import repository-derived text, then compare every resulting field exactly
   with its source, including punctuation and line breaks. Correct substitutions
   before saving; successful import does not prove text parity.
3. For each locale, confirm the active language before editing graphics. Upload
   its reviewed banner and five phone PNGs through the [Asset Library](https://support.google.com/googleplay/android-developer/answer/16386748?hl=en).
   Find the exact files, select them, and explicitly apply/add them to that
   locale's graphics fields. Uploading or selecting in the library alone does
   not assign an asset; closing the panel can leave the previous graphics intact.
4. Verify the listing editor itself shows that locale's banner and five phone
   screenshots in the intended order. Compare filenames and actual previews with
   the reviewed outputs; check file hashes when needed and available. Remove
   accidental duplicates or wrong-locale assignments within the requested scope.
   Text-only translations can inherit default-language graphics, so English
   fallback is not evidence of completed localization.
5. Review each asset declaration against its actual provenance and Google's
   current [AI-content declaration guidance](https://support.google.com/googleplay/android-developer/answer/17262077?hl=en).
   Account for native capture, HTML rendering, and any AI generation or editing
   involved. Do not apply one blanket declaration to all assets; follow the
   current form and help for each item.
6. Review every intended locale once more, save the listing, and confirm that the
   saved editor retains the exact text and assigned media. Preserve existing
   locales and their assets outside the requested changes.

## 5. Submit and verify publication

Open **Publishing overview** and inspect the pending changes. Send only the
intended listing updates; leave unrelated changes for their owner. Complete the
final review/save step, send for review, and verify **Changes in review**.

Inspect managed publishing before submission: when off, approval publishes these
changes automatically; when on, approval leaves them ready for a separate publish
action. Complete that action when publication is authorized. Existing publication
authorization covers these steps; do not request it again. Follow Google's
[review and publishing procedure](https://support.google.com/googleplay/android-developer/answer/9859654?hl=en).

Record the merge commit/CI result, submitted locales, current Console state,
managed publishing setting, and remaining action. Keep these states distinct:
repository merged, Console draft saved, sent for review, approved awaiting publish,
publicly published. A draft or review submission is not live confirmation.

After approval and publication, open the public Play listing for each target
language and verify the authored text and localized media. Record the checked
URLs/time and any unresolved discrepancy; until then, report public verification
as pending.
