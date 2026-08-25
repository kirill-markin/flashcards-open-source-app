export type CatalogPublicPackageVersionAuthor = Readonly<{
  authorId: string;
  slug: string;
  displayName: string;
}>;

export type CatalogPublicPackageVersion = Readonly<{
  packageVersionId: string;
  packageId: string;
  versionNumber: number;
  slug: string;
  title: string;
  summary: string;
  languageTags: ReadonlyArray<string>;
  cardCount: number;
  publishedAt: string;
  author: CatalogPublicPackageVersionAuthor;
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
