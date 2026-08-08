import { randomUUID } from "node:crypto";
import type { DatabaseExecutor } from "../../../database";
import type { CardMetadata, CardSourceMetadata } from "../../../cards/types";
import { normalizeCardMetadata } from "../../../cards/shared";
import { isValidMediaAssetLastOperationId } from "../../../mediaAssets/lastOperationId";
import { assertReplicaBelongsToWorkspaceInExecutor } from "../../../mediaAssets/workspaceReplicas";
import { HttpError } from "../../../shared/errors";
import type { CardImportTagPlan } from "../../../shared/cardImportTags";
import { normalizeIsoTimestamp } from "../../../sync/conflicts/lww";
import {
  insertSyncChange,
  type HotChangeWriteLock,
} from "../../../sync/replication/changes";
import { rewriteMarkdownFcAssetUrlsToFcAssets } from "../../../workspacePackages";
import {
  toIsoString,
  toOptionalIsoString,
  toSafeNumber,
} from "../../common";
import type {
  CatalogInstalledCard,
  CatalogInstalledMediaAsset,
} from "../../types";
import type { NormalizedCatalogPackageInstallConfirmInput } from "./replay";
import type {
  CatalogPackageInstallCardRow,
  CatalogPackageInstallMediaAssetRow,
  CatalogPackageInstallVersionRow,
} from "./preview";

type CatalogPackageInstallOperationConflictRow = Readonly<{
  entity_type: string;
  entity_id: string;
  last_operation_id: string;
}>;

function buildCatalogInstallMediaOperationId(operationIdPrefix: string, mediaAssetIndex: number): string {
  const lastOperationId = `${operationIdPrefix}:media:${mediaAssetIndex}`;
  if (isValidMediaAssetLastOperationId(lastOperationId)) {
    return lastOperationId;
  }

  throw new HttpError(
    400,
    "Derived catalog media lastOperationId is invalid.",
    "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
  );
}

function buildCatalogInstallCardOperationId(operationIdPrefix: string, cardIndex: number): string {
  const lastOperationId = `${operationIdPrefix}:card:${cardIndex}`;
  if (isValidMediaAssetLastOperationId(lastOperationId)) {
    return lastOperationId;
  }

  throw new HttpError(
    400,
    "Derived catalog card lastOperationId is invalid.",
    "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
  );
}

export function buildCatalogInstallOperationIds(
  input: NormalizedCatalogPackageInstallConfirmInput,
  mediaAssets: ReadonlyArray<CatalogPackageInstallMediaAssetRow>,
  cards: ReadonlyArray<CatalogPackageInstallCardRow>,
): ReadonlyArray<string> {
  return [
    ...mediaAssets.map((_mediaAsset, mediaAssetIndex) => (
      buildCatalogInstallMediaOperationId(input.operationIdPrefix, mediaAssetIndex)
    )),
    ...cards.map((_card, cardIndex) => buildCatalogInstallCardOperationId(input.operationIdPrefix, cardIndex)),
  ];
}

export async function assertInstallIdUnusedInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  installId: string,
): Promise<void> {
  const result = await executor.query<Readonly<{ card_id: string }>>(
    [
      "SELECT card_id",
      "FROM content.cards",
      "WHERE workspace_id = $1",
      "AND metadata->'source'->>'importId' = $2",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, installId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    return;
  }

  throw new HttpError(
    409,
    `Catalog package install id already exists in this workspace. workspaceId=${workspaceId} installId=${installId} cardId=${row.card_id}`,
    "CATALOG_PACKAGE_INSTALL_ID_ALREADY_EXISTS",
  );
}

export async function assertInstallOperationIdsUnusedInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  operationIds: ReadonlyArray<string>,
): Promise<void> {
  if (operationIds.length === 0) {
    return;
  }

  const result = await executor.query<CatalogPackageInstallOperationConflictRow>(
    [
      "SELECT entity_type, entity_id, last_operation_id",
      "FROM (",
      "SELECT 'card'::text AS entity_type, card_id::text AS entity_id, last_operation_id",
      "FROM content.cards",
      "WHERE workspace_id = $1",
      "AND last_operation_id = ANY($2::text[])",
      "UNION ALL",
      "SELECT 'media_asset'::text AS entity_type, media_asset_id::text AS entity_id, last_operation_id",
      "FROM content.media_assets",
      "WHERE workspace_id = $1",
      "AND last_operation_id = ANY($2::text[])",
      ") AS operation_conflicts",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, operationIds],
  );

  const row = result.rows[0];
  if (row === undefined) {
    return;
  }

  throw new HttpError(
    409,
    [
      "Catalog package install operation id already exists in this workspace.",
      `workspaceId=${workspaceId}`,
      `operationId=${row.last_operation_id}`,
      `entityType=${row.entity_type}`,
      `entityId=${row.entity_id}`,
    ].join(" "),
    "CATALOG_PACKAGE_INSTALL_OPERATION_ALREADY_EXISTS",
  );
}

export async function assertCatalogInstallReplicaBelongsToWorkspaceInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  replicaId: string,
): Promise<void> {
  try {
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, replicaId);
  } catch (error) {
    if (error instanceof HttpError && error.code === "MEDIA_ASSET_REPLICA_INVALID") {
      throw new HttpError(
        400,
        "lastModifiedByReplicaId must reference a workspace replica for this workspace.",
        "CATALOG_PACKAGE_INSTALL_REPLICA_INVALID",
        error.details ?? undefined,
      );
    }

    throw error;
  }
}

function resolveInstalledMediaAssetId(
  installedMediaAssetIdsByPackageMediaKey: ReadonlyMap<string, string>,
  packageMediaKey: string,
): string {
  const mediaAssetId = installedMediaAssetIdsByPackageMediaKey.get(packageMediaKey);
  if (mediaAssetId === undefined) {
    throw new HttpError(
      409,
      `Catalog package card references missing package media asset. packageMediaKey=${packageMediaKey}`,
      "CATALOG_PACKAGE_INSTALL_MEDIA_ASSET_NOT_FOUND",
    );
  }

  return mediaAssetId;
}

function rewriteCatalogInstallMarkdown(
  markdown: string,
  installedMediaAssetIdsByPackageMediaKey: ReadonlyMap<string, string>,
  packageCardId: string,
  fieldName: "frontText" | "backText",
): string {
  try {
    return rewriteMarkdownFcAssetUrlsToFcAssets(markdown, (packageMediaKey) => (
      resolveInstalledMediaAssetId(installedMediaAssetIdsByPackageMediaKey, packageMediaKey)
    ));
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(
        error.statusCode,
        `Catalog package card ${fieldName} media rewrite failed. packageCardId=${packageCardId} reason=${error.message}`,
        error.code ?? undefined,
        error.details ?? undefined,
      );
    }

    throw new HttpError(
      409,
      `Catalog package card ${fieldName} media rewrite failed. packageCardId=${packageCardId} reason=${error instanceof Error ? error.message : String(error)}`,
      "CATALOG_PACKAGE_INSTALL_MEDIA_REWRITE_FAILED",
    );
  }
}

function normalizePackageCardMetadata(card: CatalogPackageInstallCardRow): CardMetadata {
  try {
    return normalizeCardMetadata(card.metadata);
  } catch (error) {
    throw new HttpError(
      409,
      `Catalog package card metadata is invalid. packageCardId=${card.package_card_id} reason=${error instanceof Error ? error.message : String(error)}`,
      "CATALOG_PACKAGE_CARD_METADATA_INVALID",
    );
  }
}

function normalizePackageCardSourceCreatedAt(
  card: CatalogPackageInstallCardRow,
  sourceCreatedAt: string | null,
  packageSourceCreatedAt: string,
): string {
  if (sourceCreatedAt === null) {
    return packageSourceCreatedAt;
  }

  try {
    return normalizeIsoTimestamp(sourceCreatedAt, "metadata.source.createdAt");
  } catch (error) {
    throw new HttpError(
      409,
      `Catalog package card source createdAt is invalid. packageCardId=${card.package_card_id} reason=${error instanceof Error ? error.message : String(error)}`,
      "CATALOG_PACKAGE_CARD_METADATA_INVALID",
    );
  }
}

function createCatalogPackageInstallPackageSource(
  versionRow: CatalogPackageInstallVersionRow,
): CardSourceMetadata & Readonly<{ createdAt: string }> {
  return {
    label: versionRow.title,
    author: versionRow.author_display_name,
    comment: versionRow.summary,
    createdAt: toOptionalIsoString(versionRow.published_at) ?? toIsoString(versionRow.created_at),
    importedAt: null,
    importId: null,
  };
}

function createCatalogPackageInstallCardMetadata(
  card: CatalogPackageInstallCardRow,
  versionRow: CatalogPackageInstallVersionRow,
  input: NormalizedCatalogPackageInstallConfirmInput,
): CardMetadata {
  const cardMetadata = normalizePackageCardMetadata(card);
  const packageSource = createCatalogPackageInstallPackageSource(versionRow);
  const cardSource = cardMetadata.source;

  return {
    version: 1,
    source: {
      label: cardSource?.label ?? packageSource.label,
      author: cardSource?.author ?? packageSource.author,
      comment: cardSource?.comment ?? packageSource.comment,
      createdAt: normalizePackageCardSourceCreatedAt(
        card,
        cardSource?.createdAt ?? null,
        packageSource.createdAt,
      ),
      importedAt: input.installedAt,
      importId: input.installId,
    },
  };
}

function assertPackageCardMediaAssetKeysExist(
  card: CatalogPackageInstallCardRow,
  installedMediaAssetIdsByPackageMediaKey: ReadonlyMap<string, string>,
): void {
  const missingMediaAssetKeys = card.media_asset_keys.filter((packageMediaKey) => (
    installedMediaAssetIdsByPackageMediaKey.has(packageMediaKey) === false
  ));
  if (missingMediaAssetKeys.length === 0) {
    return;
  }

  throw new HttpError(
    409,
    `Catalog package card references missing package media asset keys. packageCardId=${card.package_card_id} packageMediaKeys=${missingMediaAssetKeys.join(",")}`,
    "CATALOG_PACKAGE_INSTALL_MEDIA_ASSET_NOT_FOUND",
  );
}

async function insertWorkspaceMediaAssetForCatalogInstallInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  mediaAssetId: string,
  packageMediaAsset: CatalogPackageInstallMediaAssetRow,
  input: NormalizedCatalogPackageInstallConfirmInput,
  mediaAssetIndex: number,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO content.media_assets",
      "(",
      "media_asset_id, workspace_id, media_blob_id, source_url, created_at,",
      "client_updated_at, last_modified_by_replica_id, last_operation_id",
      ")",
      "VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)",
    ].join(" "),
    [
      mediaAssetId,
      workspaceId,
      packageMediaAsset.media_blob_id,
      input.installedAt,
      input.clientUpdatedAt,
      input.lastModifiedByReplicaId,
      buildCatalogInstallMediaOperationId(input.operationIdPrefix, mediaAssetIndex),
    ],
  );
}

async function insertWorkspaceCardForCatalogInstallInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
  card: CatalogPackageInstallCardRow,
  input: NormalizedCatalogPackageInstallConfirmInput,
  metadata: CardMetadata,
  tags: ReadonlyArray<string>,
  createdAt: string,
  cardIndex: number,
  installedMediaAssetIdsByPackageMediaKey: ReadonlyMap<string, string>,
): Promise<void> {
  assertPackageCardMediaAssetKeysExist(card, installedMediaAssetIdsByPackageMediaKey);

  await executor.query(
    [
      "INSERT INTO content.cards",
      "(",
      "card_id, workspace_id, front_text, back_text, card_type, metadata, tags, effort_level, due_at, created_at,",
      "reps, lapses, fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
      "client_updated_at, last_modified_by_replica_id, last_operation_id",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'fast', NULL, $8, 0, 0, 'new', NULL, NULL, NULL, NULL, NULL, $9, $10, $11)",
    ].join(" "),
    [
      cardId,
      workspaceId,
      rewriteCatalogInstallMarkdown(
        card.front_text,
        installedMediaAssetIdsByPackageMediaKey,
        card.package_card_id,
        "frontText",
      ),
      rewriteCatalogInstallMarkdown(
        card.back_text,
        installedMediaAssetIdsByPackageMediaKey,
        card.package_card_id,
        "backText",
      ),
      card.card_type,
      JSON.stringify(metadata),
      tags,
      createdAt,
      input.clientUpdatedAt,
      input.lastModifiedByReplicaId,
      buildCatalogInstallCardOperationId(input.operationIdPrefix, cardIndex),
    ],
  );
}

export async function installCatalogPackageMediaAssetsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  hotChangeWriteLock: HotChangeWriteLock,
  mediaAssets: ReadonlyArray<CatalogPackageInstallMediaAssetRow>,
  input: NormalizedCatalogPackageInstallConfirmInput,
): Promise<ReadonlyArray<CatalogInstalledMediaAsset>> {
  const installedMediaAssets: Array<CatalogInstalledMediaAsset> = [];

  for (const [mediaAssetIndex, packageMediaAsset] of mediaAssets.entries()) {
    const mediaAssetId = randomUUID();
    await insertWorkspaceMediaAssetForCatalogInstallInExecutor(
      executor,
      workspaceId,
      mediaAssetId,
      packageMediaAsset,
      input,
      mediaAssetIndex,
    );
    await insertSyncChange(
      executor,
      workspaceId,
      hotChangeWriteLock,
      "media_asset",
      mediaAssetId,
      "upsert",
      input.lastModifiedByReplicaId,
      buildCatalogInstallMediaOperationId(input.operationIdPrefix, mediaAssetIndex),
      input.clientUpdatedAt,
    );

    installedMediaAssets.push({
      packageMediaAssetId: packageMediaAsset.package_media_asset_id,
      packageMediaKey: packageMediaAsset.package_media_key,
      mediaAssetId,
    });
  }

  return installedMediaAssets;
}

export function buildInstalledMediaAssetIdsByPackageMediaKey(
  installedMediaAssets: ReadonlyArray<CatalogInstalledMediaAsset>,
): ReadonlyMap<string, string> {
  return new Map(installedMediaAssets.map((mediaAsset) => [
    mediaAsset.packageMediaKey,
    mediaAsset.mediaAssetId,
  ]));
}

function buildOrderedCatalogInstallCardTimestamps(
  installedAt: string,
  cardCount: number,
): ReadonlyArray<string> {
  const installedAtMillis = new Date(installedAt).getTime();
  return Array.from({ length: cardCount }, (_unused, cardIndex) => {
    const timestampMillis = installedAtMillis - (cardCount - cardIndex - 1);
    try {
      return new Date(timestampMillis).toISOString();
    } catch {
      throw new HttpError(
        400,
        `installedAt is too early to assign ordered catalog card timestamps. installedAt=${installedAt} cardCount=${cardCount}`,
        "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
      );
    }
  });
}

function getCatalogInstallCardValue<Value>(
  values: ReadonlyArray<Value>,
  cardIndex: number,
  fieldName: string,
): Value {
  const value = values[cardIndex];
  if (value === undefined) {
    throw new Error(`Missing catalog install card value. fieldName=${fieldName} cardIndex=${cardIndex}`);
  }

  return value;
}

export async function installCatalogPackageCardsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  hotChangeWriteLock: HotChangeWriteLock,
  versionRow: CatalogPackageInstallVersionRow,
  cards: ReadonlyArray<CatalogPackageInstallCardRow>,
  tagPlan: CardImportTagPlan,
  input: NormalizedCatalogPackageInstallConfirmInput,
  installedMediaAssetIdsByPackageMediaKey: ReadonlyMap<string, string>,
): Promise<ReadonlyArray<CatalogInstalledCard>> {
  const installedCards: Array<CatalogInstalledCard> = [];
  const createdAtValues = buildOrderedCatalogInstallCardTimestamps(input.installedAt, cards.length);

  for (const [cardIndex, card] of cards.entries()) {
    const cardId = randomUUID();
    await insertWorkspaceCardForCatalogInstallInExecutor(
      executor,
      workspaceId,
      cardId,
      card,
      input,
      createCatalogPackageInstallCardMetadata(card, versionRow, input),
      getCatalogInstallCardValue(tagPlan.cardTags, cardIndex, "tags"),
      getCatalogInstallCardValue(createdAtValues, cardIndex, "createdAt"),
      cardIndex,
      installedMediaAssetIdsByPackageMediaKey,
    );
    await insertSyncChange(
      executor,
      workspaceId,
      hotChangeWriteLock,
      "card",
      cardId,
      "upsert",
      input.lastModifiedByReplicaId,
      buildCatalogInstallCardOperationId(input.operationIdPrefix, cardIndex),
      input.clientUpdatedAt,
    );
    installedCards.push({
      packageCardId: card.package_card_id,
      stableCardKey: card.stable_card_key,
      ordinal: toSafeNumber(card.ordinal, "ordinal"),
      cardId,
    });
  }

  return installedCards;
}


