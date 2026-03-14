import { useEffect, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import { loadWorkspaceOverviewSnapshot } from "../syncStorage";
import type { WorkspaceOverviewSnapshot } from "../types";
import { SettingsShell } from "./SettingsShared";

const emptyOverviewSnapshot: WorkspaceOverviewSnapshot = {
  workspaceName: "Workspace unavailable",
  deckCount: 0,
  tagsCount: 0,
  totalCards: 0,
  dueCount: 0,
  newCount: 0,
  reviewedCount: 0,
};

export function WorkspaceOverviewScreen(): ReactElement {
  const { activeWorkspace, localReadVersion, refreshLocalData } = useAppData();
  const [overviewSnapshot, setOverviewSnapshot] = useState<WorkspaceOverviewSnapshot>(emptyOverviewSnapshot);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      if (activeWorkspace === null) {
        setOverviewSnapshot(emptyOverviewSnapshot);
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
  }, [activeWorkspace, localReadVersion]);

  if (isLoading) {
    return (
      <SettingsShell
        title="Overview"
        subtitle="Review workspace details and today counts."
        activeSection="workspace"
      >
        <p className="subtitle">Loading workspace overview…</p>
      </SettingsShell>
    );
  }

  if (errorMessage !== "") {
    return (
      <SettingsShell
        title="Overview"
        subtitle="Review workspace details and today counts."
        activeSection="workspace"
      >
        <p className="error-banner">{errorMessage}</p>
        <button className="primary-btn" type="button" onClick={() => void refreshLocalData()}>
          Retry
        </button>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell
      title="Overview"
      subtitle="Review workspace details and today counts."
      activeSection="workspace"
    >
      <div className="settings-summary-grid">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Workspace</span>
          <strong className="panel-subtitle">{overviewSnapshot.workspaceName}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Cards</span>
          <strong className="panel-subtitle">{overviewSnapshot.totalCards}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Decks</span>
          <strong className="panel-subtitle">{overviewSnapshot.deckCount}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Tags</span>
          <strong className="panel-subtitle">{overviewSnapshot.tagsCount}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Due</span>
          <strong className="panel-subtitle">{overviewSnapshot.dueCount}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">New</span>
          <strong className="panel-subtitle">{overviewSnapshot.newCount}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Reviewed</span>
          <strong className="panel-subtitle">{overviewSnapshot.reviewedCount}</strong>
        </article>
      </div>
    </SettingsShell>
  );
}
