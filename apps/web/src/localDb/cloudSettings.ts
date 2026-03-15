import type { CloudSettings } from "../types";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  CloudSettingsRecord,
  getFromStore,
  runReadwrite,
} from "./core";

export type PersistentStorageState = Readonly<{
  persisted: boolean | null;
  quota: number | null;
  usage: number | null;
}>;

export async function loadCloudSettings(): Promise<CloudSettings | null> {
  const cloudSettingsRecord = await closeDatabaseAfter((database) => getFromStore<CloudSettingsRecord>(database, "meta", "cloud_settings"));
  return cloudSettingsRecord?.settings ?? null;
}

export async function putCloudSettings(settings: CloudSettings): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["meta"], (transaction) => transaction.objectStore("meta").put({
      key: "cloud_settings",
      settings,
    } satisfies CloudSettingsRecord));
  });
}

export async function clearCloudSettings(): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["meta"], (transaction) => transaction.objectStore("meta").delete("cloud_settings"));
  });
}

export async function ensurePersistentStorage(): Promise<PersistentStorageState> {
  const storageManager = navigator.storage;
  if (storageManager === undefined) {
    return {
      persisted: null,
      quota: null,
      usage: null,
    };
  }

  const persistedBefore = typeof storageManager.persisted === "function"
    ? await storageManager.persisted()
    : null;
  if (persistedBefore === false && typeof storageManager.persist === "function") {
    await storageManager.persist();
  }

  const persisted = typeof storageManager.persisted === "function"
    ? await storageManager.persisted()
    : persistedBefore;
  const estimate = typeof storageManager.estimate === "function"
    ? await storageManager.estimate()
    : null;

  return {
    persisted,
    quota: estimate?.quota ?? null,
    usage: estimate?.usage ?? null,
  };
}
