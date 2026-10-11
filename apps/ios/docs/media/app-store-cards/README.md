# Approved Nibomo App Store cards

These finished cards and review previews are ordinary tracked Git files.
Open `index.html` to select a language and inspect the full-size cards.

The [processing guide](../../../../../docs/store-screenshot-processing.md#tracked-approved-delivery)
owns the inventory, store-upload status, source and processing provenance, and
links to the manual refresh procedure.

The current `export-manifest.json` combines 460 retained rows at revision
`8ad37887e71cb946a6697a9ad657ef0ab61ce6bd`, five Duo outer rows at
`b615b50fd14fbe5b782469281d9c79869ca73d14`, and five landscape Duo inner
rows processed from base HEAD `4fb98ece8127ab446f81b7bfb31a0c70104f2c7b`
with an uncommitted `render-ios.mts` change. The renderer at production had SHA-256
`786aa74b71d71b3742499dde1c8a61d455f1d7703ace2846dc271d565b3ae49a`,
Git blob `27b1950b28f54f1af78363e453400264c82fe49c`, and binary diff SHA-256
`f21b423a8a5d71dc501797792578ff51885feb9d211af82a74db7039e9496993`.
The manifest's top-level revision and input root describe the inner processing
invocation; retained rows have a null
input root, while Duo rows record their input root. `source-manifest.json` preserves
the original 460 native-source Git blobs; [`duo-source-manifest.json`](duo-source-manifest.json)
records the Duo capture provenance.

Reusable design assets, copy and locale maps are in the
[processor assets](../../../../../scripts/store-screenshots/assets/).
