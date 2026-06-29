import { randomUUID } from "node:crypto";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../database";
import { unsafeTransaction } from "../database/core";
import { getDatabaseErrorFields } from "../database/transient";
import { HttpError } from "../shared/errors";
import type {
  AttachCatalogPackageMediaAssetInput,
  CatalogAuthor,
  CatalogAuthorRow,
  CatalogPackage,
  CatalogPackageCardSnapshotInput,
  CatalogPackageDraft,
  CatalogPackageMediaAsset,
  CatalogPackageMediaAssetRow,
  CatalogPackageRow,
  CatalogPackageStatus,
  CatalogPackageVersion,
  CatalogPackageVersionRow,
  CatalogWorkspaceCardRow,
  CreateCatalogPackageDraftInput,
  CreateCatalogPackageVersionFromWorkspaceInput,
  CreateCatalogPackageVersionInput,
  TimestampValue,
  UpdateCatalogPackageDraftInput,
  UpdateCatalogPackageVersionStatusInput,
  UpsertCatalogAuthorInput,
} from "./types";

const catalogAuthorColumns = [
  "author_id",
  "slug",
  "display_name",
  "bio",
  "website_url",
  "created_at",
  "updated_at",
].join(", ");

const catalogPackageColumns = [
  "package_id",
  "author_id",
  "slug",
  "title",
  "summary",
  "description",
  "language_tags",
  "topic_tags",
  "license",
  "content_warning",
  "cover_package_media_key",
  "status",
  "created_at",
  "updated_at",
  "published_at",
  "delisted_at",
].join(", ");

const catalogPackageMediaAssetColumns = [
  "package_media_asset_id",
  "package_id",
  "package_version_id",
  "package_media_key",
  "media_blob_id",
  "alt_text",
  "credit",
  "license",
  "created_at",
  "updated_at",
].join(", ");

const catalogPackageVersionColumns = [
  "package_version_id",
  "package_id",
  "version_number",
  "status",
  "slug",
  "title",
  "summary",
  "description",
  "language_tags",
  "topic_tags",
  "license",
  "content_warning",
  "cover_package_media_key",
  "source_workspace_id",
  "card_count",
  "created_by_admin_email",
  "reviewed_by_admin_email",
  "created_at",
  "updated_at",
  "submitted_at",
  "reviewed_at",
  "published_at",
  "delisted_at",
].join(", ");

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u;
const packageMediaKeyPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const mutablePackageVersionStatuses: ReadonlySet<CatalogPackageStatus> = new Set([
  "draft",
  "submitted",
  "needs_changes",
  "approved",
]);
const reviewStatusRouteTargets: ReadonlySet<CatalogPackageStatus> = new Set([
  "draft",
  "submitted",
  "needs_changes",
  "approved",
  "rejected",
]);
const managedMediaReferencePattern = /fcasset:/iu;

function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function toOptionalIsoString(value: TimestampValue | null): string | null {
  return value === null ? null : toIsoString(value);
}

function toSafeNumber(value: string | number, fieldName: string): number {
  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (Number.isSafeInteger(parsedValue) === false) {
    throw new Error(`${fieldName} must be a safe integer`);
  }

  return parsedValue;
}

function normalizeNonEmptyString(value: string, fieldName: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw new HttpError(400, `${fieldName} must not be empty`, "CATALOG_INVALID_INPUT");
  }

  return normalizedValue;
}

function normalizeNullableString(value: string | null, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return normalizeNonEmptyString(value, fieldName);
}

function normalizeSlug(value: string, fieldName: string): string {
  const slug = normalizeNonEmptyString(value, fieldName).toLowerCase();
  if (slugPattern.test(slug) === false) {
    throw new HttpError(
      400,
      `${fieldName} must use lowercase letters, numbers, and hyphens without leading or trailing hyphens.`,
      "CATALOG_SLUG_INVALID",
    );
  }

  return slug;
}

function normalizePackageMediaKey(value: string, fieldName: string): string {
  const packageMediaKey = normalizeNonEmptyString(value, fieldName).toLowerCase();
  if (packageMediaKeyPattern.test(packageMediaKey) === false) {
    throw new HttpError(
      400,
      `${fieldName} must use lowercase letters, numbers, dots, underscores, or hyphens.`,
      "CATALOG_PACKAGE_MEDIA_KEY_INVALID",
    );
  }

  return packageMediaKey;
}

function normalizeTextArray(
  values: ReadonlyArray<string>,
  fieldName: string,
  requireNonEmpty: boolean,
): ReadonlyArray<string> {
  const normalizedValues = values.map((value) => normalizeNonEmptyString(value, fieldName).toLowerCase());
  const uniqueValues = [...new Set(normalizedValues)];
  if (requireNonEmpty && uniqueValues.length === 0) {
    throw new HttpError(400, `${fieldName} must include at least one item`, "CATALOG_INVALID_INPUT");
  }

  return uniqueValues;
}

function normalizeAdminEmail(adminEmail: string): string {
  return normalizeNonEmptyString(adminEmail, "adminEmail").toLowerCase();
}

function readStringField(value: unknown, fieldName: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const fieldValue = (value as Readonly<Record<string, unknown>>)[fieldName];
  return typeof fieldValue === "string" && fieldValue !== "" ? fieldValue : null;
}

function toCatalogPersistenceError(error: unknown): HttpError | null {
  if (error instanceof HttpError) {
    return error;
  }

  const fields = getDatabaseErrorFields(error);
  const constraint = readStringField(error, "constraint");
  if (fields.sqlState === "23505") {
    switch (constraint) {
      case "authors_slug_unique":
        return new HttpError(409, "Catalog author slug already exists.", "CATALOG_AUTHOR_SLUG_ALREADY_EXISTS");
      case "packages_slug_unique":
        return new HttpError(409, "Catalog package slug already exists.", "CATALOG_PACKAGE_SLUG_ALREADY_EXISTS");
      case "idx_package_versions_one_review_candidate":
        return new HttpError(
          409,
          "Package already has a mutable draft or review candidate version.",
          "CATALOG_PACKAGE_VERSION_DRAFT_ALREADY_EXISTS",
        );
      case "package_versions_package_number_unique":
        return new HttpError(
          409,
          "Package version number already exists for this package.",
          "CATALOG_PACKAGE_VERSION_ALREADY_EXISTS",
        );
      case "idx_package_media_assets_draft_key_unique":
      case "idx_package_media_assets_version_key_unique":
        return new HttpError(
          409,
          "Catalog package media key already exists for this package draft or version.",
          "CATALOG_PACKAGE_MEDIA_KEY_ALREADY_EXISTS",
        );
    }
  }

  if (fields.sqlState === "23503") {
    return new HttpError(
      400,
      `Catalog write references a missing row. constraint=${constraint ?? "unknown"}`,
      "CATALOG_REFERENCE_NOT_FOUND",
    );
  }

  if (fields.sqlState === "23514") {
    return new HttpError(
      409,
      `Catalog write violates a catalog database constraint. message=${fields.errorMessage}`,
      "CATALOG_CONSTRAINT_VIOLATION",
    );
  }

  return null;
}

function rethrowCatalogPersistenceError(error: unknown): never {
  const mappedError = toCatalogPersistenceError(error);
  if (mappedError !== null) {
    throw mappedError;
  }

  throw error;
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

function mapCatalogAuthorRow(row: CatalogAuthorRow): CatalogAuthor {
  return {
    authorId: row.author_id,
    slug: row.slug,
    displayName: row.display_name,
    bio: row.bio,
    websiteUrl: row.website_url,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapCatalogPackageRow(row: CatalogPackageRow): CatalogPackage {
  return {
    packageId: row.package_id,
    authorId: row.author_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    languageTags: [...row.language_tags],
    topicTags: [...row.topic_tags],
    license: row.license,
    contentWarning: row.content_warning,
    coverPackageMediaKey: row.cover_package_media_key,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    publishedAt: toOptionalIsoString(row.published_at),
    delistedAt: toOptionalIsoString(row.delisted_at),
  };
}

function mapCatalogPackageMediaAssetRow(row: CatalogPackageMediaAssetRow): CatalogPackageMediaAsset {
  return {
    packageMediaAssetId: row.package_media_asset_id,
    packageId: row.package_id,
    packageVersionId: row.package_version_id,
    packageMediaKey: row.package_media_key,
    mediaBlobId: row.media_blob_id,
    altText: row.alt_text,
    credit: row.credit,
    license: row.license,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapCatalogPackageVersionRow(row: CatalogPackageVersionRow): CatalogPackageVersion {
  return {
    packageVersionId: row.package_version_id,
    packageId: row.package_id,
    versionNumber: toSafeNumber(row.version_number, "version_number"),
    status: row.status,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    languageTags: [...row.language_tags],
    topicTags: [...row.topic_tags],
    license: row.license,
    contentWarning: row.content_warning,
    coverPackageMediaKey: row.cover_package_media_key,
    sourceWorkspaceId: row.source_workspace_id,
    cardCount: toSafeNumber(row.card_count, "card_count"),
    createdByAdminEmail: row.created_by_admin_email,
    reviewedByAdminEmail: row.reviewed_by_admin_email,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    submittedAt: toOptionalIsoString(row.submitted_at),
    reviewedAt: toOptionalIsoString(row.reviewed_at),
    publishedAt: toOptionalIsoString(row.published_at),
    delistedAt: toOptionalIsoString(row.delisted_at),
  };
}

function normalizeCatalogAuthorInput(input: UpsertCatalogAuthorInput): UpsertCatalogAuthorInput {
  return {
    authorId: input.authorId,
    slug: normalizeSlug(input.slug, "slug"),
    displayName: normalizeNonEmptyString(input.displayName, "displayName"),
    bio: normalizeNullableString(input.bio, "bio"),
    websiteUrl: normalizeNullableString(input.websiteUrl, "websiteUrl"),
  };
}

function normalizeCreateCatalogPackageDraftInput(
  input: CreateCatalogPackageDraftInput,
): CreateCatalogPackageDraftInput {
  return {
    packageId: input.packageId,
    authorId: input.authorId,
    slug: normalizeSlug(input.slug, "slug"),
    title: normalizeNonEmptyString(input.title, "title"),
    summary: normalizeNonEmptyString(input.summary, "summary"),
    description: normalizeNonEmptyString(input.description, "description"),
    languageTags: normalizeTextArray(input.languageTags, "languageTags", true),
    topicTags: normalizeTextArray(input.topicTags, "topicTags", false),
    license: normalizeNonEmptyString(input.license, "license"),
    contentWarning: normalizeNullableString(input.contentWarning, "contentWarning"),
  };
}

function normalizeUpdateCatalogPackageDraftInput(
  input: UpdateCatalogPackageDraftInput,
): UpdateCatalogPackageDraftInput {
  return {
    ...normalizeCreateCatalogPackageDraftInput(input),
    coverPackageMediaKey: input.coverPackageMediaKey === null
      ? null
      : normalizePackageMediaKey(input.coverPackageMediaKey, "coverPackageMediaKey"),
  };
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

function normalizeCatalogPackageCardSnapshotInput(
  card: CatalogPackageCardSnapshotInput,
): CatalogPackageCardSnapshotInput {
  if (Number.isSafeInteger(card.ordinal) === false || card.ordinal < 1) {
    throw new HttpError(400, "card.ordinal must be a positive safe integer", "CATALOG_INVALID_INPUT");
  }

  return {
    packageCardId: card.packageCardId,
    stableCardKey: normalizeNonEmptyString(card.stableCardKey, "card.stableCardKey"),
    ordinal: card.ordinal,
    frontText: normalizeNonEmptyString(card.frontText, "card.frontText"),
    backText: normalizeNonEmptyString(card.backText, "card.backText"),
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

async function assertDraftMediaKeysExistInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
  mediaAssetKeys: ReadonlyArray<string>,
): Promise<void> {
  if (mediaAssetKeys.length === 0) {
    return;
  }

  const result = await executor.query<Readonly<{ package_media_key: string }>>(
    [
      "SELECT package_media_key",
      "FROM catalog.package_media_assets",
      "WHERE package_id = $1",
      "AND package_version_id IS NULL",
      "AND package_media_key = ANY($2)",
    ].join(" "),
    [packageId, mediaAssetKeys],
  );
  const existingKeys = new Set(result.rows.map((row) => row.package_media_key));
  const missingKeys = mediaAssetKeys.filter((mediaAssetKey) => existingKeys.has(mediaAssetKey) === false);
  if (missingKeys.length !== 0) {
    throw new HttpError(
      400,
      `Package draft media assets are missing referenced package-local media keys. packageId=${packageId} missingKeys=${missingKeys.join(",")}`,
      "CATALOG_PACKAGE_MEDIA_REFERENCE_NOT_FOUND",
    );
  }
}

async function lockCatalogPackageInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
): Promise<CatalogPackageRow> {
  const result = await executor.query<CatalogPackageRow>(
    [
      "SELECT",
      catalogPackageColumns,
      "FROM catalog.packages",
      "WHERE package_id = $1",
      "FOR UPDATE",
    ].join(" "),
    [packageId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, `Catalog package not found. packageId=${packageId}`, "CATALOG_PACKAGE_NOT_FOUND");
  }

  return row;
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
): Promise<CatalogPackageVersion> {
  const catalogPackage = await lockCatalogPackageInExecutor(executor, packageId);
  await assertNoMutablePackageVersionInExecutor(executor, packageId);
  await assertDraftMediaKeysExistInExecutor(
    executor,
    packageId,
    [
      ...(catalogPackage.cover_package_media_key === null ? [] : [catalogPackage.cover_package_media_key]),
      ...getAllCardMediaAssetKeys(input.cards),
    ],
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

function mapWorkspaceCardsToSnapshots(
  rows: ReadonlyArray<CatalogWorkspaceCardRow>,
): ReadonlyArray<CatalogPackageCardSnapshotInput> {
  return rows.map((row, index) => ({
    packageCardId: randomUUID(),
    stableCardKey: row.card_id,
    ordinal: index + 1,
    frontText: row.front_text,
    backText: row.back_text,
    cardType: row.card_type,
    metadata: row.metadata,
    tags: [...row.tags],
    mediaAssetKeys: [],
  }));
}

function assertWorkspaceCardHasNoManagedMediaReferences(row: CatalogWorkspaceCardRow): void {
  if (managedMediaReferencePattern.test(row.front_text)) {
    throw new HttpError(
      400,
      `Workspace card contains a managed media reference that cannot be copied into a catalog package yet. cardId=${row.card_id} field=frontText`,
      "CATALOG_WORKSPACE_CARD_MEDIA_REFERENCE_UNSUPPORTED",
    );
  }

  if (managedMediaReferencePattern.test(row.back_text)) {
    throw new HttpError(
      400,
      `Workspace card contains a managed media reference that cannot be copied into a catalog package yet. cardId=${row.card_id} field=backText`,
      "CATALOG_WORKSPACE_CARD_MEDIA_REFERENCE_UNSUPPORTED",
    );
  }
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
    const returnedCardIds = new Set(result.rows.map((row) => row.card_id));
    const missingCardIds = cardIds.filter((cardId) => returnedCardIds.has(cardId) === false);
    throw new HttpError(
      400,
      `Workspace catalog version source is missing cards. workspaceId=${workspaceId} missingCardIds=${missingCardIds.join(",")}`,
      "CATALOG_WORKSPACE_CARD_NOT_FOUND",
    );
  }

  for (const row of result.rows) {
    assertWorkspaceCardHasNoManagedMediaReferences(row);
  }

  return result.rows;
}

export async function createCatalogAuthorInExecutor(
  executor: DatabaseExecutor,
  input: UpsertCatalogAuthorInput,
): Promise<CatalogAuthor> {
  const normalizedInput = normalizeCatalogAuthorInput(input);
  try {
    const result = await executor.query<CatalogAuthorRow>(
      [
        "INSERT INTO catalog.authors",
        "(author_id, slug, display_name, bio, website_url)",
        "VALUES ($1, $2, $3, $4, $5)",
        "RETURNING",
        catalogAuthorColumns,
      ].join(" "),
      [
        normalizedInput.authorId,
        normalizedInput.slug,
        normalizedInput.displayName,
        normalizedInput.bio,
        normalizedInput.websiteUrl,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected catalog author insert to return a row");
    }

    return mapCatalogAuthorRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function updateCatalogAuthorInExecutor(
  executor: DatabaseExecutor,
  input: UpsertCatalogAuthorInput,
): Promise<CatalogAuthor> {
  const normalizedInput = normalizeCatalogAuthorInput(input);
  try {
    const result = await executor.query<CatalogAuthorRow>(
      [
        "UPDATE catalog.authors",
        "SET slug = $2, display_name = $3, bio = $4, website_url = $5",
        "WHERE author_id = $1",
        "RETURNING",
        catalogAuthorColumns,
      ].join(" "),
      [
        normalizedInput.authorId,
        normalizedInput.slug,
        normalizedInput.displayName,
        normalizedInput.bio,
        normalizedInput.websiteUrl,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new HttpError(
        404,
        `Catalog author not found. authorId=${normalizedInput.authorId}`,
        "CATALOG_AUTHOR_NOT_FOUND",
      );
    }

    return mapCatalogAuthorRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function createCatalogPackageDraftInExecutor(
  executor: DatabaseExecutor,
  input: CreateCatalogPackageDraftInput,
): Promise<CatalogPackage> {
  const normalizedInput = normalizeCreateCatalogPackageDraftInput(input);
  try {
    const result = await executor.query<CatalogPackageRow>(
      [
        "INSERT INTO catalog.packages",
        "(",
        "package_id, author_id, slug, title, summary, description, language_tags, topic_tags,",
        "license, content_warning",
        ")",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        "RETURNING",
        catalogPackageColumns,
      ].join(" "),
      [
        normalizedInput.packageId,
        normalizedInput.authorId,
        normalizedInput.slug,
        normalizedInput.title,
        normalizedInput.summary,
        normalizedInput.description,
        normalizedInput.languageTags,
        normalizedInput.topicTags,
        normalizedInput.license,
        normalizedInput.contentWarning,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected catalog package insert to return a row");
    }

    return mapCatalogPackageRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function updateCatalogPackageDraftInExecutor(
  executor: DatabaseExecutor,
  input: UpdateCatalogPackageDraftInput,
): Promise<CatalogPackage> {
  const normalizedInput = normalizeUpdateCatalogPackageDraftInput(input);
  try {
    await assertDraftMediaKeysExistInExecutor(
      executor,
      normalizedInput.packageId,
      normalizedInput.coverPackageMediaKey === null ? [] : [normalizedInput.coverPackageMediaKey],
    );
    const result = await executor.query<CatalogPackageRow>(
      [
        "UPDATE catalog.packages",
        "SET author_id = $2, slug = $3, title = $4, summary = $5, description = $6,",
        "language_tags = $7, topic_tags = $8, license = $9, content_warning = $10,",
        "cover_package_media_key = $11",
        "WHERE package_id = $1",
        "RETURNING",
        catalogPackageColumns,
      ].join(" "),
      [
        normalizedInput.packageId,
        normalizedInput.authorId,
        normalizedInput.slug,
        normalizedInput.title,
        normalizedInput.summary,
        normalizedInput.description,
        normalizedInput.languageTags,
        normalizedInput.topicTags,
        normalizedInput.license,
        normalizedInput.contentWarning,
        normalizedInput.coverPackageMediaKey,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new HttpError(
        404,
        `Catalog package not found. packageId=${normalizedInput.packageId}`,
        "CATALOG_PACKAGE_NOT_FOUND",
      );
    }

    return mapCatalogPackageRow(row);
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}

export async function loadCatalogPackageDraftInExecutor(
  executor: DatabaseExecutor,
  packageId: string,
): Promise<CatalogPackageDraft> {
  const packageResult = await executor.query<CatalogPackageRow>(
    [
      "SELECT",
      catalogPackageColumns,
      "FROM catalog.packages",
      "WHERE package_id = $1",
    ].join(" "),
    [packageId],
  );
  const packageRow = packageResult.rows[0];
  if (packageRow === undefined) {
    throw new HttpError(404, `Catalog package not found. packageId=${packageId}`, "CATALOG_PACKAGE_NOT_FOUND");
  }

  const mediaResult = await executor.query<CatalogPackageMediaAssetRow>(
    [
      "SELECT",
      catalogPackageMediaAssetColumns,
      "FROM catalog.package_media_assets",
      "WHERE package_id = $1",
      "AND package_version_id IS NULL",
      "ORDER BY package_media_key ASC",
    ].join(" "),
    [packageId],
  );

  return {
    catalogPackage: mapCatalogPackageRow(packageRow),
    mediaAssets: mediaResult.rows.map((row) => mapCatalogPackageMediaAssetRow(row)),
  };
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
    const packageVersionInput = normalizeCreatePackageVersionInput({
      packageVersionId: normalizedInput.packageVersionId,
      cards: mapWorkspaceCardsToSnapshots(workspaceCards),
    });

    return await createPackageVersionFromNormalizedCardsInExecutor(
      executor,
      packageId,
      packageVersionInput,
      normalizedInput.workspaceId,
      normalizedAdminEmail,
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

export async function createCatalogAuthor(input: UpsertCatalogAuthorInput): Promise<CatalogAuthor> {
  return unsafeTransaction(async (executor) => createCatalogAuthorInExecutor(executor, input));
}

export async function updateCatalogAuthor(input: UpsertCatalogAuthorInput): Promise<CatalogAuthor> {
  return unsafeTransaction(async (executor) => updateCatalogAuthorInExecutor(executor, input));
}

export async function createCatalogPackageDraft(
  input: CreateCatalogPackageDraftInput,
): Promise<CatalogPackage> {
  return unsafeTransaction(async (executor) => createCatalogPackageDraftInExecutor(executor, input));
}

export async function updateCatalogPackageDraft(
  input: UpdateCatalogPackageDraftInput,
): Promise<CatalogPackage> {
  return unsafeTransaction(async (executor) => updateCatalogPackageDraftInExecutor(executor, input));
}

export async function loadCatalogPackageDraft(packageId: string): Promise<CatalogPackageDraft> {
  return unsafeTransaction(async (executor) => loadCatalogPackageDraftInExecutor(executor, packageId));
}

export async function attachCatalogPackageDraftMediaAsset(
  packageId: string,
  input: AttachCatalogPackageMediaAssetInput,
): Promise<CatalogPackageMediaAsset> {
  return unsafeTransaction(async (executor) => (
    attachCatalogPackageDraftMediaAssetInExecutor(executor, packageId, input)
  ));
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
