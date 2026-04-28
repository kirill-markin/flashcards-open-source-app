import { useEffect, useState, type ReactElement } from "react";
import {
  queryBrowserPermissionState,
  type BrowserPermissionState,
} from "../../../access/browserAccess";
import { useI18n } from "../../../i18n";
import { buildSettingsAccessDetailRoute, settingsNotificationsRoute } from "../../../routes";
import { SettingsNavigationCard, SettingsShell } from "../SettingsShared";

type BrowserPermissionSnapshot = Readonly<{
  camera: BrowserPermissionState;
  microphone: BrowserPermissionState;
}>;

function permissionStateKey(state: BrowserPermissionState):
  | "accessSettings.permission.statusDenied"
  | "accessSettings.permission.statusGranted"
  | "accessSettings.permission.statusPrompt"
  | "accessSettings.permission.statusUnsupported" {
  if (state === "granted") {
    return "accessSettings.permission.statusGranted";
  }

  if (state === "prompt") {
    return "accessSettings.permission.statusPrompt";
  }

  if (state === "denied") {
    return "accessSettings.permission.statusDenied";
  }

  return "accessSettings.permission.statusUnsupported";
}

export function AccessSettingsScreen(): ReactElement {
  const { t } = useI18n();
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
      title={t("accessSettings.title")}
      subtitle={t("accessSettings.subtitle")}
      activeTab="access"
    >
      <div className="settings-nav-list">
        <SettingsNavigationCard
          title={t("accessSettings.notifications.title")}
          description={t("accessSettings.notifications.description")}
          value={t("accessSettings.notifications.value")}
          to={settingsNotificationsRoute}
        />
        <SettingsNavigationCard
          title={t("accessSettings.photosAndFiles.title")}
          description={t("accessSettings.photosAndFiles.description")}
          value={t("common.perAction")}
          to={buildSettingsAccessDetailRoute("photos-and-files")}
        />
        <SettingsNavigationCard
          title={t("accessSettings.permission.titleCamera")}
          description={t("accessSettings.permission.guidanceCamera")}
          value={t(permissionStateKey(permissionSnapshot.camera))}
          to={buildSettingsAccessDetailRoute("camera")}
        />
        <SettingsNavigationCard
          title={t("accessSettings.permission.titleMicrophone")}
          description={t("accessSettings.permission.guidanceMicrophone")}
          value={t(permissionStateKey(permissionSnapshot.microphone))}
          to={buildSettingsAccessDetailRoute("microphone")}
        />
      </div>
    </SettingsShell>
  );
}
