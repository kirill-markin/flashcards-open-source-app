# Approved Nibomo App Store cards

These finished cards and review previews are ordinary tracked Git files.
Open `index.html` to select a language and inspect the full-size cards.

The [processing guide](../../../../../docs/store-screenshot-processing.md#tracked-approved-delivery)
owns the inventory, store-upload status, source and processing provenance, and
links to the manual refresh procedure.

The current `export-manifest.json` combines 460 retained rows at revision
`8ad37887e71cb946a6697a9ad657ef0ab61ce6bd`, five Duo outer rows at
`b615b50fd14fbe5b782469281d9c79869ca73d14`, and five landscape Duo inner
rows at `25a4d50085f442b72350c9f4a8dd62dbcfa45cbb`. Its top-level revision
and input root describe the inner processing invocation; retained rows have a null
input root, while Duo rows record their input root. `source-manifest.json` preserves
the original 460 native-source Git blobs; [`duo-source-manifest.json`](duo-source-manifest.json)
records the Duo capture provenance.

Reusable design assets, copy and locale maps are in the
[processor assets](../../../../../scripts/store-screenshots/assets/).
