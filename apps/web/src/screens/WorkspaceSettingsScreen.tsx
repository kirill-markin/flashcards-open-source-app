import { useEffect, type ReactElement } from "react";
import { makeWorkspaceTagsSummary } from "../appData/domain";
import { useAppData } from "../appData";
import {
  settingsDecksRoute,
  settingsDeviceRoute,
  settingsOverviewRoute,
  settingsSchedulerRoute,
  settingsTagsRoute,
} from "../routes";
import { SettingsNavigationCard, SettingsShell } from "./SettingsShared";

export function WorkspaceSettingsScreen(): ReactElement {
  const {
    cards,
    decks,
    ensureCardsLoaded,
    ensureDecksLoaded,
    workspaceSettings,
  } = useAppData();

  useEffect(() => {
    void ensureCardsLoaded();
    void ensureDecksLoaded();
  }, [ensureCardsLoaded, ensureDecksLoaded]);

  const activeCardCount = cards.filter((card) => card.deletedAt === null).length;
  const activeDeckCount = decks.filter((deck) => deck.deletedAt === null).length;
  const tagsCount = makeWorkspaceTagsSummary(cards).tags.length;

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
