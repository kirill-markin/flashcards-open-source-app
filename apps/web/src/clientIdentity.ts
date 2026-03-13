const DEVICE_ID_STORAGE_KEY = "flashcards-sync-device-id";

export const webAppVersion = import.meta.env.VITE_APP_VERSION ?? "web-dev";
export const webAppBuild: string | null = import.meta.env.VITE_APP_BUILD ?? null;

export function getStableDeviceId(): string {
  const existingDeviceId = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existingDeviceId !== null && existingDeviceId !== "") {
    return existingDeviceId;
  }

  const nextDeviceId = crypto.randomUUID().toLowerCase();
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, nextDeviceId);
  return nextDeviceId;
}
