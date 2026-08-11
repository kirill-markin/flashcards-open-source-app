import type { DatabaseExecutor } from "../database";
import { HttpError } from "../shared/errors";
import {
  toIsoString,
  toOptionalIsoString,
  toSafeNumber,
} from "./common";
import type {
  CatalogAuthor,
  CatalogAuthorRow,
  CatalogCollectionCover,
  CatalogCollectionCoverRow,
  CatalogPackage,
  CatalogPackageMediaAsset,
  CatalogPackageMediaAssetRow,
  CatalogPackageRow,
  CatalogPackageVersion,
  CatalogPackageVersionRow,
} from "./types";

export const catalogAuthorColumns = [
  "author_id",
  "slug",
  "display_name",
  "bio",
  "website_url",
  "created_at",
  "updated_at",
].join(", ");

export const catalogPackageColumns = [
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

export const catalogPackageMediaAssetColumns = [
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

export const catalogCollectionCoverColumns = [
  "collection_id",
  "cover_media_blob_id",
  "updated_at",
].join(", ");

export const catalogPackageVersionColumns = [
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

export function mapCatalogAuthorRow(row: CatalogAuthorRow): CatalogAuthor {
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

export function mapCatalogPackageRow(row: CatalogPackageRow): CatalogPackage {
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

export function mapCatalogPackageMediaAssetRow(row: CatalogPackageMediaAssetRow): CatalogPackageMediaAsset {
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

export function mapCatalogCollectionCoverRow(
  row: CatalogCollectionCoverRow,
): CatalogCollectionCover {
  return {
    collectionId: row.collection_id,
    coverMediaBlobId: row.cover_media_blob_id,
    updatedAt: toIsoString(row.updated_at),
  };
}

export function mapCatalogPackageVersionRow(row: CatalogPackageVersionRow): CatalogPackageVersion {
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

export async function lockCatalogPackageInExecutor(
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

export async function lockCatalogCollectionCoverInExecutor(
  executor: DatabaseExecutor,
  collectionId: string,
): Promise<CatalogCollectionCoverRow> {
  const result = await executor.query<CatalogCollectionCoverRow>(
    [
      "SELECT",
      catalogCollectionCoverColumns,
      "FROM catalog.collections",
      "WHERE collection_id = $1",
      "FOR UPDATE",
    ].join(" "),
    [collectionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(
      404,
      `Catalog collection not found. collectionId=${collectionId}`,
      "CATALOG_COLLECTION_NOT_FOUND",
    );
  }

  return row;
}
