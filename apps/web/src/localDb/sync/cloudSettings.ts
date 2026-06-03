import type { CloudSettings } from "../../types";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  CloudSettingsRecord,
  getFromStore,
  runReadwrite,
} from "../core/database";

export type PersistentStorageState = Readonly<{
  persisted: boolean | null;
  quota: number | null;
  usage: number | null;
  errorName: string | null;
}>;

function createPersistentStorageState(
  persisted: boolean | null,
  quota: number | null,
  usage: number | null,
  errorName: string | null,
): PersistentStorageState {
  return {
    persisted,
    quota,
    usage,
    errorName,
  };
}

function readNamedErrorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null || "name" in error === false) {
    return null;
  }

  const errorName = (error as Readonly<{ name: unknown }>).name;
  return typeof errorName === "string" && errorName.trim() !== "" ? errorName : null;
}

function getStorageErrorName(error: unknown): string {
  return readNamedErrorName(error) ?? "Error";
}

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
    return createPersistentStorageState(null, null, null, null);
  }

  let persisted: boolean | null = null;
  let quota: number | null = null;
  let usage: number | null = null;
  try {
    persisted = typeof storageManager.persisted === "function"
      ? await storageManager.persisted()
      : null;
    if (persisted === false && typeof storageManager.persist === "function") {
      await storageManager.persist();
    }

    return await readPersistentStorageState();
  } catch (error) {
    return createPersistentStorageState(persisted, quota, usage, getStorageErrorName(error));
  }
}

export async function readPersistentStorageState(): Promise<PersistentStorageState> {
  const storageManager = navigator.storage;
  if (storageManager === undefined) {
    return createPersistentStorageState(null, null, null, null);
  }

  let persisted: boolean | null = null;
  let quota: number | null = null;
  let usage: number | null = null;
  try {
    persisted = typeof storageManager.persisted === "function"
      ? await storageManager.persisted()
      : null;
    const estimate = typeof storageManager.estimate === "function"
      ? await storageManager.estimate()
      : null;
    quota = estimate?.quota ?? null;
    usage = estimate?.usage ?? null;
  } catch (error) {
    return createPersistentStorageState(persisted, quota, usage, getStorageErrorName(error));
  }

  return createPersistentStorageState(persisted, quota, usage, null);
}
