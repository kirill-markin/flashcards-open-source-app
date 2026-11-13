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
  --all-locales \
  --family iphone-duo-inner
```

Use `--locale en-US` to target one ID in the
[App Store locale map](../scripts/ios/app-store-localization-inputs.mts).
The selected version must already have each selected version localization.
To upload both displays for English, use this command before or after the inner
bulk upload. Later inner-only uploads preserve the English outer placements.

```bash
node scripts/ios/upload-app-store-duo-screenshots.mts \
  --version '<editable-version>' \
  --screenshots apps/ios/docs/media/app-store-cards/ready \
  --locale en-US \
  --family all
```

Use `--family iphone-duo-outer` for outer cards only. `--family all` orders outer
cards 1–5 before inner cards 1–5. For each selected locale, the input root must
contain exactly one `<capture-tag>-1_*.png` through `-5_*.png` in each selected
family folder. The command validates every selected file and the draft before
writing. The cards share one group with a catalog-defined limit. All retained
placements count toward that limit, including the other display's cards during
a single-display upload.

Per locale, the uploader first uploads and waits for all selected images to
finish processing, then replaces its outdated placements for the selected
display or displays. It preserves the IDs and relative order of retained
placements and verifies the resulting order and selected image identities on
readback. It never deletes library image assets. Outdated placements must be
removed before new placements can be created, so a failure during that phase
may leave the selected display partly updated. Earlier locales may already be
complete when a later one fails.

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
