import { useEffect, useState, type ReactElement } from "react";
import { ApiError, previewWorkspacePackageImport } from "../../../../api";
import { markIndexedDbOpenRecoveryFailureAndCheckActive } from "../../../../appError/AppErrorContext";
import { useI18n } from "../../../../i18n";
import { loadWorkspaceTagsSummary } from "../../../../localDb/cards/workspace";
import type { TagSuggestion, WorkspacePackageImportConfirmResponse } from "../../../../types";
import { handleRefreshLocalDataError } from "../../../shared/refreshLocalDataError";
import { WorkspaceImportShell } from "./WorkspaceImportShell";
import { WorkspaceTextImportEditor } from "./WorkspaceTextImportEditor";
import { createTextImportPackageFile, type TextImportCard } from "./textImport";
import { useWorkspaceImportActions } from "./useWorkspaceImportActions";

type TextImportSyncState =
  | Readonly<{ workspaceId: string; stage: "syncing" }>
  | Readonly<{ workspaceId: string; stage: "failed"; message: string }>;

export function WorkspaceTextImportScreen(): ReactElement {
  const {
    appData,
    appErrorDialog,
    workspaceId,
    installationId,
    technicalErrorMessage,
    confirmWorkspaceImport,
    getImportSuccessMessage,
    getImportErrorMessage,
  } = useWorkspaceImportActions();
  const { cloudSettings, isSessionVerified, localReadVersion, refreshLocalData, session } = appData;
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = appErrorDialog;
  const { t } = useI18n();
  const [isTextImporting, setIsTextImporting] = useState(false);
  const [textImportSyncState, setTextImportSyncState] = useState<TextImportSyncState | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const currentTextImportSync = textImportSyncState?.workspaceId === workspaceId ? textImportSyncState : null;
  const isTextImportSyncing = currentTextImportSync?.stage === "syncing";
  const isImportAvailable = workspaceId !== null && isSessionVerified && installationId !== null;
  const isControlDisabled = !isImportAvailable || isTextImporting || isTextImportSyncing || indexedDbOpenRecoveryState.hasFailed();

  useEffect(() => {
    let isCancelled = false;
    if (workspaceId === null || indexedDbOpenRecoveryState.hasFailed()) {
      setTagSuggestions([]);
      return () => {
        isCancelled = true;
      };
    }

    void loadWorkspaceTagsSummary(workspaceId)
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
  }, [workspaceId, indexedDbOpenRecoveryState, localReadVersion]);

  async function syncImportedTextCards(workspaceId: string): Promise<void> {
    const pendingSync: TextImportSyncState = { workspaceId, stage: "syncing" };
    setTextImportSyncState(pendingSync);
    try {
      await refreshLocalData();
      indexedDbOpenRecoveryState.throwIfFailed();
      setTextImportSyncState((current) => current === pendingSync ? null : current);
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      handleRefreshLocalDataError({
        error,
        context: {
          feature: "sync",
          operation: "refresh_local_metadata",
          userId: session?.userId ?? null,
          workspaceId,
          installationId: cloudSettings?.installationId ?? null,
          entityId: workspaceId,
        },
        setErrorMessage: (message) => setTextImportSyncState((current) => current === pendingSync
          ? { workspaceId, stage: "failed", message }
          : current),
        showCapturedTechnicalError,
        technicalErrorMessage,
      });
    }
  }

  async function importTextCards(
    cards: ReadonlyArray<TextImportCard>,
    tags: ReadonlyArray<string>,
  ): Promise<boolean> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return false;
    }

    if (!isImportAvailable) {
      setErrorMessage(t("workspaceImport.workspaceUnavailable"));
      setSuccessMessage("");
      return false;
    }

    setIsTextImporting(true);
    setErrorMessage("");
    setSuccessMessage("");

    let result: WorkspacePackageImportConfirmResponse;
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      const file = createTextImportPackageFile(cards, tags);
      const preview = await previewWorkspacePackageImport(workspaceId, file);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (preview.cardCount !== cards.length) {
        throw new Error(
          `Pasted card preview count mismatch. expected=${cards.length} actual=${preview.cardCount}`,
        );
      }

      const usesAutomaticImportTag = tags.length === 0;
      result = await confirmWorkspaceImport(workspaceId, installationId, file, {
        addImportTag: usesAutomaticImportTag,
        importTag: usesAutomaticImportTag ? preview.defaultOptions.suggestedImportTag : "",
        removeTags: [],
      });
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return false;
      }

      if (error instanceof ApiError && error.statusCode === 413) {
        setErrorMessage(t("workspaceImport.textTooLarge"));
      } else {
        setErrorMessage(getImportErrorMessage(error, showCapturedTechnicalError));
      }
      return false;
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsTextImporting(false);
      }
    }

    setSuccessMessage(getImportSuccessMessage(result.summary));
    void syncImportedTextCards(workspaceId);
    return true;
  }

  return (
    <WorkspaceImportShell title={t("workspaceImport.spreadsheetTitle")}>
      <WorkspaceTextImportEditor
        isDisabled={isControlDisabled}
        isImporting={isTextImporting}
        isSyncing={isTextImportSyncing}
        unavailableMessage={!isImportAvailable
          ? isSessionVerified ? t("workspaceImport.workspaceUnavailable") : t("loading.restoringSession")
          : null}
        syncErrorMessage={currentTextImportSync?.stage === "failed" ? currentTextImportSync.message : null}
        onRetrySync={() => {
          if (currentTextImportSync?.stage === "failed" && !isControlDisabled) {
            void syncImportedTextCards(currentTextImportSync.workspaceId);
          }
        }}
        errorMessage={errorMessage}
        successMessage={successMessage}
        tagSuggestions={tagSuggestions}
        onImport={importTextCards}
      />
    </WorkspaceImportShell>
  );
}
