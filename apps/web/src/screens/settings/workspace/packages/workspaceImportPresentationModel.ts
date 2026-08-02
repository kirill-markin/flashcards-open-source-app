export type WorkspaceImportPreviewStatistic = Readonly<{
  id: string;
  label: string;
  value: string;
  testId: string;
}>;

export type WorkspaceImportPreviewMetadataRow = Readonly<{
  id: string;
  label: string;
  value: string;
  href: string | null;
}>;

export type WorkspaceImportPreviewWarning = Readonly<{
  id: string;
  message: string;
}>;

export type WorkspaceImportPreviewTag = Readonly<{
  tag: string;
  removalLabel: string;
}>;

export type WorkspaceImportPreviewModel = Readonly<{
  statistics: ReadonlyArray<WorkspaceImportPreviewStatistic>;
  metadataRows: ReadonlyArray<WorkspaceImportPreviewMetadataRow>;
  warnings: ReadonlyArray<WorkspaceImportPreviewWarning>;
  tags: ReadonlyArray<WorkspaceImportPreviewTag>;
  suggestedImportTag: string;
}>;

export type WorkspaceImportOptions = Readonly<{
  addImportTag: boolean;
  importTag: string;
  removeTags: ReadonlyArray<string>;
}>;

export type WorkspaceImportPresentationCopy = Readonly<{
  title: string;
  description: string;
  importTagLabel: string;
  importTagDescription: string;
  importTagValueLabel: string;
  warningsTitle: string;
  tagsTitle: string;
  selectionActionLabel: string;
  confirmActionLabel: string;
  confirmingActionLabel: string;
}>;
