import type { ReactElement } from "react";
import { useAppData } from "../../../appData";
import { useI18n } from "../../../i18n";
import {
  accountAgentConnectionsRoute,
  accountDangerZoneRoute,
  accountLegalSupportRoute,
  accountOpenSourceRoute,
  accountStatusRoute,
} from "../../../routes";
import { SettingsGroup, SettingsNavigationCard, SettingsShell } from "../SettingsShared";

function accountStatusValue(linkedEmail: string | null, unavailableLabel: string): string {
  if (linkedEmail === null || linkedEmail === "") {
    return unavailableLabel;
  }

  return linkedEmail;
}

export function AccountSettingsScreen(): ReactElement {
  const { cloudSettings, session } = useAppData();
  const { t } = useI18n();

  return (
    <SettingsShell
      title={t("accountSettings.title")}
      subtitle={t("accountSettings.subtitle")}
      activeTab="account"
    >
      <SettingsGroup>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("accountSettings.accountStatus.title")}
            description={t("accountSettings.accountStatus.description")}
            value={accountStatusValue(cloudSettings?.linkedEmail ?? session?.profile.email ?? null, t("common.unavailable"))}
            to={accountStatusRoute}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("accountSettings.supportGroupTitle")}>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("accountSettings.legalSupport.title")}
            description={t("accountSettings.legalSupport.description")}
            value={t("accountSettings.legalSupport.value")}
            to={accountLegalSupportRoute}
          />
          <SettingsNavigationCard
            title={t("accountSettings.openSource.title")}
            description={t("accountSettings.openSource.description")}
            value={t("accountSettings.openSource.value")}
            to={accountOpenSourceRoute}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("accountSettings.connectionsGroupTitle")}>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("accountSettings.agentConnections.title")}
            description={t("accountSettings.agentConnections.description")}
            value={t("accountSettings.agentConnections.value")}
            to={accountAgentConnectionsRoute}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("accountSettings.dangerZone.title")}
            description={t("accountSettings.dangerZone.description")}
            value={t("accountSettings.dangerZone.value")}
            to={accountDangerZoneRoute}
          />
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
