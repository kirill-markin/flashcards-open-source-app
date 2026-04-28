import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { loadWorkspaceDeletePreview } from "../../../api";
import { useAppData } from "../../../appData";
import { useI18n } from "../../../i18n";
import { loadWorkspaceOverviewSnapshot } from "../../../localDb/workspace";
import type { WorkspaceDeletePreview, WorkspaceOverviewSnapshot } from "../../../types";
import { SettingsShell } from "../SettingsShared";

const emptyOverviewSnapshot: WorkspaceOverviewSnapshot = {
  workspaceName: "",
  deckCount: 0,
  tagsCount: 0,
  totalCards: 0,
  dueCount: 0,
  newCount: 0,
  reviewedCount: 0,
};

export function WorkspaceOverviewScreen(): ReactElement {
  const {
    activeWorkspace,
    isSessionVerified,
    localReadVersion,
    refreshLocalData,
    renameWorkspace,
    deleteWorkspace,
  } = useAppData();
  const { t, formatCount, formatNumber } = useI18n();
  const workspaceUnavailableMessage = t("workspaceOverview.workspaceUnavailable");
  const [overviewSnapshot, setOverviewSnapshot] = useState<WorkspaceOverviewSnapshot>(emptyOverviewSnapshot);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [workspaceName, setWorkspaceName] = useState<string>("");
  const [renameErrorMessage, setRenameErrorMessage] = useState<string>("");
  const [isRenameSubmitting, setIsRenameSubmitting] = useState<boolean>(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const [deletePreview, setDeletePreview] = useState<WorkspaceDeletePreview | null>(null);
  const [deletePreviewErrorMessage, setDeletePreviewErrorMessage] = useState<string>("");
  const [deleteConfirmationValue, setDeleteConfirmationValue] = useState<string>("");
  const [isDeleteSubmitting, setIsDeleteSubmitting] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      if (activeWorkspace === null) {
        setOverviewSnapshot({
          ...emptyOverviewSnapshot,
          workspaceName: workspaceUnavailableMessage,
        });
        setWorkspaceName("");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage("");

      try {
        const nextOverviewSnapshot = await loadWorkspaceOverviewSnapshot(activeWorkspace);
        if (isCancelled) {
          return;
        }

        setOverviewSnapshot(nextOverviewSnapshot);
        setWorkspaceName(activeWorkspace.name);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadScreenData();

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspace, localReadVersion, workspaceUnavailableMessage]);

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

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (activeWorkspace === null) {
      setRenameErrorMessage(t("workspaceOverview.rename.workspaceUnavailable"));
      return;
    }

    if (isSessionVerified === false) {
      setRenameErrorMessage(t("workspaceOverview.rename.restoringSession"));
      return;
    }

    const trimmedWorkspaceName = workspaceName.trim();
    if (trimmedWorkspaceName === "") {
      setRenameErrorMessage(t("workspaceOverview.rename.workspaceNameRequired"));
      return;
    }

    setIsRenameSubmitting(true);
    setRenameErrorMessage("");

    try {
      await renameWorkspace(activeWorkspace.workspaceId, trimmedWorkspaceName);
    } catch (error) {
      setRenameErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRenameSubmitting(false);
    }
  }

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

  if (isLoading) {
    return (
      <SettingsShell
        title={t("workspaceOverview.title")}
        subtitle={t("workspaceOverview.subtitle")}
        activeTab="workspace"
      >
        <p className="subtitle">{t("workspaceOverview.loading")}</p>
      </SettingsShell>
    );
  }

  if (errorMessage !== "") {
    return (
      <SettingsShell
        title={t("workspaceOverview.title")}
        subtitle={t("workspaceOverview.subtitle")}
        activeTab="workspace"
      >
        <p className="error-banner">{errorMessage}</p>
        <button className="primary-btn" type="button" onClick={() => void refreshLocalData()}>
          {t("common.retry")}
        </button>
      </SettingsShell>
    );
  }

  const trimmedWorkspaceName = workspaceName.trim();
  const isRenameDisabled = activeWorkspace === null
    || isSessionVerified === false
    || trimmedWorkspaceName === ""
    || trimmedWorkspaceName === activeWorkspace.name
    || isRenameSubmitting;
  const isDeleteConfirmationMatched = deletePreview !== null
    && deleteConfirmationValue === deletePreview.confirmationText;

  return (
    <>
      <SettingsShell
        title={t("workspaceOverview.title")}
        subtitle={t("workspaceOverview.subtitle")}
        activeTab="workspace"
      >
        <section className="settings-group">
          <div className="settings-summary-grid">
            <article className="content-card settings-summary-card">
              <span className="cell-secondary">{t("workspaceOverview.labels.workspace")}</span>
              <strong className="panel-subtitle">{overviewSnapshot.workspaceName}</strong>
            </article>
            <article className="content-card settings-summary-card">
              <span className="cell-secondary">{t("workspaceOverview.labels.cards")}</span>
              <strong className="panel-subtitle">{formatNumber(overviewSnapshot.totalCards)}</strong>
            </article>
            <article className="content-card settings-summary-card">
              <span className="cell-secondary">{t("workspaceOverview.labels.decks")}</span>
              <strong className="panel-subtitle">{formatNumber(overviewSnapshot.deckCount)}</strong>
            </article>
            <article className="content-card settings-summary-card">
              <span className="cell-secondary">{t("workspaceOverview.labels.tags")}</span>
              <strong className="panel-subtitle">{formatNumber(overviewSnapshot.tagsCount)}</strong>
            </article>
            <article className="content-card settings-summary-card">
              <span className="cell-secondary">{t("workspaceOverview.labels.due")}</span>
              <strong className="panel-subtitle">{formatNumber(overviewSnapshot.dueCount)}</strong>
            </article>
            <article className="content-card settings-summary-card">
              <span className="cell-secondary">{t("workspaceOverview.labels.new")}</span>
              <strong className="panel-subtitle">{formatNumber(overviewSnapshot.newCount)}</strong>
            </article>
            <article className="content-card settings-summary-card">
              <span className="cell-secondary">{t("workspaceOverview.labels.reviewed")}</span>
              <strong className="panel-subtitle">{formatNumber(overviewSnapshot.reviewedCount)}</strong>
            </article>
          </div>
        </section>

        <section className="settings-group">
          <article className="content-card settings-overview-card">
            <form className="cell-stack" onSubmit={(event) => void handleRenameSubmit(event)}>
              <div className="cell-stack">
                <h2 className="panel-subtitle">{t("workspaceOverview.rename.title")}</h2>
                <p className="subtitle">{t("workspaceOverview.rename.description")}</p>
              </div>
              <label className="cell-stack" htmlFor="workspace-name">
                <span className="cell-secondary">{t("workspaceOverview.rename.fieldLabel")}</span>
                <input
                  id="workspace-name"
                  className="settings-input"
                  type="text"
                  value={workspaceName}
                  autoComplete="off"
                  onChange={(event) => {
                    setWorkspaceName(event.target.value);
                    setRenameErrorMessage("");
                  }}
                />
              </label>
              {renameErrorMessage !== "" ? <p className="error-banner">{renameErrorMessage}</p> : null}
              {isSessionVerified === false ? <p className="subtitle">{t("loading.restoringSession")}</p> : null}
              <div className="screen-actions">
                <button className="primary-btn" type="submit" disabled={isRenameDisabled}>
                  {isRenameSubmitting ? t("workspaceOverview.rename.saving") : t("workspaceOverview.rename.save")}
                </button>
              </div>
            </form>
          </article>
        </section>

        <section className="settings-group">
          <article className="content-card settings-danger-card">
            <div className="cell-stack">
              <h2 className="panel-subtitle">{t("workspaceOverview.delete.title")}</h2>
              <p className="subtitle">{t("workspaceOverview.delete.description")}</p>
            </div>
            <div className="screen-actions">
              <button
                className="ghost-btn settings-danger-btn"
                type="button"
                onClick={() => void openDeleteDialog()}
                disabled={isSessionVerified === false}
              >
                {t("workspaceOverview.delete.button")}
              </button>
            </div>
          </article>
        </section>
      </SettingsShell>

      {isDeleteDialogOpen ? (
        <section
          className="settings-delete-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-workspace-title"
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
