import type { DatabaseExecutor } from "../../../database";
import { unsafeRepeatableReadReadOnlyTransaction } from "../../../database/core";
import { HttpError } from "../../../shared/errors";
import {
  isUnsafePublicPackageMediaKey,
  normalizePackageMediaKey,
  toSafeNumber,
} from "../../common";
import { isPublicCatalogTextSafe } from "../../publicSafety";
import type {
  CatalogPublicPackageMediaAsset,
  CatalogPublicPackageMediaDownloadSource,
} from "../../types";

type CatalogPublicPackageMediaAssetRow = Readonly<{
  package_version_id: string;
  package_media_key: string;
  alt_text: string | null;
  credit: string | null;
  license: string | null;
  mime_type: string;
  size_bytes: string | number;
}>;

type CatalogPublicPackageMediaDownloadRow = CatalogPublicPackageMediaAssetRow & Readonly<{
  storage_key: string;
  sha256: string;
}>;

function buildCatalogPackageMediaDownloadUrlPath(
  packageVersionId: string,
  packageMediaKey: string,
): string {
  return `/catalog/package-versions/${packageVersionId}/media-assets/${packageMediaKey}/download-url`;
}

export function assertPublicPackageMediaKeySafe(
  packageVersionId: string,
  packageMediaKey: string | null,
): void {
  if (packageMediaKey === null || isUnsafePublicPackageMediaKey(packageMediaKey) === false) {
    return;
  }

  throw new HttpError(
    409,
    `Published catalog package contains a non-public media key. packageVersionId=${packageVersionId}`,
    "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC",
  );
}

function assertPublicCatalogTextSafe(packageVersionId: string, value: string | null): void {
  if (isPublicCatalogTextSafe(value)) {
    return;
  }

  throw new HttpError(
    409,
    `Published catalog package contains a non-public media reference. packageVersionId=${packageVersionId}`,
    "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC",
  );
}

function mapCatalogPublicPackageMediaAsset(
  row: CatalogPublicPackageMediaAssetRow,
): CatalogPublicPackageMediaAsset {
  assertPublicPackageMediaKeySafe(row.package_version_id, row.package_media_key);
  assertPublicCatalogTextSafe(row.package_version_id, row.alt_text);
  assertPublicCatalogTextSafe(row.package_version_id, row.credit);
  assertPublicCatalogTextSafe(row.package_version_id, row.license);
  assertPublicCatalogTextSafe(row.package_version_id, row.mime_type);

  return {
    packageVersionId: row.package_version_id,
    packageMediaKey: row.package_media_key,
    altText: row.alt_text,
    credit: row.credit,
    license: row.license,
    mimeType: row.mime_type,
    sizeBytes: toSafeNumber(row.size_bytes, "size_bytes"),
    downloadUrlPath: buildCatalogPackageMediaDownloadUrlPath(row.package_version_id, row.package_media_key),
  };
}

export async function loadPublicCatalogPackageMediaAssetsInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<ReadonlyArray<CatalogPublicPackageMediaAsset>> {
  const result = await executor.query<CatalogPublicPackageMediaAssetRow>(
    [
      "SELECT",
      "media_assets.package_version_id AS package_version_id,",
      "media_assets.package_media_key AS package_media_key,",
      "media_assets.alt_text AS alt_text,",
      "media_assets.credit AS credit,",
      "media_assets.license AS license,",
      "media_blobs.mime_type AS mime_type,",
      "media_blobs.size_bytes AS size_bytes",
      "FROM catalog.package_media_assets AS media_assets",
      "INNER JOIN catalog.package_versions AS versions",
      "ON versions.package_version_id = media_assets.package_version_id",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = versions.package_id",
      "INNER JOIN content.media_blobs AS media_blobs",
      "ON media_blobs.media_blob_id = media_assets.media_blob_id",
      "WHERE media_assets.package_version_id = $1",
      "AND versions.status = 'published'",
      "AND versions.delisted_at IS NULL",
      "AND packages.status = 'published'",
      "AND packages.delisted_at IS NULL",
      "ORDER BY media_assets.package_media_key ASC",
    ].join(" "),
    [packageVersionId],
  );

  return result.rows.map((row: CatalogPublicPackageMediaAssetRow) => (
    mapCatalogPublicPackageMediaAsset(row)
  ));
}

export async function loadPublicCatalogPackageMediaForDownloadInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  packageMediaKey: string,
): Promise<CatalogPublicPackageMediaDownloadSource> {
  const normalizedPackageMediaKey = normalizePackageMediaKey(packageMediaKey, "packageMediaKey");
  assertPublicPackageMediaKeySafe(packageVersionId, normalizedPackageMediaKey);
  const result = await executor.query<CatalogPublicPackageMediaDownloadRow>(
    [
      "SELECT",
      "media_assets.package_version_id AS package_version_id,",
      "media_assets.package_media_key AS package_media_key,",
      "media_assets.alt_text AS alt_text,",
      "media_assets.credit AS credit,",
      "media_assets.license AS license,",
      "media_blobs.mime_type AS mime_type,",
      "media_blobs.size_bytes AS size_bytes,",
      "media_blobs.storage_key AS storage_key,",
      "media_blobs.sha256 AS sha256",
      "FROM catalog.package_media_assets AS media_assets",
      "INNER JOIN catalog.package_versions AS versions",
      "ON versions.package_version_id = media_assets.package_version_id",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = versions.package_id",
      "INNER JOIN content.media_blobs AS media_blobs",
      "ON media_blobs.media_blob_id = media_assets.media_blob_id",
      "WHERE media_assets.package_version_id = $1",
      "AND media_assets.package_media_key = $2",
      "AND versions.status = 'published'",
      "AND versions.delisted_at IS NULL",
      "AND packages.status = 'published'",
      "AND packages.delisted_at IS NULL",
      "LIMIT 1",
    ].join(" "),
    [packageVersionId, normalizedPackageMediaKey],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(
      404,
      `Published catalog package media asset not found. packageVersionId=${packageVersionId} packageMediaKey=${normalizedPackageMediaKey}`,
      "CATALOG_PUBLIC_PACKAGE_MEDIA_NOT_FOUND",
    );
  }

  return {
    mediaAsset: mapCatalogPublicPackageMediaAsset(row),
    storageKey: row.storage_key,
    sha256: row.sha256,
  };
}

export async function loadPublicCatalogPackageMediaForDownload(
  packageVersionId: string,
  packageMediaKey: string,
): Promise<CatalogPublicPackageMediaDownloadSource> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => (
    loadPublicCatalogPackageMediaForDownloadInExecutor(executor, packageVersionId, packageMediaKey)
  ));
}
