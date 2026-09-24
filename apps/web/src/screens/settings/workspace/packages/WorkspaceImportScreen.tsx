import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  ApiError,
  confirmWorkspacePackageImport,
  previewWorkspacePackageImport,
} from "../../../../api";
import { useAppData } from "../../../../appData";
import { requireCloudInstallationId } from "../../../../appData/sync/local/syncCloudSettings";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../../../appError/AppErrorContext";
import { type TranslationKey, type TranslationValues, useI18n } from "../../../../i18n";
import { loadWorkspaceTagsSummary } from "../../../../localDb/cards/workspace";
import { buildClientWorkspaceReplicaId } from "../../../../media/mediaCrypto";
import { captureAppOperationError } from "../../../../observability/appOperationObservation";
import type {
  TagSuggestion,
  WorkspacePackageImportConfirmOptions,
  WorkspacePackageImportConfirmResponse,
  WorkspacePackageImportPreviewResponse,
} from "../../../../types";
import { SettingsShell } from "../../SettingsShared";
import { WorkspaceImportPresentation } from "./WorkspaceImportPresentation";
import { WorkspaceTextImportEditor } from "./WorkspaceTextImportEditor";
import { createTextImportPackageFile, type TextImportCard } from "./textImport";
import type {
  WorkspaceImportOptions,
  WorkspaceImportPreviewMetadataRow,
  WorkspaceImportPreviewModel,
} from "./workspaceImportPresentationModel";

type PackageImportPreviewIdentity = Readonly<{
  workspaceId: string;
  installationId: string;
}>;

type WorkspaceImportStatusOwner = "package" | "text";

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
  const {
    activeWorkspace,
    cloudSettings,
    isSessionVerified,
    localReadVersion,
    refreshLocalData,
    session,
  } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const { messages, t, formatCount, formatDateTime, formatNumber } = useI18n();
  const packageImportInputRef = useRef<HTMLInputElement | null>(null);
  const [isTextImporting, setIsTextImporting] = useState<boolean>(false);
  const [isPackagePreviewing, setIsPackagePreviewing] = useState<boolean>(false);
  const [isPackageImporting, setIsPackageImporting] = useState<boolean>(false);
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);
  const [packageImportFile, setPackageImportFile] = useState<File | null>(null);
  const [packageImportPreview, setPackageImportPreview] = useState<WorkspacePackageImportPreviewResponse | null>(null);
  const [packageImportPreviewIdentity, setPackageImportPreviewIdentity] = useState<PackageImportPreviewIdentity | null>(null);
  const [packageImportOptions, setPackageImportOptions] = useState<WorkspaceImportOptions>({
    addImportTag: true,
    importTag: "",
    removeTags: [],
  });
  const [statusOwner, setStatusOwner] = useState<WorkspaceImportStatusOwner>("text");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const technicalErrorMessage = t("appError.technicalError.message");
  const isPackageImportBusy = isPackagePreviewing || isPackageImporting;
  const isAnyImportBusy = isTextImporting || isPackageImportBusy;
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const currentInstallationId = cloudSettings?.cloudState === "linked" && cloudSettings.installationId.trim() !== ""
    ? cloudSettings.installationId
    : null;
  const isPackageImportAvailable = activeWorkspace !== null && isSessionVerified && currentInstallationId !== null;
  const isPackageImportPreviewCurrent = packageImportPreview !== null
    && packageImportFile !== null
    && packageImportPreviewIdentity !== null
    && isPackageImportAvailable
    && packageImportPreviewIdentity.workspaceId === activeWorkspaceId
    && packageImportPreviewIdentity.installationId === currentInstallationId;
  const isPackageImportControlDisabled = !isPackageImportAvailable
    || isAnyImportBusy
    || indexedDbOpenRecoveryState.hasFailed();
  const packageImportPreviewModel = packageImportPreview === null
    ? null
    : buildWorkspaceImportPreviewModel(
      packageImportPreview,
      t,
      formatDateTime,
      formatNumber,
      (value) => formatCount(value, messages.common.countLabels.card),
    );

  function captureWorkspaceImportError(error: unknown): boolean {
    return captureAppOperationError(error, {
      feature: "settings",
      operation: "workspace_import",
      userId: session?.userId ?? null,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      installationId: cloudSettings?.installationId ?? null,
      entityId: activeWorkspace?.workspaceId ?? null,
    });
  }

  useEffect(() => {
    let isCancelled = false;
    if (activeWorkspaceId === null || indexedDbOpenRecoveryState.hasFailed()) {
      setTagSuggestions([]);
      return () => {
        isCancelled = true;
      };
    }

    void loadWorkspaceTagsSummary(activeWorkspaceId)
      .then((summary) => {
        if (isCancelled || indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }
        setTagSuggestions(summary.tags.map((tag) => ({
          tag: tag.tag,
          countState: "ready",
          cardsCount: tag.cardsCount,
        })));
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return;
        }
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }
        setTagSuggestions([]);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspaceId, indexedDbOpenRecoveryState, localReadVersion]);

  function resetPackageImportPreview(): void {
    setPackageImportFile(null);
    setPackageImportPreview(null);
    setPackageImportPreviewIdentity(null);
    setPackageImportOptions({
      addImportTag: true,
      importTag: "",
      removeTags: [],
    });
  }

  async function executeWorkspacePackageImport(
    workspaceId: string,
    installationId: string,
    file: File,
    importOptions: WorkspaceImportOptions,
    onConfirmed: () => void,
  ): Promise<WorkspacePackageImportConfirmResponse> {
    await refreshLocalData();
    indexedDbOpenRecoveryState.throwIfFailed();
    const replicaId = await buildClientWorkspaceReplicaId(workspaceId, installationId);
    indexedDbOpenRecoveryState.throwIfFailed();
    const importId = crypto.randomUUID().toLowerCase();
    const importedAt = new Date().toISOString();
    const options: WorkspacePackageImportConfirmOptions = {
      addImportTag: importOptions.addImportTag,
      importTag: importOptions.importTag.trim(),
      removeTags: importOptions.removeTags,
      importedAt,
      importId,
      clientUpdatedAt: importedAt,
      lastModifiedByReplicaId: replicaId,
      operationIdPrefix: importId,
    };
    const result = await confirmWorkspacePackageImport(workspaceId, file, options);
    indexedDbOpenRecoveryState.throwIfFailed();
    onConfirmed();
    await refreshLocalData();
    indexedDbOpenRecoveryState.throwIfFailed();
    return result;
  }

  function showWorkspaceImportSuccess(result: WorkspacePackageImportConfirmResponse): void {
    const importedCardCount = formatCount(result.summary.cardCount, messages.common.countLabels.card);
    setSuccessMessage(result.summary.importTag === null
      ? t("workspaceImport.packageImportSuccess", { count: importedCardCount })
      : t("workspaceImport.packageImportSuccessWithTag", {
        count: importedCardCount,
        tag: result.summary.importTag,
      }));
  }

  useEffect(() => {
    if (packageImportPreviewIdentity === null || indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    if (
      packageImportPreviewIdentity.workspaceId !== activeWorkspaceId
      || packageImportPreviewIdentity.installationId !== currentInstallationId
    ) {
      resetPackageImportPreview();
    }
  }, [activeWorkspaceId, currentInstallationId, indexedDbOpenRecoveryState, packageImportPreviewIdentity]);

  async function previewPackageImportFile(file: File): Promise<void> {
    setStatusOwner("package");
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    if (!isPackageImportAvailable) {
      setErrorMessage(t("workspaceImport.workspaceUnavailable"));
      setSuccessMessage("");
      return;
    }

    setIsPackagePreviewing(true);
    setErrorMessage("");
    setSuccessMessage("");
    resetPackageImportPreview();

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const preview = await previewWorkspacePackageImport(activeWorkspace.workspaceId, file);
      indexedDbOpenRecoveryState.throwIfFailed();
      setPackageImportFile(file);
      setPackageImportPreview(preview);
      setPackageImportPreviewIdentity({
        workspaceId: activeWorkspace.workspaceId,
        installationId: currentInstallationId,
      });
      setPackageImportOptions({
        addImportTag: preview.defaultOptions.addImportTag,
        importTag: preview.defaultOptions.suggestedImportTag,
        removeTags: [...preview.defaultOptions.removedTags],
      });
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }

      const validationErrorMessage = getWorkspacePackageValidationErrorMessage(error, t);
      if (validationErrorMessage !== null) {
        setErrorMessage(validationErrorMessage);
      } else {
        const wasCaptured = captureWorkspaceImportError(error);
        if (wasCaptured) {
          showCapturedTechnicalError(error);
          setErrorMessage(technicalErrorMessage);
        } else {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsPackagePreviewing(false);
        if (packageImportInputRef.current !== null) {
          packageImportInputRef.current.value = "";
        }
      }
    }
  }

  async function confirmPackageImport(importOptions: WorkspaceImportOptions): Promise<void> {
    setStatusOwner("package");
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    if (!isPackageImportAvailable) {
      resetPackageImportPreview();
      setErrorMessage(t("workspaceImport.workspaceUnavailable"));
      setSuccessMessage("");
      return;
    }

    if (!isPackageImportPreviewCurrent) {
      resetPackageImportPreview();
      setErrorMessage(t("workspaceImport.packagePreviewRequired"));
      setSuccessMessage("");
      return;
    }

    const confirmedPackageImportTag = importOptions.importTag.trim();
    if (importOptions.addImportTag && confirmedPackageImportTag === "") {
      setErrorMessage(t("workspaceImport.importTagRequired"));
      setSuccessMessage("");
      return;
    }

    setIsPackageImporting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const workspaceId = activeWorkspace.workspaceId;
      const installationId = requireCloudInstallationId(cloudSettings);
      const result = await executeWorkspacePackageImport(
        workspaceId,
        installationId,
        packageImportFile,
        {
          ...importOptions,
          importTag: confirmedPackageImportTag,
        },
        resetPackageImportPreview,
      );

      showWorkspaceImportSuccess(result);
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }

      const validationErrorMessage = getWorkspacePackageValidationErrorMessage(error, t);
      if (validationErrorMessage !== null) {
        setErrorMessage(validationErrorMessage);
      } else {
        const wasCaptured = captureWorkspaceImportError(error);
        if (wasCaptured) {
          showCapturedTechnicalError(error);
          setErrorMessage(technicalErrorMessage);
        } else {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsPackageImporting(false);
      }
    }
  }

  async function importTextCards(
    cards: ReadonlyArray<TextImportCard>,
    tags: ReadonlyArray<string>,
  ): Promise<boolean> {
    setStatusOwner("text");
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return false;
    }

    if (!isPackageImportAvailable) {
      setErrorMessage(t("workspaceImport.workspaceUnavailable"));
      setSuccessMessage("");
      return false;
    }

    setIsTextImporting(true);
    setErrorMessage("");
    setSuccessMessage("");
    resetPackageImportPreview();

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const file = createTextImportPackageFile(cards, tags);
      const preview = await previewWorkspacePackageImport(activeWorkspace.workspaceId, file);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (preview.cardCount !== cards.length) {
        throw new Error(
          `Pasted card preview count mismatch. expected=${cards.length} actual=${preview.cardCount}`,
        );
      }

      const workspaceId = activeWorkspace.workspaceId;
      const installationId = requireCloudInstallationId(cloudSettings);
      const usesAutomaticImportTag = tags.length === 0;
      const result = await executeWorkspacePackageImport(workspaceId, installationId, file, {
        addImportTag: usesAutomaticImportTag,
        importTag: usesAutomaticImportTag ? preview.defaultOptions.suggestedImportTag : "",
        removeTags: [],
      }, () => undefined);
      showWorkspaceImportSuccess(result);
      return true;
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return false;
      }

      if (error instanceof ApiError && error.statusCode === 413) {
        setErrorMessage(t("workspaceImport.textTooLarge"));
      } else {
        const wasCaptured = captureWorkspaceImportError(error);
        if (wasCaptured) {
          showCapturedTechnicalError(error);
          setErrorMessage(technicalErrorMessage);
        } else {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
      return false;
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsTextImporting(false);
      }
    }
  }

  function handlePackageImportInputChange(): void {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const file = packageImportInputRef.current?.files?.[0] ?? null;
    if (file === null) {
      return;
    }

    void previewPackageImportFile(file);
  }

  return (
    <SettingsShell
      title={t("workspaceImport.title")}
      subtitle={t("workspaceImport.subtitle")}
      activeTab="workspace"
    >
      <section className="settings-group">
        <WorkspaceTextImportEditor
          isDisabled={isPackageImportControlDisabled}
          isImporting={isTextImporting}
          errorMessage={statusOwner === "text" ? errorMessage : ""}
          successMessage={statusOwner === "text" ? successMessage : ""}
          tagSuggestions={tagSuggestions}
          onImport={importTextCards}
        />
        <input
          ref={packageImportInputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          disabled={isPackageImportControlDisabled}
          data-testid="workspace-package-import-file-input"
          style={{ display: "none" }}
          onChange={handlePackageImportInputChange}
        />
        <WorkspaceImportPresentation
          copy={{
            title: t("workspaceImport.packageTitle"),
            description: t("workspaceImport.packageDescription"),
            importTagLabel: t("workspaceImport.importTagLabel"),
            importTagDescription: t("workspaceImport.importTagDescription"),
            importTagValueLabel: t("workspaceImport.importTagValueLabel"),
            warningsTitle: t("workspaceImport.previewWarningsTitle"),
            tagsTitle: t("workspaceImport.previewTagsTitle"),
            selectionActionLabel: isPackagePreviewing
              ? t("workspaceImport.packagePreviewing")
              : t("workspaceImport.packageImportButton"),
            confirmActionLabel: t("workspaceImport.packageConfirmButton"),
            confirmingActionLabel: t("workspaceImport.packageImporting"),
          }}
          preview={packageImportPreviewModel}
          options={packageImportOptions}
          isControlDisabled={isPackageImportControlDisabled}
          canConfirm={isPackageImportPreviewCurrent && !isPackageImportBusy}
          isConfirming={isPackageImporting}
          unavailableMessage={activeWorkspace !== null && !isPackageImportAvailable
            ? isSessionVerified ? t("workspaceImport.workspaceUnavailable") : t("loading.restoringSession")
            : null}
          errorMessage={statusOwner === "package" ? errorMessage : ""}
          successMessage={statusOwner === "package" ? successMessage : ""}
          onSelect={() => {
            if (indexedDbOpenRecoveryState.hasFailed() === false) {
              packageImportInputRef.current?.click();
            }
          }}
          onOptionsChange={(options) => {
            if (indexedDbOpenRecoveryState.hasFailed() === false) {
              setPackageImportOptions(options);
            }
          }}
          onConfirm={(options) => void confirmPackageImport(options)}
        />
      </section>
    </SettingsShell>
  );
}
