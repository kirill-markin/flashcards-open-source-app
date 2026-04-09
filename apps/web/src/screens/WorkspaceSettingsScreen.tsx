import { useEffect, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import { useI18n } from "../i18n";
import { resetWorkspaceProgressConfirmationText, type WorkspaceResetProgressPreview } from "../types";
import {
  settingsDecksRoute,
  settingsExportRoute,
  settingsNotificationsRoute,
  settingsOverviewRoute,
  settingsSchedulerRoute,
  settingsTagsRoute,
} from "../routes";
import { loadDecksListSnapshot } from "../localDb/decks";
import { loadWorkspaceTagsSummary } from "../localDb/workspace";
import { SettingsActionCard, SettingsGroup, SettingsNavigationCard, SettingsShell } from "./SettingsShared";

export function WorkspaceSettingsScreen(): ReactElement {
  const {
    activeWorkspace,
    cloudSettings,
    errorMessage: appErrorMessage,
    isSessionVerified,
    localReadVersion,
    loadWorkspaceResetProgressPreview,
    setErrorMessage: setAppErrorMessage,
    refreshLocalData,
    resetWorkspaceProgress,
    workspaceSettings,
  } = useAppData();
  const { t, formatCount } = useI18n();
  const [activeCardCount, setActiveCardCount] = useState<number>(0);
  const [activeDeckCount, setActiveDeckCount] = useState<number>(0);
  const [tagsCount, setTagsCount] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isResetDialogOpen, setIsResetDialogOpen] = useState<boolean>(false);
  const [resetConfirmationValue, setResetConfirmationValue] = useState<string>("");
  const [resetPreview, setResetPreview] = useState<WorkspaceResetProgressPreview | null>(null);
  const [resetErrorMessage, setResetErrorMessage] = useState<string>("");
  const [isResetPreviewLoading, setIsResetPreviewLoading] = useState<boolean>(false);
  const [isResetExecuting, setIsResetExecuting] = useState<boolean>(false);

  const isResetAvailable = isSessionVerified
    && cloudSettings?.cloudState === "linked"
    && activeWorkspace !== null;
  const isResetConfirmationMatched = resetConfirmationValue === resetWorkspaceProgressConfirmationText;
  const workspaceUnavailableMessage = t("workspaceOverview.workspaceUnavailable");
  const cardCountLabel = formatCount(activeCardCount, {
    one: t("settingsWorkspace.countLabels.card.one"),
    other: t("settingsWorkspace.countLabels.card.other"),
  });
  const deckCountLabel = formatCount(activeDeckCount, {
    one: t("settingsWorkspace.countLabels.deck.one"),
    other: t("settingsWorkspace.countLabels.deck.other"),
  });
  const tagCountLabel = formatCount(tagsCount, {
    one: t("settingsWorkspace.countLabels.tag.one"),
    other: t("settingsWorkspace.countLabels.tag.other"),
  });

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      setErrorMessage("");

      try {
        if (activeWorkspace === null) {
          throw new Error(workspaceUnavailableMessage);
        }

        const [tagsSummary, decksSnapshot] = await Promise.all([
          loadWorkspaceTagsSummary(activeWorkspace.workspaceId),
          loadDecksListSnapshot(activeWorkspace.workspaceId),
        ]);
        if (isCancelled) {
          return;
        }

        setActiveCardCount(tagsSummary.totalCards);
        setActiveDeckCount(decksSnapshot.deckSummaries.length);
        setTagsCount(tagsSummary.tags.length);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    void loadScreenData();

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspace, localReadVersion, workspaceUnavailableMessage]);

  useEffect(() => {
    if (isResetDialogOpen === false) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && isResetPreviewLoading === false && isResetExecuting === false) {
        closeResetDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return (): void => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isResetDialogOpen, isResetExecuting, isResetPreviewLoading]);

  function clearResetDialogState(): void {
    setIsResetDialogOpen(false);
    setResetConfirmationValue("");
    setResetPreview(null);
    setResetErrorMessage("");
    setIsResetPreviewLoading(false);
    setIsResetExecuting(false);
  }

  function closeResetDialog(): void {
    if (isResetPreviewLoading || isResetExecuting) {
      return;
    }

    clearResetDialogState();
  }

  function openResetDialog(): void {
    if (isResetAvailable === false) {
      return;
    }

    setIsResetDialogOpen(true);
    setResetConfirmationValue("");
    setResetPreview(null);
    setResetErrorMessage("");
    setIsResetPreviewLoading(false);
    setIsResetExecuting(false);
  }

  async function loadResetPreview(): Promise<void> {
    if (activeWorkspace === null || isResetAvailable === false) {
      return;
    }

    setIsResetPreviewLoading(true);
    setResetErrorMessage("");

    try {
      const preview = await loadWorkspaceResetProgressPreview(activeWorkspace.workspaceId);
      setResetPreview(preview);
    } catch (error) {
      setResetErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsResetPreviewLoading(false);
    }
  }

  async function executeReset(): Promise<void> {
    if (activeWorkspace === null || resetPreview === null) {
      return;
    }

    setIsResetExecuting(true);
    setResetErrorMessage("");

    try {
      await resetWorkspaceProgress(activeWorkspace.workspaceId, resetConfirmationValue);
      clearResetDialogState();
      void refreshLocalData().catch((error: unknown) => {
        setAppErrorMessage(error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      setResetErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsResetExecuting(false);
    }
  }

  function handleResetPrimaryAction(): void {
    if (resetPreview === null) {
      void loadResetPreview();
      return;
    }

    void executeReset();
  }

  if (errorMessage !== "") {
    return (
      <SettingsShell
        title={t("settingsWorkspace.title")}
        subtitle={t("settingsWorkspace.errorSubtitle")}
        activeTab="workspace"
      >
        <p className="error-banner">{errorMessage}</p>
        <button className="primary-btn" type="button" onClick={() => void refreshLocalData()}>
          {t("common.retry")}
        </button>
      </SettingsShell>
    );
  }

  return (
    <>
      <SettingsShell
        title={t("settingsWorkspace.title")}
        subtitle={t("settingsWorkspace.subtitle")}
        activeTab="workspace"
      >
        {appErrorMessage !== "" ? <p className="error-banner">{appErrorMessage}</p> : null}

        <SettingsGroup>
          <div className="settings-nav-list">
            <SettingsNavigationCard
              title={t("settingsWorkspace.overview.title")}
              description={t("settingsWorkspace.overview.description")}
              value={cardCountLabel}
              to={settingsOverviewRoute}
            />
          </div>
        </SettingsGroup>

        <SettingsGroup title={t("settingsWorkspace.workspaceDataGroupTitle")}>
          <div className="settings-nav-list">
            <SettingsNavigationCard
              title={t("settingsWorkspace.decks.title")}
              description={t("settingsWorkspace.decks.description")}
              value={deckCountLabel}
              to={settingsDecksRoute}
            />
            <SettingsNavigationCard
              title={t("settingsWorkspace.tags.title")}
              description={t("settingsWorkspace.tags.description")}
              value={tagCountLabel}
              to={settingsTagsRoute}
            />
          </div>
        </SettingsGroup>

        <SettingsGroup title={t("settingsWorkspace.settingsGroupTitle")}>
          <div className="settings-nav-list">
            <SettingsNavigationCard
              title={t("settingsWorkspace.scheduler.title")}
              description={t("settingsWorkspace.scheduler.description")}
              value={workspaceSettings === null ? t("common.unavailable") : workspaceSettings.algorithm.toUpperCase()}
              to={settingsSchedulerRoute}
            />
            <SettingsNavigationCard
              title={t("settingsWorkspace.notifications.title")}
              description={t("settingsWorkspace.notifications.description")}
              value={t("settingsWorkspace.notifications.value")}
              to={settingsNotificationsRoute}
            />
            <SettingsNavigationCard
              title={t("settingsWorkspace.export.title")}
              description={t("settingsWorkspace.export.description")}
              value={t("settingsWorkspace.export.value")}
              to={settingsExportRoute}
            />
          </div>
        </SettingsGroup>

        <SettingsGroup title={t("settingsWorkspace.dangerZoneGroupTitle")}>
          <div className="settings-nav-list">
            <SettingsActionCard
              title={t("settingsWorkspace.resetProgress.title")}
              description={t("settingsWorkspace.resetProgress.description")}
              value={t("settingsWorkspace.resetProgress.value")}
              onClick={openResetDialog}
              isMuted={isResetAvailable === false}
              disabled={isResetAvailable === false}
            />
          </div>
          {isResetAvailable ? null : (
            <p className="subtitle">
              {t("settingsWorkspace.resetProgress.availabilityHint")}
            </p>
          )}
        </SettingsGroup>
      </SettingsShell>

      {isResetDialogOpen ? (
        <section
          className="settings-delete-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-workspace-progress-title"
        >
          <div className="panel settings-delete-dialog">
            <div className="cell-stack">
              <h2 id="reset-workspace-progress-title" className="panel-subtitle">
                {t("settingsWorkspace.resetProgress.dialogTitle")}
              </h2>

              {resetPreview === null ? (
                <>
                  <p className="error-banner settings-delete-warning">
                    {t("settingsWorkspace.resetProgress.initialWarning")}
                  </p>
                  {resetErrorMessage !== "" ? <p className="error-banner">{resetErrorMessage}</p> : null}
                  <p className="subtitle">{t("settingsWorkspace.resetProgress.initialHelp")}</p>
                  <p
                    className="subtitle settings-delete-phrase"
                    aria-label="confirmation phrase"
                    data-testid="workspace-reset-progress-confirmation-phrase"
                  >
                    {resetWorkspaceProgressConfirmationText}
                  </p>
                  <label className="cell-stack" htmlFor="reset-workspace-progress-confirmation">
                    <span className="cell-secondary">{t("settingsWorkspace.resetProgress.phraseLabel")}</span>
                    <input
                      id="reset-workspace-progress-confirmation"
                      className="settings-input"
                      type="text"
                      value={resetConfirmationValue}
                      autoFocus
                      autoCapitalize="none"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={(event) => {
                        setResetConfirmationValue(event.target.value);
                        setResetErrorMessage("");
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
              ) : (
                <>
                  <p className="error-banner settings-delete-warning">
                    {t("settingsWorkspace.resetProgress.previewWarning", {
                      count: formatCount(resetPreview.cardsToResetCount, {
                        one: t("settingsWorkspace.countLabels.card.one"),
                        other: t("settingsWorkspace.countLabels.card.other"),
                      }),
                      workspaceName: resetPreview.workspaceName,
                    })}
                  </p>
                  {resetErrorMessage !== "" ? <p className="error-banner">{resetErrorMessage}</p> : null}
                  <p className="subtitle">{t("settingsWorkspace.resetProgress.previewHelp")}</p>
                  <p className="subtitle settings-delete-phrase">
                    <span data-testid="workspace-reset-progress-preview-count">
                      {t("settingsWorkspace.resetProgress.previewSummary", {
                        count: formatCount(resetPreview.cardsToResetCount, {
                          one: t("settingsWorkspace.countLabels.card.one"),
                          other: t("settingsWorkspace.countLabels.card.other"),
                        }),
                      })}
                    </span>
                  </p>
                </>
              )}
            </div>

            <div className="screen-actions">
              <button
                className="ghost-btn"
                type="button"
                disabled={isResetPreviewLoading || isResetExecuting}
                onClick={closeResetDialog}
              >
                {t("common.cancel")}
              </button>
              {resetPreview === null ? (
                <button
                  className="ghost-btn settings-danger-btn"
                  type="button"
                  disabled={isResetConfirmationMatched === false || isResetPreviewLoading || isResetExecuting}
                  onClick={handleResetPrimaryAction}
                >
                  {isResetPreviewLoading ? t("common.loading") : t("common.continue")}
                </button>
              ) : (
                <button
                  className="ghost-btn settings-danger-btn"
                  type="button"
                  disabled={isResetExecuting}
                  onClick={handleResetPrimaryAction}
                >
                  {isResetExecuting ? t("settingsWorkspace.resetProgress.resetting") : t("common.ok")}
                </button>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
