# Managed Media Cross-Client Smoke

Use this manual smoke when a release changes managed image authoring, upload,
download, rendering, or workspace sync behavior. Keep the scope to image-only
managed media; audio and video are outside this checklist.

## Setup

- Use one production-like account and one shared workspace on Web, iOS, and
  Android.
- Use a small PNG or JPEG that is visually easy to recognize on every client.
- Start each destination client online, signed in, and able to sync the shared
  workspace.

## Checklist

For each path, create a new card on the source client with ordinary front/back
text and one image attachment that renders as a managed `fcasset:` reference.

| Source | Destination checks |
| --- | --- |
| Web | Sync iOS and Android, open the card, and confirm both render the image. |
| iOS | Sync Web and Android, open the card, and confirm both render the image. |
| Android | Sync Web and iOS, open the card, and confirm both render the image. |

Expected behavior for every path:

- The source client may save the card text locally before the image upload
  finishes.
- The source client eventually uploads the image through the managed media
  upload queue and completes the S3-backed media asset.
- Destination clients receive the card and logical media asset through sync,
  download the image bytes through the managed media download path, and render
  the image after sync/download completes.
- Destination clients must not remain permanently stuck on unavailable media
  after the source upload has completed and sync has run.

## Failure Evidence

If any path fails, capture:

- source client and version/build
- destination client and version/build
- media asset id from the `fcasset:` reference
- card id, if visible in diagnostics or logs
- approximate timestamp and timezone
- whether the source client still shows a pending or failed upload state
