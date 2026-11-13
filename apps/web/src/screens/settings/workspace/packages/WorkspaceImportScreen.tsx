import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { ApiError, previewWorkspacePackageImport } from "../../../../api";
import { isWorkspaceSyncDiscardedError } from "../../../../appData/sync/observation/syncErrorObservation";
import { markIndexedDbOpenRecoveryFailureAndCheckActive } from "../../../../appError/AppErrorContext";
import { type TranslationKey, type TranslationValues, useI18n } from "../../../../i18n";
import type { WorkspacePackageImportConfirmResponse, WorkspacePackageImportConfirmSummary, WorkspacePackageImportPreviewResponse } from "../../../../types";
import { WorkspaceImportPresentation } from "./WorkspaceImportPresentation";
import { WorkspaceImportShell } from "./WorkspaceImportShell";
import { useWorkspacePackageImport } from "./WorkspacePackageImportContext";
import { useWorkspaceImportActions } from "./useWorkspaceImportActions";
import type {
  WorkspaceImportOptions,
  WorkspaceImportPreviewMetadataRow,
  WorkspaceImportPreviewModel,
} from "./workspaceImportPresentationModel";

const initialImportOptions: WorkspaceImportOptions = {
  addImportTag: true,
  importTag: "",
  removeTags: [],
};

function getWorkspacePackageValidationErrorMessage(
  error: unknown,
  t: (key: TranslationKey) => string,
): string | null {
  if (!(error instanceof ApiError) || error.statusCode < 400 || error.statusCode >= 500) {
    return null;
  }

  if (error.statusCode === 413) {
    return t("workspaceImport.packageTooLarge");
  }

  switch (error.code) {
    case "WORKSPACE_PACKAGE_IMPORT_PREVIEW_ZIP_EMPTY":
    case "WORKSPACE_PACKAGE_IMPORT_PREVIEW_ZIP_INVALID":
    case "WORKSPACE_PACKAGE_IMPORT_PREVIEW_CARDS_JSON_MALFORMED":
    case "WORKSPACE_PACKAGE_IMPORT_PREVIEW_CARDS_JSON_INVALID":
      return t("workspaceImport.packageInvalid");
    case "WORKSPACE_PACKAGE_IMPORT_PREVIEW_BODY_TOO_LARGE":
    case "WORKSPACE_PACKAGE_IMPORT_PREVIEW_TOO_LARGE":
      return t("workspaceImport.packageTooLarge");
  }

  return null;
}

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

function buildWorkspaceImportPreviewModel(
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
    suggestedImportTag: preview.defaultOptions.suggestedImportTag,
  };
}

export function WorkspaceImportScreen(): ReactElement {
  const actions = useWorkspaceImportActions();
  const { t } = useI18n();

  return (
    <WorkspaceImportShell title={t("workspaceImport.nibomoTitle")}>
      <WorkspacePackageImportForm
        key={JSON.stringify([actions.appData.session?.userId, actions.workspaceId, actions.installationId])}
        actions={actions}
      />
    </WorkspaceImportShell>
  );
}

function WorkspacePackageImportForm({ actions }: Readonly<{
  actions: ReturnType<typeof useWorkspaceImportActions>;
}>): ReactElement {
  const {
    appData,
    appErrorDialog,
    workspaceId,
    installationId,
    confirmWorkspaceImport,
    getImportSuccessMessage,
    getImportErrorMessage,
  } = actions;
  const { isSessionVerified, refreshLocalData, session } = appData;
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = appErrorDialog;
  const { messages, t, formatCount, formatDateTime, formatNumber } = useI18n();
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<WorkspacePackageImportPreviewResponse | null>(null);
  const [options, setOptions] = useState<WorkspaceImportOptions>(initialImportOptions);
  const [canRetryPreview, setCanRetryPreview] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const scopeActiveRef = useRef(false);
  const importTagChoiceBeforePreviewRef = useRef<boolean | null>(null);
  const { state: importState, read: readImportState, update: updateImportState } = useWorkspacePackageImport(
    JSON.stringify([session?.userId, workspaceId]),
  );
  const isImportAvailable = workspaceId !== null && isSessionVerified && installationId !== null;
  const isImporting = importState?.stage === "confirming" || importState?.stage === "syncing";
  const canRetrySync = importState?.stage === "syncFailed";
  const isBusy = isPreviewing || isImporting;
  const isControlDisabled = !isImportAvailable || isBusy || indexedDbOpenRecoveryState.hasFailed();
  const previewModel = preview === null
    ? null
    : buildWorkspaceImportPreviewModel(
      preview,
      t,
      formatDateTime,
      formatNumber,
      (value) => formatCount(value, messages.common.countLabels.card),
    );

  useLayoutEffect(() => {
    scopeActiveRef.current = true;
    return () => {
      scopeActiveRef.current = false;
    };
  }, []);

  function clearImportFeedback(): void {
    const current = readImportState();
    if (current?.stage === "complete" || current?.stage === "confirmFailed") {
      updateImportState(null);
    }
  }

  async function previewFile(selectedFile: File): Promise<void> {
    if (!isImportAvailable || indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    setFile(selectedFile);
    setPreview(null);
    setCanRetryPreview(false);
    setIsPreviewing(true);
    setErrorMessage("");
    clearImportFeedback();
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const result = await previewWorkspacePackageImport(workspaceId, selectedFile);
      if (!scopeActiveRef.current) {
        return;
      }
      indexedDbOpenRecoveryState.throwIfFailed();
      const addImportTag = importTagChoiceBeforePreviewRef.current ?? result.defaultOptions.addImportTag;
      importTagChoiceBeforePreviewRef.current = null;
      setPreview(result);
      setOptions({
        addImportTag,
        importTag: result.defaultOptions.suggestedImportTag,
        removeTags: [...result.defaultOptions.removedTags],
      });
    } catch (error) {
      if (!scopeActiveRef.current || markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      const validationMessage = getWorkspacePackageValidationErrorMessage(error, t);
      setErrorMessage(validationMessage ?? getImportErrorMessage(error, showCapturedTechnicalError));
      setCanRetryPreview(validationMessage === null);
    } finally {
      if (scopeActiveRef.current && !indexedDbOpenRecoveryState.hasFailed()) {
        setIsPreviewing(false);
      }
    }
  }

  function getPackageMutationErrorMessage(error: unknown): string {
    if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
      return "";
    }
    if (isWorkspaceSyncDiscardedError(error)) {
      return t("workspaceImport.workspaceUnavailable");
    }
    return getWorkspacePackageValidationErrorMessage(error, t) ?? getImportErrorMessage(error, (technicalError) => {
      if (scopeActiveRef.current) {
        showCapturedTechnicalError(technicalError);
      }
    });
  }

  async function syncImportedPackage(fileName: string, summary: WorkspacePackageImportConfirmSummary): Promise<void> {
    updateImportState({ stage: "syncing", fileName });
    try {
      await refreshLocalData();
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      updateImportState({ stage: "syncFailed", fileName, summary, message: getPackageMutationErrorMessage(error) });
      return;
    }

    if (scopeActiveRef.current) {
      setFile(null);
      setOptions(initialImportOptions);
    }
    updateImportState({ stage: "complete", summary });
  }

  async function importPackage(): Promise<void> {
    if (!isImportAvailable || isControlDisabled) {
      return;
    }
    const current = readImportState();
    if (current?.stage === "confirming" || current?.stage === "syncing") {
      return;
    }
    if (current?.stage === "syncFailed") {
      await syncImportedPackage(current.fileName, current.summary);
      return;
    }

    if (file === null || preview === null) {
      return;
    }
    if (options.addImportTag && options.importTag.trim() === "") {
      setErrorMessage(t("workspaceImport.importTagRequired"));
      return;
    }

    setErrorMessage("");
    updateImportState({ stage: "confirming", fileName: file.name });
    let result: WorkspacePackageImportConfirmResponse;
    try {
      result = await confirmWorkspaceImport(workspaceId, installationId, file, options);
    } catch (error) {
      updateImportState({ stage: "confirmFailed", message: getPackageMutationErrorMessage(error) });
      return;
    }

    if (scopeActiveRef.current) {
      setPreview(null);
    }
    await syncImportedPackage(file.name, result.summary);
  }

  function selectFiles(files: ReadonlyArray<File>): void {
    if (files.length > 1) {
      setErrorMessage(t("workspaceImport.packageSingleFile"));
      clearImportFeedback();
      return;
    }

    const selectedFile = files[0];
    if (selectedFile !== undefined) {
      if (file !== null) {
        importTagChoiceBeforePreviewRef.current = null;
      }
      void previewFile(selectedFile);
    }
  }

  return (
    <WorkspaceImportPresentation
      copy={{
        description: t("workspaceImport.packageDescription"),
        importTagLabel: t("workspaceImport.importTagLabel"),
        importTagDescription: t("workspaceImport.importTagDescription"),
        importTagValueLabel: t("workspaceImport.importTagValueLabel"),
        warningsTitle: t("workspaceImport.previewWarningsTitle"),
        tagsTitle: t("workspaceImport.previewTagsTitle"),
        selectionActionLabel: t("workspaceImport.packageImportButton"),
        confirmActionLabel: isPreviewing
          ? t("workspaceImport.packagePreviewing")
          : isImporting
            ? t("workspaceImport.packageImporting")
            : canRetrySync || canRetryPreview
              ? t("common.retry")
              : t("workspaceImport.packageConfirmButton"),
      }}
      fileName={importState !== undefined && "fileName" in importState ? importState.fileName : file?.name ?? null}
      preview={previewModel}
      options={options}
      isControlDisabled={isControlDisabled || canRetrySync}
      canConfirm={!isControlDisabled && (preview !== null || canRetrySync || canRetryPreview)}
      isPreviewing={isPreviewing}
      isBusy={isBusy}
      unavailableMessage={workspaceId !== null && !isImportAvailable
        ? isSessionVerified ? t("workspaceImport.workspaceUnavailable") : t("loading.restoringSession")
        : null}
      errorMessage={errorMessage || (importState?.stage === "confirmFailed" || importState?.stage === "syncFailed"
        ? importState.message
        : "")}
      successMessage={importState?.stage === "complete" ? getImportSuccessMessage(importState.summary) : ""}
      onSelect={selectFiles}
      onOptionsChange={(nextOptions) => {
        if (preview === null) {
          importTagChoiceBeforePreviewRef.current = nextOptions.addImportTag;
        }
        setOptions(nextOptions);
      }}
      onConfirm={() => {
        if (canRetryPreview && file !== null) {
          void previewFile(file);
        } else {
          void importPackage();
        }
      }}
    />
  );
}
