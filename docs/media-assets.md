# Public marketing media

App Store and Play Store native captures, approved cards, gallery previews,
horizontal marketing compositions, feature graphics, and exported icon previews
live in public [GitHub Release assets](https://github.com/kirill-markin/flashcards-open-source-app/releases/tag/media-archive-20261017).
The pinned inventory is [`scripts/media/manifest.json`](../scripts/media/manifest.json).
It records each file's path, size and SHA-256, plus the compressed archive's size
and SHA-256. Text provenance, gallery HTML, app resources and reusable renderer
inputs remain in Git.

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
`--destination /absolute/path/to/checkout`. Existing identical files are verified
and retained. A conflicting local file causes an error; move it aside explicitly
before downloading. The downloader verifies archives and individual files,
rejects unexpected entries and symlinks, and stages downloads before copying.
There is no automatic fetch during app development. Screenshot processing CI
explicitly downloads only its input bundles.

| Bundle | Local directory |
| --- | --- |
| `ios-native` | `apps/ios/docs/media/app-store-screenshots/` |
| `ios-cards` | `apps/ios/docs/media/app-store-cards/` |
| `ios-marketing` | `apps/ios/docs/media/marketing-materials/` |
| `ios-app-icon` | `apps/ios/docs/media/app-icon/` |
| `android-native` | `apps/android/docs/media/play-store-screenshots/` |
| `android-cards` | `apps/android/docs/media/play-store-cards/` |
| `android-feature-graphics` | `apps/android/docs/media/play-store-feature-graphic/` |

The initial archive preserves current approved bytes. Separate pre-cleanup Git
backup assets on that release preserve older historical media and original
commit identities; normal downloads do not fetch that large backup. Provenance
manifests retain historical revisions even when the corresponding Git history
has been rewritten.

## Publish a new media snapshot

1. Download `all` into a clean checkout before editing any media. Keep a separate
   copy of the current approved files while capturing and reviewing replacements.
2. Run the existing capture/processing tools and visually review the complete
   resulting galleries. Store uploads are separately authorized operations.
3. Choose a new immutable tag, such as `media-archive-20261101`, and package all
   seven complete local directories into an output directory outside the repo:

   ```bash
   python3 scripts/media/package.py --release-tag media-archive-20261101 \
     --output-dir /absolute/path/to/media-archive-20261101
   ```

   This writes seven `.tar.gz` assets, an archive copy of `manifest.json`, and
   the new tracked `scripts/media/manifest.json`. It includes media files only;
   README, JSON, and HTML sources remain in Git.
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
   `python3 scripts/media/download.py all --destination /absolute/path/to/verification`.
   This checks every public archive and media file against the generated manifest.
6. Commit the new pinned manifest with changed text provenance and gallery
   metadata. Keep all media ignored. Never replace published archive assets in
   place: older source revisions must keep working with their pinned release.

The required repository static gate rejects media force-added under either
`apps/*/docs/media/` tree, any tracked file above 5 MiB, and more than 25 MiB of
tracked marketing/rendering media. The small renderer inputs remain part of the
build tooling; bulk captures and exports belong in releases. The gate also
checks newly introduced Git history against the PR base: historical external
media blobs, blobs above 5 MiB, or more than 25 MiB of introduced blob data fail
even when the branch tip deletes those files. This prevents merging old branches
from restoring the large history.

## After the history cleanup

Clone again from GitHub and recreate worktrees from that clone. Existing clones
retain old Git objects even after a pull. Save uncommitted work outside the old
checkout before replacing it, then reapply only the needed source changes on a
fresh branch. Do not push old branches or tags back: that makes the removed
history reachable again. Use the public backup for historical inspection in a
separate directory.
