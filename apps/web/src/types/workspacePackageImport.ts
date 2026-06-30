import type { MediaAsset } from "./mediaAssets";
import type { Card } from "./study";

export type WorkspacePackageImportPreviewMetadata = Readonly<{
  label: string | null;
  author: string | null;
  comment: string | null;
  createdAt: string | null;
  sourceUrl: string | null;
}>;

export type WorkspacePackageImportPreviewTagCount = Readonly<{
  tag: string;
  cardsCount: number;
}>;

export type WorkspacePackageImportPreviewWarning = Readonly<{
  code: string;
  message: string;
  mediaPath: string;
}>;

export type WorkspacePackageImportDefaultOptions = Readonly<{
  addImportTag: boolean;
  suggestedImportTag: string;
  keptTags: ReadonlyArray<string>;
  removedTags: ReadonlyArray<string>;
}>;

export type WorkspacePackageImportPreviewResponse = Readonly<{
  sourceKind: "zip";
  packageMetadata: WorkspacePackageImportPreviewMetadata;
  cardCount: number;
  tagCounts: ReadonlyArray<WorkspacePackageImportPreviewTagCount>;
  referencedMediaCount: number;
  packageMediaFileCount: number;
  warnings: ReadonlyArray<WorkspacePackageImportPreviewWarning>;
  defaultOptions: WorkspacePackageImportDefaultOptions;
}>;

export type WorkspacePackageImportConfirmOptions = Readonly<{
  addImportTag: boolean;
  importTag: string;
  removeTags: ReadonlyArray<string>;
  importedAt: string;
  importId: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  operationIdPrefix: string;
}>;

export type WorkspacePackageImportConfirmSummary = Readonly<{
  cardCount: number;
  cardBatchCount: number;
  referencedMediaCount: number;
  importedMediaAssetCount: number;
  appliedMediaAssetCount: number;
  keptTagCount: number;
  removedTagCount: number;
  importTag: string | null;
}>;

export type WorkspacePackageImportedMediaAsset = Readonly<{
  portablePath: string;
  mediaAsset: MediaAsset;
  applied: boolean;
}>;

export type WorkspacePackageImportConfirmResponse = Readonly<{
  cards: ReadonlyArray<Card>;
  importedMediaAssets: ReadonlyArray<WorkspacePackageImportedMediaAsset>;
  summary: WorkspacePackageImportConfirmSummary;
}>;
