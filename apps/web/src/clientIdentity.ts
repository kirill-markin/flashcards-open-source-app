import packageMetadata from "../package.json";

export const LEGACY_DEVICE_ID_STORAGE_KEY = "flashcards-sync-device-id";
export const INSTALLATION_ID_STORAGE_KEY = "flashcards-sync-installation-id";

export const webAppVersion = loadWebAppVersion();
export const webAppBuild: string | null = import.meta.env.VITE_APP_BUILD ?? null;

function loadWebAppVersion(): string {
  const packageVersion = packageMetadata.version?.trim() ?? "";
  if (packageVersion === "") {
    throw new Error("Web app version is missing from apps/web/package.json.");
  }

  return packageVersion;
}

function loadStoredInstallationId(): string | null {
  const installationId = window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY);
  if (installationId === null || installationId.trim() === "") {
    return null;
  }

  return installationId;
}

function persistStoredInstallationId(installationId: string): void {
  window.localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, installationId);
}

/**
 * Returns one browser-stable installation id reused across users and workspaces.
 * Legacy per-user and legacy global device ids are collapsed into one global
 * installation identity during the hard cutover.
 */
export function getStableInstallationId(): string {
  const existingInstallationId = loadStoredInstallationId();
  if (existingInstallationId !== null) {
    window.localStorage.removeItem(LEGACY_DEVICE_ID_STORAGE_KEY);
    window.localStorage.removeItem("flashcards-sync-device-ids");
    return existingInstallationId;
  }

  const legacyDeviceId = window.localStorage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY);
  const legacyDeviceMap = window.localStorage.getItem("flashcards-sync-device-ids");
  let migratedInstallationId: string | null = null;

  if (legacyDeviceMap !== null && legacyDeviceMap !== "") {
    const parsedValue = JSON.parse(legacyDeviceMap) as unknown;
    if (typeof parsedValue === "object" && parsedValue !== null && Array.isArray(parsedValue) === false) {
      for (const value of Object.values(parsedValue)) {
        if (typeof value === "string" && value.trim() !== "") {
          migratedInstallationId = value;
          break;
        }
      }
    }
  }

  const nextInstallationId = migratedInstallationId
    ?? (legacyDeviceId !== null && legacyDeviceId !== "" ? legacyDeviceId : crypto.randomUUID().toLowerCase());

  persistStoredInstallationId(nextInstallationId);
  window.localStorage.removeItem(LEGACY_DEVICE_ID_STORAGE_KEY);
  window.localStorage.removeItem("flashcards-sync-device-ids");
  return nextInstallationId;
}
