import {
  deleteDatabase,
  deleteDatabaseForLocalBrowserDataCleanup,
} from "./database";

export async function clearWebSyncCache(): Promise<void> {
  await deleteDatabase();
}

export async function clearWebSyncCacheForLocalBrowserDataCleanup(
  throwIfIndexedDbOpenRecoveryFailed: () => void,
): Promise<void> {
  try {
    await deleteDatabaseForLocalBrowserDataCleanup(throwIfIndexedDbOpenRecoveryFailed);
    throwIfIndexedDbOpenRecoveryFailed();
  } catch (error) {
    throwIfIndexedDbOpenRecoveryFailed();
    throw error;
  }
}
