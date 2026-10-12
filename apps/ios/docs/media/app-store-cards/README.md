# Approved Nibomo App Store cards

These finished cards and review previews are ordinary tracked Git files.
Open `index.html` to select a language and inspect the full-size cards.

The [processing guide](../../../../../docs/store-screenshot-processing.md#tracked-approved-delivery)
owns the inventory, store-upload status, source and processing provenance, and
links to the manual refresh procedure.

The current `export-manifest.json` contains 210 landscape iPad cards at processing
base HEAD `518480a83bc8a99b2900e39a2250db3086132be0`, 250 retained iPhone
rows at `8ad37887e71cb946a6697a9ad657ef0ab61ce6bd`, five Duo outer rows at
`b615b50fd14fbe5b782469281d9c79869ca73d14`, and five Duo inner rows at
`4fb98ece8127ab446f81b7bfb31a0c70104f2c7b`. The 260 retained rows and their
PNG/preview bytes are unchanged. The manifest's top-level revision and input
root describe the iPad invocation; every row retains its own provenance.

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
owns Duo capture provenance. Mac Catalyst has an explicit processing profile;
its genuine native screenshots and derived cards remain pending.

Reusable design assets, copy and locale maps are in the
[processor assets](../../../../../scripts/store-screenshots/assets/).
