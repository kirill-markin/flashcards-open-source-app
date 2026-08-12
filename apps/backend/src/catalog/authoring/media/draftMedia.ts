import type { DatabaseExecutor } from "../../../database";
import { getDatabaseErrorFields } from "../../../database/transient";
import { unsafeTransaction } from "../../../database/core";
import {
  mediaBlobCleanupDelayMs,
  MediaBlobLifecycleBusyError,
  MediaBlobLifecycleConflictError,
} from "../../../mediaAssets/blobLifecycle";
import { HttpError } from "../../../shared/errors";
import {
  normalizeNullableString,
  normalizePackageMediaKey,
} from "../../common";
import { rethrowCatalogPersistenceError } from "../../errors";
import {
  catalogPackageMediaAssetColumns,
  lockCatalogPackageInExecutor,
  mapCatalogPackageMediaAssetRow,
} from "../../rows";
import type {
  AttachCatalogPackageMediaAssetInput,
  CatalogPackageMediaAsset,
  CatalogPackageMediaAssetRow,
  CatalogPackageVersionMediaAssetInput,
} from "../../types";

type PackageMediaKeyRow = Readonly<{ package_media_key: string }>;

export type CatalogPackageMediaMutationResult = Readonly<{
  mediaAsset: CatalogPackageMediaAsset;
  applied: boolean;
}>;

export async function scheduleDisplacedMediaBlobCleanupInExecutor(
  executor: DatabaseExecutor,
  mediaBlobId: string,
): Promise<void> {
  try {
    await executor.query(
      "SELECT content.schedule_media_blob_cleanup($1, $2)",
      [mediaBlobId, mediaBlobCleanupDelayMs],
    );
  } catch (error) {
    const { sqlState } = getDatabaseErrorFields(error);
    if (sqlState === "55P03") {
      throw new MediaBlobLifecycleBusyError();
    }
    if (sqlState === "23514") {
      throw new MediaBlobLifecycleConflictError();
    }
    throw error;
  }
}

async function loadCatalogPackageDraftMediaAssetForUpdateInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  packageMediaKey: string,
): Promise<CatalogPackageMediaAssetRow | null> {
  const result = await executor.query<CatalogPackageMediaAssetRow>(
    [
      "SELECT",
      catalogPackageMediaAssetColumns,
      "FROM catalog.package_media_assets",
      "WHERE package_id = $1",
      "AND package_version_id IS NULL",
      "AND package_media_key = $2",
      "FOR UPDATE",
    ].join(" "),
    [packageId, packageMediaKey],
  );
  return result.rows[0] ?? null;
}

async function insertCatalogPackageDraftImageInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  packageMediaKey: string,
  mediaBlobId: string,
  altText: string | null,
  credit: string | null,
  license: string | null,
): Promise<CatalogPackageMediaAsset> {
  const result = await executor.query<CatalogPackageMediaAssetRow>(
    [
      "INSERT INTO catalog.package_media_assets",
      "(package_media_asset_id, package_id, package_version_id, package_media_key, media_blob_id, alt_text, credit, license)",
      "SELECT gen_random_uuid(), $1, NULL, $2, media_blobs.media_blob_id, $4, $5, $6",
      "FROM content.media_blobs AS media_blobs",
      "WHERE media_blobs.media_blob_id = $3",
      "RETURNING",
      catalogPackageMediaAssetColumns,
    ].join(" "),
    [packageId, packageMediaKey, mediaBlobId, altText, credit, license],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(
      400,
      "Normalized media blob not found for catalog package image attachment.",
      "CATALOG_MEDIA_BLOB_NOT_FOUND",
    );
  }
  return mapCatalogPackageMediaAssetRow(row);
}

export async function createOrReplayCatalogPackageDraftCardImageInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  packageMediaKey: string,
  mediaBlobId: string,
): Promise<CatalogPackageMediaMutationResult> {
  const normalizedPackageMediaKey = normalizePackageMediaKey(
    packageMediaKey,
    "packageMediaKey",
  );
  if (normalizedPackageMediaKey === "cover") {
    throw new HttpError(
      400,
      "Catalog package media key cover is reserved for package cover replacement.",
      "CATALOG_PACKAGE_MEDIA_KEY_RESERVED",
    );
  }
  try {
    await lockCatalogPackageInExecutor(executor, packageId);
    const existing = await loadCatalogPackageDraftMediaAssetForUpdateInExecutor(
      executor,
      packageId,
      normalizedPackageMediaKey,
    );
    if (existing !== null) {
      if (existing.media_blob_id !== mediaBlobId) {
        throw new HttpError(
          409,
          `Catalog package media key already contains different normalized bytes. packageId=${packageId} packageMediaKey=${normalizedPackageMediaKey}`,
          "CATALOG_PACKAGE_MEDIA_KEY_CONTENT_CONFLICT",
        );
      }
      return { mediaAsset: mapCatalogPackageMediaAssetRow(existing), applied: false };
    }

    return {
      mediaAsset: await insertCatalogPackageDraftImageInExecutor(
        executor,
        packageId,
        normalizedPackageMediaKey,
        mediaBlobId,
        null,
        null,
        null,
      ),
      applied: true,
    };
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function replaceCatalogPackageDraftCoverInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  mediaBlobId: string,
  altText: string | null,
  credit: string | null,
  license: string | null,
): Promise<CatalogPackageMediaMutationResult> {
  const packageMediaKey = "cover";
  const normalizedAltText = normalizeNullableString(altText, "altText");
  const normalizedCredit = normalizeNullableString(credit, "credit");
  const normalizedLicense = normalizeNullableString(license, "license");
  try {
    const catalogPackage = await lockCatalogPackageInExecutor(executor, packageId);
    const existing = await loadCatalogPackageDraftMediaAssetForUpdateInExecutor(
      executor,
      packageId,
      packageMediaKey,
    );
    const mediaBlobChanged = existing !== null
      && existing.media_blob_id !== mediaBlobId;
    let mediaAsset: CatalogPackageMediaAsset;
    let applied = catalogPackage.cover_package_media_key !== packageMediaKey;
    if (existing === null) {
      mediaAsset = await insertCatalogPackageDraftImageInExecutor(
        executor,
        packageId,
        packageMediaKey,
        mediaBlobId,
        normalizedAltText,
        normalizedCredit,
        normalizedLicense,
      );
      applied = true;
    } else if (
      mediaBlobChanged === false
      && existing.alt_text === normalizedAltText
      && existing.credit === normalizedCredit
      && existing.license === normalizedLicense
    ) {
      mediaAsset = mapCatalogPackageMediaAssetRow(existing);
    } else {
      if (mediaBlobChanged) {
        await executor.query(
          "SELECT content.lock_media_blob_lifecycles_for_reference_swap($1, $2)",
          [existing.media_blob_id, mediaBlobId],
        );
      }
      const updateResult = await executor.query<CatalogPackageMediaAssetRow>(
        [
          "UPDATE catalog.package_media_assets",
          "SET media_blob_id = $3, alt_text = $4, credit = $5, license = $6",
          "WHERE package_id = $1",
          "AND package_version_id IS NULL",
          "AND package_media_key = $2",
          "RETURNING",
          catalogPackageMediaAssetColumns,
        ].join(" "),
        [
          packageId,
          packageMediaKey,
          mediaBlobId,
          normalizedAltText,
          normalizedCredit,
          normalizedLicense,
        ],
      );
      const updated = updateResult.rows[0];
      if (updated === undefined) {
        throw new Error(
          `Locked catalog package cover disappeared during replacement. packageId=${packageId}`,
        );
      }
      mediaAsset = mapCatalogPackageMediaAssetRow(updated);
      applied = true;
    }

    await executor.query(
      [
        "UPDATE catalog.packages SET cover_package_media_key = $2",
        "WHERE package_id = $1 AND cover_package_media_key IS DISTINCT FROM $2",
      ].join(" "),
      [packageId, packageMediaKey],
    );
    if (existing !== null && mediaBlobChanged) {
      await scheduleDisplacedMediaBlobCleanupInExecutor(
        executor,
        existing.media_blob_id,
      );
    }
    return { mediaAsset, applied };
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

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
