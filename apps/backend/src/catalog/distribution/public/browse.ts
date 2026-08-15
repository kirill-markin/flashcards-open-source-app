import type { DatabaseExecutor, SqlValue } from "../../../database";
import { unsafeRepeatableReadReadOnlyTransaction } from "../../../database/core";
import { HttpError } from "../../../shared/errors";
import {
  normalizeNonEmptyString,
  normalizeSlug,
  toIsoString,
  toSafeNumber,
} from "../../common";
import {
  isPublicCatalogCardMarkdownSafe,
  isPublicCatalogTextArraySafe,
  isPublicCatalogTextSafe,
} from "../../publicSafety";
import type {
  CatalogPublicAuthor,
  CatalogPublicPackageCardPreview,
  CatalogPublicPackageCardPreviewInput,
  CatalogPublicPackageDetail,
  CatalogPublicPackageListInput,
  CatalogPublicPackageSummary,
  CatalogPublicPackageVersionSummary,
  TimestampValue,
} from "../../types";
import {
  assertPublicPackageMediaKeySafe,
  loadPublicCatalogPackageMediaAssetsInExecutor,
} from "./media";

type PublicCatalogQuery = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
}>;

type CatalogPublicPackageRow = Readonly<{
  package_id: string;
  author_id: string;
  author_slug: string;
  author_display_name: string;
  author_bio: string | null;
  author_website_url: string | null;
  package_version_id: string;
  version_number: string | number;
  status: "published";
  slug: string;
  title: string;
  summary: string;
  description: string;
  language_tags: ReadonlyArray<string>;
  license: string;
  content_warning: string | null;
  cover_package_media_key: string | null;
  card_count: string | number;
  updated_at: TimestampValue;
  published_at: TimestampValue;
}>;

type CatalogPublicPackageCardPreviewRow = Readonly<{
  ordinal: string | number;
  front_text: string;
  back_text: string;
  card_type: string;
  tags: ReadonlyArray<string>;
  media_asset_keys: ReadonlyArray<string>;
}>;

const publicCatalogPackageSelectColumns = [
  "packages.package_id AS package_id",
  "packages.slug AS slug",
  "authors.author_id AS author_id",
  "authors.slug AS author_slug",
  "authors.display_name AS author_display_name",
  "authors.bio AS author_bio",
  "authors.website_url AS author_website_url",
  "versions.package_version_id AS package_version_id",
  "versions.version_number AS version_number",
  "versions.status AS status",
  "versions.title AS title",
  "versions.summary AS summary",
  "versions.description AS description",
  "versions.language_tags AS language_tags",
  "versions.license AS license",
  "versions.content_warning AS content_warning",
  "versions.cover_package_media_key AS cover_package_media_key",
  "versions.card_count AS card_count",
  "versions.updated_at AS updated_at",
  "versions.published_at AS published_at",
].join(", ");

const latestPublishedVersionsCte = [
  "WITH latest_published_versions AS (",
  "SELECT DISTINCT ON (package_id)",
  "package_version_id, package_id, version_number, status, title, summary, description,",
  "language_tags, license, content_warning, cover_package_media_key, card_count,",
  "updated_at, published_at",
  "FROM catalog.package_versions",
  "WHERE status = 'published'",
  "AND delisted_at IS NULL",
  "ORDER BY package_id, version_number DESC",
  ")",
].join(" ");

function assertPublicCardMarkdownSafe(packageVersionId: string, markdown: string): void {
  if (isPublicCatalogCardMarkdownSafe(markdown)) {
    return;
  }

  throw new HttpError(
    409,
    `Published catalog package card contains a non-public media reference. packageVersionId=${packageVersionId}`,
    "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC",
  );
}

function assertPublicCatalogTextSafe(packageVersionId: string, value: string | null): void {
  if (isPublicCatalogTextSafe(value)) {
    return;
  }

  throw new HttpError(
    409,
    `Published catalog package contains a non-public media reference. packageVersionId=${packageVersionId}`,
    "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC",
  );
}

function assertPublicCatalogTextArraySafe(
  packageVersionId: string,
  values: ReadonlyArray<string>,
): void {
  if (isPublicCatalogTextArraySafe(values)) {
    return;
  }

  throw new HttpError(
    409,
    `Published catalog package contains a non-public media reference. packageVersionId=${packageVersionId}`,
    "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC",
  );
}

function normalizeOptionalSearch(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return normalizeNonEmptyString(value, "search").toLowerCase();
}

function normalizeOptionalTag(value: string | null, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return normalizeNonEmptyString(value, fieldName).toLowerCase();
}

function normalizePositiveBoundedLimit(value: number, fieldName: string, maximumLimit: number): number {
  if (Number.isSafeInteger(value) === false || value < 1 || value > maximumLimit) {
    throw new HttpError(
      400,
      `${fieldName} must be an integer between 1 and ${maximumLimit}`,
      "CATALOG_PUBLIC_LIMIT_INVALID",
    );
  }

  return value;
}

function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function buildPublicPackageListQuery(input: CatalogPublicPackageListInput): PublicCatalogQuery {
  const params: Array<SqlValue> = [];
  const whereClauses: Array<string> = [
    "packages.status = 'published'",
    "packages.delisted_at IS NULL",
  ];

  if (input.search !== null) {
    params.push(`%${escapeLikeValue(input.search)}%`);
    const searchParam = `$${params.length}`;
    whereClauses.push([
      "(",
      `lower(packages.slug) LIKE ${searchParam} ESCAPE '\\'`,
      `OR lower(versions.title) LIKE ${searchParam} ESCAPE '\\'`,
      `OR lower(versions.summary) LIKE ${searchParam} ESCAPE '\\'`,
      `OR lower(versions.description) LIKE ${searchParam} ESCAPE '\\'`,
      `OR lower(authors.display_name) LIKE ${searchParam} ESCAPE '\\'`,
      ")",
    ].join(" "));
  }

  if (input.languageTag !== null) {
    params.push(input.languageTag);
    whereClauses.push(`$${params.length} = ANY(versions.language_tags)`);
  }

  params.push(input.limit);

  return {
    text: [
      latestPublishedVersionsCte,
      "SELECT",
      publicCatalogPackageSelectColumns,
      "FROM catalog.packages AS packages",
      "INNER JOIN latest_published_versions AS versions",
      "ON versions.package_id = packages.package_id",
      "INNER JOIN catalog.authors AS authors",
      "ON authors.author_id = packages.author_id",
      `WHERE ${whereClauses.join(" AND ")}`,
      "ORDER BY versions.published_at DESC NULLS LAST, versions.package_version_id DESC",
      `LIMIT $${params.length}`,
    ].join(" "),
    params,
  };
}

function buildPublicPackageDetailQuery(packageSlug: string): PublicCatalogQuery {
  return {
    text: [
      latestPublishedVersionsCte,
      "SELECT",
      publicCatalogPackageSelectColumns,
      "FROM catalog.packages AS packages",
      "INNER JOIN latest_published_versions AS versions",
      "ON versions.package_id = packages.package_id",
      "INNER JOIN catalog.authors AS authors",
      "ON authors.author_id = packages.author_id",
      "WHERE packages.status = 'published'",
      "AND packages.delisted_at IS NULL",
      "AND packages.slug = $1",
      "ORDER BY versions.published_at DESC NULLS LAST, versions.package_version_id DESC",
      "LIMIT 1",
    ].join(" "),
    params: [packageSlug],
  };
}

function mapCatalogPublicAuthor(row: CatalogPublicPackageRow): CatalogPublicAuthor {
  assertPublicCatalogTextSafe(row.package_version_id, row.author_display_name);
  assertPublicCatalogTextSafe(row.package_version_id, row.author_bio);
  assertPublicCatalogTextSafe(row.package_version_id, row.author_website_url);

  return {
    authorId: row.author_id,
    slug: row.author_slug,
    displayName: row.author_display_name,
    bio: row.author_bio,
    websiteUrl: row.author_website_url,
  };
}

function mapCatalogPublicPackageVersionSummary(
  row: CatalogPublicPackageRow,
): CatalogPublicPackageVersionSummary {
  assertPublicPackageMediaKeySafe(row.package_version_id, row.cover_package_media_key);
  assertPublicCatalogTextSafe(row.package_version_id, row.title);
  assertPublicCatalogTextSafe(row.package_version_id, row.summary);
  assertPublicCatalogTextSafe(row.package_version_id, row.description);
  assertPublicCatalogTextArraySafe(row.package_version_id, row.language_tags);
  assertPublicCatalogTextSafe(row.package_version_id, row.license);
  assertPublicCatalogTextSafe(row.package_version_id, row.content_warning);

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
    license: row.license,
    contentWarning: row.content_warning,
    coverPackageMediaKey: row.cover_package_media_key,
    cardCount: toSafeNumber(row.card_count, "card_count"),
    updatedAt: toIsoString(row.updated_at),
    publishedAt: toIsoString(row.published_at),
  };
}

function mapCatalogPublicPackageSummary(row: CatalogPublicPackageRow): CatalogPublicPackageSummary {
  const latestVersion = mapCatalogPublicPackageVersionSummary(row);
  return {
    packageId: row.package_id,
    slug: latestVersion.slug,
    title: latestVersion.title,
    summary: latestVersion.summary,
    description: latestVersion.description,
    languageTags: latestVersion.languageTags,
    license: latestVersion.license,
    contentWarning: latestVersion.contentWarning,
    coverPackageMediaKey: latestVersion.coverPackageMediaKey,
    status: "published",
    author: mapCatalogPublicAuthor(row),
    latestVersion,
  };
}

function mapCatalogPublicPackageCardPreview(
  packageVersionId: string,
  row: CatalogPublicPackageCardPreviewRow,
): CatalogPublicPackageCardPreview {
  assertPublicCardMarkdownSafe(packageVersionId, row.front_text);
  assertPublicCardMarkdownSafe(packageVersionId, row.back_text);
  assertPublicCatalogTextSafe(packageVersionId, row.card_type);
  assertPublicCatalogTextArraySafe(packageVersionId, row.tags);
  for (const packageMediaKey of row.media_asset_keys) {
    assertPublicPackageMediaKeySafe(packageVersionId, packageMediaKey);
  }

  return {
    ordinal: toSafeNumber(row.ordinal, "ordinal"),
    frontText: row.front_text,
    backText: row.back_text,
    cardType: row.card_type,
    tags: [...row.tags],
    mediaAssetKeys: [...row.media_asset_keys],
  };
}

async function assertPublicPackageVersionPublishedInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<void> {
  const result = await executor.query<Readonly<{ package_version_id: string }>>(
    [
      "SELECT versions.package_version_id AS package_version_id",
      "FROM catalog.package_versions AS versions",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = versions.package_id",
      "WHERE versions.package_version_id = $1",
      "AND versions.status = 'published'",
      "AND versions.delisted_at IS NULL",
      "AND packages.status = 'published'",
      "AND packages.delisted_at IS NULL",
      "LIMIT 1",
    ].join(" "),
    [packageVersionId],
  );

  if (result.rows[0] === undefined) {
    throw new HttpError(
      404,
      `Published catalog package version not found. packageVersionId=${packageVersionId}`,
      "CATALOG_PUBLIC_PACKAGE_VERSION_NOT_FOUND",
    );
  }
}

export function normalizeCatalogPublicPackageListInput(
  input: CatalogPublicPackageListInput,
): CatalogPublicPackageListInput {
  return {
    limit: normalizePositiveBoundedLimit(input.limit, "limit", 100),
    search: normalizeOptionalSearch(input.search),
    languageTag: normalizeOptionalTag(input.languageTag, "languageTag"),
  };
}

export function normalizeCatalogPublicPackageCardPreviewInput(
  input: CatalogPublicPackageCardPreviewInput,
): CatalogPublicPackageCardPreviewInput {
  return {
    packageVersionId: input.packageVersionId,
    limit: normalizePositiveBoundedLimit(input.limit, "limit", 100),
  };
}

export async function listPublicCatalogPackagesInExecutor(
  executor: DatabaseExecutor,
  input: CatalogPublicPackageListInput,
): Promise<ReadonlyArray<CatalogPublicPackageSummary>> {
  const query = buildPublicPackageListQuery(normalizeCatalogPublicPackageListInput(input));
  const result = await executor.query<CatalogPublicPackageRow>(query.text, query.params);
  return result.rows.map((row: CatalogPublicPackageRow) => mapCatalogPublicPackageSummary(row));
}

export async function loadPublicCatalogPackageDetailInExecutor(
  executor: DatabaseExecutor,
  packageSlug: string,
): Promise<CatalogPublicPackageDetail> {
  const normalizedPackageSlug = normalizeSlug(packageSlug, "packageSlug");
  const query = buildPublicPackageDetailQuery(normalizedPackageSlug);
  const packageResult = await executor.query<CatalogPublicPackageRow>(query.text, query.params);
  const packageRow = packageResult.rows[0];
  if (packageRow === undefined) {
    throw new HttpError(
      404,
      `Published catalog package not found. packageSlug=${normalizedPackageSlug}`,
      "CATALOG_PUBLIC_PACKAGE_NOT_FOUND",
    );
  }

  return {
    ...mapCatalogPublicPackageSummary(packageRow),
    mediaAssets: await loadPublicCatalogPackageMediaAssetsInExecutor(executor, packageRow.package_version_id),
  };
}

export async function loadPublicCatalogPackageVersionCardPreviewInExecutor(
  executor: DatabaseExecutor,
  input: CatalogPublicPackageCardPreviewInput,
): Promise<ReadonlyArray<CatalogPublicPackageCardPreview>> {
  const normalizedInput = normalizeCatalogPublicPackageCardPreviewInput(input);
  await assertPublicPackageVersionPublishedInExecutor(executor, normalizedInput.packageVersionId);
  const result = await executor.query<CatalogPublicPackageCardPreviewRow>(
    [
      "SELECT ordinal, front_text, back_text, card_type, tags, media_asset_keys",
      "FROM catalog.package_cards",
      "WHERE package_version_id = $1",
      "ORDER BY ordinal ASC",
      "LIMIT $2",
    ].join(" "),
    [normalizedInput.packageVersionId, normalizedInput.limit],
  );

  return result.rows.map((row: CatalogPublicPackageCardPreviewRow) => (
    mapCatalogPublicPackageCardPreview(normalizedInput.packageVersionId, row)
  ));
}

export async function listPublicCatalogPackages(
  input: CatalogPublicPackageListInput,
): Promise<ReadonlyArray<CatalogPublicPackageSummary>> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => (
    listPublicCatalogPackagesInExecutor(executor, input)
  ));
}

export async function loadPublicCatalogPackageDetail(
  packageSlug: string,
): Promise<CatalogPublicPackageDetail> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => (
    loadPublicCatalogPackageDetailInExecutor(executor, packageSlug)
  ));
}

export async function loadPublicCatalogPackageVersionCardPreview(
  input: CatalogPublicPackageCardPreviewInput,
): Promise<ReadonlyArray<CatalogPublicPackageCardPreview>> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => (
    loadPublicCatalogPackageVersionCardPreviewInExecutor(executor, input)
  ));
}
