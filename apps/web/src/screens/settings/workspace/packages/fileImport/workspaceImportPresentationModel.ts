import type { TranslationKey, TranslationValues } from "../../../../../i18n";
import type { WorkspacePackageImportPreviewResponse } from "../../../../../types";

type WorkspaceImportPreviewStatistic = Readonly<{
  id: string;
  label: string;
  value: string;
  testId: string;
}>;

type WorkspaceImportPreviewMetadataRow = Readonly<{
  id: string;
  label: string;
  value: string;
  href: string | null;
}>;

type WorkspaceImportPreviewWarning = Readonly<{
  id: string;
  message: string;
}>;

type WorkspaceImportPreviewTag = Readonly<{
  tag: string;
  removalLabel: string;
}>;

export type WorkspaceImportPreviewModel = Readonly<{
  statistics: ReadonlyArray<WorkspaceImportPreviewStatistic>;
  metadataRows: ReadonlyArray<WorkspaceImportPreviewMetadataRow>;
  warnings: ReadonlyArray<WorkspaceImportPreviewWarning>;
  tags: ReadonlyArray<WorkspaceImportPreviewTag>;
}>;

function buildSafeMetadataHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function formatPackageMetadataCreatedAt(
  value: string,
  formatDateTimeValue: (dateValue: Date) => string,
): string {
  const dateValue = new Date(value);
  if (Number.isNaN(dateValue.getTime())) {
    return value;
  }

  return formatDateTimeValue(dateValue);
}

export function buildWorkspaceImportPreviewModel(
  preview: WorkspacePackageImportPreviewResponse,
  t: (key: TranslationKey, values?: TranslationValues) => string,
  formatDateTimeValue: (dateValue: Date) => string,
  formatNumberValue: (value: number) => string,
  formatCardCountValue: (value: number) => string,
): WorkspaceImportPreviewModel {
  const metadataRows: ReadonlyArray<WorkspaceImportPreviewMetadataRow> = [
    preview.packageMetadata.label === null ? null : {
      id: "label",
      label: t("workspaceImport.previewMetadataLabel"),
      value: preview.packageMetadata.label,
      href: null,
    },
    preview.packageMetadata.author === null ? null : {
      id: "author",
      label: t("workspaceImport.previewMetadataAuthor"),
      value: preview.packageMetadata.author,
      href: null,
    },
    preview.packageMetadata.comment === null ? null : {
      id: "comment",
      label: t("workspaceImport.previewMetadataComment"),
      value: preview.packageMetadata.comment,
      href: null,
    },
    preview.packageMetadata.createdAt === null ? null : {
      id: "created-at",
      label: t("workspaceImport.previewMetadataCreatedAt"),
      value: formatPackageMetadataCreatedAt(preview.packageMetadata.createdAt, formatDateTimeValue),
      href: null,
    },
    preview.packageMetadata.sourceUrl === null ? null : {
      id: "source-url",
      label: t("workspaceImport.previewMetadataSourceUrl"),
      value: preview.packageMetadata.sourceUrl,
      href: buildSafeMetadataHttpUrl(preview.packageMetadata.sourceUrl),
    },
  ].filter((row): row is WorkspaceImportPreviewMetadataRow => row !== null);

  return {
    statistics: [
      {
        id: "source",
        label: t("workspaceImport.previewSourceLabel"),
        value: t("workspaceImport.previewSourceZip"),
        testId: "workspace-package-import-preview-source",
      },
      {
        id: "cards",
        label: t("workspaceImport.previewCardsLabel"),
        value: formatNumberValue(preview.cardCount),
        testId: "workspace-package-import-preview-card-count",
      },
      {
        id: "referenced-media",
        label: t("workspaceImport.previewReferencedMediaLabel"),
        value: formatNumberValue(preview.referencedMediaCount),
        testId: "workspace-package-import-preview-referenced-media-count",
      },
      {
        id: "package-media",
        label: t("workspaceImport.previewPackageMediaLabel"),
        value: formatNumberValue(preview.packageMediaFileCount),
        testId: "workspace-package-import-preview-package-media-count",
      },
    ],
    metadataRows,
    warnings: preview.warnings.map((warning) => ({
      id: `${warning.code}:${warning.mediaPath}:${warning.message}`,
      message: warning.mediaPath === ""
        ? warning.message
        : t("workspaceImport.previewWarningWithPath", {
          message: warning.message,
          path: warning.mediaPath,
        }),
    })),
    tags: preview.tagCounts.map((tagCount) => ({
      tag: tagCount.tag,
      removalLabel: t("workspaceImport.previewRemoveTagLabel", {
        tag: tagCount.tag,
        count: formatCardCountValue(tagCount.cardsCount),
      }),
    })),
  };
}
