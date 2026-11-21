import { useLayoutEffect, useRef, useState } from "react";
import { ApiError, previewWorkspacePackageImport } from "../../../../../api";
import { isWorkspaceSyncDiscardedError } from "../../../../../appData/sync/observation/syncErrorObservation";
import { markIndexedDbOpenRecoveryFailureAndCheckActive } from "../../../../../appError/AppErrorContext";
import { type TranslationKey, useI18n } from "../../../../../i18n";
import type {
  WorkspacePackageImportConfirmResponse,
  WorkspacePackageImportConfirmSummary,
  WorkspacePackageImportPreviewResponse,
} from "../../../../../types";
import type { WorkspaceImportOptions, useWorkspaceImportActions } from "../useWorkspaceImportActions";
import { useWorkspacePackageImport } from "./WorkspacePackageImportContext";
import { buildWorkspaceImportPreviewModel, type WorkspaceImportPreviewModel } from "./workspaceImportPresentationModel";

type PackagePreviewState =
  | Readonly<{ stage: "previewing"; file: File }>
  | Readonly<{ stage: "ready"; file: File; result: WorkspacePackageImportPreviewResponse }>
  | Readonly<{ stage: "previewFailed"; file: File; canRetry: boolean }>;

export type WorkspacePackageImportFormState = Readonly<{
  fileName: string | null;
  preview: WorkspaceImportPreviewModel | null;
  options: WorkspaceImportOptions;
  isControlDisabled: boolean;
  canSubmit: boolean;
  isPreviewing: boolean;
  isBusy: boolean;
  submitActionLabel: string;
  unavailableMessage: string | null;
  errorMessage: string;
  successMessage: string;
}>;

export type WorkspacePackageImportCommands = Readonly<{
  selectFiles: (files: ReadonlyArray<File>) => void;
  setImportTagEnabled: (enabled: boolean) => void;
  setImportTag: (tag: string) => void;
  toggleRemovedTag: (tag: string) => void;
  submit: () => Promise<void>;
}>;

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

export function useWorkspacePackageImportController(actions: ReturnType<typeof useWorkspaceImportActions>): Readonly<{
  state: WorkspacePackageImportFormState;
  commands: WorkspacePackageImportCommands;
}> {
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
  const [previewState, setPreviewState] = useState<PackagePreviewState | null>(null);
  const [options, setOptions] = useState<WorkspaceImportOptions>(initialImportOptions);
  const [errorMessage, setErrorMessage] = useState("");
  const scopeActiveRef = useRef(false);
  const importTagChoiceBeforePreviewRef = useRef<boolean | null>(null);
  const { state: importState, read: readImportState, update: updateImportState } = useWorkspacePackageImport(
    session?.userId,
    workspaceId,
  );
  const preview = previewState?.stage === "ready" ? previewState.result : null;
  const isPreviewing = previewState?.stage === "previewing";
  const canRetryPreview = previewState?.stage === "previewFailed" && previewState.canRetry;
  const isImportAvailable = workspaceId !== null && isSessionVerified && installationId !== null;
  const isImporting = importState?.stage === "confirming" || importState?.stage === "syncing";
  const canRetrySync = importState?.stage === "syncFailed";
  const isBusy = isPreviewing || isImporting;
  const isControlDisabled = !isImportAvailable || isBusy || indexedDbOpenRecoveryState.hasFailed();

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

  async function previewFile(workspaceId: string, file: File): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    setPreviewState({ stage: "previewing", file });
    setErrorMessage("");
    clearImportFeedback();
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const result = await previewWorkspacePackageImport(workspaceId, file);
      if (!scopeActiveRef.current) {
        return;
      }
      indexedDbOpenRecoveryState.throwIfFailed();
      const addImportTag = importTagChoiceBeforePreviewRef.current ?? result.defaultOptions.addImportTag;
      importTagChoiceBeforePreviewRef.current = null;
      setPreviewState({ stage: "ready", file, result });
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
      setPreviewState({ stage: "previewFailed", file, canRetry: validationMessage === null });
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
      setOptions(initialImportOptions);
    }
    updateImportState({ stage: "complete", summary });
  }

  async function submit(): Promise<void> {
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
    if (previewState?.stage === "previewFailed" && previewState.canRetry) {
      await previewFile(workspaceId, previewState.file);
      return;
    }

    if (previewState?.stage !== "ready") {
      return;
    }
    if (options.addImportTag && options.importTag.trim() === "") {
      setErrorMessage(t("workspaceImport.importTagRequired"));
      return;
    }

    const { file } = previewState;
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
      setPreviewState(null);
    }
    await syncImportedPackage(file.name, result.summary);
  }

  function selectFiles(files: ReadonlyArray<File>): void {
    if (workspaceId === null || isControlDisabled || canRetrySync) {
      return;
    }
    if (files.length > 1) {
      setErrorMessage(t("workspaceImport.packageSingleFile"));
      clearImportFeedback();
      return;
    }

    const selectedFile = files[0];
    if (selectedFile !== undefined) {
      if (previewState !== null) {
        importTagChoiceBeforePreviewRef.current = null;
      }
      void previewFile(workspaceId, selectedFile);
    }
  }

  function setImportTagEnabled(addImportTag: boolean): void {
    if (preview === null) {
      importTagChoiceBeforePreviewRef.current = addImportTag;
    }
    setOptions((current) => ({
      ...current,
      addImportTag,
      importTag: addImportTag && current.importTag.trim() === "" && preview !== null
        ? preview.defaultOptions.suggestedImportTag
        : current.importTag,
    }));
  }

  function setImportTag(importTag: string): void {
    setOptions((current) => ({ ...current, importTag }));
  }

  function toggleRemovedTag(tag: string): void {
    setOptions((current) => ({
      ...current,
      removeTags: current.removeTags.includes(tag)
        ? current.removeTags.filter((removedTag) => removedTag !== tag)
        : [...current.removeTags, tag],
    }));
  }

  return {
    state: {
      fileName: importState !== undefined && "fileName" in importState ? importState.fileName : previewState?.file.name ?? null,
      preview: preview === null
        ? null
        : buildWorkspaceImportPreviewModel(
          preview,
          t,
          formatDateTime,
          formatNumber,
          (value) => formatCount(value, messages.common.countLabels.card),
        ),
      options,
      isControlDisabled: isControlDisabled || canRetrySync,
      canSubmit: !isControlDisabled && (preview !== null || canRetrySync || canRetryPreview),
      isPreviewing,
      isBusy,
      submitActionLabel: isPreviewing
        ? t("workspaceImport.packagePreviewing")
        : isImporting
          ? t("workspaceImport.packageImporting")
          : canRetrySync || canRetryPreview
            ? t("common.retry")
            : t("workspaceImport.packageConfirmButton"),
      unavailableMessage: workspaceId !== null && !isImportAvailable
        ? isSessionVerified ? t("workspaceImport.workspaceUnavailable") : t("loading.restoringSession")
        : null,
      errorMessage: errorMessage || (importState?.stage === "confirmFailed" || importState?.stage === "syncFailed"
        ? importState.message
        : ""),
      successMessage: importState?.stage === "complete" ? getImportSuccessMessage(importState.summary) : "",
    },
    commands: { selectFiles, setImportTagEnabled, setImportTag, toggleRemovedTag, submit },
  };
}
