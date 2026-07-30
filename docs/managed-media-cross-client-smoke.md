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

## iOS Card Photo Picker Regression

Run this flow on a real iPhone:

1. Open Cards, tap Add card, and open Front.
2. Enter ordinary text, tap Add image, and select a recognizable photo.
3. Confirm the Front editor remains visible after the system photo picker closes,
   the original text remains present, and the selected image appears in the
   preview strip.
4. Use Back to return to the card form; this must not save or dismiss the card.
   Open Back, enter ordinary answer text, return to the card form, and tap Save.
5. Confirm the new card is visible in Cards, reopen it, open Front, and confirm
   the text and image are still present.

Repeat the picker portion with each of these conditions:

- Tap Cancel in the system photo picker. The Front editor and enclosing card
  editor must remain open and unchanged.
- Select an animated GIF. The actionable rejection alert must appear, and
  closing it must leave the Front editor and enclosing card editor open with
  the existing text unchanged.
- Select JPEG- and HEIC-origin photos, including once while the iPhone is
  offline. Each supported photo must be inserted locally while the Front editor
  and enclosing card editor remain open; upload may wait for connectivity.

## Failure Evidence

If any path fails, capture:

- source client and version/build
- destination client and version/build
- media asset id from the `fcasset:` reference
- card id, if visible in diagnostics or logs
- approximate timestamp and timezone
- whether the source client still shows a pending or failed upload state

## Generated Image Chat Tool

After this change is merged and deployed, make the next permitted real image request from a signed-in production chat:

- Explicitly request one teaching-relevant image, confirm the assistant inspects the card first, names the card and side, and attaches exactly one canonical managed-media reference to that side; sync Web, iOS, and Android and confirm it renders everywhere without front-side answer leakage.
- Do not make additional real image requests for cap, retry, replay, cancellation, claim-loss, or guest checks. Use the deployed automated test results and structured logs to confirm those paths, including that guest chat stays SQL-only.
- Record only model/status/request ID/duration and card/media IDs, never prompts, alt text, image bytes/base64, signed URLs, storage keys, or tool output.
