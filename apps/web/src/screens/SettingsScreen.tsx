import type { ReactElement } from "react";
import { accountSettingsRoute, workspaceSettingsRoute } from "../routes";
import { SettingsNavigationCard, SettingsShell } from "./SettingsShared";

export function SettingsScreen(): ReactElement {
  return (
    <SettingsShell
      title="Settings"
      subtitle="Choose which settings area you want to manage."
      activeSection={null}
    >
      <div className="settings-nav-list">
        <SettingsNavigationCard
          title="Workspace Settings"
          description="Manage workspace overview, scheduler, decks, tags, access, and device details."
          value="6 sections"
          to={workspaceSettingsRoute}
        />
        <SettingsNavigationCard
          title="Account Settings"
          description="Manage account status, agent connections, and the danger zone."
          value="3 sections"
          to={accountSettingsRoute}
        />
      </div>
    </SettingsShell>
  );
}
