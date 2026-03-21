import type { ReactElement } from "react";
import { useAppData } from "../appData";
import {
  accountSettingsRoute,
  settingsAccessRoute,
  settingsCurrentWorkspaceRoute,
  settingsDeviceRoute,
  workspaceSettingsRoute,
} from "../routes";
import { useTransientMessage } from "../useTransientMessage";
import { isWorkspaceManagementLocked, workspaceManagementLockedBannerMessage } from "../workspaceManagement";
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
  const { message, showMessage } = useTransientMessage(3000);
  const isWorkspaceLocked = isWorkspaceManagementLocked(isSessionVerified, cloudSettings);
  const currentWorkspaceName = activeWorkspace?.name ?? "Unavailable";

  return (
    <SettingsShell
      title="Settings"
      subtitle="Manage the current workspace, account, this device, and browser access."
      activeSection={null}
    >
      {message === "" ? null : <p className="settings-temporary-banner" role="status">{message}</p>}

      <SettingsGroup>
        <div className="settings-nav-list">
          {isWorkspaceLocked ? (
            <SettingsActionCard
              title="Current Workspace"
              description="Change the active workspace or create a new workspace for this account."
              value={currentWorkspaceName}
              onClick={() => showMessage(workspaceManagementLockedBannerMessage)}
              isMuted
            />
          ) : (
            <SettingsNavigationCard
              title="Current Workspace"
              description="Change the active workspace or create a new workspace for this account."
              value={currentWorkspaceName}
              to={settingsCurrentWorkspaceRoute}
            />
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="settings-nav-list">
          <SettingsNavigationCard
            title="Workspace Settings"
            description="Review overview, workspace data, scheduler settings, and export."
            value="Workspace"
            to={workspaceSettingsRoute}
          />
          <SettingsNavigationCard
            title="Account Settings"
            description="Review account status, support, connections, and danger-zone actions."
            value="Account"
            to={accountSettingsRoute}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div className="settings-inline-nav-list">
          <SettingsNavigationCard
            title="This Device"
            description="Review browser, build, storage, and device-local workspace details."
            value="Device"
            to={settingsDeviceRoute}
          />
          <SettingsNavigationCard
            title="Access"
            description="Review browser permissions for files, camera, and microphone."
            value="Permissions"
            to={settingsAccessRoute}
          />
        </div>
      </SettingsGroup>
    </SettingsShell>
  );
}
