import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../shared/errors";
import {
  parseSyncBootstrapInput,
  parseSyncPullInput,
  parseSyncPushInput,
} from "./input";
import {
  createMediaAssetPayload,
  mediaAssetId,
} from "./inputTestSupport";

const mediaAssetSha256 = createMediaAssetPayload(null).sha256;

test("parseSyncPushInput accepts media_asset metadata operations", () => {
  const parsedInput = parseSyncPushInput({
    installationId: "installation-1",
    platform: "ios",
    operations: [
      {
        operationId: "operation-media-1",
        entityType: "media_asset",
        action: "upsert",
        entityId: mediaAssetId,
        clientUpdatedAt: "2026-02-28T09:30:00.000Z",
        payload: {
          mediaAssetId,
          workspaceId: "workspace-1",
          mimeType: "image/png",
          sizeBytes: 42,
          sha256: mediaAssetSha256,
          sourceUrl: " https://example.com/source image.png ",
          createdAt: "2026-02-28T09:00:00.000Z",
          deletedAt: "2026-02-28T09:30:00.000Z",
        },
      },
    ],
  });

  const operation = parsedInput.operations[0];
  if (operation?.entityType !== "media_asset") {
    assert.fail("Expected the parsed sync operation to remain a media_asset");
  }

  assert.equal(operation.payload.mediaAssetId, mediaAssetId);
  assert.equal(operation.payload.sourceUrl, "https://example.com/source%20image.png");
  assert.equal(operation.payload.deletedAt, "2026-02-28T09:30:00.000Z");
  assert.equal(Object.prototype.hasOwnProperty.call(operation.payload, "bytes"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(operation.payload, "storageKey"), false);
});

test("parseSyncPushInput rejects non-http media_asset source URLs", () => {
  assert.throws(
    () => parseSyncPushInput({
      installationId: "installation-1",
      platform: "ios",
      operations: [
        {
          operationId: "operation-media-1",
          entityType: "media_asset",
          action: "upsert",
          entityId: mediaAssetId,
          clientUpdatedAt: "2026-02-28T09:30:00.000Z",
          payload: {
            mediaAssetId,
            workspaceId: "workspace-1",
            mimeType: "image/png",
            sizeBytes: 42,
            sha256: mediaAssetSha256,
            sourceUrl: "file:///tmp/source.png",
            createdAt: "2026-02-28T09:00:00.000Z",
            deletedAt: null,
          },
        },
      ],
    }),
    (error: unknown) => {
      if (!(error instanceof HttpError)) {
        assert.fail("Expected parseSyncPushInput to throw HttpError");
      }

      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "SYNC_INVALID_INPUT");
      assert.deepEqual(error.details?.validationIssues, [
        {
          path: "operations.0.payload.sourceUrl",
          code: "custom",
          message: "sourceUrl must be an absolute HTTP or HTTPS URL",
        },
      ]);

      return true;
    },
  );
});

test("parseSyncPullInput accepts media asset opt-in without requiring it", () => {
  const legacyInput = parseSyncPullInput({
    installationId: "installation-1",
    platform: "ios",
    afterHotChangeId: 0,
    limit: 100,
  });
  const mediaInput = parseSyncPullInput({
    installationId: "installation-1",
    platform: "ios",
    afterHotChangeId: 0,
    limit: 100,
    includeMediaAssets: true,
  });

  assert.equal(legacyInput.includeMediaAssets, undefined);
  assert.equal(mediaInput.includeMediaAssets, true);
});

test("parseSyncBootstrapInput accepts media asset opt-in for pull", () => {
  const input = parseSyncBootstrapInput({
    mode: "pull",
    installationId: "installation-1",
    platform: "ios",
    cursor: null,
    limit: 100,
    includeMediaAssets: true,
  });

  if (input.mode !== "pull") {
    assert.fail("Expected parsed bootstrap input to remain pull mode");
  }

  assert.equal(input.includeMediaAssets, true);
});

test("parseSyncBootstrapInput accepts media asset opt-in for push with empty entries", () => {
  const input = parseSyncBootstrapInput({
    mode: "push",
    installationId: "installation-1",
    platform: "ios",
    includeMediaAssets: true,
    entries: [],
  });

  if (input.mode !== "push") {
    assert.fail("Expected parsed bootstrap input to remain push mode");
  }

  assert.equal(input.includeMediaAssets, true);
  assert.deepEqual(input.entries, []);
});

test("parseSyncBootstrapInput accepts media_asset metadata entries for push", () => {
  const input = parseSyncBootstrapInput({
    mode: "push",
    installationId: "installation-1",
    platform: "ios",
    entries: [
      {
        entityType: "media_asset",
        entityId: mediaAssetId,
        action: "upsert",
        payload: {
          ...createMediaAssetPayload(null),
          lastModifiedByReplicaId: undefined,
        },
      },
    ],
  });

  if (input.mode !== "push") {
    assert.fail("Expected parsed bootstrap input to remain push mode");
  }

  const entry = input.entries[0];
  if (entry?.entityType !== "media_asset") {
    assert.fail("Expected parsed bootstrap entry to remain a media_asset");
  }

  assert.equal(Object.prototype.hasOwnProperty.call(entry.payload, "lastModifiedByReplicaId"), false);
  assert.equal(entry.payload.mediaAssetId, mediaAssetId);
});
