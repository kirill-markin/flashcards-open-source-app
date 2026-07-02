import type { CardMetadata } from "../cards/types";

export const catalogPackageStatuses = [
  "draft",
  "submitted",
  "needs_changes",
  "approved",
  "rejected",
  "published",
  "delisted",
] as const;

export type CatalogPackageStatus = (typeof catalogPackageStatuses)[number];

export type TimestampValue = Date | string;

export type CatalogAuthorRow = Readonly<{
  author_id: string;
  slug: string;
  display_name: string;
  bio: string | null;
  website_url: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}>;

export type CatalogAuthor = Readonly<{
  authorId: string;
  slug: string;
  displayName: string;
  bio: string | null;
  websiteUrl: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type UpsertCatalogAuthorInput = Readonly<{
  authorId: string;
  slug: string;
  displayName: string;
  bio: string | null;
  websiteUrl: string | null;
}>;

export type CatalogPackageRow = Readonly<{
  package_id: string;
  author_id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  language_tags: ReadonlyArray<string>;
  topic_tags: ReadonlyArray<string>;
  license: string;
  content_warning: string | null;
  cover_package_media_key: string | null;
  status: CatalogPackageStatus;
  created_at: TimestampValue;
  updated_at: TimestampValue;
  published_at: TimestampValue | null;
  delisted_at: TimestampValue | null;
}>;

export type CatalogPackage = Readonly<{
  packageId: string;
  authorId: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  languageTags: ReadonlyArray<string>;
  topicTags: ReadonlyArray<string>;
  license: string;
  contentWarning: string | null;
  coverPackageMediaKey: string | null;
  status: CatalogPackageStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  delistedAt: string | null;
}>;

export type CreateCatalogPackageDraftInput = Readonly<{
  packageId: string;
  authorId: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  languageTags: ReadonlyArray<string>;
  topicTags: ReadonlyArray<string>;
  license: string;
  contentWarning: string | null;
}>;

export type UpdateCatalogPackageDraftInput = Readonly<{
  packageId: string;
  authorId: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  languageTags: ReadonlyArray<string>;
  topicTags: ReadonlyArray<string>;
  license: string;
  contentWarning: string | null;
  coverPackageMediaKey: string | null;
}>;

export type CatalogPackageMediaAssetRow = Readonly<{
  package_media_asset_id: string;
  package_id: string;
  package_version_id: string | null;
  package_media_key: string;
  media_blob_id: string;
  alt_text: string | null;
  credit: string | null;
  license: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}>;

export type CatalogPackageMediaAsset = Readonly<{
  packageMediaAssetId: string;
  packageId: string;
  packageVersionId: string | null;
  packageMediaKey: string;
  mediaBlobId: string;
  altText: string | null;
  credit: string | null;
  license: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type AttachCatalogPackageMediaAssetInput = Readonly<{
  packageMediaAssetId: string;
  packageMediaKey: string;
  mediaBlobId: string;
  altText: string | null;
  credit: string | null;
  license: string | null;
}>;

export type CatalogPackageVersionMediaAssetInput = Readonly<{
  packageMediaKey: string;
  mediaBlobId: string;
}>;

export type CatalogPackageVersionRow = Readonly<{
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
  source_workspace_id: string | null;
  card_count: string | number;
  created_by_admin_email: string;
  reviewed_by_admin_email: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
  submitted_at: TimestampValue | null;
  reviewed_at: TimestampValue | null;
  published_at: TimestampValue | null;
  delisted_at: TimestampValue | null;
}>;

export type CatalogPackageVersion = Readonly<{
  packageVersionId: string;
  packageId: string;
  versionNumber: number;
  status: CatalogPackageStatus;
  slug: string;
  title: string;
  summary: string;
  description: string;
  languageTags: ReadonlyArray<string>;
  topicTags: ReadonlyArray<string>;
  license: string;
  contentWarning: string | null;
  coverPackageMediaKey: string | null;
  sourceWorkspaceId: string | null;
  cardCount: number;
  createdByAdminEmail: string;
  reviewedByAdminEmail: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  delistedAt: string | null;
}>;

export type CatalogPublicAuthor = Readonly<{
  authorId: string;
  slug: string;
  displayName: string;
  bio: string | null;
  websiteUrl: string | null;
}>;

export type CatalogPublicPackageVersionSummary = Readonly<{
  packageVersionId: string;
  packageId: string;
  versionNumber: number;
  status: "published";
  slug: string;
  title: string;
  summary: string;
  description: string;
  languageTags: ReadonlyArray<string>;
  topicTags: ReadonlyArray<string>;
  license: string;
  contentWarning: string | null;
  coverPackageMediaKey: string | null;
  cardCount: number;
  updatedAt: string;
  publishedAt: string;
}>;

export type CatalogPublicPackageSummary = Readonly<{
  packageId: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  languageTags: ReadonlyArray<string>;
  topicTags: ReadonlyArray<string>;
  license: string;
  contentWarning: string | null;
  coverPackageMediaKey: string | null;
  status: "published";
  author: CatalogPublicAuthor;
  latestVersion: CatalogPublicPackageVersionSummary;
}>;

export type CatalogPublicPackageMediaAsset = Readonly<{
  packageVersionId: string;
  packageMediaKey: string;
  altText: string | null;
  credit: string | null;
  license: string | null;
  mimeType: string;
  sizeBytes: number;
  downloadUrlPath: string;
}>;

export type CatalogPublicPackageDetail = CatalogPublicPackageSummary & Readonly<{
  mediaAssets: ReadonlyArray<CatalogPublicPackageMediaAsset>;
}>;

export type CatalogPublicPackageCardPreview = Readonly<{
  ordinal: number;
  frontText: string;
  backText: string;
  cardType: string;
  tags: ReadonlyArray<string>;
  mediaAssetKeys: ReadonlyArray<string>;
}>;

export type CatalogPublicPackageListInput = Readonly<{
  limit: number;
  search: string | null;
  languageTag: string | null;
  topicTag: string | null;
}>;

export type CatalogPublicPackageCardPreviewInput = Readonly<{
  packageVersionId: string;
  limit: number;
}>;

export type CatalogPublicPackageMediaDownloadSource = Readonly<{
  mediaAsset: CatalogPublicPackageMediaAsset;
  storageKey: string;
}>;

export type CatalogPackageDraft = Readonly<{
  catalogPackage: CatalogPackage;
  mediaAssets: ReadonlyArray<CatalogPackageMediaAsset>;
}>;

export type CatalogPackageCardSnapshotInput = Readonly<{
  packageCardId: string;
  stableCardKey: string;
  ordinal: number;
  frontText: string;
  backText: string;
  cardType: string;
  metadata: CardMetadata;
  tags: ReadonlyArray<string>;
  mediaAssetKeys: ReadonlyArray<string>;
}>;

export type CreateCatalogPackageVersionInput = Readonly<{
  packageVersionId: string;
  cards: ReadonlyArray<CatalogPackageCardSnapshotInput>;
}>;

export type CreateCatalogPackageVersionFromWorkspaceInput = Readonly<{
  packageVersionId: string;
  workspaceId: string;
  cardIds: ReadonlyArray<string>;
}>;

export type UpdateCatalogPackageVersionStatusInput = Readonly<{
  status: CatalogPackageStatus;
  note: string | null;
}>;

export type CatalogWorkspaceCardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  card_type: string;
  metadata: CardMetadata;
  tags: ReadonlyArray<string>;
}>;
