import { useEffect, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import {
  settingsDecksRoute,
  settingsExportRoute,
  settingsOverviewRoute,
  settingsSchedulerRoute,
  settingsTagsRoute,
} from "../routes";
import { loadDecksListSnapshot } from "../localDb/decks";
import { loadWorkspaceTagsSummary } from "../localDb/workspace";
import { SettingsGroup, SettingsNavigationCard, SettingsShell } from "./SettingsShared";

export function WorkspaceSettingsScreen(): ReactElement {
  const { activeWorkspace, localReadVersion, refreshLocalData, workspaceSettings } = useAppData();
  const [activeCardCount, setActiveCardCount] = useState<number>(0);
  const [activeDeckCount, setActiveDeckCount] = useState<number>(0);
  const [tagsCount, setTagsCount] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>("");

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
    <SettingsShell
      title="Workspace Settings"
      subtitle="Manage workspace overview, workspace data, study settings, and export."
      activeTab="workspace"
    >
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
            title="Export"
            description="Save all active cards from this workspace as a standard CSV file."
            value="CSV"
            to={settingsExportRoute}
          />
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
