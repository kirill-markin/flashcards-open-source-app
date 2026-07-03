import type { DatabaseExecutor } from "../../database";
import { unsafeTransaction } from "../../database/core";
import { HttpError } from "../../shared/errors";
import {
  normalizeNullableString,
  normalizePackageMediaKey,
} from "../common";
import { rethrowCatalogPersistenceError } from "../errors";
import {
  catalogPackageMediaAssetColumns,
  lockCatalogPackageInExecutor,
  mapCatalogPackageMediaAssetRow,
} from "../rows";
import type {
  AttachCatalogPackageMediaAssetInput,
  CatalogPackageMediaAsset,
  CatalogPackageMediaAssetRow,
  CatalogPackageVersionMediaAssetInput,
} from "../types";

type PackageMediaKeyRow = Readonly<{ package_media_key: string }>;

function normalizePackageMediaAssetInput(
  input: AttachCatalogPackageMediaAssetInput,
): AttachCatalogPackageMediaAssetInput {
  return {
    packageMediaAssetId: input.packageMediaAssetId,
    packageMediaKey: normalizePackageMediaKey(input.packageMediaKey, "packageMediaKey"),
    mediaBlobId: input.mediaBlobId,
    altText: normalizeNullableString(input.altText, "altText"),
    credit: normalizeNullableString(input.credit, "credit"),
    license: normalizeNullableString(input.license, "license"),
  };
}

function normalizePackageVersionMediaAssetInput(
  input: CatalogPackageVersionMediaAssetInput,
): CatalogPackageVersionMediaAssetInput {
  return {
    packageMediaKey: normalizePackageMediaKey(input.packageMediaKey, "packageMediaKey"),
    mediaBlobId: input.mediaBlobId,
  };
}

export async function assertDraftMediaKeysExistInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  mediaAssetKeys: ReadonlyArray<string>,
): Promise<void> {
  if (mediaAssetKeys.length === 0) {
    return;
  }

  const result = await executor.query<PackageMediaKeyRow>(
    [
      "SELECT package_media_key",
      "FROM catalog.package_media_assets",
      "WHERE package_id = $1",
      "AND package_version_id IS NULL",
      "AND package_media_key = ANY($2)",
    ].join(" "),
    [packageId, mediaAssetKeys],
  );
  const existingKeys = new Set(result.rows.map((row: PackageMediaKeyRow) => row.package_media_key));
  const missingKeys = mediaAssetKeys.filter((mediaAssetKey) => existingKeys.has(mediaAssetKey) === false);
  if (missingKeys.length !== 0) {
    throw new HttpError(
      400,
      `Package draft media assets are missing referenced package-local media keys. packageId=${packageId} missingKeys=${missingKeys.join(",")}`,
      "CATALOG_PACKAGE_MEDIA_REFERENCE_NOT_FOUND",
    );
  }
}

export async function loadCatalogPackageDraftMediaKeysInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
): Promise<ReadonlySet<string>> {
  const result = await executor.query<PackageMediaKeyRow>(
    [
      "SELECT package_media_key",
      "FROM catalog.package_media_assets",
      "WHERE package_id = $1",
      "AND package_version_id IS NULL",
    ].join(" "),
    [packageId],
  );

  return new Set(result.rows.map((row: PackageMediaKeyRow) => row.package_media_key));
}

export async function attachCatalogPackageDraftMediaAssetInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  input: AttachCatalogPackageMediaAssetInput,
): Promise<CatalogPackageMediaAsset> {
  const normalizedInput = normalizePackageMediaAssetInput(input);
  try {
    await lockCatalogPackageInExecutor(executor, packageId);
    const result = await executor.query<CatalogPackageMediaAssetRow>(
      [
        "INSERT INTO catalog.package_media_assets",
        "(",
        "package_media_asset_id, package_id, package_version_id, package_media_key,",
        "media_blob_id, alt_text, credit, license",
        ")",
        "SELECT $1, $2, NULL, $3, media_blobs.media_blob_id, $5, $6, $7",
        "FROM content.media_blobs AS media_blobs",
        "WHERE media_blobs.media_blob_id = $4",
        "RETURNING",
        catalogPackageMediaAssetColumns,
      ].join(" "),
      [
        normalizedInput.packageMediaAssetId,
        packageId,
        normalizedInput.packageMediaKey,
        normalizedInput.mediaBlobId,
        normalizedInput.altText,
        normalizedInput.credit,
        normalizedInput.license,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new HttpError(
        400,
        `Media blob not found for catalog package media asset. mediaBlobId=${normalizedInput.mediaBlobId}`,
        "CATALOG_MEDIA_BLOB_NOT_FOUND",
      );
    }

    return mapCatalogPackageMediaAssetRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function insertCatalogPackageVersionMediaAssetsInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  packageVersionId: string,
  mediaAssets: ReadonlyArray<CatalogPackageVersionMediaAssetInput>,
): Promise<void> {
  for (const mediaAsset of mediaAssets.map((input) => normalizePackageVersionMediaAssetInput(input))) {
    await executor.query(
      [
        "INSERT INTO catalog.package_media_assets",
        "(package_media_asset_id, package_id, package_version_id, package_media_key, media_blob_id, alt_text, credit, license)",
        "VALUES (gen_random_uuid(), $1, $2, $3, $4, NULL, NULL, NULL)",
      ].join(" "),
      [
        packageId,
        packageVersionId,
        mediaAsset.packageMediaKey,
        mediaAsset.mediaBlobId,
      ],
    );
  }
}

export async function attachCatalogPackageDraftMediaAsset(
  packageId: string,
  input: AttachCatalogPackageMediaAssetInput,
): Promise<CatalogPackageMediaAsset> {
  return unsafeTransaction(async (executor) => (
    attachCatalogPackageDraftMediaAssetInExecutor(executor, packageId, input)
  ));
}
