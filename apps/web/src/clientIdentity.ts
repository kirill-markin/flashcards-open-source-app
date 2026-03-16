export const LEGACY_DEVICE_ID_STORAGE_KEY = "flashcards-sync-device-id";
export const DEVICE_ID_MAP_STORAGE_KEY = "flashcards-sync-device-ids";

export const webAppVersion = import.meta.env.VITE_APP_VERSION ?? "web-dev";
export const webAppBuild: string | null = import.meta.env.VITE_APP_BUILD ?? null;

type StoredDeviceIdMap = Readonly<Record<string, string>>;

function parseStoredDeviceIdMap(storedValue: string | null): StoredDeviceIdMap {
  if (storedValue === null || storedValue === "") {
    return {};
  }

  const parsedValue = JSON.parse(storedValue) as unknown;
  if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
    throw new Error("Stored sync device ids must be a JSON object");
  }

  const entries = Object.entries(parsedValue);
  for (const [userId, deviceId] of entries) {
    if (typeof userId !== "string" || userId === "" || typeof deviceId !== "string" || deviceId === "") {
      throw new Error("Stored sync device ids must map non-empty user ids to non-empty device ids");
    }
  }

  return Object.fromEntries(entries) as StoredDeviceIdMap;
}

function loadStoredDeviceIdMap(): StoredDeviceIdMap {
  return parseStoredDeviceIdMap(window.localStorage.getItem(DEVICE_ID_MAP_STORAGE_KEY));
}

function persistStoredDeviceIdMap(deviceIdsByUserId: StoredDeviceIdMap): void {
  window.localStorage.setItem(DEVICE_ID_MAP_STORAGE_KEY, JSON.stringify(deviceIdsByUserId));
}

/**
 * Returns a browser-stable sync device id that is scoped to a single user.
 * Legacy global device ids are migrated only into the current user's entry.
 */
export function getStableDeviceIdForUser(userId: string): string {
  if (userId.trim() === "") {
    throw new Error("userId is required");
  }

  const storedDeviceIds = loadStoredDeviceIdMap();
  const existingDeviceId = storedDeviceIds[userId];
  if (typeof existingDeviceId === "string" && existingDeviceId !== "") {
    window.localStorage.removeItem(LEGACY_DEVICE_ID_STORAGE_KEY);
    return existingDeviceId;
  }

  const legacyDeviceId = window.localStorage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY);
  const nextDeviceId = legacyDeviceId !== null && legacyDeviceId !== ""
    ? legacyDeviceId
    : crypto.randomUUID().toLowerCase();
  persistStoredDeviceIdMap({
    ...storedDeviceIds,
    [userId]: nextDeviceId,
  });
  window.localStorage.removeItem(LEGACY_DEVICE_ID_STORAGE_KEY);
  return nextDeviceId;
}
