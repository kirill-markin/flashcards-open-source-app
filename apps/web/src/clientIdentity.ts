import packageMetadata from "../package.json";

export const LEGACY_DEVICE_ID_STORAGE_KEY = "flashcards-sync-device-id";
export const INSTALLATION_ID_STORAGE_KEY = "flashcards-sync-installation-id";
const LEGACY_DEVICE_ID_MAP_STORAGE_KEY = "flashcards-sync-device-ids";

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

function loadLegacyDeviceInstallationId(): string | null {
  const legacyDeviceId = window.localStorage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY);
  if (legacyDeviceId === null || legacyDeviceId.trim() === "") {
    return null;
  }

  return legacyDeviceId;
}

function loadLegacyMappedInstallationId(): string | null {
  const legacyDeviceMap = window.localStorage.getItem(LEGACY_DEVICE_ID_MAP_STORAGE_KEY);
  if (legacyDeviceMap === null || legacyDeviceMap.trim() === "") {
    return null;
  }

  const parsedValue = JSON.parse(legacyDeviceMap) as unknown;
  if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
    return null;
  }

  for (const value of Object.values(parsedValue)) {
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return null;
}

function clearLegacyInstallationStorage(): void {
  // Legacy installation keys remain only for cleanup after the hard cutover.
  window.localStorage.removeItem(LEGACY_DEVICE_ID_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_DEVICE_ID_MAP_STORAGE_KEY);
}

/**
 * Returns one browser-stable installation id reused across users and workspaces.
 * Only the dedicated installation storage key is a valid source of truth.
 * Legacy per-user and device-scoped keys are no longer read for migration;
 * they are deleted only as cleanup from the retired storage layout.
 */
export function getStableInstallationId(): string {
  const existingInstallationId = loadStoredInstallationId();
  if (existingInstallationId !== null) {
    clearLegacyInstallationStorage();
    return existingInstallationId;
  }

  const nextInstallationId = loadLegacyMappedInstallationId()
    ?? loadLegacyDeviceInstallationId()
    ?? crypto.randomUUID().toLowerCase();
  persistStoredInstallationId(nextInstallationId);
  clearLegacyInstallationStorage();
  return nextInstallationId;
}
