import { randomUUID } from "node:crypto";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import { unsafeTransaction } from "../../database/core";
import { HttpError } from "../../shared/errors";
import {
  normalizeAdminEmail,
  normalizeNonEmptyString,
  normalizeNullableString,
  normalizePackageMediaKey,
  normalizeTextArray,
  toSafeNumber,
} from "../common";
import {
  assertDraftMediaKeysExistInExecutor,
  insertCatalogPackageVersionMediaAssetsInExecutor,
  loadCatalogPackageDraftMediaKeysInExecutor,
} from "./draftMedia";
import { rethrowCatalogPersistenceError } from "../errors";
import {
  catalogPackageVersionColumns,
  lockCatalogPackageInExecutor,
  mapCatalogPackageVersionRow,
} from "../rows";
import {
  extractMarkdownFcAssetIds,
  extractMarkdownManagedMediaLifecycleIssues,
  rewriteMarkdownFcAssetUrlsToFcAssets,
} from "../../workspacePackages";
import type { ManagedMediaLifecycleIssues } from "../../workspacePackages";
import type {
  CatalogPackageCardSnapshotInput,
  CatalogPackageStatus,
  CatalogPackageVersion,
  CatalogPackageVersionMediaAssetInput,
  CatalogPackageVersionRow,
  CatalogWorkspaceCardRow,
  CreateCatalogPackageVersionFromWorkspaceInput,
  CreateCatalogPackageVersionInput,
  UpdateCatalogPackageVersionStatusInput,
} from "../types";

const reviewStatusRouteTargets: ReadonlySet<CatalogPackageStatus> = new Set([
  "draft",
  "submitted",
  "needs_changes",
  "approved",
  "rejected",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type CatalogWorkspaceMediaAssetRow = Readonly<{
  media_asset_id: string;
  media_blob_id: string;
}>;

function collectCardManagedMediaLifecycleIssues(
  frontText: string,
  backText: string,
): ManagedMediaLifecycleIssues {
  const pendingDestinations = new Set<string>();
  const failedDestinations = new Set<string>();
  const unsupportedDestinations = new Set<string>();
  for (const markdown of [frontText, backText]) {
    const issues = extractMarkdownManagedMediaLifecycleIssues(markdown);
    for (const destination of issues.pendingDestinations) {
      pendingDestinations.add(destination);
    }
    for (const destination of issues.failedDestinations) {
      failedDestinations.add(destination);
    }
    for (const destination of issues.unsupportedDestinations) {
      unsupportedDestinations.add(destination);
    }
  }
  return {
    pendingDestinations: [...pendingDestinations],
    failedDestinations: [...failedDestinations],
    unsupportedDestinations: [...unsupportedDestinations],
  };
}

function describeManagedMediaLifecycleIssues(issues: ManagedMediaLifecycleIssues): string {
  const remediation: Array<string> = [];
  if (issues.pendingDestinations.length !== 0) {
    remediation.push(
      "Pending managed media is still being promoted and attached; retry after promotion and attachment settle. "
        + `pendingManagedMedia=${issues.pendingDestinations.join(",")}`,
    );
  }
  if (issues.failedDestinations.length !== 0) {
    remediation.push(
      "Failed managed media is terminal; remove the reference or regenerate and reattach the image. "
        + `failedManagedMedia=${issues.failedDestinations.join(",")}`,
    );
  }
  if (issues.unsupportedDestinations.length !== 0) {
    remediation.push(
      "Unsupported managed media lifecycle URLs must use fcasset:<id>, "
        + "fcasset:<id>?state=pending, or fcasset:<id>?state=failed. "
        + `unsupportedManagedMedia=${issues.unsupportedDestinations.join(",")}`,
    );
  }
  return remediation.join(" ");
}

function hasManagedMediaLifecycleIssues(issues: ManagedMediaLifecycleIssues): boolean {
  return issues.pendingDestinations.length !== 0
    || issues.failedDestinations.length !== 0
    || issues.unsupportedDestinations.length !== 0;
}

export function isCatalogPackageVersionStatusTransitionAllowed(
  fromStatus: CatalogPackageStatus,
  toStatus: CatalogPackageStatus,
): boolean {
  if (fromStatus === toStatus) {
    return true;
  }

  switch (fromStatus) {
    case "draft":
      return toStatus === "submitted" || toStatus === "rejected";
    case "submitted":
      return toStatus === "needs_changes" || toStatus === "approved" || toStatus === "rejected";
    case "needs_changes":
      return toStatus === "submitted" || toStatus === "rejected";
    case "approved":
      return toStatus === "published" || toStatus === "rejected";
    case "published":
      return toStatus === "delisted";
    case "rejected":
    case "delisted":
      return false;
  }
}

export function assertCatalogPackageVersionStatusTransitionAllowed(
  fromStatus: CatalogPackageStatus,
  toStatus: CatalogPackageStatus,
): void {
  if (isCatalogPackageVersionStatusTransitionAllowed(fromStatus, toStatus)) {
    return;
  }

  throw new HttpError(
    409,
    `Invalid catalog package version status transition. fromStatus=${fromStatus} toStatus=${toStatus}`,
    "CATALOG_PACKAGE_VERSION_STATUS_TRANSITION_INVALID",
  );
}

function normalizeCatalogPackageCardSnapshotInput(
  card: CatalogPackageCardSnapshotInput,
): CatalogPackageCardSnapshotInput {
  if (Number.isSafeInteger(card.ordinal) === false || card.ordinal < 1) {
    throw new HttpError(400, "card.ordinal must be a positive safe integer", "CATALOG_INVALID_INPUT");
  }
  const frontText = normalizeNonEmptyString(card.frontText, "card.frontText");
  const backText = normalizeNonEmptyString(card.backText, "card.backText");
  const managedMediaIssues = collectCardManagedMediaLifecycleIssues(frontText, backText);
  if (hasManagedMediaLifecycleIssues(managedMediaIssues)) {
    throw new HttpError(
      409,
      "Catalog package cards require valid ready managed media references. "
        + describeManagedMediaLifecycleIssues(managedMediaIssues),
      "CATALOG_MANAGED_MEDIA_NOT_READY",
    );
  }

  return {
    packageCardId: card.packageCardId,
    stableCardKey: normalizeNonEmptyString(card.stableCardKey, "card.stableCardKey"),
    ordinal: card.ordinal,
    frontText,
    backText,
    cardType: normalizeNonEmptyString(card.cardType, "card.cardType"),
    metadata: card.metadata,
    tags: normalizeTextArray(card.tags, "card.tags", false),
    mediaAssetKeys: card.mediaAssetKeys.map((mediaAssetKey) => (
      normalizePackageMediaKey(mediaAssetKey, "card.mediaAssetKeys")
    )),
  };
}

function normalizeCreatePackageVersionInput(
  input: CreateCatalogPackageVersionInput,
): CreateCatalogPackageVersionInput {
  const cards = input.cards.map((card) => normalizeCatalogPackageCardSnapshotInput(card));
  if (cards.length === 0) {
    throw new HttpError(400, "cards must include at least one card snapshot", "CATALOG_PACKAGE_VERSION_EMPTY");
  }

  assertUniqueCardSnapshots(cards);
  return {
    packageVersionId: input.packageVersionId,
    cards,
  };
}

function assertUniqueCardSnapshots(cards: ReadonlyArray<CatalogPackageCardSnapshotInput>): void {
  const stableCardKeys = new Set<string>();
  const ordinals = new Set<number>();
  const packageCardIds = new Set<string>();

  for (const card of cards) {
    if (stableCardKeys.has(card.stableCardKey)) {
      throw new HttpError(
        400,
        `cards must not repeat stableCardKey. stableCardKey=${card.stableCardKey}`,
        "CATALOG_PACKAGE_CARD_DUPLICATE",
      );
    }
    stableCardKeys.add(card.stableCardKey);

    if (ordinals.has(card.ordinal)) {
      throw new HttpError(
        400,
        `cards must not repeat ordinal. ordinal=${card.ordinal}`,
        "CATALOG_PACKAGE_CARD_DUPLICATE",
      );
    }
    ordinals.add(card.ordinal);

    if (packageCardIds.has(card.packageCardId)) {
      throw new HttpError(
        400,
        `cards must not repeat packageCardId. packageCardId=${card.packageCardId}`,
        "CATALOG_PACKAGE_CARD_DUPLICATE",
      );
    }
    packageCardIds.add(card.packageCardId);
  }
}

function getAllCardMediaAssetKeys(cards: ReadonlyArray<CatalogPackageCardSnapshotInput>): ReadonlyArray<string> {
  return [...new Set(cards.flatMap((card) => card.mediaAssetKeys))];
}

function getVersionMediaAssetKeys(
  versionMediaAssets: ReadonlyArray<CatalogPackageVersionMediaAssetInput>,
): ReadonlySet<string> {
  return new Set(versionMediaAssets.map((mediaAsset) => (
    normalizePackageMediaKey(mediaAsset.packageMediaKey, "versionMediaAssets.packageMediaKey")
  )));
}

function getDraftMediaAssetKeysForPackageVersion(
  coverPackageMediaKey: string | null,
  cards: ReadonlyArray<CatalogPackageCardSnapshotInput>,
  versionMediaAssetKeys: ReadonlySet<string>,
): ReadonlyArray<string> {
  return [
    ...(coverPackageMediaKey === null ? [] : [coverPackageMediaKey]),
    ...getAllCardMediaAssetKeys(cards).filter((mediaAssetKey) => (
      versionMediaAssetKeys.has(mediaAssetKey) === false
    )),
  ];
}

async function loadPackageVersionForUpdateInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<CatalogPackageVersionRow> {
  const result = await executor.query<CatalogPackageVersionRow>(
    [
      "SELECT",
      catalogPackageVersionColumns,
      "FROM catalog.package_versions",
      "WHERE package_version_id = $1",
      "FOR UPDATE",
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

  return row;
}

async function assertNoMutablePackageVersionInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
): Promise<void> {
  const result = await executor.query<Readonly<{
    package_version_id: string;
    status: CatalogPackageStatus;
  }>>(
    [
      "SELECT package_version_id, status",
      "FROM catalog.package_versions",
      "WHERE package_id = $1",
      "AND status IN ('draft', 'submitted', 'needs_changes', 'approved')",
      "LIMIT 1",
    ].join(" "),
    [packageId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return;
  }

  throw new HttpError(
    409,
    `Package already has a mutable catalog version. packageId=${packageId} packageVersionId=${row.package_version_id} status=${row.status}`,
    "CATALOG_PACKAGE_VERSION_DRAFT_ALREADY_EXISTS",
  );
}

async function getNextPackageVersionNumberInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
): Promise<number> {
  const result = await executor.query<Readonly<{ version_number: string | number }>>(
    [
      "SELECT version_number",
      "FROM catalog.package_versions",
      "WHERE package_id = $1",
      "ORDER BY version_number DESC",
      "LIMIT 1",
      "FOR UPDATE",
    ].join(" "),
    [packageId],
  );
  const latestVersionNumber = result.rows[0]?.version_number;
  if (latestVersionNumber === undefined) {
    return 1;
  }

  return toSafeNumber(latestVersionNumber, "version_number") + 1;
}

async function insertPackageVersionStatusEventInExecutor(
  executor: DatabaseExecutor,
  params: Readonly<{
    packageId: string;
    packageVersionId: string | null;
    fromStatus: CatalogPackageStatus | null;
    toStatus: CatalogPackageStatus;
    adminEmail: string;
    note: string | null;
  }>,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO catalog.package_review_events",
      "(package_id, package_version_id, from_status, to_status, actor_admin_email, note)",
      "VALUES ($1, $2, $3, $4, $5, $6)",
    ].join(" "),
    [
      params.packageId,
      params.packageVersionId,
      params.fromStatus,
      params.toStatus,
      params.adminEmail,
      params.note,
    ],
  );
}

async function copyDraftMediaAssetsToPackageVersionInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  packageVersionId: string,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO catalog.package_media_assets",
      "(package_media_asset_id, package_id, package_version_id, package_media_key, media_blob_id, alt_text, credit, license)",
      "SELECT gen_random_uuid(), package_id, $2, package_media_key, media_blob_id, alt_text, credit, license",
      "FROM catalog.package_media_assets",
      "WHERE package_id = $1",
      "AND package_version_id IS NULL",
    ].join(" "),
    [packageId, packageVersionId],
  );
}

async function insertPackageCardsInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  cards: ReadonlyArray<CatalogPackageCardSnapshotInput>,
): Promise<void> {
  for (const card of cards) {
    await executor.query(
      [
        "INSERT INTO catalog.package_cards",
        "(package_card_id, package_version_id, stable_card_key, ordinal, front_text, back_text, card_type, metadata, tags, media_asset_keys)",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)",
      ].join(" "),
      [
        card.packageCardId,
        packageVersionId,
        card.stableCardKey,
        card.ordinal,
        card.frontText,
        card.backText,
        card.cardType,
        JSON.stringify(card.metadata),
        card.tags,
        card.mediaAssetKeys,
      ],
    );
  }
}

async function createPackageVersionFromNormalizedCardsInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  input: CreateCatalogPackageVersionInput,
  sourceWorkspaceId: string | null,
  adminEmail: string,
  versionMediaAssets: ReadonlyArray<CatalogPackageVersionMediaAssetInput>,
): Promise<CatalogPackageVersion> {
  const catalogPackage = await lockCatalogPackageInExecutor(executor, packageId);
  await assertNoMutablePackageVersionInExecutor(executor, packageId);
  const versionMediaAssetKeys = getVersionMediaAssetKeys(versionMediaAssets);
  await assertDraftMediaKeysExistInExecutor(
    executor,
    packageId,
    getDraftMediaAssetKeysForPackageVersion(
      catalogPackage.cover_package_media_key,
      input.cards,
      versionMediaAssetKeys,
    ),
  );
  const versionNumber = await getNextPackageVersionNumberInExecutor(executor, packageId);
  const result = await executor.query<CatalogPackageVersionRow>(
    [
      "INSERT INTO catalog.package_versions",
      "(",
      "package_version_id, package_id, version_number, status, slug, title, summary, description,",
      "language_tags, topic_tags, license, content_warning, cover_package_media_key, source_workspace_id,",
      "card_count, created_by_admin_email",
      ")",
      "VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
      "RETURNING",
      catalogPackageVersionColumns,
    ].join(" "),
    [
      input.packageVersionId,
      packageId,
      versionNumber,
      catalogPackage.slug,
      catalogPackage.title,
      catalogPackage.summary,
      catalogPackage.description,
      catalogPackage.language_tags,
      catalogPackage.topic_tags,
      catalogPackage.license,
      catalogPackage.content_warning,
      catalogPackage.cover_package_media_key,
      sourceWorkspaceId,
      input.cards.length,
      adminEmail,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Expected catalog package version insert to return a row");
  }

  await copyDraftMediaAssetsToPackageVersionInExecutor(executor, packageId, input.packageVersionId);
  await insertCatalogPackageVersionMediaAssetsInExecutor(
    executor,
    packageId,
    input.packageVersionId,
    versionMediaAssets,
  );
  await insertPackageCardsInExecutor(executor, input.packageVersionId, input.cards);
  await insertPackageVersionStatusEventInExecutor(executor, {
    packageId,
    packageVersionId: input.packageVersionId,
    fromStatus: null,
    toStatus: "draft",
    adminEmail,
    note: null,
  });

  return mapCatalogPackageVersionRow(row);
}

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

export async function createCatalogPackageVersionFromCardsInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  input: CreateCatalogPackageVersionInput,
  adminEmail: string,
): Promise<CatalogPackageVersion> {
  const normalizedInput = normalizeCreatePackageVersionInput(input);
  const normalizedAdminEmail = normalizeAdminEmail(adminEmail);
  try {
    return await createPackageVersionFromNormalizedCardsInExecutor(
      executor,
      packageId,
      normalizedInput,
      null,
      normalizedAdminEmail,
      [],
    );
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
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

export async function updateCatalogPackageVersionReviewStatusInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  input: UpdateCatalogPackageVersionStatusInput,
  adminEmail: string,
): Promise<CatalogPackageVersion> {
  if (reviewStatusRouteTargets.has(input.status) === false) {
    throw new HttpError(
      400,
      `Use the publish or delist catalog endpoint for terminal public statuses. status=${input.status}`,
      "CATALOG_PACKAGE_VERSION_STATUS_INVALID",
    );
  }

  const normalizedAdminEmail = normalizeAdminEmail(adminEmail);
  const versionRow = await loadPackageVersionForUpdateInExecutor(executor, packageVersionId);
  if (versionRow.status === input.status) {
    throw new HttpError(
      409,
      `Catalog package version already has the requested status. packageVersionId=${packageVersionId} status=${input.status}`,
      "CATALOG_PACKAGE_VERSION_STATUS_UNCHANGED",
    );
  }
  assertCatalogPackageVersionStatusTransitionAllowed(versionRow.status, input.status);

  try {
    const result = await executor.query<CatalogPackageVersionRow>(
      [
        "UPDATE catalog.package_versions",
        "SET status = $2,",
        "submitted_at = CASE WHEN $2 = 'submitted' THEN now() ELSE submitted_at END,",
        "reviewed_at = CASE WHEN $2 IN ('needs_changes', 'approved', 'rejected') THEN now() ELSE reviewed_at END,",
        "reviewed_by_admin_email = CASE WHEN $2 IN ('needs_changes', 'approved', 'rejected') THEN $3 ELSE reviewed_by_admin_email END",
        "WHERE package_version_id = $1",
        "RETURNING",
        catalogPackageVersionColumns,
      ].join(" "),
      [packageVersionId, input.status, normalizedAdminEmail],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected catalog package version status update to return a row");
    }

    await insertPackageVersionStatusEventInExecutor(executor, {
      packageId: row.package_id,
      packageVersionId,
      fromStatus: versionRow.status,
      toStatus: row.status,
      adminEmail: normalizedAdminEmail,
      note: normalizeNullableString(input.note, "note"),
    });

    return mapCatalogPackageVersionRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function publishCatalogPackageVersionInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  adminEmail: string,
  note: string | null,
): Promise<CatalogPackageVersion> {
  const normalizedAdminEmail = normalizeAdminEmail(adminEmail);
  const normalizedNote = normalizeNullableString(note, "note");
  const versionRow = await loadPackageVersionForUpdateInExecutor(executor, packageVersionId);
  if (versionRow.status !== "approved") {
    throw new HttpError(
      409,
      `Catalog package version must be approved before publishing. packageVersionId=${packageVersionId} status=${versionRow.status}`,
      "CATALOG_PACKAGE_VERSION_NOT_APPROVED",
    );
  }

  try {
    const result = await executor.query<CatalogPackageVersionRow>(
      [
        "UPDATE catalog.package_versions",
        "SET status = 'published', published_at = now()",
        "WHERE package_version_id = $1",
        "RETURNING",
        catalogPackageVersionColumns,
      ].join(" "),
      [packageVersionId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected catalog package version publish to return a row");
    }

    await executor.query(
      [
        "UPDATE catalog.packages",
        "SET status = 'published', published_at = COALESCE(published_at, now()), delisted_at = NULL",
        "WHERE package_id = $1",
      ].join(" "),
      [row.package_id],
    );
    await insertPackageVersionStatusEventInExecutor(executor, {
      packageId: row.package_id,
      packageVersionId,
      fromStatus: versionRow.status,
      toStatus: "published",
      adminEmail: normalizedAdminEmail,
      note: normalizedNote,
    });

    return mapCatalogPackageVersionRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function delistCatalogPackageVersionInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  adminEmail: string,
  note: string | null,
): Promise<CatalogPackageVersion> {
  const normalizedAdminEmail = normalizeAdminEmail(adminEmail);
  const normalizedNote = normalizeNullableString(note, "note");
  const versionRow = await loadPackageVersionForUpdateInExecutor(executor, packageVersionId);
  if (versionRow.status !== "published") {
    throw new HttpError(
      409,
      `Only published catalog package versions can be delisted. packageVersionId=${packageVersionId} status=${versionRow.status}`,
      "CATALOG_PACKAGE_VERSION_NOT_PUBLISHED",
    );
  }

  try {
    const result = await executor.query<CatalogPackageVersionRow>(
      [
        "UPDATE catalog.package_versions",
        "SET status = 'delisted', delisted_at = now()",
        "WHERE package_version_id = $1",
        "RETURNING",
        catalogPackageVersionColumns,
      ].join(" "),
      [packageVersionId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected catalog package version delist to return a row");
    }

    await executor.query(
      [
        "UPDATE catalog.packages",
        "SET status = CASE",
        "WHEN EXISTS (",
        "SELECT 1 FROM catalog.package_versions",
        "WHERE package_id = $1",
        "AND status = 'published'",
        ") THEN 'published'::catalog.package_status",
        "ELSE 'delisted'::catalog.package_status",
        "END,",
        "delisted_at = CASE",
        "WHEN EXISTS (",
        "SELECT 1 FROM catalog.package_versions",
        "WHERE package_id = $1",
        "AND status = 'published'",
        ") THEN delisted_at",
        "ELSE now()",
        "END",
        "WHERE package_id = $1",
      ].join(" "),
      [row.package_id],
    );
    await insertPackageVersionStatusEventInExecutor(executor, {
      packageId: row.package_id,
      packageVersionId,
      fromStatus: versionRow.status,
      toStatus: "delisted",
      adminEmail: normalizedAdminEmail,
      note: normalizedNote,
    });

    return mapCatalogPackageVersionRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function createCatalogPackageVersionFromCards(
  packageId: string,
  input: CreateCatalogPackageVersionInput,
  adminEmail: string,
): Promise<CatalogPackageVersion> {
  return unsafeTransaction(async (executor) => (
    createCatalogPackageVersionFromCardsInExecutor(executor, packageId, input, adminEmail)
  ));
}

export async function createCatalogPackageVersionFromWorkspaceSelection(
  packageId: string,
  input: CreateCatalogPackageVersionFromWorkspaceInput,
  adminUserId: string,
  adminEmail: string,
): Promise<CatalogPackageVersion> {
  return unsafeTransaction(async (executor) => (
    createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
      executor,
      packageId,
      input,
      adminUserId,
      adminEmail,
    )
  ));
}

export async function updateCatalogPackageVersionReviewStatus(
  packageVersionId: string,
  input: UpdateCatalogPackageVersionStatusInput,
  adminEmail: string,
): Promise<CatalogPackageVersion> {
  return unsafeTransaction(async (executor) => (
    updateCatalogPackageVersionReviewStatusInExecutor(executor, packageVersionId, input, adminEmail)
  ));
}

export async function publishCatalogPackageVersion(
  packageVersionId: string,
  adminEmail: string,
  note: string | null,
): Promise<CatalogPackageVersion> {
  return unsafeTransaction(async (executor) => (
    publishCatalogPackageVersionInExecutor(executor, packageVersionId, adminEmail, note)
  ));
}

export async function delistCatalogPackageVersion(
  packageVersionId: string,
  adminEmail: string,
  note: string | null,
): Promise<CatalogPackageVersion> {
  return unsafeTransaction(async (executor) => (
    delistCatalogPackageVersionInExecutor(executor, packageVersionId, adminEmail, note)
  ));
}
