# Public marketing media

App Store and Play Store native captures, approved cards, gallery previews,
horizontal marketing compositions, feature graphics, and exported icon previews
live in public GitHub Release assets, pinned by
[`scripts/media/manifest.json`](../scripts/media/manifest.json). Text
provenance, gallery HTML, app resources and reusable renderer inputs remain in
Git.

A fresh clone or worktree needs **no media download to build any app**. Media
is restored only when processing, reviewing, or uploading store assets. Python
3.11 or newer and internet access are required; no GitHub login is needed.
From the repository root:

```bash
# Existing screenshot processor inputs and Android gallery banners.
python3 scripts/media/download.py ios-native android-native android-feature-graphics

# Existing approved cards for gallery review or a separately authorized store upload.
python3 scripts/media/download.py ios-cards android-cards android-feature-graphics

# Every current media file, restored at the paths the existing tools expect.
python3 scripts/media/download.py all
```

Each worktree has its own ignored media. To populate another checkout, pass
`--destination /absolute/path/to/checkout`. Existing identical files are kept;
a conflicting local file is an error, so move it aside explicitly before
downloading. Nothing fetches media automatically during app development, and
screenshot processing CI downloads only its input bundles. Bundle names and
their local directories are in [`catalog.py`](../scripts/media/catalog.py).

Separate pre-cleanup Git backup assets on the first
[media release](https://github.com/kirill-markin/flashcards-open-source-app/releases/tag/media-archive-20261017) preserve
older historical media and original commit identities; normal downloads do not
fetch that large backup.

## Publish a new media snapshot

1. Download `all` into a clean checkout before editing any media. Keep a separate
   copy of the current approved files while capturing and reviewing replacements.
2. Run the existing capture/processing tools and visually review the complete
   resulting galleries. Store uploads are separately authorized operations.
3. Choose a new immutable tag, such as `media-archive-20261101`, and package every
   complete bundle directory into an output directory outside the repo:

   ```bash
   python3 scripts/media/package.py --release-tag media-archive-20261101 \
     --output-dir /absolute/path/to/media-archive-20261101
   ```

   It writes the release assets and the new tracked `scripts/media/manifest.json`.
4. Create a public media release and upload its complete output directory before
   publishing the manifest change. Media releases do not release an app:

   ```bash
   gh release create media-archive-20261101 \
     --repo kirill-markin/flashcards-open-source-app --target main \
     --title "Marketing media 2026-11-01" \
     --notes "Public marketing asset snapshot; no application release." --latest=false
   gh release upload media-archive-20261101 /absolute/path/to/media-archive-20261101/* \
     --repo kirill-markin/flashcards-open-source-app
   ```

5. Download the new snapshot into an empty directory with
   `python3 scripts/media/download.py all --destination /absolute/path/to/verification`;
   it verifies every published file against the new manifest.
6. Commit the new pinned manifest with changed text provenance and gallery
   metadata. Keep all media ignored. Never replace published archive assets in
   place: older source revisions must keep working with their pinned release.

Bulk captures and exports belong in releases; only the small renderer inputs
stay in Git. The required repository static gate enforces the size budgets on
the tree and on newly introduced history ([`check-repository-size.mjs`](../scripts/checks/pr/check-repository-size.mjs)).

## After the history cleanup

Clone again from GitHub and recreate worktrees from that clone. Existing clones
retain old Git objects even after a pull. Save uncommitted work outside the old
checkout before replacing it, then reapply only the needed source changes on a
fresh branch. Do not push old branches or tags back: that makes the removed
history reachable again. Use the public backup for historical inspection in a
separate directory.
