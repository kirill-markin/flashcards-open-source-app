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
  license: string;
  contentWarning: string | null;
  coverPackageMediaKey: string | null;
}>;

// TODO: Add future collection metadata/status and ordered-membership authoring.
export type CatalogCollectionCoverRow = Readonly<{
  collection_id: string;
  cover_media_blob_id: string | null;
  updated_at: TimestampValue;
}>;

export type CatalogCollectionCover = Readonly<{
  collectionId: string;
  coverMediaBlobId: string | null;
  updatedAt: string;
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
}>;

export type CatalogPublicPackageCardPreviewInput = Readonly<{
  packageVersionId: string;
  limit: number;
}>;

export type CatalogPublicPackageMediaDownloadSource = Readonly<{
  mediaAsset: CatalogPublicPackageMediaAsset;
  storageKey: string;
  sha256: string;
}>;

export type CatalogPublicCollectionCover = Readonly<{
  collectionId: string;
  mimeType: string;
  sizeBytes: number;
}>;

export type CatalogPublicCollectionCoverDownloadSource = Readonly<{
  collectionCover: CatalogPublicCollectionCover;
  storageKey: string;
  sha256: string;
}>;

export const catalogPublicSnapshotSchemaVersion = 2 as const;

export type CatalogPublicSnapshotAuthor = Readonly<{
  authorId: string;
  slug: string;
  displayName: string;
  bio: string | null;
  websiteUrl: string | null;
}>;

export type CatalogPublicSnapshotPackage = Readonly<{
  packageId: string;
  authorId: string;
  slug: string;
  status: "published";
  latestPackageVersionId: string;
  versionCount: number;
  publishedAt: string;
}>;

export type CatalogPublicSnapshotPackageVersion = Readonly<{
  packageVersionId: string;
  packageId: string;
  versionNumber: number;
  status: "published";
  slug: string;
  title: string;
  summary: string;
  description: string;
  languageTags: ReadonlyArray<string>;
  license: string;
  contentWarning: string | null;
  coverMediaAssetId: string | null;
  cardCount: number;
  updatedAt: string;
  publishedAt: string;
  installUrl: string;
}>;

export type CatalogPublicSnapshotCard = Readonly<{
  packageCardId: string;
  packageVersionId: string;
  ordinal: number;
  frontText: string;
  backText: string;
  cardType: string;
  tags: ReadonlyArray<string>;
  mediaAssetIds: ReadonlyArray<string>;
}>;

export type CatalogPublicSnapshotMediaAsset = Readonly<{
  packageMediaAssetId: string;
  packageVersionId: string;
  packageMediaKey: string;
  altText: string | null;
  credit: string | null;
  license: string | null;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
}>;

export type CatalogPublicSnapshotCollection = Readonly<{
  collectionId: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  languageTags: ReadonlyArray<string>;
  coverPackageId: string | null;
  coverDownloadUrl?: string;
  status: "published";
  updatedAt: string;
  publishedAt: string;
}>;

export type CatalogPublicSnapshotCollectionPackage = Readonly<{
  collectionId: string;
  packageId: string;
  ordinal: number;
}>;

export type CatalogPublicSnapshot = Readonly<{
  schemaVersion: typeof catalogPublicSnapshotSchemaVersion;
  generatedAt: string;
  authors: ReadonlyArray<CatalogPublicSnapshotAuthor>;
  packages: ReadonlyArray<CatalogPublicSnapshotPackage>;
  packageVersions: ReadonlyArray<CatalogPublicSnapshotPackageVersion>;
  cards: ReadonlyArray<CatalogPublicSnapshotCard>;
  mediaAssets: ReadonlyArray<CatalogPublicSnapshotMediaAsset>;
  collections: ReadonlyArray<CatalogPublicSnapshotCollection>;
  collectionPackages: ReadonlyArray<CatalogPublicSnapshotCollectionPackage>;
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

export type CatalogPackageVersionAuditCard = Readonly<{
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

export type CatalogPackageVersionAudit = Readonly<{
  packageVersionId: string;
  versionNumber: number;
  status: CatalogPackageStatus;
  cards: ReadonlyArray<CatalogPackageVersionAuditCard>;
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

export type CatalogPackageInstallAuthor = Readonly<{
  authorId: string;
  slug: string;
  displayName: string;
}>;

export type CatalogPackageInstallPackageVersion = Readonly<{
  packageVersionId: string;
  packageId: string;
  versionNumber: number;
  slug: string;
  title: string;
  summary: string;
  description: string;
  languageTags: ReadonlyArray<string>;
  license: string;
  contentWarning: string | null;
  coverPackageMediaKey: string | null;
  cardCount: number;
  createdAt: string;
  publishedAt: string | null;
  author: CatalogPackageInstallAuthor;
}>;

export type CatalogPackageInstallPreviewSummary = Readonly<{
  cardCount: number;
  mediaAssetCount: number;
}>;

export type CatalogPackageInstallTagCount = Readonly<{
  tag: string;
  cardsCount: number;
}>;

export type CatalogPackageInstallDefaultOptions = Readonly<{
  addImportTag: boolean;
  suggestedImportTag: string;
  keptTags: ReadonlyArray<string>;
  removedTags: ReadonlyArray<string>;
}>;

export type CatalogPackageInstallPreviewInput = Readonly<{
  generatedAt: string;
  existingWorkspaceTags: ReadonlyArray<string>;
}>;

export type CatalogPackageInstallPreview = Readonly<{
  packageVersion: CatalogPackageInstallPackageVersion;
  summary: CatalogPackageInstallPreviewSummary;
  tagCounts: ReadonlyArray<CatalogPackageInstallTagCount>;
  defaultOptions: CatalogPackageInstallDefaultOptions;
}>;

export type CatalogPackageInstallConfirmInput = Readonly<{
  installId: string;
  installedAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  operationIdPrefix: string;
  addImportTag?: boolean;
  importTag?: string;
  removeTags?: ReadonlyArray<string>;
}>;

export type CatalogInstalledCard = Readonly<{
  packageCardId: string;
  stableCardKey: string;
  ordinal: number;
  cardId: string;
}>;

export type CatalogInstalledMediaAsset = Readonly<{
  packageMediaAssetId: string;
  packageMediaKey: string;
  mediaAssetId: string;
}>;

export type CatalogPackageInstallResultSummary = Readonly<{
  cardCount: number;
  mediaAssetCount: number;
  installId: string;
  installedAt: string;
  keptTagCount: number;
  removedTagCount: number;
  importTag: string | null;
}>;

export type CatalogPackageInstallResult = Readonly<{
  packageVersion: CatalogPackageInstallPackageVersion;
  installedCards: ReadonlyArray<CatalogInstalledCard>;
  installedMediaAssets: ReadonlyArray<CatalogInstalledMediaAsset>;
  summary: CatalogPackageInstallResultSummary;
}>;
