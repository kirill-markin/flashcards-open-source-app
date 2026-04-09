import type { ReactElement } from "react";
import { useAppData } from "../appData";
import { useI18n } from "../i18n";
import {
  accountSettingsRoute,
  settingsAccessRoute,
  settingsCurrentWorkspaceRoute,
  settingsDeviceRoute,
  workspaceSettingsRoute,
} from "../routes";
import { useTransientMessage } from "../useTransientMessage";
import { isWorkspaceManagementLocked } from "../workspaceManagement";
import {
  SettingsActionCard,
  SettingsGroup,
  SettingsNavigationCard,
  SettingsShell,
} from "./SettingsShared";

export function SettingsScreen(): ReactElement {
  const {
    activeWorkspace,
    cloudSettings,
    isSessionVerified,
  } = useAppData();
  const { t } = useI18n();
  const { message, showMessage } = useTransientMessage(3000);
  const isWorkspaceLocked = isWorkspaceManagementLocked(isSessionVerified, cloudSettings);
  const currentWorkspaceName = activeWorkspace?.name ?? t("common.unavailable");
  const workspaceManagementLockedMessage = t("workspaceManagement.lockedMessage");

  return (
    <SettingsShell
      title={t("settingsHome.title")}
      subtitle={t("settingsHome.subtitle")}
      activeTab="general"
    >
      {message === "" ? null : <p className="settings-temporary-banner" role="status">{message}</p>}

      <SettingsGroup>
        <div className="settings-nav-list">
          {isWorkspaceLocked ? (
            <SettingsActionCard
              title={t("settingsHome.currentWorkspace.title")}
              description={t("settingsHome.currentWorkspace.description")}
              value={currentWorkspaceName}
              onClick={() => showMessage(workspaceManagementLockedMessage)}
              isMuted
            />
          ) : (
            <SettingsNavigationCard
              title={t("settingsHome.currentWorkspace.title")}
              description={t("settingsHome.currentWorkspace.description")}
              value={currentWorkspaceName}
              to={settingsCurrentWorkspaceRoute}
            />
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title={t("settingsHome.workspaceSettings.title")}
            description={t("settingsHome.workspaceSettings.description")}
            value={t("settingsHome.workspaceSettings.value")}
            to={workspaceSettingsRoute}
          />
          <SettingsNavigationCard
            title={t("settingsHome.accountSettings.title")}
            description={t("settingsHome.accountSettings.description")}
            value={t("settingsHome.accountSettings.value")}
            to={accountSettingsRoute}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="settings-inline-nav-list">
          <SettingsNavigationCard
            title={t("settingsHome.device.title")}
            description={t("settingsHome.device.description")}
            value={t("settingsHome.device.value")}
            to={settingsDeviceRoute}
          />
          <SettingsNavigationCard
            title={t("settingsHome.access.title")}
            description={t("settingsHome.access.description")}
            value={t("settingsHome.access.value")}
            to={settingsAccessRoute}
          />
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
