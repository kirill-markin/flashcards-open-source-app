import {
  queryWithWorkspaceScopeReadOnly,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../database";
import { HttpError } from "../shared/errors";
import {
  incomingLwwMetadataWins,
  normalizeIsoTimestamp,
  type LwwMetadata,
} from "../sync/conflicts/lww";
import {
  findLatestSyncChangeId,
  insertSyncChange,
  lockWorkspaceSyncMetadataForHotChangesInExecutor,
  type HotChangeWriteLock,
} from "../sync/replication/changes";
import {
  createSyncConflictHttpError,
  findSyncConflictWorkspaceIdInExecutor,
} from "../sync/conflicts/fork";
import { buildMediaBlobStorageKey } from "./storageKeys";
import {
  mediaBlobNormalizationVersions,
  passthroughMediaBlobNormalizationVersion,
} from "./types";
import type {
  CompleteMediaAssetUploadInput,
  MediaAsset,
  MediaAssetWithBlob,
  MediaBlob,
  MediaBlobNormalizationVersion,
  MediaBlobRow,
  MediaAssetMutationMetadata,
  MediaAssetMutationResult,
  MediaAssetRow,
  MediaAssetSnapshotInput,
  MediaAssetSyncMutationResult,
  MediaAssetUploadSession,
  MediaAssetUploadSessionAbortStartResult,
  MediaAssetUploadSessionCompletionStartResult,
  MediaAssetUploadSessionCreateInput,
  MediaAssetUploadSessionCreateResult,
  MediaAssetUploadSessionRow,
  MediaAssetUploadSessionState,
  TimestampValue,
} from "./types";
import { expectMediaAssetSourceUrl } from "./validators";

export const MEDIA_ASSET_COLUMNS = [
  "media_assets.media_asset_id AS media_asset_id",
  "media_assets.workspace_id AS workspace_id",
  "media_assets.media_blob_id AS media_blob_id",
  "media_blobs.mime_type AS mime_type",
  "media_blobs.size_bytes AS size_bytes",
  "media_blobs.sha256 AS sha256",
  "media_blobs.storage_key AS storage_key",
  "media_blobs.normalization_version AS blob_normalization_version",
  "media_blobs.created_at AS blob_created_at",
  "media_blobs.updated_at AS blob_updated_at",
  "media_assets.source_url AS source_url",
  "media_assets.created_at AS created_at",
  "media_assets.client_updated_at AS client_updated_at",
  "media_assets.last_modified_by_replica_id AS last_modified_by_replica_id",
  "media_assets.last_operation_id AS last_operation_id",
  "media_assets.updated_at AS updated_at",
  "media_assets.deleted_at AS deleted_at",
].join(", ");

export const MEDIA_ASSET_JOIN_CLAUSE = [
  "content.media_assets AS media_assets",
  "INNER JOIN content.media_blobs AS media_blobs",
  "ON media_blobs.media_blob_id = media_assets.media_blob_id",
].join(" ");

const MEDIA_BLOB_COLUMNS = [
  "media_blob_id",
  "mime_type",
  "size_bytes",
  "sha256",
  "storage_key",
  "normalization_version",
  "created_at",
  "updated_at",
].join(", ");

const MEDIA_UPLOAD_SESSION_COLUMNS = [
  "media_upload_session_id",
  "workspace_id",
  "media_asset_id",
  "media_blob_sha256",
  "staging_storage_key",
  "blob_storage_key",
  "s3_upload_id",
  "mime_type",
  "size_bytes",
  "part_size_bytes",
  "part_count",
  "state",
  "source_url",
  "asset_created_at",
  "client_updated_at",
  "last_modified_by_replica_id",
  "last_operation_id",
  "expires_at",
  "created_at",
  "completed_at",
  "aborted_at",
].join(", ");

type ExistingMediaAssetIntentRow = Readonly<{
  ok: number;
}>;

function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function toOptionalIsoString(value: TimestampValue | null): string | null {
  return value === null ? null : toIsoString(value);
}

function toSafeNumber(value: string | number, fieldName: string): number {
  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (Number.isSafeInteger(parsedValue) === false) {
    throw new Error(`${fieldName} must be a safe integer`);
  }

  return parsedValue;
}

function expectMediaBlobNormalizationVersion(value: string): MediaBlobNormalizationVersion {
  const version = mediaBlobNormalizationVersions.find((knownVersion) => knownVersion === value);
  if (version === undefined) {
    throw new Error(`normalization_version is unsupported: ${value}`);
  }

  return version;
}

export function mapMediaAssetRow(row: MediaAssetRow): MediaAsset {
  return {
    mediaAssetId: row.media_asset_id,
    workspaceId: row.workspace_id,
    mimeType: row.mime_type,
    sizeBytes: toSafeNumber(row.size_bytes, "size_bytes"),
    sha256: row.sha256,
    sourceUrl: row.source_url,
    createdAt: toIsoString(row.created_at),
    clientUpdatedAt: toIsoString(row.client_updated_at),
    lastModifiedByReplicaId: row.last_modified_by_replica_id,
    lastOperationId: row.last_operation_id,
    updatedAt: toIsoString(row.updated_at),
    deletedAt: toOptionalIsoString(row.deleted_at),
  };
}

export function mapMediaBlobRow(row: MediaBlobRow): MediaBlob {
  return {
    mediaBlobId: row.media_blob_id,
    mimeType: row.mime_type,
    sizeBytes: toSafeNumber(row.size_bytes, "size_bytes"),
    sha256: row.sha256,
    storageKey: row.storage_key,
    normalizationVersion: expectMediaBlobNormalizationVersion(row.normalization_version),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export function mapMediaAssetUploadSessionRow(row: MediaAssetUploadSessionRow): MediaAssetUploadSession {
  return {
    sessionId: row.media_upload_session_id,
    workspaceId: row.workspace_id,
    mediaAssetId: row.media_asset_id,
    mediaBlobSha256: row.media_blob_sha256,
    stagingStorageKey: row.staging_storage_key,
    blobStorageKey: row.blob_storage_key,
    s3UploadId: row.s3_upload_id,
    mimeType: row.mime_type,
    sizeBytes: toSafeNumber(row.size_bytes, "size_bytes"),
    partSizeBytes: toSafeNumber(row.part_size_bytes, "part_size_bytes"),
    partCount: toSafeNumber(row.part_count, "part_count"),
    state: row.state,
    sourceUrl: row.source_url,
    assetCreatedAt: toIsoString(row.asset_created_at),
    clientUpdatedAt: toIsoString(row.client_updated_at),
    lastModifiedByReplicaId: row.last_modified_by_replica_id,
    lastOperationId: row.last_operation_id,
    expiresAt: toIsoString(row.expires_at),
    createdAt: toIsoString(row.created_at),
    completedAt: toOptionalIsoString(row.completed_at),
    abortedAt: toOptionalIsoString(row.aborted_at),
  };
}

function mapMediaAssetWithBlobRow(row: MediaAssetRow): MediaAssetWithBlob {
  return {
    mediaAsset: mapMediaAssetRow(row),
    mediaBlob: {
      mediaBlobId: row.media_blob_id,
      mimeType: row.mime_type,
      sizeBytes: toSafeNumber(row.size_bytes, "size_bytes"),
      sha256: row.sha256,
      storageKey: row.storage_key,
      normalizationVersion: expectMediaBlobNormalizationVersion(row.blob_normalization_version),
      createdAt: toIsoString(row.blob_created_at),
      updatedAt: toIsoString(row.blob_updated_at),
    },
  };
}

export async function assertMediaAssetUploadIntentAvailableForWorkspace(
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
): Promise<void> {
  const result = await queryWithWorkspaceScopeReadOnly<ExistingMediaAssetIntentRow>(
    { userId, workspaceId },
    [
      "SELECT 1 AS ok",
      "FROM content.media_assets",
      "WHERE workspace_id = $1",
      "AND media_asset_id = $2",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, mediaAssetId],
  );

  const existingRow = result.rows[0];
  if (existingRow === undefined) {
    return;
  }

  throw new HttpError(
    409,
    [
      "Media asset is already registered; create a new mediaAssetId before requesting another upload session.",
      `workspaceId=${workspaceId}`,
      `mediaAssetId=${mediaAssetId}`,
    ].join(" "),
    "MEDIA_ASSET_ALREADY_REGISTERED",
  );
}

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

function normalizeMediaAssetMutationMetadata(
  metadata: MediaAssetMutationMetadata,
): MediaAssetMutationMetadata {
  return {
    clientUpdatedAt: normalizeIsoTimestamp(metadata.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByReplicaId: metadata.lastModifiedByReplicaId,
    lastOperationId: metadata.lastOperationId,
  };
}

async function assertReplicaBelongsToWorkspaceInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  replicaId: string,
): Promise<void> {
  const result = await executor.query<Readonly<{ ok: number }>>(
    [
      "SELECT 1 AS ok",
      "FROM sync.workspace_replicas",
      "WHERE workspace_id = $1",
      "AND replica_id = $2",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, replicaId],
  );

  if (result.rows.length === 0) {
    throw new HttpError(
      400,
      "lastModifiedByReplicaId must reference a workspace replica accessible to the authenticated user.",
      "MEDIA_ASSET_REPLICA_INVALID",
    );
  }
}

async function findMediaAssetRowForUpdateInExecutor(
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

function normalizeMediaAssetSnapshotInput(input: MediaAssetSnapshotInput): MediaAssetSnapshotInput {
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

function assertMediaBlobMatchesInput(row: MediaBlobRow, input: MediaAssetSnapshotInput): void {
  const existingSizeBytes = toSafeNumber(row.size_bytes, "size_bytes");
  const expectedStorageKey = buildMediaBlobStorageKey(input.sha256);
  if (
    row.mime_type === input.mimeType
    && existingSizeBytes === input.sizeBytes
    && row.sha256 === input.sha256
    && row.storage_key === expectedStorageKey
  ) {
    return;
  }

  throw new HttpError(
    409,
    [
      "Media bytes are already registered with different metadata.",
      "conflictingFields=mimeType,sizeBytes,sha256",
    ].join(" "),
    "MEDIA_BLOB_METADATA_CONFLICT",
  );
}

async function findMediaBlobRowBySha256InExecutor(
  executor: DatabaseExecutor,
  sha256: string,
): Promise<MediaBlobRow | null> {
  const result = await executor.query<MediaBlobRow>(
    [
      "SELECT",
      MEDIA_BLOB_COLUMNS,
      "FROM content.media_blobs",
      "WHERE sha256 = $1",
      "LIMIT 1",
    ].join(" "),
    [sha256],
  );

  return result.rows[0] ?? null;
}

function toMediaAssetSnapshotInputFromUploadSessionCreate(
  input: MediaAssetUploadSessionCreateInput,
): MediaAssetSnapshotInput {
  return {
    mediaAssetId: input.mediaAssetId,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    sourceUrl: input.sourceUrl,
    createdAt: input.createdAt,
    deletedAt: null,
  };
}

function toMediaAssetSnapshotInputFromUploadSession(
  session: MediaAssetUploadSession,
): MediaAssetSnapshotInput {
  return {
    mediaAssetId: session.mediaAssetId,
    mimeType: session.mimeType,
    sizeBytes: session.sizeBytes,
    sha256: session.mediaBlobSha256,
    sourceUrl: session.sourceUrl,
    createdAt: session.assetCreatedAt,
    deletedAt: null,
  };
}

function toMediaAssetMutationMetadataFromUploadSessionCreate(
  input: MediaAssetUploadSessionCreateInput,
): MediaAssetMutationMetadata {
  return {
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId,
  };
}

function toMediaAssetMutationMetadataFromUploadSession(
  session: MediaAssetUploadSession,
): MediaAssetMutationMetadata {
  return {
    clientUpdatedAt: session.clientUpdatedAt,
    lastModifiedByReplicaId: session.lastModifiedByReplicaId,
    lastOperationId: session.lastOperationId,
  };
}

async function findReachableMediaBlobForUploadSessionCreateInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: MediaAssetUploadSessionCreateInput,
): Promise<MediaBlobRow | null> {
  const normalizedInput = normalizeMediaAssetSnapshotInput(toMediaAssetSnapshotInputFromUploadSessionCreate(input));
  const result = await executor.query<MediaBlobRow>(
    [
      "SELECT",
      [
        "media_blobs.media_blob_id AS media_blob_id",
        "media_blobs.mime_type AS mime_type",
        "media_blobs.size_bytes AS size_bytes",
        "media_blobs.sha256 AS sha256",
        "media_blobs.storage_key AS storage_key",
        "media_blobs.normalization_version AS normalization_version",
        "media_blobs.created_at AS created_at",
        "media_blobs.updated_at AS updated_at",
      ].join(", "),
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.deleted_at IS NULL",
      "AND media_blobs.sha256 = $2",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, normalizedInput.sha256],
  );
  const row = result.rows[0] ?? null;
  if (row === null) {
    return null;
  }

  assertMediaBlobMatchesInput(row, normalizedInput);
  return row;
}

async function upsertMediaBlobRowInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetSnapshotInput,
): Promise<MediaBlobRow> {
  const storageKey = buildMediaBlobStorageKey(input.sha256);
  const insertResult = await executor.query<MediaBlobRow>(
    [
      "INSERT INTO content.media_blobs",
      "(media_blob_id, sha256, mime_type, size_bytes, storage_key, normalization_version)",
      "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)",
      "ON CONFLICT (sha256) DO NOTHING",
      "RETURNING",
      MEDIA_BLOB_COLUMNS,
    ].join(" "),
    [input.sha256, input.mimeType, input.sizeBytes, storageKey, passthroughMediaBlobNormalizationVersion],
  );

  const insertedRow = insertResult.rows[0];
  const row = insertedRow ?? await findMediaBlobRowBySha256InExecutor(executor, input.sha256);
  if (row === null) {
    throw new Error("Media bytes insert conflicted but no row was found");
  }

  assertMediaBlobMatchesInput(row, input);
  return row;
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

async function recordMediaAssetSyncChange(
  executor: DatabaseExecutor,
  workspaceId: string,
  hotChangeWriteLock: HotChangeWriteLock,
  mediaAsset: MediaAsset,
): Promise<number> {
  return insertSyncChange(
    executor,
    workspaceId,
    hotChangeWriteLock,
    "media_asset",
    mediaAsset.mediaAssetId,
    "upsert",
    mediaAsset.lastModifiedByReplicaId,
    mediaAsset.lastOperationId,
    mediaAsset.clientUpdatedAt,
  );
}

export async function upsertMediaAssetSnapshotInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: MediaAssetSnapshotInput,
  metadata: MediaAssetMutationMetadata,
): Promise<MediaAssetSyncMutationResult> {
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, workspaceId);
  const normalizedInput = normalizeMediaAssetSnapshotInput(input);
  const normalizedMetadata = normalizeMediaAssetMutationMetadata(metadata);

  let existingRow = await findMediaAssetRowForUpdateInExecutor(executor, workspaceId, normalizedInput.mediaAssetId);
  if (existingRow === null) {
    const mediaBlobRow = await upsertMediaBlobRowInExecutor(executor, normalizedInput);
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
    return {
      mediaAsset: existingMediaAsset,
      applied: false,
      changeId: await findLatestSyncChangeId(executor, workspaceId, "media_asset", existingMediaAsset.mediaAssetId),
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

export async function completeMediaAssetUploadForWorkspace(
  userId: string,
  workspaceId: string,
  input: CompleteMediaAssetUploadInput,
): Promise<MediaAssetMutationResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, input.lastModifiedByReplicaId);
    const result = await upsertMediaAssetSnapshotInExecutor(
      executor,
      workspaceId,
      {
        mediaAssetId: input.mediaAssetId,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        sourceUrl: input.sourceUrl,
        createdAt: input.createdAt,
        deletedAt: null,
      },
      {
        clientUpdatedAt: input.clientUpdatedAt,
        lastModifiedByReplicaId: input.lastModifiedByReplicaId,
        lastOperationId: input.lastOperationId,
      },
    );

    return {
      mediaAsset: result.mediaAsset,
      applied: result.applied,
    };
  });
}

export async function createMediaAssetFromReachableBlobForWorkspace(
  userId: string,
  workspaceId: string,
  input: MediaAssetUploadSessionCreateInput,
): Promise<MediaAssetMutationResult | null> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, input.lastModifiedByReplicaId);
    const mediaBlobRow = await findReachableMediaBlobForUploadSessionCreateInExecutor(executor, workspaceId, input);
    if (mediaBlobRow === null) {
      return null;
    }

    const result = await upsertMediaAssetSnapshotInExecutor(
      executor,
      workspaceId,
      toMediaAssetSnapshotInputFromUploadSessionCreate(input),
      toMediaAssetMutationMetadataFromUploadSessionCreate(input),
    );

    return {
      mediaAsset: result.mediaAsset,
      applied: result.applied,
    };
  });
}

export async function createMediaAssetFromAvailableBlobForWorkspace(
  userId: string,
  workspaceId: string,
  input: MediaAssetUploadSessionCreateInput,
): Promise<MediaAssetMutationResult | null> {
  return createMediaAssetFromReachableBlobForWorkspace(userId, workspaceId, input);
}

async function findMediaAssetUploadSessionRowForUpdateInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSessionRow | null> {
  const result = await executor.query<MediaAssetUploadSessionRow>(
    [
      "SELECT",
      MEDIA_UPLOAD_SESSION_COLUMNS,
      "FROM content.media_upload_sessions",
      "WHERE workspace_id = $1",
      "AND media_upload_session_id = $2",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, sessionId],
  );

  return result.rows[0] ?? null;
}

function createMediaAssetUploadSessionNotFoundError(sessionId: string): HttpError {
  return new HttpError(
    404,
    `Media asset upload session not found. sessionId=${sessionId}`,
    "MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND",
  );
}

function assertMediaAssetUploadSessionActive(session: MediaAssetUploadSession): void {
  assertMediaAssetUploadSessionState(session, "active");

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    throw new HttpError(
      409,
      `Media asset upload session is expired. sessionId=${session.sessionId} expiresAt=${session.expiresAt}`,
      "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED",
    );
  }
}

function assertMediaAssetUploadSessionState(
  session: MediaAssetUploadSession,
  expectedState: MediaAssetUploadSessionState,
): void {
  if (session.state === expectedState) {
    return;
  }

  if (session.state === "completed") {
    throw new HttpError(
      409,
      `Media asset upload session is already completed. sessionId=${session.sessionId}`,
      "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED",
    );
  }

  if (session.state === "aborted") {
    throw new HttpError(
      409,
      `Media asset upload session is already aborted. sessionId=${session.sessionId}`,
      "MEDIA_ASSET_UPLOAD_SESSION_ABORTED",
    );
  }

  throw new HttpError(
    409,
    `Media asset upload session is ${session.state}; expected ${expectedState}. sessionId=${session.sessionId}`,
    "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
  );
}

function assertMediaAssetUploadSessionCanComplete(session: MediaAssetUploadSession): void {
  if (session.state === "completing") {
    return;
  }

  if (session.state === "active") {
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new HttpError(
        409,
        `Media asset upload session is expired. sessionId=${session.sessionId} expiresAt=${session.expiresAt}`,
        "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED",
      );
    }

    return;
  }

  assertMediaAssetUploadSessionState(session, "completing");
}

function assertMediaAssetUploadSessionCanAbort(session: MediaAssetUploadSession): void {
  if (session.state === "active" || session.state === "aborting") {
    return;
  }

  assertMediaAssetUploadSessionState(session, "aborting");
}

export function assertMediaAssetUploadSessionPartNumbersInRange(
  session: MediaAssetUploadSession,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): void {
  for (const part of parts) {
    if (part.partNumber > session.partCount) {
      throw new HttpError(
        400,
        `partNumber must be between 1 and ${session.partCount} for this upload session`,
        "MEDIA_ASSET_PART_NUMBER_OUT_OF_RANGE",
      );
    }
  }
}

export function assertMediaAssetUploadSessionCompletionPartsMatch(
  session: MediaAssetUploadSession,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): void {
  if (parts.length !== session.partCount) {
    throw new HttpError(
      400,
      `parts must contain exactly ${session.partCount} completed parts for this upload session`,
      "MEDIA_ASSET_PART_COUNT_MISMATCH",
    );
  }

  const sortedPartNumbers = parts.map((part) => part.partNumber).sort((left, right) => left - right);
  for (let index = 0; index < sortedPartNumbers.length; index += 1) {
    const expectedPartNumber = index + 1;
    if (sortedPartNumbers[index] !== expectedPartNumber) {
      throw new HttpError(
        400,
        "parts must contain every partNumber from 1 through the upload session partCount",
        "MEDIA_ASSET_PART_SEQUENCE_INVALID",
      );
    }
  }
}

export async function recordMediaAssetUploadSessionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
  input: MediaAssetUploadSessionCreateInput,
  stagingStorageKey: string,
  blobStorageKey: string,
  s3UploadId: string,
  expiresAt: string,
): Promise<MediaAssetUploadSessionCreateResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, input.lastModifiedByReplicaId);
    const existingMediaBlobRow = await findReachableMediaBlobForUploadSessionCreateInExecutor(
      executor,
      workspaceId,
      input,
    );
    if (existingMediaBlobRow !== null) {
      const result = await upsertMediaAssetSnapshotInExecutor(
        executor,
        workspaceId,
        toMediaAssetSnapshotInputFromUploadSessionCreate(input),
        toMediaAssetMutationMetadataFromUploadSessionCreate(input),
      );

      return {
        status: "already_available",
        mediaAsset: result.mediaAsset,
        applied: result.applied,
      };
    }

    const normalizedSnapshot = normalizeMediaAssetSnapshotInput(toMediaAssetSnapshotInputFromUploadSessionCreate(input));
    const normalizedMetadata = normalizeMediaAssetMutationMetadata(
      toMediaAssetMutationMetadataFromUploadSessionCreate(input),
    );
    const result = await executor.query<MediaAssetUploadSessionRow>(
      [
        "INSERT INTO content.media_upload_sessions",
        "(",
        "media_upload_session_id, workspace_id, media_asset_id, media_blob_sha256, staging_storage_key,",
        "blob_storage_key, s3_upload_id, mime_type, size_bytes, part_size_bytes, part_count, state, source_url,",
        "asset_created_at, client_updated_at, last_modified_by_replica_id, last_operation_id, expires_at",
        ")",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12, $13, $14, $15, $16, $17)",
        "RETURNING",
        MEDIA_UPLOAD_SESSION_COLUMNS,
      ].join(" "),
      [
        sessionId,
        workspaceId,
        normalizedSnapshot.mediaAssetId,
        normalizedSnapshot.sha256,
        stagingStorageKey,
        blobStorageKey,
        s3UploadId,
        normalizedSnapshot.mimeType,
        normalizedSnapshot.sizeBytes,
        input.partSizeBytes,
        input.partCount,
        normalizedSnapshot.sourceUrl,
        normalizedSnapshot.createdAt,
        normalizedMetadata.clientUpdatedAt,
        normalizedMetadata.lastModifiedByReplicaId,
        normalizedMetadata.lastOperationId,
        expiresAt,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Media asset upload session insert did not return a row");
    }

    return {
      status: "upload_required",
      uploadSession: mapMediaAssetUploadSessionRow(row),
    };
  });
}

export async function loadMediaAssetUploadSessionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  const result = await queryWithWorkspaceScopeReadOnly<MediaAssetUploadSessionRow>(
    { userId, workspaceId },
    [
      "SELECT",
      MEDIA_UPLOAD_SESSION_COLUMNS,
      "FROM content.media_upload_sessions",
      "WHERE workspace_id = $1",
      "AND media_upload_session_id = $2",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, sessionId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw createMediaAssetUploadSessionNotFoundError(sessionId);
  }

  const session = mapMediaAssetUploadSessionRow(row);
  assertMediaAssetUploadSessionActive(session);
  return session;
}

async function findMediaAssetFromSessionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  session: MediaAssetUploadSession,
): Promise<MediaAsset> {
  const row = await findMediaAssetRowForUpdateInExecutor(executor, workspaceId, session.mediaAssetId);
  if (row === null) {
    throw new Error(`Completed media asset upload session has no media asset row. sessionId=${session.sessionId}`);
  }

  return mapMediaAssetRow(row);
}

export async function beginMediaAssetUploadSessionCompletionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): Promise<MediaAssetUploadSessionCompletionStartResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    beginMediaAssetUploadSessionCompletionInExecutor(executor, workspaceId, sessionId, parts));
}

export async function beginMediaAssetUploadSessionCompletionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  sessionId: string,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): Promise<MediaAssetUploadSessionCompletionStartResult> {
  const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
  if (row === null) {
    throw createMediaAssetUploadSessionNotFoundError(sessionId);
  }

  const session = mapMediaAssetUploadSessionRow(row);
  if (session.state === "completed") {
    return {
      status: "already_completed",
      mediaAsset: await findMediaAssetFromSessionInExecutor(executor, workspaceId, session),
      applied: false,
    };
  }

  assertMediaAssetUploadSessionCanComplete(session);
  assertMediaAssetUploadSessionCompletionPartsMatch(session, parts);
  if (session.state === "completing") {
    return {
      status: "complete_required",
      uploadSession: session,
    };
  }

  const result = await executor.query<MediaAssetUploadSessionRow>(
    [
      "UPDATE content.media_upload_sessions",
      "SET state = 'completing'",
      "WHERE workspace_id = $1",
      "AND media_upload_session_id = $2",
      "AND state = 'active'",
      "RETURNING",
      MEDIA_UPLOAD_SESSION_COLUMNS,
    ].join(" "),
    [workspaceId, sessionId],
  );
  const updatedRow = result.rows[0];
  if (updatedRow === undefined) {
    throw new Error(`Media asset upload session completing update did not return a row. sessionId=${sessionId}`);
  }

  return {
    status: "complete_required",
    uploadSession: mapMediaAssetUploadSessionRow(updatedRow),
  };
}

export async function recoverMediaAssetUploadSessionCompletionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    recoverMediaAssetUploadSessionCompletionInExecutor(executor, workspaceId, sessionId));
}

export async function recoverMediaAssetUploadSessionCompletionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
  if (row === null) {
    throw createMediaAssetUploadSessionNotFoundError(sessionId);
  }

  const session = mapMediaAssetUploadSessionRow(row);
  if (session.state === "active" || session.state === "completed") {
    return session;
  }

  assertMediaAssetUploadSessionState(session, "completing");
  const result = await executor.query<MediaAssetUploadSessionRow>(
    [
      "UPDATE content.media_upload_sessions",
      "SET state = 'active'",
      "WHERE workspace_id = $1",
      "AND media_upload_session_id = $2",
      "AND state = 'completing'",
      "RETURNING",
      MEDIA_UPLOAD_SESSION_COLUMNS,
    ].join(" "),
    [workspaceId, sessionId],
  );

  const updatedRow = result.rows[0];
  if (updatedRow === undefined) {
    throw new Error(`Media asset upload session completion recovery did not return a row. sessionId=${sessionId}`);
  }

  return mapMediaAssetUploadSessionRow(updatedRow);
}

export async function completeMediaAssetUploadSessionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetMutationResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
    if (row === null) {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }

    const session = mapMediaAssetUploadSessionRow(row);
    if (session.state === "completed") {
      return {
        mediaAsset: await findMediaAssetFromSessionInExecutor(executor, workspaceId, session),
        applied: false,
      };
    }

    assertMediaAssetUploadSessionState(session, "completing");
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, session.lastModifiedByReplicaId);
    const result = await upsertMediaAssetSnapshotInExecutor(
      executor,
      workspaceId,
      toMediaAssetSnapshotInputFromUploadSession(session),
      toMediaAssetMutationMetadataFromUploadSession(session),
    );
    await executor.query(
      [
        "UPDATE content.media_upload_sessions",
        "SET state = 'completed', completed_at = now()",
        "WHERE workspace_id = $1",
        "AND media_upload_session_id = $2",
        "AND state = 'completing'",
      ].join(" "),
      [workspaceId, sessionId],
    );

    return {
      mediaAsset: result.mediaAsset,
      applied: result.applied,
    };
  });
}

export async function beginMediaAssetUploadSessionAbortForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSessionAbortStartResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
    if (row === null) {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }

    const session = mapMediaAssetUploadSessionRow(row);
    if (session.state === "aborted") {
      return {
        status: "already_aborted",
        uploadSession: session,
      };
    }

    assertMediaAssetUploadSessionCanAbort(session);
    if (session.state === "aborting") {
      return {
        status: "abort_required",
        uploadSession: session,
      };
    }

    const result = await executor.query<MediaAssetUploadSessionRow>(
      [
        "UPDATE content.media_upload_sessions",
        "SET state = 'aborting'",
        "WHERE workspace_id = $1",
        "AND media_upload_session_id = $2",
        "AND state = 'active'",
        "RETURNING",
        MEDIA_UPLOAD_SESSION_COLUMNS,
      ].join(" "),
      [workspaceId, sessionId],
    );

    const updatedRow = result.rows[0];
    if (updatedRow === undefined) {
      throw new Error(`Media asset upload session aborting update did not return a row. sessionId=${sessionId}`);
    }

    return {
      status: "abort_required",
      uploadSession: mapMediaAssetUploadSessionRow(updatedRow),
    };
  });
}

export async function markMediaAssetUploadSessionAbortedForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
    if (row === null) {
      throw createMediaAssetUploadSessionNotFoundError(sessionId);
    }

    const session = mapMediaAssetUploadSessionRow(row);
    if (session.state === "aborted") {
      return session;
    }

    assertMediaAssetUploadSessionState(session, "aborting");
    const result = await executor.query<MediaAssetUploadSessionRow>(
      [
        "UPDATE content.media_upload_sessions",
        "SET state = 'aborted', aborted_at = now()",
        "WHERE workspace_id = $1",
        "AND media_upload_session_id = $2",
        "AND state = 'aborting'",
        "RETURNING",
        MEDIA_UPLOAD_SESSION_COLUMNS,
      ].join(" "),
      [workspaceId, sessionId],
    );

    const updatedRow = result.rows[0];
    if (updatedRow === undefined) {
      throw new Error(`Media asset upload session aborted update did not return a row. sessionId=${sessionId}`);
    }

    return mapMediaAssetUploadSessionRow(updatedRow);
  });
}

export async function loadMediaAssetForWorkspace(
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
): Promise<MediaAsset> {
  const result = await queryWithWorkspaceScopeReadOnly<MediaAssetRow>(
    { userId, workspaceId },
    [
      "SELECT",
      MEDIA_ASSET_COLUMNS,
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.media_asset_id = $2",
      "AND media_assets.deleted_at IS NULL",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, mediaAssetId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Media asset not found.", "MEDIA_ASSET_NOT_FOUND");
  }

  return mapMediaAssetRow(row);
}

export async function loadMediaAssetWithBlobForWorkspace(
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
): Promise<MediaAssetWithBlob> {
  const result = await queryWithWorkspaceScopeReadOnly<MediaAssetRow>(
    { userId, workspaceId },
    [
      "SELECT",
      MEDIA_ASSET_COLUMNS,
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.media_asset_id = $2",
      "AND media_assets.deleted_at IS NULL",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, mediaAssetId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Media asset not found.", "MEDIA_ASSET_NOT_FOUND");
  }

  return mapMediaAssetWithBlobRow(row);
}
