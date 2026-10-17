# App Store Connect Duo screenshots

[The Duo uploader](../scripts/ios/upload-app-store-duo-screenshots.mts) places
five cards from a selected display, or all ten outer and inner cards, in one
iPhone Duo screenshot group for an existing editable iOS version. It uses the App
Asset Library API and leaves the ordinary iPhone/iPad screenshot uploader and its
sets alone. Capture and rendering are separate manual steps.

Run from the repository root with Node 24, the main checkout's App Store
Connect credentials, an existing `PREPARE_FOR_SUBMISSION`,
`DEVELOPER_REJECTED`, or `REJECTED` iOS version, and the rendered cards for the
selected display:

```bash
node scripts/ios/upload-app-store-duo-screenshots.mts \
  --version '<editable-version>' \
  --screenshots apps/ios/docs/media/app-store-cards/ready \
  --locale en-US \
  --family iphone-duo-inner
```

Use `--all-locales` instead of `--locale en-US` to target every existing Store
locale in the [Store locale map](../scripts/store-screenshots/assets/app-store/store-locales.json).
The selected version must already have each selected version localization; the
uploader does not create locale metadata. `--family` is required: choose
`iphone-duo-inner`, `iphone-duo-outer`, or `all`, which places outer 1–5 before
inner 1–5:

```bash
node scripts/ios/upload-app-store-duo-screenshots.mts \
  --version '<editable-version>' \
  --screenshots apps/ios/docs/media/app-store-cards/ready \
  --all-locales \
  --family all
```

For each selected locale, the input root must contain exactly one
`<capture-tag>-1_*.png` through `-5_*.png` in each selected family folder. The
command validates every selected file and the draft before writing. The cards
share one group with a catalog-defined limit; any unrelated placement consumes
capacity and causes a clear refusal when the selected set will not fit.

Per locale, the uploader first uploads and waits for all selected images to
finish processing, then replaces only its own placements. Selecting one display
removes this uploader's placements for the other display. It never deletes
library image assets. The old managed placements must be removed before new
placements can be created, so a failure during that phase may leave the locale's
Duo group partly updated, and earlier locales may already be complete when a
later one fails.

On rerun with the same files, the command reuses processed images, waits for
processing ones, or resumes one unfinished upload reservation. Inspect any
reported image or placement ID before rerunning after an uncertain POST response.
Duplicate reservations, failed processing, unexpected states, and changed file
identity require explicit reconciliation. Keep the selected files and draft
unchanged during the run. Require `duo_upload_verified` before treating all
selected locales as uploaded, then inspect the selected listing in App Store
Connect.

This command changes screenshots only. It does not create, rename, withdraw,
submit, or release an App Store version. Submission follows the
[iOS release procedure](release/ios.md#ios).
