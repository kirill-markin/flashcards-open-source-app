import type { DatabaseExecutor } from "../../database";
import { HttpError } from "../../shared/errors";
import {
  extractMarkdownManagedMediaLifecycleIssues,
  type ManagedMediaLifecycleIssues,
} from "../../workspacePackages";
import {
  normalizeAdminEmail,
  normalizeNonEmptyString,
  normalizePackageMediaKey,
  normalizeTextArray,
  toSafeNumber,
} from "../common";
import { rethrowCatalogPersistenceError } from "../errors";
import {
  catalogPackageVersionColumns,
  lockCatalogPackageInExecutor,
  mapCatalogPackageVersionRow,
} from "../rows";
import type {
  CatalogPackageCardSnapshotInput,
  CatalogPackageStatus,
  CatalogPackageVersion,
  CatalogPackageVersionMediaAssetInput,
  CatalogPackageVersionRow,
  CreateCatalogPackageVersionInput,
} from "../types";
import {
  assertDraftMediaKeysExistInExecutor,
  insertCatalogPackageVersionMediaAssetsInExecutor,
} from "./draftMedia";

export function collectCardManagedMediaLifecycleIssues(
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

export function describeManagedMediaLifecycleIssues(issues: ManagedMediaLifecycleIssues): string {
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

export function hasManagedMediaLifecycleIssues(issues: ManagedMediaLifecycleIssues): boolean {
  return issues.pendingDestinations.length !== 0
    || issues.failedDestinations.length !== 0
    || issues.unsupportedDestinations.length !== 0;
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

export function normalizeCreatePackageVersionInput(
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

export async function insertPackageVersionStatusEventInExecutor(
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

export async function createPackageVersionFromNormalizedCardsInExecutor(
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
