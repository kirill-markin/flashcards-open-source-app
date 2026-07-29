import { randomUUID } from "node:crypto";
import {
  transactionWithWorkspaceScope,
  transactionWithWorkspaceScopeReadOnly,
  type DatabaseExecutor,
} from "../../database";
import type { CardMetadata, CardSourceMetadata } from "../../cards/types";
import { normalizeCardMetadata } from "../../cards/shared";
import {
  isValidMediaAssetLastOperationId,
  isValidMediaAssetLastOperationIdPrefix,
  maximumMediaAssetLastOperationIdLength,
} from "../../mediaAssets/lastOperationId";
import { assertReplicaBelongsToWorkspaceInExecutor } from "../../mediaAssets/workspaceReplicas";
import { HttpError } from "../../shared/errors";
import { normalizeIsoTimestamp } from "../../sync/conflicts/lww";
import {
  insertSyncChange,
  lockWorkspaceSyncMetadataForHotChangesInExecutor,
  type HotChangeWriteLock,
} from "../../sync/replication/changes";
import { rewriteMarkdownFcAssetUrlsToFcAssets } from "../../workspacePackages";
import {
  normalizeNonEmptyString,
  toIsoString,
  toOptionalIsoString,
  toSafeNumber,
} from "../common";
import type {
  CatalogPackageStatus,
  TimestampValue,
  CatalogPackageInstallConfirmInput,
  CatalogPackageInstallPreview,
  CatalogPackageInstallResult,
  CatalogPackageInstallPackageVersion,
  CatalogInstalledCard,
  CatalogInstalledMediaAsset,
} from "../types";

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

type CatalogPackageInstallVersionRow = Readonly<{
  package_version_id: string;
  package_id: string;
  version_number: string | number;
  status: CatalogPackageStatus;
  slug: string;
  title: string;
  summary: string;
  description: string;
  language_tags: ReadonlyArray<string>;
  topic_tags: ReadonlyArray<string>;
  license: string;
  content_warning: string | null;
  cover_package_media_key: string | null;
  card_count: string | number;
  created_at: TimestampValue;
  published_at: TimestampValue | null;
  author_id: string;
  author_slug: string;
  author_display_name: string;
}>;

type CatalogPackageInstallMediaAssetRow = Readonly<{
  package_media_asset_id: string;
  package_media_key: string;
  media_blob_id: string;
}>;

type CatalogPackageInstallCardRow = Readonly<{
  package_card_id: string;
  stable_card_key: string;
  ordinal: string | number;
  front_text: string;
  back_text: string;
  card_type: string;
  metadata: CardMetadata;
  tags: ReadonlyArray<string>;
  media_asset_keys: ReadonlyArray<string>;
}>;

type CatalogPackageInstallOperationConflictRow = Readonly<{
  entity_type: string;
  entity_id: string;
  last_operation_id: string;
}>;

type NormalizedCatalogPackageInstallConfirmInput = CatalogPackageInstallConfirmInput;

const catalogPackageInstallVersionColumns = [
  "package_versions.package_version_id AS package_version_id",
  "package_versions.package_id AS package_id",
  "package_versions.version_number AS version_number",
  "package_versions.status AS status",
  "package_versions.slug AS slug",
  "package_versions.title AS title",
  "package_versions.summary AS summary",
  "package_versions.description AS description",
  "package_versions.language_tags AS language_tags",
  "package_versions.topic_tags AS topic_tags",
  "package_versions.license AS license",
  "package_versions.content_warning AS content_warning",
  "package_versions.cover_package_media_key AS cover_package_media_key",
  "package_versions.card_count AS card_count",
  "package_versions.created_at AS created_at",
  "package_versions.published_at AS published_at",
  "authors.author_id AS author_id",
  "authors.slug AS author_slug",
  "authors.display_name AS author_display_name",
].join(", ");

function normalizeUuidString(value: string, fieldName: string): string {
  const normalizedValue = normalizeNonEmptyString(value, fieldName).toLowerCase();
  if (uuidPattern.test(normalizedValue) === false) {
    throw new HttpError(400, `${fieldName} must be a UUID`, "CATALOG_PACKAGE_INSTALL_INVALID_INPUT");
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
  return {
    installId: normalizeBoundedNonEmptyString(input.installId, "installId", 128),
    installedAt: normalizeCatalogInstallIsoTimestamp(input.installedAt, "installedAt"),
    clientUpdatedAt: normalizeCatalogInstallIsoTimestamp(input.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByReplicaId: normalizeUuidString(input.lastModifiedByReplicaId, "lastModifiedByReplicaId"),
    operationIdPrefix: normalizeCatalogPackageInstallOperationIdPrefix(input.operationIdPrefix),
  };
}

function assertCatalogPackageVersionIsPublished(row: CatalogPackageInstallVersionRow): void {
  if (row.status === "published") {
    return;
  }

  throw new HttpError(
    409,
    `Catalog package version must be published before installation. packageVersionId=${row.package_version_id} status=${row.status}`,
    "CATALOG_PACKAGE_VERSION_NOT_PUBLISHED",
  );
}

function mapCatalogPackageInstallPackageVersion(
  row: CatalogPackageInstallVersionRow,
): CatalogPackageInstallPackageVersion {
  return {
    packageVersionId: row.package_version_id,
    packageId: row.package_id,
    versionNumber: toSafeNumber(row.version_number, "version_number"),
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    languageTags: [...row.language_tags],
    topicTags: [...row.topic_tags],
    license: row.license,
    contentWarning: row.content_warning,
    coverPackageMediaKey: row.cover_package_media_key,
    cardCount: toSafeNumber(row.card_count, "card_count"),
    createdAt: toIsoString(row.created_at),
    publishedAt: toOptionalIsoString(row.published_at),
    author: {
      authorId: row.author_id,
      slug: row.author_slug,
      displayName: row.author_display_name,
    },
  };
}

async function loadCatalogPackageInstallVersionInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<CatalogPackageInstallVersionRow> {
  const result = await executor.query<CatalogPackageInstallVersionRow>(
    [
      "SELECT",
      catalogPackageInstallVersionColumns,
      "FROM catalog.package_versions AS package_versions",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = package_versions.package_id",
      "INNER JOIN catalog.authors AS authors",
      "ON authors.author_id = packages.author_id",
      "WHERE package_versions.package_version_id = $1",
    ].join(" "),
    [packageVersionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(
      404,
      `Catalog package version not found. packageVersionId=${packageVersionId}`,
      "CATALOG_PACKAGE_VERSION_NOT_FOUND",
    );
  }

  assertCatalogPackageVersionIsPublished(row);
  return row;
}

async function loadCatalogPackageInstallVersionForInstallInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<CatalogPackageInstallVersionRow> {
  const result = await executor.query<CatalogPackageInstallVersionRow>(
    [
      "SELECT",
      catalogPackageInstallVersionColumns,
      "FROM catalog.package_versions AS package_versions",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = package_versions.package_id",
      "INNER JOIN catalog.authors AS authors",
      "ON authors.author_id = packages.author_id",
      "WHERE package_versions.package_version_id = $1",
      "FOR SHARE OF package_versions",
    ].join(" "),
    [packageVersionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(
      404,
      `Catalog package version not found. packageVersionId=${packageVersionId}`,
      "CATALOG_PACKAGE_VERSION_NOT_FOUND",
    );
  }

  assertCatalogPackageVersionIsPublished(row);
  return row;
}

async function countCatalogPackageVersionMediaAssetsInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<number> {
  const result = await executor.query<Readonly<{ media_asset_count: string | number }>>(
    [
      "SELECT COUNT(*) AS media_asset_count",
      "FROM catalog.package_media_assets",
      "WHERE package_version_id = $1",
    ].join(" "),
    [packageVersionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Catalog package version media asset count returned no rows");
  }

  return toSafeNumber(row.media_asset_count, "media_asset_count");
}

async function loadCatalogPackageVersionMediaAssetsInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<ReadonlyArray<CatalogPackageInstallMediaAssetRow>> {
  const result = await executor.query<CatalogPackageInstallMediaAssetRow>(
    [
      "SELECT package_media_asset_id, package_media_key, media_blob_id",
      "FROM catalog.package_media_assets",
      "WHERE package_version_id = $1",
      "ORDER BY package_media_key ASC",
    ].join(" "),
    [packageVersionId],
  );

  return result.rows;
}

async function loadCatalogPackageVersionCardsInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<ReadonlyArray<CatalogPackageInstallCardRow>> {
  const result = await executor.query<CatalogPackageInstallCardRow>(
    [
      "SELECT package_card_id, stable_card_key, ordinal, front_text, back_text, card_type, metadata, tags, media_asset_keys",
      "FROM catalog.package_cards",
      "WHERE package_version_id = $1",
      "ORDER BY ordinal ASC, package_card_id ASC",
    ].join(" "),
    [packageVersionId],
  );

  return result.rows;
}

function createCatalogPackageInstallPreview(
  row: CatalogPackageInstallVersionRow,
  mediaAssetCount: number,
): CatalogPackageInstallPreview {
  return {
    packageVersion: mapCatalogPackageInstallPackageVersion(row),
    summary: {
      cardCount: toSafeNumber(row.card_count, "card_count"),
      mediaAssetCount,
    },
  };
}

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

function buildCatalogInstallOperationIds(
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

async function assertInstallIdUnusedInExecutor(
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

async function assertInstallOperationIdsUnusedInExecutor(
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

async function assertCatalogInstallReplicaBelongsToWorkspaceInExecutor(
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
      card.tags,
      input.installedAt,
      input.clientUpdatedAt,
      input.lastModifiedByReplicaId,
      buildCatalogInstallCardOperationId(input.operationIdPrefix, cardIndex),
    ],
  );
}

async function installCatalogPackageMediaAssetsInExecutor(
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

function buildInstalledMediaAssetIdsByPackageMediaKey(
  installedMediaAssets: ReadonlyArray<CatalogInstalledMediaAsset>,
): ReadonlyMap<string, string> {
  return new Map(installedMediaAssets.map((mediaAsset) => [
    mediaAsset.packageMediaKey,
    mediaAsset.mediaAssetId,
  ]));
}

async function installCatalogPackageCardsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  hotChangeWriteLock: HotChangeWriteLock,
  versionRow: CatalogPackageInstallVersionRow,
  cards: ReadonlyArray<CatalogPackageInstallCardRow>,
  input: NormalizedCatalogPackageInstallConfirmInput,
  installedMediaAssetIdsByPackageMediaKey: ReadonlyMap<string, string>,
): Promise<ReadonlyArray<CatalogInstalledCard>> {
  const installedCards: Array<CatalogInstalledCard> = [];

  for (const [cardIndex, card] of cards.entries()) {
    const cardId = randomUUID();
    await insertWorkspaceCardForCatalogInstallInExecutor(
      executor,
      workspaceId,
      cardId,
      card,
      input,
      createCatalogPackageInstallCardMetadata(card, versionRow, input),
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

export async function previewCatalogPackageInstallInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<CatalogPackageInstallPreview> {
  const normalizedPackageVersionId = normalizeUuidString(packageVersionId, "packageVersionId");
  const versionRow = await loadCatalogPackageInstallVersionInExecutor(executor, normalizedPackageVersionId);
  const mediaAssetCount = await countCatalogPackageVersionMediaAssetsInExecutor(
    executor,
    normalizedPackageVersionId,
  );

  return createCatalogPackageInstallPreview(versionRow, mediaAssetCount);
}

export async function installCatalogPackageVersionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  packageVersionId: string,
  input: CatalogPackageInstallConfirmInput,
): Promise<CatalogPackageInstallResult> {
  const normalizedWorkspaceId = normalizeUuidString(workspaceId, "workspaceId");
  const normalizedPackageVersionId = normalizeUuidString(packageVersionId, "packageVersionId");
  const normalizedInput = normalizeCatalogPackageInstallConfirmInput(input);
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

  await assertCatalogInstallReplicaBelongsToWorkspaceInExecutor(
    executor,
    normalizedWorkspaceId,
    normalizedInput.lastModifiedByReplicaId,
  );
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(
    executor,
    normalizedWorkspaceId,
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
    normalizedInput,
    installedMediaAssetIdsByPackageMediaKey,
  );

  return {
    packageVersion: mapCatalogPackageInstallPackageVersion(versionRow),
    installedCards,
    installedMediaAssets,
    summary: {
      cardCount: installedCards.length,
      mediaAssetCount: installedMediaAssets.length,
      installId: normalizedInput.installId,
      installedAt: normalizedInput.installedAt,
    },
  };
}

export async function previewCatalogPackageInstall(
  userId: string,
  workspaceId: string,
  packageVersionId: string,
): Promise<CatalogPackageInstallPreview> {
  return transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => (
    previewCatalogPackageInstallInExecutor(executor, packageVersionId)
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
