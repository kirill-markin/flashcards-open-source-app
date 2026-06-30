import type { DatabaseExecutor } from "../../database";
import { HttpError } from "../../shared/errors";
import { buildMediaBlobStorageKey } from "../storageKeys";
import type {
  MediaAssetSnapshotInput,
  MediaBlobNormalizationVersion,
  MediaBlobRow,
} from "../types";
import {
  MEDIA_BLOB_COLUMNS,
  toSafeNumber,
} from "./rows";

export function assertMediaBlobMatchesMetadata(
  row: MediaBlobRow,
  input: Readonly<{
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }>,
): void {
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

export function assertMediaBlobMatchesInput(row: MediaBlobRow, input: MediaAssetSnapshotInput): void {
  assertMediaBlobMatchesMetadata(row, {
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
  });
}

export async function findMediaBlobRowBySha256InExecutor(
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

export async function upsertMediaBlobRowInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetSnapshotInput,
  normalizationVersion: MediaBlobNormalizationVersion,
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
    [input.sha256, input.mimeType, input.sizeBytes, storageKey, normalizationVersion],
  );

  const insertedRow = insertResult.rows[0];
  const row = insertedRow ?? await findMediaBlobRowBySha256InExecutor(executor, input.sha256);
  if (row === null) {
    throw new Error("Media bytes insert conflicted but no row was found");
  }

  assertMediaBlobMatchesInput(row, input);
  return row;
}
