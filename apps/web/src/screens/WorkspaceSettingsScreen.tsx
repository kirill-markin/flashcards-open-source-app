import { useEffect, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
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

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      setErrorMessage("");

      try {
        if (activeWorkspace === null) {
          throw new Error("Workspace is unavailable");
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
  }, [activeWorkspace, localReadVersion]);

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
        title="Workspace Settings"
        subtitle="Manage workspace data, study settings, and device details."
        activeTab="workspace"
      >
        <p className="error-banner">{errorMessage}</p>
        <button className="primary-btn" type="button" onClick={() => void refreshLocalData()}>
          Retry
        </button>
      </SettingsShell>
    );
  }

  return (
    <>
      <SettingsShell
        title="Workspace Settings"
        subtitle="Manage workspace overview, workspace data, study settings, and export."
        activeTab="workspace"
      >
        {appErrorMessage !== "" ? <p className="error-banner">{appErrorMessage}</p> : null}

        <SettingsGroup>
          <div className="settings-nav-list">
            <SettingsNavigationCard
              title="Overview"
              description="Review workspace name, counts, and today stats."
              value={`${activeCardCount} cards`}
              to={settingsOverviewRoute}
            />
          </div>
        </SettingsGroup>

        <SettingsGroup title="Workspace Data">
          <div className="settings-nav-list">
            <SettingsNavigationCard
              title="Decks"
              description="Create, edit, and review reusable study scopes."
              value={`${activeDeckCount} total`}
              to={settingsDecksRoute}
            />
            <SettingsNavigationCard
              title="Tags"
              description="Inspect workspace-wide tag usage and card counts."
              value={`${tagsCount} total`}
              to={settingsTagsRoute}
            />
          </div>
        </SettingsGroup>

        <SettingsGroup title="Settings">
          <div className="settings-nav-list">
            <SettingsNavigationCard
              title="Scheduler"
              description="Review the active scheduler configuration for future reviews."
              value={workspaceSettings === null ? "Unavailable" : workspaceSettings.algorithm.toUpperCase()}
              to={settingsSchedulerRoute}
            />
            <SettingsNavigationCard
              title="Notifications"
              description="Review device-local reminder settings for study notifications on this workspace."
              value="This device"
              to={settingsNotificationsRoute}
            />
            <SettingsNavigationCard
              title="Export"
              description="Save all active cards from this workspace as a standard CSV file."
              value="CSV"
              to={settingsExportRoute}
            />
          </div>
        </SettingsGroup>

        <SettingsGroup title="Danger Zone">
          <div className="settings-nav-list">
            <SettingsActionCard
              title="Reset all progress"
              description="Reset study progress for every active card in this workspace."
              value="Reset"
              onClick={openResetDialog}
              isMuted={isResetAvailable === false}
              disabled={isResetAvailable === false}
            />
          </div>
          {isResetAvailable ? null : (
            <p className="subtitle">
              Reset all progress is available only for linked cloud workspaces.
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
                Reset all progress
              </h2>

              {resetPreview === null ? (
                <>
                  <p className="error-banner settings-delete-warning">
                    Warning! This action is permanent. It will reset progress for every active card in this workspace.
                  </p>
                  {resetErrorMessage !== "" ? <p className="error-banner">{resetErrorMessage}</p> : null}
                  <p className="subtitle">
                    Type this phrase exactly to continue.
                  </p>
                  <p
                    className="subtitle settings-delete-phrase"
                    aria-label="confirmation phrase"
                    data-testid="workspace-reset-progress-confirmation-phrase"
                  >
                    {resetWorkspaceProgressConfirmationText}
                  </p>
                  <label className="cell-stack" htmlFor="reset-workspace-progress-confirmation">
                    <span className="cell-secondary">Confirmation phrase</span>
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
                    Warning! This action is permanent. It will reset progress for {resetPreview.cardsToResetCount} cards in{" "}
                    {resetPreview.workspaceName}.
                  </p>
                  {resetErrorMessage !== "" ? <p className="error-banner">{resetErrorMessage}</p> : null}
                  <p className="subtitle">
                    Press OK to clear the scheduler state and make these cards start over.
                  </p>
                  <p className="subtitle settings-delete-phrase">
                    <span data-testid="workspace-reset-progress-preview-count">{resetPreview.cardsToResetCount}</span>
                    {" cards will be reset."}
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
                Cancel
              </button>
              {resetPreview === null ? (
                <button
                  className="ghost-btn settings-danger-btn"
                  type="button"
                  disabled={isResetConfirmationMatched === false || isResetPreviewLoading || isResetExecuting}
                  onClick={handleResetPrimaryAction}
                >
                  {isResetPreviewLoading ? "Loading..." : "Continue"}
                </button>
              ) : (
                <button
                  className="ghost-btn settings-danger-btn"
                  type="button"
                  disabled={isResetExecuting}
                  onClick={handleResetPrimaryAction}
                >
                  {isResetExecuting ? "Resetting..." : "OK"}
                </button>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
