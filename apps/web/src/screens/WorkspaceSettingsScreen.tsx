import { useEffect, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import {
  settingsDecksRoute,
  settingsDeviceRoute,
  settingsOverviewRoute,
  settingsSchedulerRoute,
  settingsTagsRoute,
} from "../routes";
import { loadDecksListSnapshot } from "../localDb/decks";
import { loadWorkspaceTagsSummary } from "../localDb/workspace";
import { SettingsNavigationCard, SettingsShell } from "./SettingsShared";

export function WorkspaceSettingsScreen(): ReactElement {
  const { localReadVersion, refreshLocalData, workspaceSettings } = useAppData();
  const [activeCardCount, setActiveCardCount] = useState<number>(0);
  const [activeDeckCount, setActiveDeckCount] = useState<number>(0);
  const [tagsCount, setTagsCount] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      setErrorMessage("");

      try {
        const [tagsSummary, decksSnapshot] = await Promise.all([
          loadWorkspaceTagsSummary(),
          loadDecksListSnapshot(),
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
  }, [localReadVersion]);

  if (errorMessage !== "") {
    return (
      <SettingsShell
        title="Workspace Settings"
        subtitle="Manage workspace data, study settings, and device details."
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
      title="Workspace Settings"
      subtitle="Manage workspace data, study settings, and device details."
      activeSection="workspace"
    >
      <section className="settings-group">
        <h2 className="panel-subtitle">Workspace Data</h2>
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
      </section>

      <section className="settings-group">
        <h2 className="panel-subtitle">Settings</h2>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title="Overview"
            description="Review workspace name, counts, and today stats."
            value={`${activeCardCount} cards`}
            to={settingsOverviewRoute}
          />
          <SettingsNavigationCard
            title="Scheduler"
            description="Review the active scheduler configuration for future reviews."
            value={workspaceSettings === null ? "Unavailable" : workspaceSettings.algorithm.toUpperCase()}
            to={settingsSchedulerRoute}
          />
        </div>
      </section>

      <section className="settings-group">
        <h2 className="panel-subtitle">Device</h2>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title="This Device"
            description="Review browser, app version, build, and local-storage details for this device."
            value="Technical info"
            to={settingsDeviceRoute}
          />
        </div>
      </section>
    </SettingsShell>
  );
}
