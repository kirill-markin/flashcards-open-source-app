import { confirmWorkspacePackageImport } from "../../../../api";
import { useAppData } from "../../../../appData";
import { useAppErrorDialog } from "../../../../appError/AppErrorContext";
import { useI18n } from "../../../../i18n";
import { buildClientWorkspaceReplicaId } from "../../../../media/mediaCrypto";
import { captureAppOperationError } from "../../../../observability/appOperationObservation";
import type { WorkspacePackageImportConfirmResponse, WorkspacePackageImportConfirmSummary } from "../../../../types";
import type { WorkspaceImportOptions } from "./workspaceImportPresentationModel";

export function useWorkspaceImportActions() {
  const appData = useAppData();
  const appErrorDialog = useAppErrorDialog();
  const { activeWorkspace, cloudSettings, refreshLocalData, session } = appData;
  const { indexedDbOpenRecoveryState } = appErrorDialog;
  const { messages, t, formatCount } = useI18n();
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const installationId = cloudSettings?.cloudState === "linked" && cloudSettings.installationId.trim() !== ""
    ? cloudSettings.installationId
    : null;
  const technicalErrorMessage = t("appError.technicalError.message");

  async function confirmWorkspaceImport(
    workspaceId: string,
    installationId: string,
    file: File,
    importOptions: WorkspaceImportOptions,
  ): Promise<WorkspacePackageImportConfirmResponse> {
    await refreshLocalData();
    indexedDbOpenRecoveryState.throwIfFailed();
    const replicaId = await buildClientWorkspaceReplicaId(workspaceId, installationId);
    indexedDbOpenRecoveryState.throwIfFailed();
    const importId = crypto.randomUUID().toLowerCase();
    const importedAt = new Date().toISOString();
    return confirmWorkspacePackageImport(workspaceId, file, {
      addImportTag: importOptions.addImportTag,
      importTag: importOptions.importTag.trim(),
      removeTags: importOptions.removeTags,
      importedAt,
      importId,
      clientUpdatedAt: importedAt,
      lastModifiedByReplicaId: replicaId,
      operationIdPrefix: importId,
    });
  }

  function getImportSuccessMessage(summary: WorkspacePackageImportConfirmSummary): string {
    const importedCardCount = formatCount(summary.cardCount, messages.common.countLabels.card);
    return summary.importTag === null
      ? t("workspaceImport.packageImportSuccess", { count: importedCardCount })
      : t("workspaceImport.packageImportSuccessWithTag", {
        count: importedCardCount,
        tag: summary.importTag,
      });
  }

  function getImportErrorMessage(error: unknown, showCapturedTechnicalError: (error: unknown) => void): string {
    const wasCaptured = captureAppOperationError(error, {
      feature: "settings",
      operation: "workspace_import",
      userId: session?.userId ?? null,
      workspaceId,
      installationId: cloudSettings?.installationId ?? null,
      entityId: workspaceId,
    });
    if (wasCaptured) {
      showCapturedTechnicalError(error);
      return technicalErrorMessage;
    }
    return error instanceof Error ? error.message : String(error);
  }

  return {
    appData,
    appErrorDialog,
    workspaceId,
    installationId,
    technicalErrorMessage,
    confirmWorkspaceImport,
    getImportSuccessMessage,
    getImportErrorMessage,
  };
}
