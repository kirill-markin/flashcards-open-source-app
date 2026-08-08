import { randomUUID } from "node:crypto";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import { HttpError } from "../../shared/errors";
import {
  extractMarkdownFcAssetIds,
  rewriteMarkdownFcAssetUrlsToFcAssets,
} from "../../workspacePackages";
import { normalizeAdminEmail, normalizePackageMediaKey } from "../common";
import { rethrowCatalogPersistenceError } from "../errors";
import { lockCatalogPackageInExecutor } from "../rows";
import type {
  CatalogPackageCardSnapshotInput,
  CatalogPackageVersion,
  CatalogPackageVersionMediaAssetInput,
  CatalogWorkspaceCardRow,
  CreateCatalogPackageVersionFromWorkspaceInput,
} from "../types";
import { loadCatalogPackageDraftMediaKeysInExecutor } from "./draftMedia";
import {
  collectCardManagedMediaLifecycleIssues,
  createPackageVersionFromNormalizedCardsInExecutor,
  describeManagedMediaLifecycleIssues,
  hasManagedMediaLifecycleIssues,
  normalizeCreatePackageVersionInput,
} from "./versionCreation";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type CatalogWorkspaceMediaAssetRow = Readonly<{
  media_asset_id: string;
  media_blob_id: string;
}>;

function normalizeWorkspaceVersionInput(
  input: CreateCatalogPackageVersionFromWorkspaceInput,
): CreateCatalogPackageVersionFromWorkspaceInput {
  if (input.cardIds.length === 0) {
    throw new HttpError(400, "cardIds must include at least one card id", "CATALOG_PACKAGE_VERSION_EMPTY");
  }

  const uniqueCardIds = [...new Set(input.cardIds)];
  if (uniqueCardIds.length !== input.cardIds.length) {
    throw new HttpError(400, "cardIds must not include duplicates", "CATALOG_PACKAGE_CARD_DUPLICATE");
  }

  return {
    packageVersionId: input.packageVersionId,
    workspaceId: input.workspaceId,
    cardIds: uniqueCardIds,
  };
}

function normalizeWorkspaceMediaAssetIds(mediaAssetIds: ReadonlyArray<string>): ReadonlyArray<string> {
  const normalizedMediaAssetIds = mediaAssetIds.map((mediaAssetId) => mediaAssetId.toLowerCase());
  const invalidMediaAssetIds = normalizedMediaAssetIds.filter((mediaAssetId) => (
    uuidPattern.test(mediaAssetId) === false
  ));
  if (invalidMediaAssetIds.length !== 0) {
    throw new HttpError(
      400,
      `Workspace catalog version source references invalid media asset ids. mediaAssetIds=${invalidMediaAssetIds.join(",")}`,
      "CATALOG_WORKSPACE_MEDIA_ASSET_ID_INVALID",
    );
  }

  return [...new Set(normalizedMediaAssetIds)];
}

function assertWorkspaceCardManagedMediaReady(row: CatalogWorkspaceCardRow): void {
  const managedMediaIssues = collectCardManagedMediaLifecycleIssues(row.front_text, row.back_text);
  if (!hasManagedMediaLifecycleIssues(managedMediaIssues)) {
    return;
  }

  throw new HttpError(
    409,
    "Workspace catalog versions require valid ready managed media references before publication. "
      + `cardId=${row.card_id} ${describeManagedMediaLifecycleIssues(managedMediaIssues)}`,
    "CATALOG_WORKSPACE_MANAGED_MEDIA_NOT_READY",
  );
}

function getWorkspaceCardMediaAssetIds(row: CatalogWorkspaceCardRow): ReadonlyArray<string> {
  assertWorkspaceCardManagedMediaReady(row);
  return normalizeWorkspaceMediaAssetIds([
    ...extractMarkdownFcAssetIds(row.front_text),
    ...extractMarkdownFcAssetIds(row.back_text),
  ]);
}

function getWorkspaceCardsMediaAssetIds(rows: ReadonlyArray<CatalogWorkspaceCardRow>): ReadonlyArray<string> {
  for (const row of rows) {
    assertWorkspaceCardManagedMediaReady(row);
  }
  return normalizeWorkspaceMediaAssetIds(rows.flatMap((row) => [
    ...extractMarkdownFcAssetIds(row.front_text),
    ...extractMarkdownFcAssetIds(row.back_text),
  ]));
}

function buildPackageMediaKeyFromWorkspaceMediaAssetOrdinal(index: number): string {
  return normalizePackageMediaKey(`media-${index + 1}`, "workspaceMediaAssetOrdinal");
}

function buildCollisionFreePackageMediaKey(
  basePackageMediaKey: string,
  reservedPackageMediaKeys: ReadonlySet<string>,
): string {
  if (reservedPackageMediaKeys.has(basePackageMediaKey) === false) {
    return basePackageMediaKey;
  }

  let suffix = 1;
  while (reservedPackageMediaKeys.has(`${basePackageMediaKey}.${suffix}`)) {
    suffix += 1;
  }

  return `${basePackageMediaKey}.${suffix}`;
}

function buildWorkspacePackageMediaKeyMap(
  rows: ReadonlyArray<CatalogWorkspaceMediaAssetRow>,
  reservedPackageMediaKeys: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const usedPackageMediaKeys = new Set(reservedPackageMediaKeys);
  return new Map(rows.map((row, index) => {
    const packageMediaKey = buildCollisionFreePackageMediaKey(
      buildPackageMediaKeyFromWorkspaceMediaAssetOrdinal(index),
      usedPackageMediaKeys,
    );
    usedPackageMediaKeys.add(packageMediaKey);

    return [
      row.media_asset_id.toLowerCase(),
      packageMediaKey,
    ];
  }));
}

function resolveWorkspacePackageMediaKey(
  packageMediaKeysByWorkspaceMediaAssetId: ReadonlyMap<string, string>,
  workspaceMediaAssetId: string,
): string {
  const packageMediaKey = packageMediaKeysByWorkspaceMediaAssetId.get(workspaceMediaAssetId.toLowerCase());
  if (packageMediaKey === undefined) {
    throw new Error(`Workspace media asset package key was not loaded. mediaAssetId=${workspaceMediaAssetId}`);
  }

  return packageMediaKey;
}

function rewriteWorkspaceCardTextMediaKeys(
  markdown: string,
  packageMediaKeysByWorkspaceMediaAssetId: ReadonlyMap<string, string>,
): string {
  return rewriteMarkdownFcAssetUrlsToFcAssets(markdown, (workspaceMediaAssetId) => (
    resolveWorkspacePackageMediaKey(packageMediaKeysByWorkspaceMediaAssetId, workspaceMediaAssetId)
  ));
}

function mapWorkspaceCardsToSnapshots(
  rows: ReadonlyArray<CatalogWorkspaceCardRow>,
  packageMediaKeysByWorkspaceMediaAssetId: ReadonlyMap<string, string>,
): ReadonlyArray<CatalogPackageCardSnapshotInput> {
  return rows.map((row, index) => ({
    packageCardId: randomUUID(),
    stableCardKey: row.card_id,
    ordinal: index + 1,
    frontText: rewriteWorkspaceCardTextMediaKeys(row.front_text, packageMediaKeysByWorkspaceMediaAssetId),
    backText: rewriteWorkspaceCardTextMediaKeys(row.back_text, packageMediaKeysByWorkspaceMediaAssetId),
    cardType: row.card_type,
    metadata: row.metadata,
    tags: [...row.tags],
    mediaAssetKeys: getWorkspaceCardMediaAssetIds(row).map((mediaAssetId) => (
      resolveWorkspacePackageMediaKey(packageMediaKeysByWorkspaceMediaAssetId, mediaAssetId)
    )),
  }));
}

function mapWorkspaceMediaRowsToPackageVersionMediaAssets(
  rows: ReadonlyArray<CatalogWorkspaceMediaAssetRow>,
  packageMediaKeysByWorkspaceMediaAssetId: ReadonlyMap<string, string>,
): ReadonlyArray<CatalogPackageVersionMediaAssetInput> {
  return rows.map((row) => ({
    packageMediaKey: resolveWorkspacePackageMediaKey(
      packageMediaKeysByWorkspaceMediaAssetId,
      row.media_asset_id,
    ),
    mediaBlobId: row.media_blob_id,
  }));
}

async function loadWorkspaceCardsForCatalogVersionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<CatalogWorkspaceCardRow>> {
  const result = await executor.query<CatalogWorkspaceCardRow>(
    [
      "SELECT card_id, front_text, back_text, card_type, metadata, tags",
      "FROM content.cards",
      "WHERE workspace_id = $1",
      "AND card_id = ANY($2::uuid[])",
      "AND deleted_at IS NULL",
      "ORDER BY array_position($2::uuid[], card_id)",
    ].join(" "),
    [workspaceId, cardIds],
  );
  if (result.rows.length !== cardIds.length) {
    const returnedCardIds = new Set(result.rows.map((row: CatalogWorkspaceCardRow) => row.card_id));
    const missingCardIds = cardIds.filter((cardId) => returnedCardIds.has(cardId) === false);
    throw new HttpError(
      400,
      `Workspace catalog version source is missing cards. workspaceId=${workspaceId} missingCardIds=${missingCardIds.join(",")}`,
      "CATALOG_WORKSPACE_CARD_NOT_FOUND",
    );
  }

  return result.rows;
}

async function loadWorkspaceMediaAssetsForCatalogVersionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  mediaAssetIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<CatalogWorkspaceMediaAssetRow>> {
  const normalizedMediaAssetIds = normalizeWorkspaceMediaAssetIds(mediaAssetIds);
  if (normalizedMediaAssetIds.length === 0) {
    return [];
  }

  const result = await executor.query<CatalogWorkspaceMediaAssetRow>(
    [
      "SELECT",
      "media_assets.media_asset_id AS media_asset_id,",
      "media_blobs.media_blob_id AS media_blob_id",
      "FROM content.media_assets AS media_assets",
      "INNER JOIN content.media_blobs AS media_blobs",
      "ON media_blobs.media_blob_id = media_assets.media_blob_id",
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.media_asset_id = ANY($2::uuid[])",
      "AND media_assets.deleted_at IS NULL",
      "ORDER BY array_position($2::uuid[], media_assets.media_asset_id)",
    ].join(" "),
    [workspaceId, normalizedMediaAssetIds],
  );
  const returnedMediaAssetIds = new Set(result.rows.map((row: CatalogWorkspaceMediaAssetRow) => (
    row.media_asset_id.toLowerCase()
  )));
  const missingMediaAssetIds = normalizedMediaAssetIds.filter((mediaAssetId) => (
    returnedMediaAssetIds.has(mediaAssetId) === false
  ));
  if (missingMediaAssetIds.length !== 0) {
    throw new HttpError(
      400,
      `Workspace catalog version source is missing media assets. workspaceId=${workspaceId} missingMediaAssetIds=${missingMediaAssetIds.join(",")}`,
      "CATALOG_WORKSPACE_MEDIA_ASSET_NOT_FOUND",
    );
  }

  return result.rows;
}

export async function createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  input: CreateCatalogPackageVersionFromWorkspaceInput,
  adminUserId: string,
  adminEmail: string,
): Promise<CatalogPackageVersion> {
  const normalizedInput = normalizeWorkspaceVersionInput(input);
  const normalizedAdminEmail = normalizeAdminEmail(adminEmail);
  try {
    await applyWorkspaceDatabaseScopeInExecutor(executor, {
      userId: adminUserId,
      workspaceId: normalizedInput.workspaceId,
    });
    const workspaceCards = await loadWorkspaceCardsForCatalogVersionInExecutor(
      executor,
      normalizedInput.workspaceId,
      normalizedInput.cardIds,
    );
    const workspaceMediaAssets = await loadWorkspaceMediaAssetsForCatalogVersionInExecutor(
      executor,
      normalizedInput.workspaceId,
      getWorkspaceCardsMediaAssetIds(workspaceCards),
    );
    if (workspaceMediaAssets.length !== 0) {
      await lockCatalogPackageInExecutor(executor, packageId);
    }
    const reservedPackageMediaKeys = workspaceMediaAssets.length === 0
      ? new Set<string>()
      : await loadCatalogPackageDraftMediaKeysInExecutor(executor, packageId);
    const packageMediaKeysByWorkspaceMediaAssetId = buildWorkspacePackageMediaKeyMap(
      workspaceMediaAssets,
      reservedPackageMediaKeys,
    );
    const packageVersionInput = normalizeCreatePackageVersionInput({
      packageVersionId: normalizedInput.packageVersionId,
      cards: mapWorkspaceCardsToSnapshots(workspaceCards, packageMediaKeysByWorkspaceMediaAssetId),
    });

    return await createPackageVersionFromNormalizedCardsInExecutor(
      executor,
      packageId,
      packageVersionInput,
      normalizedInput.workspaceId,
      normalizedAdminEmail,
      mapWorkspaceMediaRowsToPackageVersionMediaAssets(
        workspaceMediaAssets,
        packageMediaKeysByWorkspaceMediaAssetId,
      ),
    );
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}
