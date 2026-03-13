import type { ReactElement } from "react";
import { accountSettingsRoute, settingsAccessRoute, workspaceSettingsRoute } from "../routes";
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
          description="Manage workspace data, overview, scheduler, and device details."
          value="3 groups"
          to={workspaceSettingsRoute}
        />
        <SettingsNavigationCard
          title="Account Settings"
          description="Manage account status, agent connections, and the danger zone."
          value="3 sections"
          to={accountSettingsRoute}
        />
        <SettingsNavigationCard
          title="Access"
          description="Review app-wide permissions for camera, microphone, and file flows."
          value="3 items"
          to={settingsAccessRoute}
        />
      </div>
    </SettingsShell>
  );
}
