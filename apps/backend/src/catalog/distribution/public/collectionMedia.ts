import type { DatabaseExecutor } from "../../../database";
import { unsafeRepeatableReadReadOnlyTransaction } from "../../../database/core";
import { buildMediaBlobStorageKey } from "../../../mediaAssets/storageKeys";
import { HttpError } from "../../../shared/errors";
import { getPublicCatalogMediaDeliveryIssue } from "../../publicMediaDelivery";
import { isPublicCatalogTextSafe } from "../../publicSafety";
import type { CatalogPublicCollectionCoverDownloadSource } from "../../types";

type CatalogPublicCollectionCoverRow = Readonly<{
  collection_id: string;
  cover_media_blob_id: string | null;
  mime_type: string | null;
  size_bytes: string | number | null;
  storage_key: string | null;
  sha256: string | null;
}>;

const sha256Pattern = /^[0-9a-f]{64}$/u;

function mapPublicCatalogCollectionCover(
  row: CatalogPublicCollectionCoverRow,
): CatalogPublicCollectionCoverDownloadSource {
  if (row.cover_media_blob_id === null) {
    throw new HttpError(
      404,
      `Published catalog collection cover not found. collectionId=${row.collection_id}`,
      "CATALOG_PUBLIC_COLLECTION_COVER_NOT_FOUND",
    );
  }
  if (
    row.mime_type === null
    || row.size_bytes === null
    || row.storage_key === null
    || row.sha256 === null
  ) {
    throw new HttpError(
      409,
      `Published catalog collection cover references missing media. collectionId=${row.collection_id}`,
      "CATALOG_PUBLIC_COLLECTION_COVER_MEDIA_NOT_FOUND",
    );
  }
  if (isPublicCatalogTextSafe(row.mime_type) === false) {
    throw new HttpError(
      409,
      `Published catalog collection cover metadata is not public-safe. collectionId=${row.collection_id}`,
      "CATALOG_PUBLIC_COLLECTION_COVER_METADATA_NOT_PUBLIC",
    );
  }

  const sizeBytes = typeof row.size_bytes === "number"
    ? row.size_bytes
    : Number(row.size_bytes);
  if (Number.isSafeInteger(sizeBytes) === false || sizeBytes < 0) {
    throw new HttpError(
      409,
      `Published catalog collection cover has an invalid byte size. collectionId=${row.collection_id}`,
      "CATALOG_PUBLIC_COLLECTION_COVER_SIZE_INVALID",
    );
  }
  if (
    sha256Pattern.test(row.sha256) === false
    || row.storage_key !== buildMediaBlobStorageKey(row.sha256)
  ) {
    throw new HttpError(
      409,
      `Published catalog collection cover is outside private blob storage. collectionId=${row.collection_id}`,
      "CATALOG_PUBLIC_COLLECTION_COVER_STORAGE_INVALID",
    );
  }

  const deliveryIssue = getPublicCatalogMediaDeliveryIssue({
    mimeType: row.mime_type,
    sizeBytes,
  });
  if (deliveryIssue?.reason === "too_large") {
    throw new HttpError(
      413,
      `Published catalog collection cover is too large for public delivery. collectionId=${row.collection_id}`,
      "CATALOG_PUBLIC_COLLECTION_COVER_TOO_LARGE",
    );
  }
  if (deliveryIssue?.reason === "unsupported_mime_type") {
    throw new HttpError(
      415,
      `Published catalog collection cover type is not supported for public delivery. collectionId=${row.collection_id}`,
      "CATALOG_PUBLIC_COLLECTION_COVER_UNSUPPORTED_TYPE",
    );
  }

  return {
    collectionCover: {
      collectionId: row.collection_id,
      mimeType: row.mime_type,
      sizeBytes,
    },
    storageKey: row.storage_key,
    sha256: row.sha256,
  };
}

const publicCollectionCoverSelect = [
  "SELECT",
  "collections.collection_id AS collection_id,",
  "collections.cover_media_blob_id AS cover_media_blob_id,",
  "media_blobs.mime_type AS mime_type,",
  "media_blobs.size_bytes AS size_bytes,",
  "media_blobs.storage_key AS storage_key,",
  "media_blobs.sha256 AS sha256",
  "FROM catalog.collections AS collections",
  "LEFT JOIN content.media_blobs AS media_blobs",
  "ON media_blobs.media_blob_id = collections.cover_media_blob_id",
] as const;

export async function loadPublicCatalogCollectionCoversInExecutor(
  executor: DatabaseExecutor,
): Promise<ReadonlyArray<CatalogPublicCollectionCoverDownloadSource>> {
  const result = await executor.query<CatalogPublicCollectionCoverRow>(
    [
      ...publicCollectionCoverSelect,
      "WHERE collections.cover_media_blob_id IS NOT NULL",
      "AND collections.status = 'published'",
      "AND collections.delisted_at IS NULL",
      "ORDER BY collections.collection_id ASC",
    ].join(" "),
    [],
  );

  return result.rows.map(mapPublicCatalogCollectionCover);
}

export async function loadPublicCatalogCollectionCoverForDownloadInExecutor(
  executor: DatabaseExecutor,
  collectionId: string,
): Promise<CatalogPublicCollectionCoverDownloadSource> {
  const result = await executor.query<CatalogPublicCollectionCoverRow>(
    [
      ...publicCollectionCoverSelect,
      "WHERE collections.collection_id = $1",
      "AND collections.status = 'published'",
      "AND collections.delisted_at IS NULL",
      "LIMIT 1",
    ].join(" "),
    [collectionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(
      404,
      `Published catalog collection cover not found. collectionId=${collectionId}`,
      "CATALOG_PUBLIC_COLLECTION_COVER_NOT_FOUND",
    );
  }

  return mapPublicCatalogCollectionCover(row);
}

export async function loadPublicCatalogCollectionCoverForDownload(
  collectionId: string,
): Promise<CatalogPublicCollectionCoverDownloadSource> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => (
    loadPublicCatalogCollectionCoverForDownloadInExecutor(executor, collectionId)
  ));
}
