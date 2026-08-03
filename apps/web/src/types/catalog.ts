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
  topicTags: ReadonlyArray<string>;
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
  topicTags: ReadonlyArray<string>;
  coverPackageId: string | null;
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
  schemaVersion: 1;
  generatedAt: string;
  authors: ReadonlyArray<CatalogPublicSnapshotAuthor>;
  packages: ReadonlyArray<CatalogPublicSnapshotPackage>;
  packageVersions: ReadonlyArray<CatalogPublicSnapshotPackageVersion>;
  cards: ReadonlyArray<CatalogPublicSnapshotCard>;
  mediaAssets: ReadonlyArray<CatalogPublicSnapshotMediaAsset>;
  collections: ReadonlyArray<CatalogPublicSnapshotCollection>;
  collectionPackages: ReadonlyArray<CatalogPublicSnapshotCollectionPackage>;
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
  topicTags: ReadonlyArray<string>;
  license: string;
  contentWarning: string | null;
  coverPackageMediaKey: string | null;
  cardCount: number;
  createdAt: string;
  publishedAt: string | null;
  author: CatalogPackageInstallAuthor;
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

export type CatalogPackageInstallPreviewResponse = Readonly<{
  packageVersion: CatalogPackageInstallPackageVersion;
  summary: Readonly<{
    cardCount: number;
    mediaAssetCount: number;
  }>;
  tagCounts: ReadonlyArray<CatalogPackageInstallTagCount>;
  defaultOptions: CatalogPackageInstallDefaultOptions;
}>;

export type CatalogPackageInstallConfirmOptions = Readonly<{
  addImportTag: boolean;
  importTag: string;
  removeTags: ReadonlyArray<string>;
  installId: string;
  installedAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  operationIdPrefix: string;
}>;

export type CatalogPackageInstallConfirmResponse = Readonly<{
  packageVersion: CatalogPackageInstallPackageVersion;
  installedCards: ReadonlyArray<Readonly<{
    packageCardId: string;
    stableCardKey: string;
    ordinal: number;
    cardId: string;
  }>>;
  installedMediaAssets: ReadonlyArray<Readonly<{
    packageMediaAssetId: string;
    packageMediaKey: string;
    mediaAssetId: string;
  }>>;
  summary: Readonly<{
    cardCount: number;
    mediaAssetCount: number;
    installId: string;
    installedAt: string;
    keptTagCount: number;
    removedTagCount: number;
    importTag: string | null;
  }>;
}>;
