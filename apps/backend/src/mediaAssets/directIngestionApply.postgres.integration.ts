import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { DatabaseDeadlineExceededError } from "../database";
import { HttpError } from "../shared/errors";
import {
  type PostgresIntegrationFixture,
  withPostgresIntegrationFixture,
} from "../testSupport/postgresIntegration";
import {
  applyImageNormalizedMediaAssetWithDirectWriterForWorkspace,
  replayImageNormalizedMediaAssetForWorkspace,
} from ".";
import {
  beginDirectMediaBlobWriterAttemptWithOwner,
  type DirectMediaBlobWriterAttemptExactInput,
  type DirectMediaBlobWriterAttemptInput,
} from "./blobLifecycle";
import { buildMediaBlobStorageKey } from "./storageKeys";
import {
  imageJpegCardMediaBlobNormalizationVersion,
  type NormalizedImageMediaAssetInput,
} from "./types";

function createSha256(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function createNormalizedInput(
  fixture: PostgresIntegrationFixture,
  mediaAssetId: string,
  sha256: string,
  operationId: string,
): NormalizedImageMediaAssetInput {
  return {
    mediaAssetId,
    sourceUrl: null,
    createdAt: fixture.createdAt,
    clientUpdatedAt: fixture.createdAt,
    lastModifiedByReplicaId: fixture.replicaId,
    lastOperationId: operationId,
    sizeBytes: 42,
    sha256,
  };
}

function toAttemptInput(
  fixture: PostgresIntegrationFixture,
  input: NormalizedImageMediaAssetInput,
): DirectMediaBlobWriterAttemptInput {
  return {
    attemptToken: randomUUID(),
    userId: fixture.userId,
    workspaceId: fixture.workspaceId,
    mediaAssetId: input.mediaAssetId,
    operationId: input.lastOperationId,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    sha256: input.sha256,
    storageKey: buildMediaBlobStorageKey(input.sha256),
    mimeType: "image/jpeg",
    sizeBytes: input.sizeBytes,
    normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
    sourceUrl: input.sourceUrl,
    assetCreatedAt: input.createdAt,
    clientUpdatedAt: input.clientUpdatedAt,
  };
}

async function acquireExactAttempt(
  fixture: PostgresIntegrationFixture,
  input: NormalizedImageMediaAssetInput,
): Promise<DirectMediaBlobWriterAttemptExactInput> {
  const attemptInput = toAttemptInput(fixture, input);
  const attempt = await beginDirectMediaBlobWriterAttemptWithOwner(
    attemptInput,
    {
      leaseTargetAt: new Date(Date.now() + 10_000).toISOString(),
      operationDeadlineAt: new Date(Date.now() + 5_000).toISOString(),
    },
  );
  if (!("reservationToken" in attempt)) {
    throw new Error(
      `Direct ingestion integration attempt was not acquired. status=${attempt.status}`,
    );
  }
  return {
    ...attemptInput,
    reservationToken: attempt.reservationToken,
    normalizationVersion: attempt.normalizationVersion,
  };
}

function hasSqlState(error: unknown, sqlState: string): boolean {
  return typeof error === "object"
    && error !== null
    && (
      ("code" in error && error.code === sqlState)
      || ("sqlState" in error && error.sqlState === sqlState)
      || ("errorCode" in error && error.errorCode === sqlState)
    );
}

test("direct ingestion apply and replay glue preserves exact, conflict, tombstone, and deadline contracts", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const exactInput = createNormalizedInput(
      fixture,
      randomUUID(),
      createSha256(),
      `direct-exact-${randomUUID()}`,
    );
    const exactWriter = await acquireExactAttempt(fixture, exactInput);
    const applied = await applyImageNormalizedMediaAssetWithDirectWriterForWorkspace(
      fixture.userId,
      fixture.workspaceId,
      exactInput,
      exactWriter,
      new Date(Date.now() + 5_000).toISOString(),
    );
    assert.equal(applied.applied, true);

    const exactReplay = await applyImageNormalizedMediaAssetWithDirectWriterForWorkspace(
      fixture.userId,
      fixture.workspaceId,
      exactInput,
      exactWriter,
      new Date(Date.now() + 5_000).toISOString(),
    );
    assert.equal(exactReplay.applied, false);
    assert.equal(exactReplay.mediaAsset.mediaAssetId, exactInput.mediaAssetId);

    const tombstoneUpdatedAt = new Date(Date.now() + 60_000).toISOString();
    await fixture.ownerPool.query(
      `UPDATE content.media_assets
       SET deleted_at = $2, client_updated_at = $2, last_operation_id = $3
       WHERE media_asset_id = $1`,
      [
        exactInput.mediaAssetId,
        tombstoneUpdatedAt,
        `direct-tombstone-${randomUUID()}`,
      ],
    );
    const peerInput: NormalizedImageMediaAssetInput = {
      ...exactInput,
      lastOperationId: `direct-peer-${randomUUID()}`,
    };
    const peerAttempt = await beginDirectMediaBlobWriterAttemptWithOwner(
      toAttemptInput(fixture, peerInput),
      {
        leaseTargetAt: new Date(Date.now() + 10_000).toISOString(),
        operationDeadlineAt: new Date(Date.now() + 5_000).toISOString(),
      },
    );
    assert.equal(peerAttempt.status, "peer_conflict");
    const tombstoneReplay = await replayImageNormalizedMediaAssetForWorkspace(
      fixture.userId,
      fixture.workspaceId,
      peerInput,
      "peer_conflict",
      Date.now() + 5_000,
    );
    assert.equal(tombstoneReplay.applied, false);
    assert.equal(tombstoneReplay.mediaAsset.deletedAt, tombstoneUpdatedAt);

    await assert.rejects(
      replayImageNormalizedMediaAssetForWorkspace(
        fixture.userId,
        fixture.workspaceId,
        { ...peerInput, sha256: createSha256() },
        "peer_conflict",
        Date.now() + 5_000,
      ),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "MEDIA_ASSET_ID_CONFLICT");
        assert.doesNotMatch(error.message, /sha256|storage|workspaceId=/i);
        return true;
      },
    );

    const otherUserId = `direct-cross-workspace-${randomUUID()}`;
    const otherWorkspaceId = fixture.outOfScopeWorkspaceId;
    const otherReplicaId = randomUUID();
    const otherMediaAssetId = randomUUID();
    const otherSha256 = createSha256();
    const otherMediaBlobId = randomUUID();
    try {
      const setupClient = await fixture.ownerPool.connect();
      try {
        await setupClient.query("BEGIN");
        await setupClient.query(
          "INSERT INTO org.user_settings (user_id) VALUES ($1)",
          [otherUserId],
        );
        await setupClient.query(
          `INSERT INTO org.workspaces (
             workspace_id, name, fsrs_client_updated_at,
             fsrs_last_modified_by_replica_id, fsrs_last_operation_id
           ) VALUES ($1, 'Direct ingestion replay isolation', $2, $3, $4)`,
          [
            otherWorkspaceId,
            fixture.createdAt,
            otherReplicaId,
            `direct-cross-workspace-${otherWorkspaceId}`,
          ],
        );
        await setupClient.query(
          `INSERT INTO org.workspace_memberships (workspace_id, user_id, role)
           VALUES ($1, $2, 'owner')`,
          [otherWorkspaceId, otherUserId],
        );
        await setupClient.query(
          `INSERT INTO sync.workspace_replicas (
             replica_id, workspace_id, user_id, actor_kind, actor_key, platform, app_version
           ) VALUES ($1, $2, $3, 'ai_chat', $4, 'system', 'postgres-integration')`,
          [
            otherReplicaId,
            otherWorkspaceId,
            otherUserId,
            `postgres-integration-${otherReplicaId}`,
          ],
        );
        await setupClient.query("COMMIT");
      } catch (error) {
        await setupClient.query("ROLLBACK");
        throw error;
      } finally {
        setupClient.release();
      }
      await fixture.ownerPool.query(
        `INSERT INTO content.media_blobs (
           media_blob_id, sha256, mime_type, size_bytes, storage_key, normalization_version
         ) VALUES ($1, $2, 'image/jpeg', 42, $3, $4)`,
        [
          otherMediaBlobId,
          otherSha256,
          buildMediaBlobStorageKey(otherSha256),
          imageJpegCardMediaBlobNormalizationVersion,
        ],
      );
      await fixture.ownerPool.query(
        `INSERT INTO content.media_assets (
           media_asset_id, workspace_id, media_blob_id, source_url, created_at,
           client_updated_at, last_modified_by_replica_id, last_operation_id
         ) VALUES ($1, $2, $3, NULL, $4, $4, $5, $6)`,
        [
          otherMediaAssetId,
          otherWorkspaceId,
          otherMediaBlobId,
          fixture.createdAt,
          otherReplicaId,
          `direct-cross-workspace-${randomUUID()}`,
        ],
      );
      const crossWorkspaceInput = createNormalizedInput(
        fixture,
        otherMediaAssetId,
        otherSha256,
        `direct-cross-replay-${randomUUID()}`,
      );
      await assert.rejects(
        replayImageNormalizedMediaAssetForWorkspace(
          fixture.userId,
          fixture.workspaceId,
          crossWorkspaceInput,
          "peer_conflict",
          Date.now() + 5_000,
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "MEDIA_ASSET_ID_CONFLICT");
          assert.doesNotMatch(error.message, new RegExp(otherWorkspaceId, "i"));
          assert.equal(error.details, null);
          return true;
        },
      );
    } finally {
      await fixture.ownerPool.query(
        "DELETE FROM org.workspaces WHERE workspace_id = $1",
        [otherWorkspaceId],
      );
      await fixture.ownerPool.query(
        "DELETE FROM content.media_blobs WHERE media_blob_id = $1",
        [otherMediaBlobId],
      );
      await fixture.ownerPool.query(
        "DELETE FROM org.user_settings WHERE user_id = $1",
        [otherUserId],
      );
    }

    const deadlineInput = createNormalizedInput(
      fixture,
      randomUUID(),
      createSha256(),
      `direct-deadline-${randomUUID()}`,
    );
    const deadlineWriter = await acquireExactAttempt(fixture, deadlineInput);
    const blocker = await fixture.ownerPool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended('direct:' || $1::text || ':' || $2::text || ':' || $3, 2)
         )`,
        [
          fixture.workspaceId,
          deadlineInput.mediaAssetId,
          deadlineInput.lastOperationId,
        ],
      );
      await assert.rejects(
        applyImageNormalizedMediaAssetWithDirectWriterForWorkspace(
          fixture.userId,
          fixture.workspaceId,
          deadlineInput,
          deadlineWriter,
          new Date(Date.now() + 500).toISOString(),
        ),
        (error: unknown) => (
          error instanceof DatabaseDeadlineExceededError
          || hasSqlState(error, "57014")
          || hasSqlState(error, "55P03")
        ),
      );
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    const deadlineAsset = await fixture.ownerPool.query(
      "SELECT 1 FROM content.media_assets WHERE media_asset_id = $1",
      [deadlineInput.mediaAssetId],
    );
    assert.equal(deadlineAsset.rows.length, 0);

    await assert.rejects(
      replayImageNormalizedMediaAssetForWorkspace(
        fixture.userId,
        fixture.workspaceId,
        exactInput,
        "live_applied",
        Date.now() - 1,
      ),
      DatabaseDeadlineExceededError,
    );
  });
});
