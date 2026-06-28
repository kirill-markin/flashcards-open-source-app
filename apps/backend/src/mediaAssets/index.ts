import {
  queryWithWorkspaceScopeReadOnly,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../database";
import { HttpError } from "../shared/errors";
import {
  incomingLwwMetadataWins,
  type LwwMetadata,
} from "../sync/conflicts/lww";
import { buildMediaAssetStorageKey } from "./storageKeys";
import type {
  CompleteMediaAssetUploadInput,
  MediaAsset,
  MediaAssetMutationResult,
  MediaAssetRow,
  TimestampValue,
} from "./types";

const MEDIA_ASSET_COLUMNS = [
  "media_asset_id",
  "workspace_id",
  "mime_type",
  "size_bytes",
  "sha256",
  "storage_key",
  "source_url",
  "created_at",
  "client_updated_at",
  "last_modified_by_replica_id",
  "last_operation_id",
  "updated_at",
  "deleted_at",
].join(", ");

type ExistingMediaAssetIntentRow = Readonly<{
  storage_key: string;
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

export function mapMediaAssetRow(row: MediaAssetRow): MediaAsset {
  return {
    mediaAssetId: row.media_asset_id,
    workspaceId: row.workspace_id,
    mimeType: row.mime_type,
    sizeBytes: toSafeNumber(row.size_bytes, "size_bytes"),
    sha256: row.sha256,
    storageKey: row.storage_key,
    sourceUrl: row.source_url,
    createdAt: toIsoString(row.created_at),
    clientUpdatedAt: toIsoString(row.client_updated_at),
    lastModifiedByReplicaId: row.last_modified_by_replica_id,
    lastOperationId: row.last_operation_id,
    updatedAt: toIsoString(row.updated_at),
    deletedAt: toOptionalIsoString(row.deleted_at),
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
      "SELECT storage_key",
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
      "Media asset is already registered; create a new mediaAssetId before requesting another upload intent.",
      `workspaceId=${workspaceId}`,
      `mediaAssetId=${mediaAssetId}`,
      `storageKey=${existingRow.storage_key}`,
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

function toInputLwwMetadata(input: CompleteMediaAssetUploadInput): LwwMetadata {
  return {
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId,
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
      "FROM content.media_assets",
      "WHERE workspace_id = $1",
      "AND media_asset_id = $2",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, mediaAssetId],
  );

  return result.rows[0] ?? null;
}

function assertExistingMediaAssetMatchesInput(
  existingRow: MediaAssetRow,
  input: CompleteMediaAssetUploadInput,
  storageKey: string,
): void {
  if (
    existingRow.mime_type !== input.mimeType
    || toSafeNumber(existingRow.size_bytes, "size_bytes") !== input.sizeBytes
    || existingRow.sha256 !== input.sha256
    || existingRow.storage_key !== storageKey
  ) {
    throw new HttpError(
      409,
      [
        "mediaAssetId is already registered with different file metadata",
        `workspaceId=${existingRow.workspace_id}`,
        `mediaAssetId=${existingRow.media_asset_id}`,
        `existingStorageKey=${existingRow.storage_key}`,
        `requestedStorageKey=${storageKey}`,
      ].join(" "),
      "MEDIA_ASSET_ID_CONFLICT",
    );
  }
}

async function insertMediaAssetRowInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: CompleteMediaAssetUploadInput,
  storageKey: string,
): Promise<MediaAssetRow | null> {
  const result = await executor.query<MediaAssetRow>(
    [
      "INSERT INTO content.media_assets",
      "(",
      "media_asset_id, workspace_id, mime_type, size_bytes, sha256, storage_key, source_url, created_at,",
      "client_updated_at, last_modified_by_replica_id, last_operation_id, deleted_at",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)",
      "ON CONFLICT DO NOTHING",
      "RETURNING",
      MEDIA_ASSET_COLUMNS,
    ].join(" "),
    [
      input.mediaAssetId,
      workspaceId,
      input.mimeType,
      input.sizeBytes,
      input.sha256,
      storageKey,
      input.sourceUrl,
      input.createdAt,
      input.clientUpdatedAt,
      input.lastModifiedByReplicaId,
      input.lastOperationId,
    ],
  );

  return result.rows[0] ?? null;
}

async function updateExistingMediaAssetRowInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: CompleteMediaAssetUploadInput,
): Promise<MediaAssetRow> {
  const result = await executor.query<MediaAssetRow>(
    [
      "UPDATE content.media_assets",
      "SET source_url = $3,",
      "client_updated_at = $4,",
      "last_modified_by_replica_id = $5,",
      "last_operation_id = $6,",
      "updated_at = now(),",
      "deleted_at = NULL",
      "WHERE workspace_id = $1",
      "AND media_asset_id = $2",
      "RETURNING",
      MEDIA_ASSET_COLUMNS,
    ].join(" "),
    [
      workspaceId,
      input.mediaAssetId,
      input.sourceUrl,
      input.clientUpdatedAt,
      input.lastModifiedByReplicaId,
      input.lastOperationId,
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

export async function completeMediaAssetUploadForWorkspace(
  userId: string,
  workspaceId: string,
  input: CompleteMediaAssetUploadInput,
): Promise<MediaAssetMutationResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, input.lastModifiedByReplicaId);
    const storageKey = buildMediaAssetStorageKey(workspaceId, input.mediaAssetId, input.sha256);
    const insertedRow = await insertMediaAssetRowInExecutor(executor, workspaceId, input, storageKey);
    if (insertedRow !== null) {
      return {
        mediaAsset: mapMediaAssetRow(insertedRow),
        applied: true,
      };
    }

    const existingRow = await findMediaAssetRowForUpdateInExecutor(executor, workspaceId, input.mediaAssetId);
    if (existingRow === null) {
      throw new HttpError(
        409,
        `mediaAssetId is already used by another workspace: mediaAssetId=${input.mediaAssetId}`,
        "MEDIA_ASSET_ID_CONFLICT",
      );
    }

    assertExistingMediaAssetMatchesInput(existingRow, input, storageKey);
    if (incomingLwwMetadataWins(toInputLwwMetadata(input), toMediaAssetLwwMetadata(existingRow)) === false) {
      return {
        mediaAsset: mapMediaAssetRow(existingRow),
        applied: false,
      };
    }

    const updatedRow = await updateExistingMediaAssetRowInExecutor(executor, workspaceId, input);
    return {
      mediaAsset: mapMediaAssetRow(updatedRow),
      applied: true,
    };
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
      "FROM content.media_assets",
      "WHERE workspace_id = $1",
      "AND media_asset_id = $2",
      "AND deleted_at IS NULL",
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
