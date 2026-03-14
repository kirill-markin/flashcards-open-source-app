import { useAppData } from "../appData";
import {
  accountAgentConnectionsRoute,
  accountDangerZoneRoute,
  accountOpenSourceRoute,
  accountStatusRoute,
} from "../routes";
import { SettingsNavigationCard, SettingsShell } from "./SettingsShared";
import type { ReactElement } from "react";

function accountStatusValue(linkedEmail: string | null): string {
  if (linkedEmail === null || linkedEmail === "") {
    return "Unavailable";
  }

  return linkedEmail;
}

export function AccountSettingsScreen(): ReactElement {
  const { cloudSettings, session } = useAppData();

  return (
    <SettingsShell
      title="Account Settings"
      subtitle="Manage account state, agent connections, and irreversible actions."
      activeSection="account"
    >
      <div className="settings-nav-list">
        <SettingsNavigationCard
          title="Account Status"
          description="Review the signed-in account and current browser session state."
          value={accountStatusValue(cloudSettings?.linkedEmail ?? session?.profile.email ?? null)}
          to={accountStatusRoute}
        />
        <SettingsNavigationCard
          title="Open Source"
          description="Review the repository, MIT license, and self-hosting links."
          value="GitHub + MIT"
          to={accountOpenSourceRoute}
        />
        <SettingsNavigationCard
          title="Agent Connections"
          description="Review and revoke long-lived bot connections for this account."
          value="Connections"
          to={accountAgentConnectionsRoute}
        />
        <SettingsNavigationCard
          title="Danger Zone"
          description="Delete the account and all cloud data."
          value="Delete"
          to={accountDangerZoneRoute}
        />
      </div>
    </SettingsShell>
  );
}
