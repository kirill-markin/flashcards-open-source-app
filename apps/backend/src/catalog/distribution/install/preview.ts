import type { DatabaseExecutor } from "../../../database";
import type { CardMetadata } from "../../../cards/types";
import { HttpError } from "../../../shared/errors";
import {
  buildSuggestedCardImportTag,
  planCardImportTags,
  type CardImportTagPlan,
} from "../../../shared/cardImportTags";
import {
  toIsoString,
  toOptionalIsoString,
  toSafeNumber,
} from "../../common";
import type {
  CatalogPackageInstallPreview,
  CatalogPackageInstallPreviewInput,
  CatalogPackageInstallPackageVersion,
  CatalogPackageStatus,
  TimestampValue,
} from "../../types";

export type CatalogPackageInstallVersionRow = Readonly<{
  package_version_id: string;
  package_id: string;
  version_number: string | number;
  status: CatalogPackageStatus;
  slug: string;
  title: string;
  summary: string;
  description: string;
  language_tags: ReadonlyArray<string>;
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

export type CatalogPackageInstallMediaAssetRow = Readonly<{
  package_media_asset_id: string;
  package_media_key: string;
  media_blob_id: string;
}>;

export type CatalogPackageInstallCardRow = Readonly<{
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

type CatalogPackageInstallTagRow = Readonly<{
  tags: ReadonlyArray<string>;
}>;

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

export function mapCatalogPackageInstallPackageVersion(
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

export async function loadCatalogPackageInstallVersionForInstallInExecutor(
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

export async function loadCatalogPackageVersionMediaAssetsInExecutor(
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

export async function loadCatalogPackageVersionCardsInExecutor(
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

async function loadCatalogPackageVersionTagRowsInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<ReadonlyArray<CatalogPackageInstallTagRow>> {
  const result = await executor.query<CatalogPackageInstallTagRow>(
    [
      "SELECT tags",
      "FROM catalog.package_cards",
      "WHERE package_version_id = $1",
      "ORDER BY ordinal ASC, package_card_id ASC",
    ].join(" "),
    [packageVersionId],
  );

  return result.rows;
}

export function createCatalogPackageInstallTagPlan(
  cards: ReadonlyArray<Readonly<{ tags: ReadonlyArray<string> }>>,
  options: Readonly<{
    addImportTag: boolean;
    importTag: string;
    removeTags: ReadonlyArray<string>;
  }>,
): CardImportTagPlan {
  try {
    return planCardImportTags(cards, options);
  } catch (error) {
    throw new HttpError(
      400,
      `Catalog package install tag options are invalid. reason=${error instanceof Error ? error.message : String(error)}`,
      "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
    );
  }
}

function createCatalogPackageInstallPreview(
  row: CatalogPackageInstallVersionRow,
  mediaAssetCount: number,
  tagRows: ReadonlyArray<CatalogPackageInstallTagRow>,
  input: CatalogPackageInstallPreviewInput,
): CatalogPackageInstallPreview {
  const suggestedImportTag = buildSuggestedCardImportTag(
    input.generatedAt,
    input.existingWorkspaceTags,
  );
  const tagPlan = createCatalogPackageInstallTagPlan(
    tagRows,
    {
      addImportTag: true,
      importTag: suggestedImportTag,
      removeTags: [],
    },
  );

  return {
    packageVersion: mapCatalogPackageInstallPackageVersion(row),
    summary: {
      cardCount: toSafeNumber(row.card_count, "card_count"),
      mediaAssetCount,
    },
    tagCounts: tagPlan.sourceTagCounts,
    defaultOptions: {
      addImportTag: true,
      suggestedImportTag,
      keptTags: tagPlan.keptTags,
      removedTags: tagPlan.removedTags,
    },
  };
}

export async function loadCatalogPackageInstallPreviewInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  input: CatalogPackageInstallPreviewInput,
): Promise<CatalogPackageInstallPreview> {
  const versionRow = await loadCatalogPackageInstallVersionInExecutor(executor, packageVersionId);
  const mediaAssetCount = await countCatalogPackageVersionMediaAssetsInExecutor(
    executor,
    packageVersionId,
  );
  const tagRows = await loadCatalogPackageVersionTagRowsInExecutor(
    executor,
    packageVersionId,
  );

  return createCatalogPackageInstallPreview(versionRow, mediaAssetCount, tagRows, input);
}
