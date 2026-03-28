import { useEffect, useState, type ReactElement } from "react";
import {
  browserPermissionSettingsGuidance,
  formatBrowserPermissionState,
  queryBrowserPermissionState,
  type BrowserPermissionState,
} from "../access/browserAccess";
import { buildSettingsAccessDetailRoute, settingsNotificationsRoute } from "../routes";
import { SettingsNavigationCard, SettingsShell } from "./SettingsShared";

type BrowserPermissionSnapshot = Readonly<{
  camera: BrowserPermissionState;
  microphone: BrowserPermissionState;
}>;

export function AccessSettingsScreen(): ReactElement {
  const [permissionSnapshot, setPermissionSnapshot] = useState<BrowserPermissionSnapshot>({
    camera: "unsupported",
    microphone: "unsupported",
  });

  useEffect(() => {
    let isCancelled = false;

    async function loadPermissions(): Promise<void> {
      const [camera, microphone] = await Promise.all([
        queryBrowserPermissionState("camera"),
        queryBrowserPermissionState("microphone"),
      ]);
      if (isCancelled) {
        return;
      }

      setPermissionSnapshot({ camera, microphone });
    }

    void loadPermissions();
    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <SettingsShell
      title="Access"
      subtitle="Review which browser permissions the chat and attachments can use on this device."
      activeTab="access"
    >
      <div className="settings-nav-list">
        <SettingsNavigationCard
          title="Notifications"
          description="Review study reminder options for this workspace on the current device."
          value="This device"
          to={settingsNotificationsRoute}
        />
        <SettingsNavigationCard
            title="Photos and files"
            description="Browser file access is granted only when you choose files from the picker."
            value="Per action"
            to={buildSettingsAccessDetailRoute("photos-and-files")}
          />
          <SettingsNavigationCard
            title="Camera"
            description={browserPermissionSettingsGuidance("camera")}
            value={formatBrowserPermissionState(permissionSnapshot.camera)}
            to={buildSettingsAccessDetailRoute("camera")}
          />
          <SettingsNavigationCard
            title="Microphone"
            description={browserPermissionSettingsGuidance("microphone")}
            value={formatBrowserPermissionState(permissionSnapshot.microphone)}
            to={buildSettingsAccessDetailRoute("microphone")}
          />
      </div>
    </SettingsShell>
  );
}
