# Approved Nibomo App Store cards

These finished cards and review previews are ordinary tracked Git files.
Open `index.html` to select a language and inspect the full-size cards.

The [processing guide](../../../../../docs/store-screenshot-processing.md#tracked-approved-delivery)
owns the inventory, store-upload status, source and processing provenance, and
links to the manual refresh procedure.

The current `export-manifest.json` contains 210 Mac cards at processing
HEAD `4fb044b41043b4c0344ef6763253f8e3d2c0bb0f`, 210 landscape iPad
cards at processing
base HEAD `518480a83bc8a99b2900e39a2250db3086132be0`, 250 retained iPhone
rows at `8ad37887e71cb946a6697a9ad657ef0ab61ce6bd`, five Duo outer rows at
`b615b50fd14fbe5b782469281d9c79869ca73d14`, and 210 Duo inner rows.
The five English inner rows retain renderer revision
`4fb98ece8127ab446f81b7bfb31a0c70104f2c7b`; the 205 localized rows retain
their actual `0ee31be3f4edfd4465c941b9b84a25f996eaf485` or
`e694d7eb2df39a68711cdc02a91c506bc3521ec0` renderer revision. All
pre-existing PNG and preview bytes are unchanged. The manifest's top-level
revision and input root describe the retained Mac invocation; every row
records its own provenance. The localized inner cards were assembled from
previously reviewed outputs, without a new render.

The iPad delivery is 42 Store locales × five 2752 × 2064 opaque RGB cards, using
the committed native landscape package from
`d7496a1c3be51f2b4a9fc134ca9e7e732c164e8a`. Production command:

```bash
npm run render --prefix scripts/store-screenshots -- --platform ios --family ipad
```

The uncommitted renderer used for that invocation has SHA-256
`e9966244581b9f4c326f338cc0e4f9db7ce36bccdb6d9bda50d5cebeb3a5d53a`, Git blob
`6e4c8279142166f6ae9ef868b7f6d7187d3cd25e` and binary diff SHA-256
`5b14080dce91a3ffacb4a93ce47d916eb429ec3fd64fbccec70ea8e2d2f834ec`. Every current native PNG
and output hash is recorded in the iPad manifest rows. Their measured frame
padding is 33.109375–33.125 px on all four sides, with at most 0.015625 px
difference from browser subpixel rounding; the complete proportional screen
fills the inner box without letterboxing. Representative English, Russian, Arabic,
Chinese and Hindi PNGs each have 33 solid border pixels on every side.

`source-manifest.json` preserves the original native-source package, including
historical iPad hashes. [`duo-source-manifest.json`](duo-source-manifest.json)
owns Duo capture provenance. The 205 localized native inner captures come from
the frozen app and capture code at `b615b50fd14fbe5b782469281d9c79869ca73d14`;
their hashes and Git blob identities are recorded per file, without claiming
the captures existed in that source commit. Mac Catalyst has an explicit
processing profile; [`macos-source-manifest.json`](macos-source-manifest.json)
owns the 42-locale Mac capture provenance and exact processing recipe. The delivery contains 210
1440 × 900 native window originals, 210 opaque RGB 2880 × 1800 cards and 42
previews. All five states and full-size cards in every locale were visually
inspected. The Mac cards use source order 4, 1, 2, 3, 5 and measure 29 solid grey
border pixels on each side; CSS padding is 28.875 px, except 28.890625 px at the
bottom from browser subpixel rounding. The complete native window remains
visible and proportional. These Mac assets are prepared and have not been uploaded.

Reusable design assets, copy and locale maps are in the
[processor assets](../../../../../scripts/store-screenshots/assets/).
