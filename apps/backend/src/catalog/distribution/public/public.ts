import type { DatabaseExecutor, SqlValue } from "../../../database";
import { unsafeRepeatableReadReadOnlyTransaction } from "../../../database/core";
import { HttpError } from "../../../shared/errors";
import {
  isUnsafePublicPackageMediaKey,
  normalizeNonEmptyString,
  normalizePackageMediaKey,
  normalizeSlug,
  toIsoString,
  toSafeNumber,
} from "../../common";
import {
  getCatalogCardRequiredPackageMediaKeys,
} from "../../cardMedia";
import {
  getPublicCatalogAuthorEligibilityIssue,
  getPublicCatalogVersionEligibilityIssue,
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
  CatalogPublicPackageMediaAsset,
  CatalogPublicPackageMediaDownloadSource,
  CatalogPublicPackageSummary,
  CatalogPublicPackageVersionSummary,
  CatalogPublicSnapshot,
  CatalogPublicSnapshotAuthor,
  CatalogPublicSnapshotCard,
  CatalogPublicSnapshotCollection,
  CatalogPublicSnapshotCollectionPackage,
  CatalogPublicSnapshotMediaAsset,
  CatalogPublicSnapshotPackage,
  CatalogPublicSnapshotPackageVersion,
  TimestampValue,
} from "../../types";
import { catalogPublicSnapshotSchemaVersion } from "../../types";

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
  topic_tags: ReadonlyArray<string>;
  license: string;
  content_warning: string | null;
  cover_package_media_key: string | null;
  card_count: string | number;
  updated_at: TimestampValue;
  published_at: TimestampValue;
}>;

type CatalogPublicPackageMediaAssetRow = Readonly<{
  package_version_id: string;
  package_media_key: string;
  alt_text: string | null;
  credit: string | null;
  license: string | null;
  mime_type: string;
  size_bytes: string | number;
}>;

type CatalogPublicPackageMediaDownloadRow = CatalogPublicPackageMediaAssetRow & Readonly<{
  storage_key: string;
  sha256: string;
}>;

type CatalogPublicPackageCardPreviewRow = Readonly<{
  ordinal: string | number;
  front_text: string;
  back_text: string;
  card_type: string;
  tags: ReadonlyArray<string>;
  media_asset_keys: ReadonlyArray<string>;
}>;

type CatalogPublicSnapshotPackageVersionRow = CatalogPublicPackageRow & Readonly<{
  package_slug: string;
  package_published_at: TimestampValue;
  version_slug: string;
}>;

type CatalogPublicSnapshotMediaAssetRow = CatalogPublicPackageMediaAssetRow & Readonly<{
  package_media_asset_id: string;
}>;

type CatalogPublicSnapshotCardRow = CatalogPublicPackageCardPreviewRow & Readonly<{
  package_card_id: string;
  package_version_id: string;
}>;

type CatalogPublicSnapshotCollectionRow = Readonly<{
  collection_id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  language_tags: ReadonlyArray<string>;
  topic_tags: ReadonlyArray<string>;
  cover_package_id: string | null;
  status: "published";
  updated_at: TimestampValue;
  published_at: TimestampValue;
}>;

type CatalogPublicSnapshotCollectionPackageRow = Readonly<{
  collection_id: string;
  package_id: string;
  ordinal: string | number;
}>;

type CatalogPublicSnapshotLoadInput = Readonly<{
  publicApiBaseUrl: string;
  publicAppBaseUrl: string;
  generatedAt: string;
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
  "versions.topic_tags AS topic_tags",
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
  "language_tags, topic_tags, license, content_warning, cover_package_media_key, card_count,",
  "updated_at, published_at",
  "FROM catalog.package_versions",
  "WHERE status = 'published'",
  "AND delisted_at IS NULL",
  "ORDER BY package_id, version_number DESC",
  ")",
].join(" ");

function buildCatalogPackageMediaDownloadUrlPath(packageVersionId: string, packageMediaKey: string): string {
  return `/catalog/package-versions/${packageVersionId}/media-assets/${packageMediaKey}/download-url`;
}

function assertPublicPackageMediaKeySafe(
  packageVersionId: string,
  packageMediaKey: string | null,
): void {
  if (packageMediaKey === null || isUnsafePublicPackageMediaKey(packageMediaKey) === false) {
    return;
  }

  throw new HttpError(
    409,
    `Published catalog package contains a non-public media key. packageVersionId=${packageVersionId}`,
    "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC",
  );
}

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

function assertPublicCatalogTextSafe(
  packageVersionId: string,
  value: string | null,
): void {
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

  if (input.topicTag !== null) {
    params.push(input.topicTag);
    whereClauses.push(`$${params.length} = ANY(versions.topic_tags)`);
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

function buildPublicCatalogSnapshotPackageVersionsQuery(): PublicCatalogQuery {
  return {
    text: [
      "SELECT",
      "packages.package_id AS package_id,",
      "packages.author_id AS author_id,",
      "packages.slug AS package_slug,",
      "packages.published_at AS package_published_at,",
      "authors.slug AS author_slug,",
      "authors.display_name AS author_display_name,",
      "authors.bio AS author_bio,",
      "authors.website_url AS author_website_url,",
      "versions.package_version_id AS package_version_id,",
      "versions.version_number AS version_number,",
      "versions.status AS status,",
      "versions.slug AS version_slug,",
      "versions.slug AS slug,",
      "versions.title AS title,",
      "versions.summary AS summary,",
      "versions.description AS description,",
      "versions.language_tags AS language_tags,",
      "versions.topic_tags AS topic_tags,",
      "versions.license AS license,",
      "versions.content_warning AS content_warning,",
      "versions.cover_package_media_key AS cover_package_media_key,",
      "versions.card_count AS card_count,",
      "versions.updated_at AS updated_at,",
      "versions.published_at AS published_at",
      "FROM catalog.package_versions AS versions",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = versions.package_id",
      "INNER JOIN catalog.authors AS authors",
      "ON authors.author_id = packages.author_id",
      "WHERE versions.status = 'published'",
      "AND versions.delisted_at IS NULL",
      "AND packages.status = 'published'",
      "AND packages.delisted_at IS NULL",
      "ORDER BY packages.slug ASC, versions.version_number ASC, versions.package_version_id ASC",
    ].join(" "),
    params: [],
  };
}

function buildPublicCatalogSnapshotMediaAssetsQuery(): PublicCatalogQuery {
  return {
    text: [
      "SELECT",
      "media_assets.package_media_asset_id AS package_media_asset_id,",
      "media_assets.package_version_id AS package_version_id,",
      "media_assets.package_media_key AS package_media_key,",
      "media_assets.alt_text AS alt_text,",
      "media_assets.credit AS credit,",
      "media_assets.license AS license,",
      "media_blobs.mime_type AS mime_type,",
      "media_blobs.size_bytes AS size_bytes",
      "FROM catalog.package_media_assets AS media_assets",
      "INNER JOIN catalog.package_versions AS versions",
      "ON versions.package_version_id = media_assets.package_version_id",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = versions.package_id",
      "INNER JOIN content.media_blobs AS media_blobs",
      "ON media_blobs.media_blob_id = media_assets.media_blob_id",
      "WHERE versions.status = 'published'",
      "AND versions.delisted_at IS NULL",
      "AND packages.status = 'published'",
      "AND packages.delisted_at IS NULL",
      "ORDER BY media_assets.package_version_id ASC, media_assets.package_media_key ASC",
    ].join(" "),
    params: [],
  };
}

function buildPublicCatalogSnapshotCardsQuery(): PublicCatalogQuery {
  return {
    text: [
      "SELECT",
      "cards.package_card_id AS package_card_id,",
      "cards.package_version_id AS package_version_id,",
      "cards.ordinal AS ordinal,",
      "cards.front_text AS front_text,",
      "cards.back_text AS back_text,",
      "cards.card_type AS card_type,",
      "cards.tags AS tags,",
      "cards.media_asset_keys AS media_asset_keys",
      "FROM catalog.package_cards AS cards",
      "INNER JOIN catalog.package_versions AS versions",
      "ON versions.package_version_id = cards.package_version_id",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = versions.package_id",
      "WHERE versions.status = 'published'",
      "AND versions.delisted_at IS NULL",
      "AND packages.status = 'published'",
      "AND packages.delisted_at IS NULL",
      "ORDER BY cards.package_version_id ASC, cards.ordinal ASC, cards.package_card_id ASC",
    ].join(" "),
    params: [],
  };
}

function buildPublicCatalogSnapshotCollectionsQuery(): PublicCatalogQuery {
  return {
    text: [
      "SELECT",
      "collections.collection_id AS collection_id,",
      "collections.slug AS slug,",
      "collections.title AS title,",
      "collections.summary AS summary,",
      "collections.description AS description,",
      "collections.language_tags AS language_tags,",
      "collections.topic_tags AS topic_tags,",
      "collections.cover_package_id AS cover_package_id,",
      "collections.status AS status,",
      "collections.updated_at AS updated_at,",
      "collections.published_at AS published_at",
      "FROM catalog.collections AS collections",
      "WHERE collections.status = 'published'",
      "AND collections.delisted_at IS NULL",
      "ORDER BY collections.slug ASC, collections.collection_id ASC",
    ].join(" "),
    params: [],
  };
}

function buildPublicCatalogSnapshotCollectionPackagesQuery(): PublicCatalogQuery {
  return {
    text: [
      "SELECT",
      "memberships.collection_id AS collection_id,",
      "memberships.package_id AS package_id,",
      "memberships.ordinal AS ordinal",
      "FROM catalog.collection_packages AS memberships",
      "INNER JOIN catalog.collections AS collections",
      "ON collections.collection_id = memberships.collection_id",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = memberships.package_id",
      "WHERE collections.status = 'published'",
      "AND collections.delisted_at IS NULL",
      "AND packages.status = 'published'",
      "AND packages.delisted_at IS NULL",
      "AND EXISTS (",
      "SELECT 1",
      "FROM catalog.package_versions AS versions",
      "WHERE versions.package_id = packages.package_id",
      "AND versions.status = 'published'",
      "AND versions.delisted_at IS NULL",
      ")",
      "ORDER BY memberships.collection_id ASC, memberships.ordinal ASC, memberships.package_id ASC",
    ].join(" "),
    params: [],
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

function mapCatalogPublicSnapshotAuthor(
  row: CatalogPublicSnapshotPackageVersionRow,
): CatalogPublicSnapshotAuthor {
  const issue = getPublicCatalogAuthorEligibilityIssue({
    slug: row.author_slug,
    displayName: row.author_display_name,
    bio: row.author_bio,
    websiteUrl: row.author_website_url,
  });
  if (issue !== null) {
    throw new Error(
      `Eligible catalog package version has an ineligible author. packageVersionId=${row.package_version_id} reason=${issue.reason}`,
    );
  }

  return mapCatalogPublicAuthor(row);
}

function mapCatalogPublicPackageVersionSummary(row: CatalogPublicPackageRow): CatalogPublicPackageVersionSummary {
  assertPublicPackageMediaKeySafe(row.package_version_id, row.cover_package_media_key);
  assertPublicCatalogTextSafe(row.package_version_id, row.title);
  assertPublicCatalogTextSafe(row.package_version_id, row.summary);
  assertPublicCatalogTextSafe(row.package_version_id, row.description);
  assertPublicCatalogTextArraySafe(row.package_version_id, row.language_tags);
  assertPublicCatalogTextArraySafe(row.package_version_id, row.topic_tags);
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
    topicTags: [...row.topic_tags],
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
    topicTags: latestVersion.topicTags,
    license: latestVersion.license,
    contentWarning: latestVersion.contentWarning,
    coverPackageMediaKey: latestVersion.coverPackageMediaKey,
    status: "published",
    author: mapCatalogPublicAuthor(row),
    latestVersion,
  };
}

function mapCatalogPublicPackageMediaAsset(
  row: CatalogPublicPackageMediaAssetRow,
): CatalogPublicPackageMediaAsset {
  assertPublicPackageMediaKeySafe(row.package_version_id, row.package_media_key);
  assertPublicCatalogTextSafe(row.package_version_id, row.alt_text);
  assertPublicCatalogTextSafe(row.package_version_id, row.credit);
  assertPublicCatalogTextSafe(row.package_version_id, row.license);
  assertPublicCatalogTextSafe(row.package_version_id, row.mime_type);

  return {
    packageVersionId: row.package_version_id,
    packageMediaKey: row.package_media_key,
    altText: row.alt_text,
    credit: row.credit,
    license: row.license,
    mimeType: row.mime_type,
    sizeBytes: toSafeNumber(row.size_bytes, "size_bytes"),
    downloadUrlPath: buildCatalogPackageMediaDownloadUrlPath(row.package_version_id, row.package_media_key),
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

function buildSnapshotMediaAssetLookupKey(
  packageVersionId: string,
  packageMediaKey: string,
): string {
  return `${packageVersionId}:${packageMediaKey}`;
}

function buildSnapshotMediaDownloadUrl(
  publicApiBaseUrl: string,
  packageVersionId: string,
  packageMediaKey: string,
): string {
  return [
    publicApiBaseUrl,
    "catalog",
    "package-versions",
    packageVersionId,
    "media-assets",
    encodeURIComponent(packageMediaKey),
    "download",
  ].join("/");
}

function getSnapshotCardRequiredMediaAssetKeys(
  row: CatalogPublicSnapshotCardRow,
): ReadonlyArray<string> {
  return getCatalogCardRequiredPackageMediaKeys({
    frontText: row.front_text,
    backText: row.back_text,
    mediaAssetKeys: row.media_asset_keys,
  });
}

function isCatalogPublicSnapshotCollectionSafe(
  row: CatalogPublicSnapshotCollectionRow,
): boolean {
  return isPublicCatalogTextSafe(row.slug)
    && isPublicCatalogTextSafe(row.title)
    && isPublicCatalogTextSafe(row.summary)
    && isPublicCatalogTextSafe(row.description)
    && isPublicCatalogTextArraySafe(row.language_tags)
    && isPublicCatalogTextArraySafe(row.topic_tags);
}

function getEligibleSnapshotPackageVersionIds(
  packageVersionRows: ReadonlyArray<CatalogPublicSnapshotPackageVersionRow>,
  mediaAssetRows: ReadonlyArray<CatalogPublicSnapshotMediaAssetRow>,
  cardRows: ReadonlyArray<CatalogPublicSnapshotCardRow>,
): ReadonlySet<string> {
  const mediaAssetRowsByPackageVersionId = new Map<
    string,
    Array<CatalogPublicSnapshotMediaAssetRow>
  >();
  const cardRowsByPackageVersionId = new Map<string, Array<CatalogPublicSnapshotCardRow>>();

  for (const row of mediaAssetRows) {
    const versionMediaAssetRows = mediaAssetRowsByPackageVersionId.get(row.package_version_id)
      ?? [];
    versionMediaAssetRows.push(row);
    mediaAssetRowsByPackageVersionId.set(row.package_version_id, versionMediaAssetRows);
  }

  for (const row of cardRows) {
    const versionCardRows = cardRowsByPackageVersionId.get(row.package_version_id) ?? [];
    versionCardRows.push(row);
    cardRowsByPackageVersionId.set(row.package_version_id, versionCardRows);
  }

  return new Set(packageVersionRows.filter((row) => (
    getPublicCatalogVersionEligibilityIssue({
      package: { slug: row.package_slug },
      author: {
        slug: row.author_slug,
        displayName: row.author_display_name,
        bio: row.author_bio,
        websiteUrl: row.author_website_url,
      },
      version: {
        slug: row.version_slug,
        title: row.title,
        summary: row.summary,
        description: row.description,
        languageTags: row.language_tags,
        topicTags: row.topic_tags,
        license: row.license,
        contentWarning: row.content_warning,
        coverPackageMediaKey: row.cover_package_media_key,
      },
      mediaAssets: (mediaAssetRowsByPackageVersionId.get(row.package_version_id) ?? []).map(
        (mediaAsset) => ({
          packageMediaKey: mediaAsset.package_media_key,
          altText: mediaAsset.alt_text,
          credit: mediaAsset.credit,
          license: mediaAsset.license,
          mimeType: mediaAsset.mime_type,
          sizeBytes: mediaAsset.size_bytes,
        }),
      ),
      cards: (cardRowsByPackageVersionId.get(row.package_version_id) ?? []).map((card) => ({
        packageCardId: card.package_card_id,
        frontText: card.front_text,
        backText: card.back_text,
        cardType: card.card_type,
        tags: card.tags,
        mediaAssetKeys: card.media_asset_keys,
      })),
    }) === null
  )).map((row) => row.package_version_id));
}

function mapCatalogPublicSnapshotMediaAssets(
  rows: ReadonlyArray<CatalogPublicSnapshotMediaAssetRow>,
  publicApiBaseUrl: string,
): ReadonlyArray<CatalogPublicSnapshotMediaAsset> {
  const mediaAssets: Array<CatalogPublicSnapshotMediaAsset> = [];
  for (const row of rows) {
    if (isUnsafePublicPackageMediaKey(row.package_media_key)) {
      continue;
    }

    assertPublicCatalogTextSafe(row.package_version_id, row.alt_text);
    assertPublicCatalogTextSafe(row.package_version_id, row.credit);
    assertPublicCatalogTextSafe(row.package_version_id, row.license);
    assertPublicCatalogTextSafe(row.package_version_id, row.mime_type);
    mediaAssets.push({
      packageMediaAssetId: row.package_media_asset_id,
      packageVersionId: row.package_version_id,
      packageMediaKey: row.package_media_key,
      altText: row.alt_text,
      credit: row.credit,
      license: row.license,
      mimeType: row.mime_type,
      sizeBytes: toSafeNumber(row.size_bytes, "size_bytes"),
      downloadUrl: buildSnapshotMediaDownloadUrl(
        publicApiBaseUrl,
        row.package_version_id,
        row.package_media_key,
      ),
    });
  }

  return mediaAssets;
}

function indexSnapshotMediaAssets(
  mediaAssets: ReadonlyArray<CatalogPublicSnapshotMediaAsset>,
): ReadonlyMap<string, string> {
  const mediaAssetIds = new Map<string, string>();
  for (const mediaAsset of mediaAssets) {
    mediaAssetIds.set(
      buildSnapshotMediaAssetLookupKey(
        mediaAsset.packageVersionId,
        mediaAsset.packageMediaKey,
      ),
      mediaAsset.packageMediaAssetId,
    );
  }

  return mediaAssetIds;
}

function resolveSnapshotMediaAssetIds(
  packageVersionId: string,
  packageMediaKeys: ReadonlyArray<string>,
  mediaAssetIdsByKey: ReadonlyMap<string, string>,
): ReadonlyArray<string> {
  const resolvedIds: Array<string> = [];
  const seenIds = new Set<string>();
  for (const packageMediaKey of packageMediaKeys) {
    const mediaAssetId = mediaAssetIdsByKey.get(
      buildSnapshotMediaAssetLookupKey(packageVersionId, packageMediaKey),
    );
    if (mediaAssetId === undefined) {
      throw new Error(
        `Eligible catalog package card references missing media. packageVersionId=${packageVersionId} packageMediaKey=${packageMediaKey}`,
      );
    }
    if (seenIds.has(mediaAssetId)) {
      continue;
    }

    resolvedIds.push(mediaAssetId);
    seenIds.add(mediaAssetId);
  }

  return resolvedIds;
}

function mapCatalogPublicSnapshotAuthors(
  rows: ReadonlyArray<CatalogPublicSnapshotPackageVersionRow>,
): ReadonlyArray<CatalogPublicSnapshotAuthor> {
  const authorsById = new Map<string, CatalogPublicSnapshotAuthor>();
  for (const row of rows) {
    if (authorsById.has(row.author_id)) {
      continue;
    }

    authorsById.set(row.author_id, mapCatalogPublicSnapshotAuthor(row));
  }

  return [...authorsById.values()].sort((left, right) => (
    left.slug.localeCompare(right.slug) || left.authorId.localeCompare(right.authorId)
  ));
}

type CatalogPublicSnapshotPackageAccumulator = Readonly<{
  packageId: string;
  authorId: string;
  slug: string;
  publishedAt: string;
  latestPackageVersionId: string;
  latestVersionNumber: number;
  versionCount: number;
}>;

function mapCatalogPublicSnapshotPackages(
  rows: ReadonlyArray<CatalogPublicSnapshotPackageVersionRow>,
): ReadonlyArray<CatalogPublicSnapshotPackage> {
  const packagesById = new Map<string, CatalogPublicSnapshotPackageAccumulator>();
  for (const row of rows) {
    assertPublicCatalogTextSafe(row.package_version_id, row.package_slug);
    const versionNumber = toSafeNumber(row.version_number, "version_number");
    const existingPackage = packagesById.get(row.package_id);
    if (existingPackage === undefined) {
      packagesById.set(row.package_id, {
        packageId: row.package_id,
        authorId: row.author_id,
        slug: row.package_slug,
        publishedAt: toIsoString(row.package_published_at),
        latestPackageVersionId: row.package_version_id,
        latestVersionNumber: versionNumber,
        versionCount: 1,
      });
      continue;
    }

    packagesById.set(row.package_id, {
      ...existingPackage,
      latestPackageVersionId: versionNumber > existingPackage.latestVersionNumber
        ? row.package_version_id
        : existingPackage.latestPackageVersionId,
      latestVersionNumber: Math.max(existingPackage.latestVersionNumber, versionNumber),
      versionCount: existingPackage.versionCount + 1,
    });
  }

  return [...packagesById.values()].map((catalogPackage) => ({
    packageId: catalogPackage.packageId,
    authorId: catalogPackage.authorId,
    slug: catalogPackage.slug,
    status: "published",
    latestPackageVersionId: catalogPackage.latestPackageVersionId,
    versionCount: catalogPackage.versionCount,
    publishedAt: catalogPackage.publishedAt,
  }));
}

function mapCatalogPublicSnapshotPackageVersions(
  rows: ReadonlyArray<CatalogPublicSnapshotPackageVersionRow>,
  mediaAssetIdsByKey: ReadonlyMap<string, string>,
  publicAppBaseUrl: string,
): ReadonlyArray<CatalogPublicSnapshotPackageVersion> {
  return rows.map((row) => {
    assertPublicCatalogTextSafe(row.package_version_id, row.version_slug);
    assertPublicCatalogTextSafe(row.package_version_id, row.title);
    assertPublicCatalogTextSafe(row.package_version_id, row.summary);
    assertPublicCatalogTextSafe(row.package_version_id, row.description);
    assertPublicCatalogTextArraySafe(row.package_version_id, row.language_tags);
    assertPublicCatalogTextArraySafe(row.package_version_id, row.topic_tags);
    assertPublicCatalogTextSafe(row.package_version_id, row.license);
    assertPublicCatalogTextSafe(row.package_version_id, row.content_warning);
    const coverMediaAssetId = row.cover_package_media_key === null
      ? null
      : mediaAssetIdsByKey.get(buildSnapshotMediaAssetLookupKey(
        row.package_version_id,
        row.cover_package_media_key,
      ));
    if (coverMediaAssetId === undefined) {
      throw new Error(
        `Eligible catalog package version references missing cover media. packageVersionId=${row.package_version_id}`,
      );
    }

    return {
      packageVersionId: row.package_version_id,
      packageId: row.package_id,
      versionNumber: toSafeNumber(row.version_number, "version_number"),
      status: "published",
      slug: row.version_slug,
      title: row.title,
      summary: row.summary,
      description: row.description,
      languageTags: [...row.language_tags],
      topicTags: [...row.topic_tags],
      license: row.license,
      contentWarning: row.content_warning,
      coverMediaAssetId,
      cardCount: toSafeNumber(row.card_count, "card_count"),
      updatedAt: toIsoString(row.updated_at),
      publishedAt: toIsoString(row.published_at),
      installUrl: `${publicAppBaseUrl}/catalog/import/${row.package_version_id}`,
    };
  });
}

function mapCatalogPublicSnapshotCards(
  rows: ReadonlyArray<CatalogPublicSnapshotCardRow>,
  mediaAssetIdsByKey: ReadonlyMap<string, string>,
): ReadonlyArray<CatalogPublicSnapshotCard> {
  return rows.map((row) => {
    assertPublicCardMarkdownSafe(row.package_version_id, row.front_text);
    assertPublicCardMarkdownSafe(row.package_version_id, row.back_text);
    assertPublicCatalogTextSafe(row.package_version_id, row.card_type);
    assertPublicCatalogTextArraySafe(row.package_version_id, row.tags);
    return {
      packageCardId: row.package_card_id,
      packageVersionId: row.package_version_id,
      ordinal: toSafeNumber(row.ordinal, "ordinal"),
      frontText: row.front_text,
      backText: row.back_text,
      cardType: row.card_type,
      tags: [...row.tags],
      mediaAssetIds: resolveSnapshotMediaAssetIds(
        row.package_version_id,
        getSnapshotCardRequiredMediaAssetKeys(row),
        mediaAssetIdsByKey,
      ),
    };
  });
}

function assertPublicSnapshotCollectionTextSafe(
  collectionId: string,
  value: string | null,
): void {
  if (isPublicCatalogTextSafe(value)) {
    return;
  }

  throw new HttpError(
    409,
    `Published catalog collection contains a non-public media reference. collectionId=${collectionId}`,
    "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC",
  );
}

function mapCatalogPublicSnapshotCollections(
  rows: ReadonlyArray<CatalogPublicSnapshotCollectionRow>,
  publicPackageIds: ReadonlySet<string>,
): ReadonlyArray<CatalogPublicSnapshotCollection> {
  return rows.map((row) => {
    assertPublicSnapshotCollectionTextSafe(row.collection_id, row.slug);
    assertPublicSnapshotCollectionTextSafe(row.collection_id, row.title);
    assertPublicSnapshotCollectionTextSafe(row.collection_id, row.summary);
    assertPublicSnapshotCollectionTextSafe(row.collection_id, row.description);
    for (const languageTag of row.language_tags) {
      assertPublicSnapshotCollectionTextSafe(row.collection_id, languageTag);
    }
    for (const topicTag of row.topic_tags) {
      assertPublicSnapshotCollectionTextSafe(row.collection_id, topicTag);
    }

    return {
      collectionId: row.collection_id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      description: row.description,
      languageTags: [...row.language_tags],
      topicTags: [...row.topic_tags],
      coverPackageId: row.cover_package_id !== null && publicPackageIds.has(row.cover_package_id)
        ? row.cover_package_id
        : null,
      status: "published",
      updatedAt: toIsoString(row.updated_at),
      publishedAt: toIsoString(row.published_at),
    };
  });
}

function mapCatalogPublicSnapshotCollectionPackages(
  rows: ReadonlyArray<CatalogPublicSnapshotCollectionPackageRow>,
  publicCollectionIds: ReadonlySet<string>,
  publicPackageIds: ReadonlySet<string>,
): ReadonlyArray<CatalogPublicSnapshotCollectionPackage> {
  return rows.flatMap((row) => (
    publicCollectionIds.has(row.collection_id) && publicPackageIds.has(row.package_id)
      ? [{
        collectionId: row.collection_id,
        packageId: row.package_id,
        ordinal: toSafeNumber(row.ordinal, "ordinal"),
      }]
      : []
  ));
}

export function normalizeCatalogPublicPackageListInput(
  input: CatalogPublicPackageListInput,
): CatalogPublicPackageListInput {
  return {
    limit: normalizePositiveBoundedLimit(input.limit, "limit", 100),
    search: normalizeOptionalSearch(input.search),
    languageTag: normalizeOptionalTag(input.languageTag, "languageTag"),
    topicTag: normalizeOptionalTag(input.topicTag, "topicTag"),
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

export async function loadPublicCatalogSnapshotInExecutor(
  executor: DatabaseExecutor,
  input: CatalogPublicSnapshotLoadInput,
): Promise<CatalogPublicSnapshot> {
  const packageVersionsQuery = buildPublicCatalogSnapshotPackageVersionsQuery();
  const packageVersionsResult = await executor.query<CatalogPublicSnapshotPackageVersionRow>(
    packageVersionsQuery.text,
    packageVersionsQuery.params,
  );
  const mediaAssetsQuery = buildPublicCatalogSnapshotMediaAssetsQuery();
  const mediaAssetsResult = await executor.query<CatalogPublicSnapshotMediaAssetRow>(
    mediaAssetsQuery.text,
    mediaAssetsQuery.params,
  );
  const cardsQuery = buildPublicCatalogSnapshotCardsQuery();
  const cardsResult = await executor.query<CatalogPublicSnapshotCardRow>(
    cardsQuery.text,
    cardsQuery.params,
  );
  const collectionsQuery = buildPublicCatalogSnapshotCollectionsQuery();
  const collectionsResult = await executor.query<CatalogPublicSnapshotCollectionRow>(
    collectionsQuery.text,
    collectionsQuery.params,
  );
  const collectionPackagesQuery = buildPublicCatalogSnapshotCollectionPackagesQuery();
  const collectionPackagesResult = await executor.query<CatalogPublicSnapshotCollectionPackageRow>(
    collectionPackagesQuery.text,
    collectionPackagesQuery.params,
  );

  const eligiblePackageVersionIds = getEligibleSnapshotPackageVersionIds(
    packageVersionsResult.rows,
    mediaAssetsResult.rows,
    cardsResult.rows,
  );
  const packageVersionRows = packageVersionsResult.rows.filter((row) => (
    eligiblePackageVersionIds.has(row.package_version_id)
  ));
  const mediaAssetRows = mediaAssetsResult.rows.filter((row) => (
    eligiblePackageVersionIds.has(row.package_version_id)
  ));
  const cardRows = cardsResult.rows.filter((row) => (
    eligiblePackageVersionIds.has(row.package_version_id)
  ));
  const collectionRows = collectionsResult.rows.filter((row) => (
    isCatalogPublicSnapshotCollectionSafe(row)
  ));

  const mediaAssets = mapCatalogPublicSnapshotMediaAssets(
    mediaAssetRows,
    input.publicApiBaseUrl,
  );
  const mediaAssetIdsByKey = indexSnapshotMediaAssets(mediaAssets);
  const packages = mapCatalogPublicSnapshotPackages(packageVersionRows);
  const publicPackageIds = new Set(packages.map((catalogPackage) => catalogPackage.packageId));
  const collections = mapCatalogPublicSnapshotCollections(
    collectionRows,
    publicPackageIds,
  );
  const publicCollectionIds = new Set(collections.map((collection) => collection.collectionId));

  return {
    schemaVersion: catalogPublicSnapshotSchemaVersion,
    generatedAt: toIsoString(input.generatedAt),
    authors: mapCatalogPublicSnapshotAuthors(packageVersionRows),
    packages,
    packageVersions: mapCatalogPublicSnapshotPackageVersions(
      packageVersionRows,
      mediaAssetIdsByKey,
      input.publicAppBaseUrl,
    ),
    cards: mapCatalogPublicSnapshotCards(cardRows, mediaAssetIdsByKey),
    mediaAssets,
    collections,
    collectionPackages: mapCatalogPublicSnapshotCollectionPackages(
      collectionPackagesResult.rows,
      publicCollectionIds,
      publicPackageIds,
    ),
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

export async function loadPublicCatalogPackageMediaAssetsInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
): Promise<ReadonlyArray<CatalogPublicPackageMediaAsset>> {
  const result = await executor.query<CatalogPublicPackageMediaAssetRow>(
    [
      "SELECT",
      "media_assets.package_version_id AS package_version_id,",
      "media_assets.package_media_key AS package_media_key,",
      "media_assets.alt_text AS alt_text,",
      "media_assets.credit AS credit,",
      "media_assets.license AS license,",
      "media_blobs.mime_type AS mime_type,",
      "media_blobs.size_bytes AS size_bytes",
      "FROM catalog.package_media_assets AS media_assets",
      "INNER JOIN catalog.package_versions AS versions",
      "ON versions.package_version_id = media_assets.package_version_id",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = versions.package_id",
      "INNER JOIN content.media_blobs AS media_blobs",
      "ON media_blobs.media_blob_id = media_assets.media_blob_id",
      "WHERE media_assets.package_version_id = $1",
      "AND versions.status = 'published'",
      "AND versions.delisted_at IS NULL",
      "AND packages.status = 'published'",
      "AND packages.delisted_at IS NULL",
      "ORDER BY media_assets.package_media_key ASC",
    ].join(" "),
    [packageVersionId],
  );

  return result.rows.map((row: CatalogPublicPackageMediaAssetRow) => (
    mapCatalogPublicPackageMediaAsset(row)
  ));
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

export async function loadPublicCatalogPackageMediaForDownloadInExecutor(
  executor: DatabaseExecutor,
  packageVersionId: string,
  packageMediaKey: string,
): Promise<CatalogPublicPackageMediaDownloadSource> {
  const normalizedPackageMediaKey = normalizePackageMediaKey(packageMediaKey, "packageMediaKey");
  assertPublicPackageMediaKeySafe(packageVersionId, normalizedPackageMediaKey);
  const result = await executor.query<CatalogPublicPackageMediaDownloadRow>(
    [
      "SELECT",
      "media_assets.package_version_id AS package_version_id,",
      "media_assets.package_media_key AS package_media_key,",
      "media_assets.alt_text AS alt_text,",
      "media_assets.credit AS credit,",
      "media_assets.license AS license,",
      "media_blobs.mime_type AS mime_type,",
      "media_blobs.size_bytes AS size_bytes,",
      "media_blobs.storage_key AS storage_key,",
      "media_blobs.sha256 AS sha256",
      "FROM catalog.package_media_assets AS media_assets",
      "INNER JOIN catalog.package_versions AS versions",
      "ON versions.package_version_id = media_assets.package_version_id",
      "INNER JOIN catalog.packages AS packages",
      "ON packages.package_id = versions.package_id",
      "INNER JOIN content.media_blobs AS media_blobs",
      "ON media_blobs.media_blob_id = media_assets.media_blob_id",
      "WHERE media_assets.package_version_id = $1",
      "AND media_assets.package_media_key = $2",
      "AND versions.status = 'published'",
      "AND versions.delisted_at IS NULL",
      "AND packages.status = 'published'",
      "AND packages.delisted_at IS NULL",
      "LIMIT 1",
    ].join(" "),
    [packageVersionId, normalizedPackageMediaKey],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(
      404,
      `Published catalog package media asset not found. packageVersionId=${packageVersionId} packageMediaKey=${normalizedPackageMediaKey}`,
      "CATALOG_PUBLIC_PACKAGE_MEDIA_NOT_FOUND",
    );
  }

  return {
    mediaAsset: mapCatalogPublicPackageMediaAsset(row),
    storageKey: row.storage_key,
    sha256: row.sha256,
  };
}

export async function listPublicCatalogPackages(
  input: CatalogPublicPackageListInput,
): Promise<ReadonlyArray<CatalogPublicPackageSummary>> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => (
    listPublicCatalogPackagesInExecutor(executor, input)
  ));
}

export async function loadPublicCatalogSnapshot(
  publicApiBaseUrl: string,
  publicAppBaseUrl: string,
): Promise<CatalogPublicSnapshot> {
  const generatedAt = new Date().toISOString();
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => (
    loadPublicCatalogSnapshotInExecutor(executor, {
      publicApiBaseUrl,
      publicAppBaseUrl,
      generatedAt,
    })
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

export async function loadPublicCatalogPackageMediaForDownload(
  packageVersionId: string,
  packageMediaKey: string,
): Promise<CatalogPublicPackageMediaDownloadSource> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => (
    loadPublicCatalogPackageMediaForDownloadInExecutor(executor, packageVersionId, packageMediaKey)
  ));
}
