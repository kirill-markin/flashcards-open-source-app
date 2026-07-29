import type { DatabaseExecutor } from "../../database";
import { HttpError } from "../../shared/errors";
import {
  createSyncConflictHttpError,
  findSyncConflictWorkspaceIdInExecutor,
} from "../../sync/conflicts/fork";
import {
  incomingLwwMetadataWins,
  normalizeIsoTimestamp,
  type LwwMetadata,
} from "../../sync/conflicts/lww";
import {
  findLatestSyncChangeId,
  lockWorkspaceSyncMetadataForHotChangesInExecutor,
} from "../../sync/replication/changes";
import type {
  MediaAssetMutationMetadata,
  MediaAssetRow,
  MediaAssetSnapshotInput,
  MediaAssetSyncMutationResult,
  MediaBlobNormalizationVersion,
} from "../types";
import { isValidMediaAssetLastOperationId } from "../lastOperationId";
import { passthroughMediaBlobNormalizationVersion } from "../types";
import { expectMediaAssetSourceUrl } from "../validators";
import {
  upsertMediaBlobRowInExecutor,
} from "./blobs";
import {
  MEDIA_ASSET_COLUMNS,
  MEDIA_ASSET_JOIN_CLAUSE,
  mapMediaAssetRow,
  toIsoString,
  toSafeNumber,
} from "./rows";
import { recordMediaAssetSyncChange } from "./syncChanges";

function toMediaAssetLwwMetadata(row: MediaAssetRow): LwwMetadata {
  return {
    clientUpdatedAt: toIsoString(row.client_updated_at),
    lastModifiedByReplicaId: row.last_modified_by_replica_id,
    lastOperationId: row.last_operation_id,
  };
}

function toInputLwwMetadata(metadata: MediaAssetMutationMetadata): LwwMetadata {
  return {
    clientUpdatedAt: metadata.clientUpdatedAt,
    lastModifiedByReplicaId: metadata.lastModifiedByReplicaId,
    lastOperationId: metadata.lastOperationId,
  };
}

export function normalizeMediaAssetMutationMetadata(
  metadata: MediaAssetMutationMetadata,
): MediaAssetMutationMetadata {
  if (isValidMediaAssetLastOperationId(metadata.lastOperationId) === false) {
    throw new HttpError(
      400,
      "lastOperationId must be 1 to 1024 printable ASCII characters without leading or trailing spaces",
      "MEDIA_ASSET_LAST_OPERATION_ID_INVALID",
    );
  }

  return {
    clientUpdatedAt: normalizeIsoTimestamp(metadata.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByReplicaId: metadata.lastModifiedByReplicaId,
    lastOperationId: metadata.lastOperationId,
  };
}

export async function findMediaAssetRowForUpdateInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  mediaAssetId: string,
): Promise<MediaAssetRow | null> {
  const result = await executor.query<MediaAssetRow>(
    [
      "SELECT",
      MEDIA_ASSET_COLUMNS,
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.media_asset_id = $2",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, mediaAssetId],
  );

  return result.rows[0] ?? null;
}

export function normalizeMediaAssetSnapshotInput(input: MediaAssetSnapshotInput): MediaAssetSnapshotInput {
  if (Number.isSafeInteger(input.sizeBytes) === false || input.sizeBytes < 0) {
    throw new HttpError(400, "sizeBytes must be a non-negative safe integer", "MEDIA_ASSET_SIZE_INVALID");
  }

  return {
    mediaAssetId: input.mediaAssetId,
    mimeType: input.mimeType.trim().toLowerCase(),
    sizeBytes: input.sizeBytes,
    sha256: input.sha256.toLowerCase(),
    sourceUrl: expectMediaAssetSourceUrl(input.sourceUrl, "sourceUrl"),
    createdAt: normalizeIsoTimestamp(input.createdAt, "createdAt"),
    deletedAt: input.deletedAt === null ? null : normalizeIsoTimestamp(input.deletedAt, "deletedAt"),
  };
}

function assertExistingMediaAssetMatchesSnapshot(
  existingRow: MediaAssetRow,
  input: MediaAssetSnapshotInput,
): void {
  const existingSizeBytes = toSafeNumber(existingRow.size_bytes, "size_bytes");
  const conflictingFields = [
    ...(existingRow.mime_type === input.mimeType ? [] : ["mimeType"]),
    ...(existingSizeBytes === input.sizeBytes ? [] : ["sizeBytes"]),
    ...(existingRow.sha256 === input.sha256 ? [] : ["sha256"]),
  ];
  if (
    existingRow.mime_type !== input.mimeType
    || existingSizeBytes !== input.sizeBytes
    || existingRow.sha256 !== input.sha256
  ) {
    throw new HttpError(
      409,
      [
        "mediaAssetId is already registered with different file metadata",
        `workspaceId=${existingRow.workspace_id}`,
        `mediaAssetId=${existingRow.media_asset_id}`,
        `conflictingFields=${conflictingFields.join(",")}`,
      ].join(" "),
      "MEDIA_ASSET_ID_CONFLICT",
    );
  }
}

async function insertMediaAssetSnapshotRowInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: MediaAssetSnapshotInput,
  metadata: MediaAssetMutationMetadata,
  mediaBlobId: string,
): Promise<MediaAssetRow | null> {
  const result = await executor.query<MediaAssetRow>(
    [
      "WITH inserted_media_asset AS (",
      "INSERT INTO content.media_assets",
      "(",
      "media_asset_id, workspace_id, media_blob_id, source_url, created_at,",
      "client_updated_at, last_modified_by_replica_id, last_operation_id, deleted_at",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      "ON CONFLICT DO NOTHING",
      "RETURNING media_asset_id",
      ")",
      "SELECT",
      MEDIA_ASSET_COLUMNS,
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "INNER JOIN inserted_media_asset",
      "ON inserted_media_asset.media_asset_id = media_assets.media_asset_id",
    ].join(" "),
    [
      input.mediaAssetId,
      workspaceId,
      mediaBlobId,
      input.sourceUrl,
      input.createdAt,
      metadata.clientUpdatedAt,
      metadata.lastModifiedByReplicaId,
      metadata.lastOperationId,
      input.deletedAt,
    ],
  );

  return result.rows[0] ?? null;
}

async function resolveMediaAssetSnapshotInsertConflictInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  mediaAssetId: string,
): Promise<MediaAssetRow> {
  const conflictingWorkspaceId = await findSyncConflictWorkspaceIdInExecutor(executor, {
    entityType: "media_asset",
    entityId: mediaAssetId,
  });

  if (conflictingWorkspaceId === null) {
    throw new Error(`Media asset insert was skipped but no conflicting workspace was found for ${mediaAssetId}`);
  }

  if (conflictingWorkspaceId !== workspaceId) {
    throw createSyncConflictHttpError({
      phase: "sync_write",
      entityType: "media_asset",
      entityId: mediaAssetId,
      conflictingWorkspaceId,
      constraint: "media_assets_pkey",
      sqlState: "23505",
      table: "media_assets",
    });
  }

  const existingRow = await findMediaAssetRowForUpdateInExecutor(executor, workspaceId, mediaAssetId);
  if (existingRow === null) {
    throw new Error(`Media asset insert was skipped but the current workspace row was not found for ${mediaAssetId}`);
  }

  return existingRow;
}

async function updateExistingMediaAssetSnapshotRowInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: MediaAssetSnapshotInput,
  metadata: MediaAssetMutationMetadata,
): Promise<MediaAssetRow> {
  const result = await executor.query<MediaAssetRow>(
    [
      "WITH updated_media_asset AS (",
      "UPDATE content.media_assets",
      "SET source_url = $3,",
      "created_at = $4,",
      "deleted_at = $5,",
      "client_updated_at = $6,",
      "last_modified_by_replica_id = $7,",
      "last_operation_id = $8,",
      "updated_at = now()",
      "WHERE workspace_id = $1",
      "AND media_asset_id = $2",
      "RETURNING media_asset_id",
      ")",
      "SELECT",
      MEDIA_ASSET_COLUMNS,
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "INNER JOIN updated_media_asset",
      "ON updated_media_asset.media_asset_id = media_assets.media_asset_id",
    ].join(" "),
    [
      workspaceId,
      input.mediaAssetId,
      input.sourceUrl,
      input.createdAt,
      input.deletedAt,
      metadata.clientUpdatedAt,
      metadata.lastModifiedByReplicaId,
      metadata.lastOperationId,
    ],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(
      404,
      "Media asset was not found while completing upload.",
      "MEDIA_ASSET_NOT_FOUND",
    );
  }

  return row;
}

export async function upsertMediaAssetSnapshotWithBlobNormalizationInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: MediaAssetSnapshotInput,
  metadata: MediaAssetMutationMetadata,
  normalizationVersion: MediaBlobNormalizationVersion,
): Promise<MediaAssetSyncMutationResult> {
  const normalizedInput = normalizeMediaAssetSnapshotInput(input);
  const normalizedMetadata = normalizeMediaAssetMutationMetadata(metadata);
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, workspaceId);

  let existingRow = await findMediaAssetRowForUpdateInExecutor(executor, workspaceId, normalizedInput.mediaAssetId);
  if (existingRow === null) {
    const mediaBlobRow = await upsertMediaBlobRowInExecutor(executor, normalizedInput, normalizationVersion);
    const insertedRow = await insertMediaAssetSnapshotRowInExecutor(
      executor,
      workspaceId,
      normalizedInput,
      normalizedMetadata,
      mediaBlobRow.media_blob_id,
    );

    if (insertedRow === null) {
      existingRow = await resolveMediaAssetSnapshotInsertConflictInExecutor(
        executor,
        workspaceId,
        normalizedInput.mediaAssetId,
      );
    } else {
      const insertedMediaAsset = mapMediaAssetRow(insertedRow);
      return {
        mediaAsset: insertedMediaAsset,
        applied: true,
        changeId: await recordMediaAssetSyncChange(executor, workspaceId, hotChangeWriteLock, insertedMediaAsset),
      };
    }
  }

  assertExistingMediaAssetMatchesSnapshot(existingRow, normalizedInput);
  const existingMediaAsset = mapMediaAssetRow(existingRow);
  if (incomingLwwMetadataWins(toInputLwwMetadata(normalizedMetadata), toMediaAssetLwwMetadata(existingRow)) === false) {
    const existingChangeId = await findLatestSyncChangeId(
      executor,
      workspaceId,
      "media_asset",
      existingMediaAsset.mediaAssetId,
    );
    const changeId = existingChangeId === null
      ? await recordMediaAssetSyncChange(executor, workspaceId, hotChangeWriteLock, existingMediaAsset)
      : existingChangeId;
    return {
      mediaAsset: existingMediaAsset,
      applied: false,
      changeId,
    };
  }

  const updatedRow = await updateExistingMediaAssetSnapshotRowInExecutor(
    executor,
    workspaceId,
    normalizedInput,
    normalizedMetadata,
  );
  const updatedMediaAsset = mapMediaAssetRow(updatedRow);

  return {
    mediaAsset: updatedMediaAsset,
    applied: true,
    changeId: await recordMediaAssetSyncChange(executor, workspaceId, hotChangeWriteLock, updatedMediaAsset),
  };
}

export async function upsertMediaAssetSnapshotInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: MediaAssetSnapshotInput,
  metadata: MediaAssetMutationMetadata,
): Promise<MediaAssetSyncMutationResult> {
  return upsertMediaAssetSnapshotWithBlobNormalizationInExecutor(
    executor,
    workspaceId,
    input,
    metadata,
    passthroughMediaBlobNormalizationVersion,
  );
}
