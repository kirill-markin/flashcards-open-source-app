import { useEffect, useState, type ReactElement } from "react";
import { ApiContractError, loadWorkspaceDeletePreview } from "../../../api";
import { useAppData } from "../../../appData";
import { useI18n } from "../../../i18n";
import { captureApiContractError } from "../../../observability/apiContractObservation";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import type { WorkspaceDeletePreview } from "../../../types";
import { SettingsGroup, SettingsShell } from "../SettingsShared";

export function DeleteCurrentWorkspaceScreen(): ReactElement {
  const {
    activeWorkspace,
    cloudSettings,
    deleteWorkspace,
    isSessionVerified,
    session,
  } = useAppData();
  const { t, formatCount } = useI18n();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const [deletePreview, setDeletePreview] = useState<WorkspaceDeletePreview | null>(null);
  const [deletePreviewErrorMessage, setDeletePreviewErrorMessage] = useState<string>("");
  const [deleteConfirmationValue, setDeleteConfirmationValue] = useState<string>("");
  const [isDeleteSubmitting, setIsDeleteSubmitting] = useState<boolean>(false);
  const isDeleteAvailable = activeWorkspace !== null && isSessionVerified;
  const deleteUnavailableMessage = activeWorkspace === null
    ? t("workspaceOverview.rename.workspaceUnavailable")
    : t("workspaceOverview.rename.restoringSession");
  const isDeleteConfirmationMatched = deletePreview !== null
    && deleteConfirmationValue === deletePreview.confirmationText;

  useEffect(() => {
    if (!isDeleteDialogOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && isDeleteSubmitting === false) {
        closeDeleteDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return (): void => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDeleteDialogOpen, isDeleteSubmitting]);

  function closeDeleteDialog(): void {
    setDeletePreview(null);
    setDeletePreviewErrorMessage("");
    setDeleteConfirmationValue("");
    setIsDeleteDialogOpen(false);
  }

  async function openDeleteDialog(): Promise<void> {
    if (activeWorkspace === null || isSessionVerified === false) {
      return;
    }

    setIsDeleteDialogOpen(true);
    setDeletePreview(null);
    setDeletePreviewErrorMessage("");
    setDeleteConfirmationValue("");

    try {
      const preview = await loadWorkspaceDeletePreview(activeWorkspace.workspaceId);
      setDeletePreview(preview);
    } catch (error) {
      if (error instanceof ApiContractError) {
        captureApiContractError(error, {
          feature: "settings",
          sourceAction: "workspace_delete_preview_load",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace.workspaceId,
          installationId: cloudSettings?.installationId ?? null,
        });
      } else {
        captureAppOperationError(error, {
          feature: "settings",
          operation: "workspace_delete_preview_load",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace.workspaceId,
          installationId: cloudSettings?.installationId ?? null,
          entityId: activeWorkspace.workspaceId,
        });
      }
      setDeletePreviewErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function retryDeletePreview(): Promise<void> {
    if (activeWorkspace === null) {
      setDeletePreviewErrorMessage(t("workspaceOverview.rename.workspaceUnavailable"));
      return;
    }

    setDeletePreview(null);
    setDeletePreviewErrorMessage("");

    try {
      const preview = await loadWorkspaceDeletePreview(activeWorkspace.workspaceId);
      setDeletePreview(preview);
    } catch (error) {
      if (error instanceof ApiContractError) {
        captureApiContractError(error, {
          feature: "settings",
          sourceAction: "workspace_delete_preview_retry",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace.workspaceId,
          installationId: cloudSettings?.installationId ?? null,
        });
      } else {
        captureAppOperationError(error, {
          feature: "settings",
          operation: "workspace_delete_preview_retry",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace.workspaceId,
          installationId: cloudSettings?.installationId ?? null,
          entityId: activeWorkspace.workspaceId,
        });
      }
      setDeletePreviewErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function confirmDeleteWorkspace(): Promise<void> {
    if (activeWorkspace === null || deletePreview === null) {
      return;
    }

    setIsDeleteSubmitting(true);
    setDeletePreviewErrorMessage("");

    try {
      await deleteWorkspace(activeWorkspace.workspaceId, deleteConfirmationValue);
      closeDeleteDialog();
    } catch (error) {
      setDeletePreviewErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDeleteSubmitting(false);
    }
  }

  return (
    <>
      <SettingsShell
        title={t("settingsHome.deleteCurrentWorkspace.title")}
        subtitle={t("settingsHome.deleteCurrentWorkspace.description")}
        activeTab="workspace"
      >
        <SettingsGroup>
          <article className="content-card settings-danger-card">
            <div className="cell-stack">
              <h2 className="panel-subtitle">{t("settingsHome.deleteCurrentWorkspace.title")}</h2>
              <p className="subtitle">
                {isDeleteAvailable
                  ? t("settingsHome.deleteCurrentWorkspace.description")
                  : deleteUnavailableMessage}
              </p>
            </div>
            <div className="screen-actions">
              <button
                className="ghost-btn settings-danger-btn"
                type="button"
                onClick={() => void openDeleteDialog()}
                disabled={isDeleteAvailable === false}
                data-testid="delete-current-workspace-open"
              >
                {t("workspaceOverview.delete.button")}
              </button>
            </div>
          </article>
        </SettingsGroup>
      </SettingsShell>

      {isDeleteDialogOpen ? (
        <section
          className="settings-delete-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-workspace-title"
          data-testid="delete-current-workspace-dialog"
        >
          <div className="panel settings-delete-dialog">
            <div className="cell-stack">
              <h2 id="delete-workspace-title" className="panel-subtitle">{t("workspaceOverview.delete.dialogTitle")}</h2>
              {deletePreviewErrorMessage !== "" ? <p className="error-banner">{deletePreviewErrorMessage}</p> : null}
              {deletePreview === null ? (
                <p className="subtitle">{t("workspaceOverview.delete.loading")}</p>
              ) : (
                <>
                  <p className="error-banner settings-delete-warning">
                    {t("workspaceOverview.delete.warning", {
                      count: formatCount(deletePreview.activeCardCount, {
                        one: t("settingsWorkspace.countLabels.card.one"),
                        other: t("settingsWorkspace.countLabels.card.other"),
                      }),
                      workspaceName: deletePreview.workspaceName,
                    })}
                  </p>
                  {deletePreview.isLastAccessibleWorkspace ? (
                    <p className="subtitle">{t("workspaceOverview.delete.lastWorkspaceHint")}</p>
                  ) : null}
                  <p className="subtitle settings-delete-phrase" aria-label="confirmation phrase">
                    {deletePreview.confirmationText}
                  </p>
                  <label className="cell-stack" htmlFor="delete-workspace-confirmation">
                    <span className="cell-secondary">{t("workspaceOverview.delete.typePhrase")}</span>
                    <input
                      id="delete-workspace-confirmation"
                      className="settings-input"
                      type="text"
                      value={deleteConfirmationValue}
                      autoFocus
                      autoCapitalize="none"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={(event) => {
                        setDeleteConfirmationValue(event.target.value);
                        setDeletePreviewErrorMessage("");
                      }}
                      onPaste={(event) => {
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                      }}
                    />
                  </label>
                </>
              )}
            </div>
            <div className="screen-actions">
              <button className="ghost-btn" type="button" disabled={isDeleteSubmitting} onClick={closeDeleteDialog}>
                {t("common.cancel")}
              </button>
              {deletePreview === null ? (
                <button className="primary-btn" type="button" disabled={isDeleteSubmitting} onClick={() => void retryDeletePreview()}>
                  {t("common.retry")}
                </button>
              ) : (
                <button
                  className="ghost-btn settings-danger-btn"
                  type="button"
                  disabled={!isDeleteConfirmationMatched || isDeleteSubmitting}
                  onClick={() => void confirmDeleteWorkspace()}
                >
                  {isDeleteSubmitting ? t("workspaceOverview.delete.deleting") : t("workspaceOverview.delete.button")}
                </button>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
