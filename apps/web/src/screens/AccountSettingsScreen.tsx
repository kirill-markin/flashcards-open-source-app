import { useAppData } from "../appData";
import {
  accountAgentConnectionsRoute,
  accountDangerZoneRoute,
  accountLegalSupportRoute,
  accountOpenSourceRoute,
  accountStatusRoute,
} from "../routes";
import { SettingsGroup, SettingsNavigationCard, SettingsShell } from "./SettingsShared";
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
      subtitle="Manage account state, support, connections, and irreversible actions."
      activeTab="account"
    >
      <SettingsGroup>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title="Account Status"
            description="Review the signed-in account and current browser session state."
            value={accountStatusValue(cloudSettings?.linkedEmail ?? session?.profile.email ?? null)}
            to={accountStatusRoute}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Support">
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title="Legal & Support"
            description="Review privacy, terms, hosted support links, and support contact details."
            value="Policies"
            to={accountLegalSupportRoute}
          />
          <SettingsNavigationCard
            title="Open Source"
            description="Review the repository, MIT license, and self-hosting links."
            value="GitHub + MIT"
            to={accountOpenSourceRoute}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Connections">
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title="Agent Connections"
            description="Review and revoke long-lived bot connections for this account."
            value="Connections"
            to={accountAgentConnectionsRoute}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title="Danger Zone"
            description="Delete the account and all cloud data."
            value="Delete"
            to={accountDangerZoneRoute}
          />
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
