export type WorkspacePackageExportAllActiveCardsSelection = Readonly<{
  kind: "allActiveCards";
}>;

export type WorkspacePackageExportTagFiltersSelection = Readonly<{
  kind: "tagFilters";
  includeTags: ReadonlyArray<string>;
  excludeTags: ReadonlyArray<string>;
}>;

export type WorkspacePackageExportExplicitCardIdsSelection = Readonly<{
  kind: "explicitCardIds";
  cardIds: ReadonlyArray<string>;
}>;

export type WorkspacePackageExportSelection =
  | WorkspacePackageExportAllActiveCardsSelection
  | WorkspacePackageExportTagFiltersSelection
  | WorkspacePackageExportExplicitCardIdsSelection;

export type WorkspacePackageExportTagPolicyInput = Readonly<{
  additionalRemovedTags: ReadonlyArray<string>;
}>;

export type WorkspacePackageExportMetadataInput = Readonly<{
  label: string | null;
  author: string | null;
  comment: string | null;
  createdAt: string | null;
  sourceUrl: string | null;
}>;

export type WorkspacePackageExportRequest = Readonly<{
  selection: WorkspacePackageExportSelection;
  tagPolicy: WorkspacePackageExportTagPolicyInput;
  packageMetadata: WorkspacePackageExportMetadataInput;
}>;

export type WorkspacePackageExportTagCount = Readonly<{
  tag: string;
  cardsCount: number;
}>;

export type WorkspacePackageExportDefaultPackageMetadata = Readonly<{
  label: string;
  author?: string;
  comment?: string;
  createdAt: string;
  sourceUrl?: string;
}>;

export type WorkspacePackageExportPreviewResponse = Readonly<{
  selectedCardCount: number;
  availableTagCounts: ReadonlyArray<WorkspacePackageExportTagCount>;
  tagsSelectedForRemoval: ReadonlyArray<WorkspacePackageExportTagCount>;
  referencedMediaCount: number;
  approximateReferencedMediaBytes: number;
  defaultPackageMetadata: WorkspacePackageExportDefaultPackageMetadata;
}>;

export type WorkspacePackageExportDownloadMetadata = Readonly<{
  filename: string;
  contentType: string;
}>;

export type WorkspacePackageExportDownloadResult = WorkspacePackageExportDownloadMetadata & Readonly<{
  blob: Blob;
}>;
