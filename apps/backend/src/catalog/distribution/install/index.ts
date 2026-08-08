import {
  transactionWithWorkspaceScope,
  transactionWithWorkspaceScopeReadOnly,
  type DatabaseExecutor,
} from "../../../database";
import {
  isValidMediaAssetLastOperationIdPrefix,
  maximumMediaAssetLastOperationIdLength,
} from "../../../mediaAssets/lastOperationId";
import { HttpError } from "../../../shared/errors";
import { normalizeCardImportTagOptions } from "../../../shared/cardImportTags";
import { normalizeIsoTimestamp } from "../../../sync/conflicts/lww";
import { lockWorkspaceSyncMetadataForHotChangesInExecutor } from "../../../sync/replication/changes";
import {
  isLowercaseWorkspaceId,
  normalizeWorkspaceId,
} from "../../../workspaces/identity";
import { normalizeNonEmptyString } from "../../common";
import type {
  CatalogPackageInstallConfirmInput,
  CatalogPackageInstallPreview,
  CatalogPackageInstallPreviewInput,
  CatalogPackageInstallResult,
} from "../../types";
import {
  createCatalogPackageInstallTagPlan,
  loadCatalogPackageInstallPreviewInExecutor,
  loadCatalogPackageInstallVersionForInstallInExecutor,
  loadCatalogPackageVersionCardsInExecutor,
  loadCatalogPackageVersionMediaAssetsInExecutor,
  mapCatalogPackageInstallPackageVersion,
} from "./preview";
import {
  createCatalogPackageInstallRequestIdentity,
  insertCatalogPackageInstallIdempotencyResultInExecutor,
  loadCatalogPackageInstallReplayInExecutor,
  type NormalizedCatalogPackageInstallConfirmInput,
} from "./replay";
import {
  assertCatalogInstallReplicaBelongsToWorkspaceInExecutor,
  assertInstallIdUnusedInExecutor,
  assertInstallOperationIdsUnusedInExecutor,
  buildCatalogInstallOperationIds,
  buildInstalledMediaAssetIdsByPackageMediaKey,
  installCatalogPackageCardsInExecutor,
  installCatalogPackageMediaAssetsInExecutor,
} from "./persistence";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const maximumJavaScriptArrayIndex = 4_294_967_294;
const catalogPackageInstallMediaLastOperationIdMaximumSuffix =
  `:media:${maximumJavaScriptArrayIndex}`;
const catalogPackageInstallCardLastOperationIdMaximumSuffix =
  `:card:${maximumJavaScriptArrayIndex}`;
const catalogPackageInstallLastOperationIdMaximumSuffixLength = Math.max(
  catalogPackageInstallMediaLastOperationIdMaximumSuffix.length,
  catalogPackageInstallCardLastOperationIdMaximumSuffix.length,
);

export const catalogPackageInstallOperationIdPrefixMaximumLength =
  maximumMediaAssetLastOperationIdLength
  - catalogPackageInstallLastOperationIdMaximumSuffixLength;

function normalizeUuidString(value: string, fieldName: string): string {
  const normalizedValue = normalizeNonEmptyString(value, fieldName).toLowerCase();
  if (uuidPattern.test(normalizedValue) === false) {
    throw new HttpError(400, `${fieldName} must be a UUID`, "CATALOG_PACKAGE_INSTALL_INVALID_INPUT");
  }

  return normalizedValue;
}

function normalizeCatalogWorkspaceId(value: string): string {
  const normalizedValue = normalizeWorkspaceId(
    normalizeNonEmptyString(value, "workspaceId"),
  ).toLowerCase();
  if (isLowercaseWorkspaceId(normalizedValue) === false) {
    throw new HttpError(
      400,
      "workspaceId must be a UUID",
      "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
    );
  }

  return normalizedValue;
}

function normalizeBoundedNonEmptyString(value: string, fieldName: string, maximumLength: number): string {
  const normalizedValue = normalizeNonEmptyString(value, fieldName);
  if (normalizedValue.length > maximumLength) {
    throw new HttpError(
      400,
      `${fieldName} must contain at most ${maximumLength} characters`,
      "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
    );
  }

  return normalizedValue;
}

export function isValidCatalogPackageInstallOperationIdPrefix(
  value: string,
): boolean {
  return isValidMediaAssetLastOperationIdPrefix(
    value,
    catalogPackageInstallOperationIdPrefixMaximumLength,
  );
}

function normalizeCatalogPackageInstallOperationIdPrefix(value: string): string {
  if (isValidCatalogPackageInstallOperationIdPrefix(value)) {
    return value;
  }

  throw new HttpError(
    400,
    [
      "operationIdPrefix must be",
      `1 to ${catalogPackageInstallOperationIdPrefixMaximumLength}`,
      "printable ASCII characters without leading or trailing spaces.",
    ].join(" "),
    "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
  );
}

function normalizeCatalogInstallIsoTimestamp(value: string, fieldName: string): string {
  try {
    return normalizeIsoTimestamp(value, fieldName);
  } catch {
    throw new HttpError(
      400,
      `${fieldName} must be a valid ISO timestamp`,
      "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
    );
  }
}

function normalizeCatalogPackageInstallConfirmInput(
  input: CatalogPackageInstallConfirmInput,
): NormalizedCatalogPackageInstallConfirmInput {
  let normalizedTagOptions: ReturnType<typeof normalizeCardImportTagOptions>;
  try {
    normalizedTagOptions = normalizeCardImportTagOptions({
      addImportTag: input.addImportTag === undefined ? false : input.addImportTag,
      importTag: input.importTag === undefined ? "" : input.importTag,
      removeTags: input.removeTags === undefined ? [] : input.removeTags,
    });
  } catch (error) {
    throw new HttpError(
      400,
      `Catalog package install tag options are invalid. reason=${error instanceof Error ? error.message : String(error)}`,
      "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
    );
  }

  return {
    installId: normalizeBoundedNonEmptyString(input.installId, "installId", 128),
    installedAt: normalizeCatalogInstallIsoTimestamp(input.installedAt, "installedAt"),
    clientUpdatedAt: normalizeCatalogInstallIsoTimestamp(input.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByReplicaId: normalizeUuidString(input.lastModifiedByReplicaId, "lastModifiedByReplicaId"),
    operationIdPrefix: normalizeCatalogPackageInstallOperationIdPrefix(input.operationIdPrefix),
    addImportTag: normalizedTagOptions.addImportTag,
    importTag: normalizedTagOptions.importTag,
    removeTags: normalizedTagOptions.removeTags,
  };
}

export async function previewCatalogPackageInstallInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  input: CatalogPackageInstallPreviewInput,
): Promise<CatalogPackageInstallPreview> {
  const normalizedPackageVersionId = normalizeUuidString(packageVersionId, "packageVersionId");
  return loadCatalogPackageInstallPreviewInExecutor(
    executor,
    normalizedPackageVersionId,
    input,
  );
}

export async function installCatalogPackageVersionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  packageVersionId: string,
  input: CatalogPackageInstallConfirmInput,
): Promise<CatalogPackageInstallResult> {
  const normalizedWorkspaceId = normalizeCatalogWorkspaceId(workspaceId);
  const normalizedPackageVersionId = normalizeUuidString(packageVersionId, "packageVersionId");
  const normalizedInput = normalizeCatalogPackageInstallConfirmInput(input);
  const requestIdentity = createCatalogPackageInstallRequestIdentity(
    normalizedPackageVersionId,
    normalizedInput,
  );
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(
    executor,
    normalizedWorkspaceId,
  );
  const replayResult = await loadCatalogPackageInstallReplayInExecutor(
    executor,
    normalizedWorkspaceId,
    normalizedInput.installId,
    requestIdentity,
  );
  if (replayResult !== null) {
    return replayResult;
  }

  const versionRow = await loadCatalogPackageInstallVersionForInstallInExecutor(
    executor,
    normalizedPackageVersionId,
  );
  const packageMediaAssets = await loadCatalogPackageVersionMediaAssetsInExecutor(
    executor,
    normalizedPackageVersionId,
  );
  const packageCards = await loadCatalogPackageVersionCardsInExecutor(executor, normalizedPackageVersionId);

  if (packageCards.length === 0) {
    throw new HttpError(
      409,
      `Catalog package version has no cards to install. packageVersionId=${normalizedPackageVersionId}`,
      "CATALOG_PACKAGE_VERSION_EMPTY",
    );
  }
  const tagPlan = createCatalogPackageInstallTagPlan(packageCards, normalizedInput);

  await assertCatalogInstallReplicaBelongsToWorkspaceInExecutor(
    executor,
    normalizedWorkspaceId,
    normalizedInput.lastModifiedByReplicaId,
  );
  await assertInstallIdUnusedInExecutor(executor, normalizedWorkspaceId, normalizedInput.installId);
  await assertInstallOperationIdsUnusedInExecutor(
    executor,
    normalizedWorkspaceId,
    buildCatalogInstallOperationIds(normalizedInput, packageMediaAssets, packageCards),
  );

  const installedMediaAssets = await installCatalogPackageMediaAssetsInExecutor(
    executor,
    normalizedWorkspaceId,
    hotChangeWriteLock,
    packageMediaAssets,
    normalizedInput,
  );
  const installedMediaAssetIdsByPackageMediaKey = buildInstalledMediaAssetIdsByPackageMediaKey(
    installedMediaAssets,
  );
  const installedCards = await installCatalogPackageCardsInExecutor(
    executor,
    normalizedWorkspaceId,
    hotChangeWriteLock,
    versionRow,
    packageCards,
    tagPlan,
    normalizedInput,
    installedMediaAssetIdsByPackageMediaKey,
  );

  const result: CatalogPackageInstallResult = {
    packageVersion: mapCatalogPackageInstallPackageVersion(versionRow),
    installedCards,
    installedMediaAssets,
    summary: {
      cardCount: installedCards.length,
      mediaAssetCount: installedMediaAssets.length,
      installId: normalizedInput.installId,
      installedAt: normalizedInput.installedAt,
      keptTagCount: tagPlan.keptTags.length,
      removedTagCount: tagPlan.removedTags.length,
      importTag: tagPlan.importTag,
    },
  };
  await insertCatalogPackageInstallIdempotencyResultInExecutor(
    executor,
    normalizedWorkspaceId,
    normalizedInput.installId,
    requestIdentity,
    result,
  );
  return result;
}

export async function previewCatalogPackageInstall(
  userId: string,
  workspaceId: string,
  packageVersionId: string,
  input: CatalogPackageInstallPreviewInput,
): Promise<CatalogPackageInstallPreview> {
  return transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => (
    previewCatalogPackageInstallInExecutor(executor, packageVersionId, input)
  ));
}

export async function installCatalogPackageVersion(
  userId: string,
  workspaceId: string,
  packageVersionId: string,
  input: CatalogPackageInstallConfirmInput,
): Promise<CatalogPackageInstallResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => (
    installCatalogPackageVersionInExecutor(executor, workspaceId, packageVersionId, input)
  ));
}

