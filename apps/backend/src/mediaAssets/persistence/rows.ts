import {
  mediaBlobNormalizationVersions,
  type MediaAsset,
  type MediaAssetRow,
  type MediaAssetWithBlob,
  type MediaBlob,
  type MediaBlobNormalizationVersion,
  type MediaBlobRow,
  type TimestampValue,
} from "../types";

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

export const MEDIA_BLOB_COLUMNS = [
  "media_blob_id",
  "mime_type",
  "size_bytes",
  "sha256",
  "storage_key",
  "normalization_version",
  "created_at",
  "updated_at",
].join(", ");

export function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

export function toOptionalIsoString(value: TimestampValue | null): string | null {
  return value === null ? null : toIsoString(value);
}

export function toSafeNumber(value: string | number, fieldName: string): number {
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

export function mapMediaAssetWithBlobRow(row: MediaAssetRow): MediaAssetWithBlob {
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
