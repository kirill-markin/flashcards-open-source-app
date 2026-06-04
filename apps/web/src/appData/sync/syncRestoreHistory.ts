import { webAppVersion } from "../../clientIdentity";
import type { PersistentStorageState } from "../../localDb/sync/cloudSettings";

export const SYNC_RESTORE_HISTORY_STORAGE_KEY = "flashcards-sync-restore-history-v1";

const syncRestoreHistoryVersion = 1;
const maximumSyncRestoreHistoryEntries = 20;

type SyncRestoreHistoryEnvelope = Readonly<{
  version: 1;
  entries: ReadonlyArray<SyncRestoreHistoryEntry>;
}>;

type JsonRecord = Record<string, unknown>;

export type SyncRestoreHistoryEntry = Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
  hydratedAt: string;
  webAppVersion: string;
  lastAppliedHotChangeId: number;
  localCardCount: number;
  persistentStorageCheckedAt: string | null;
  persistentStoragePersisted: boolean | null;
  persistentStorageUsage: number | null;
  persistentStorageQuota: number | null;
  persistentStorageErrorName: string | null;
  persistentStoragePersistAttempted: boolean | null;
  persistentStoragePersistGranted: boolean | null;
}>;

export type SyncRestoreHistoryLookup = Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
}>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readNullableString(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}

function readNullableNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function readNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseSyncRestoreHistoryEntry(value: unknown): SyncRestoreHistoryEntry | null {
  if (isRecord(value) === false) {
    return null;
  }

  if (
    isNonEmptyString(value.userId) === false
    || isNonEmptyString(value.workspaceId) === false
    || isNonEmptyString(value.installationId) === false
    || isNonEmptyString(value.hydratedAt) === false
    || isNonEmptyString(value.webAppVersion) === false
    || isFiniteNumber(value.lastAppliedHotChangeId) === false
    || isFiniteNumber(value.localCardCount) === false
  ) {
    return null;
  }

  return {
    userId: value.userId,
    workspaceId: value.workspaceId,
    installationId: value.installationId,
    hydratedAt: value.hydratedAt,
    webAppVersion: value.webAppVersion,
    lastAppliedHotChangeId: value.lastAppliedHotChangeId,
    localCardCount: value.localCardCount,
    persistentStorageCheckedAt: readNullableString(value.persistentStorageCheckedAt),
    persistentStoragePersisted: readNullableBoolean(value.persistentStoragePersisted),
    persistentStorageUsage: readNullableNumber(value.persistentStorageUsage),
    persistentStorageQuota: readNullableNumber(value.persistentStorageQuota),
    persistentStorageErrorName: readNullableString(value.persistentStorageErrorName),
    persistentStoragePersistAttempted: readNullableBoolean(value.persistentStoragePersistAttempted),
    persistentStoragePersistGranted: readNullableBoolean(value.persistentStoragePersistGranted),
  };
}

function getBrowserStorage(): Storage | null {
  let storageValue: Storage;
  try {
    storageValue = window.localStorage;
  } catch {
    return null;
  }

  if (
    typeof storageValue?.getItem !== "function"
    || typeof storageValue.setItem !== "function"
    || typeof storageValue.removeItem !== "function"
  ) {
    return null;
  }

  return storageValue;
}

function parseSyncRestoreHistoryEnvelope(rawValue: string | null): SyncRestoreHistoryEnvelope {
  if (rawValue === null) {
    return {
      version: syncRestoreHistoryVersion,
      entries: [],
    };
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown;
    if (
      isRecord(parsedValue) === false
      || parsedValue.version !== syncRestoreHistoryVersion
      || Array.isArray(parsedValue.entries) === false
    ) {
      return {
        version: syncRestoreHistoryVersion,
        entries: [],
      };
    }

    const entries = parsedValue.entries
      .map(parseSyncRestoreHistoryEntry)
      .filter((entry): entry is SyncRestoreHistoryEntry => entry !== null);
    return {
      version: syncRestoreHistoryVersion,
      entries,
    };
  } catch {
    return {
      version: syncRestoreHistoryVersion,
      entries: [],
    };
  }
}

function isMatchingSyncRestoreHistoryEntry(
  entry: SyncRestoreHistoryEntry,
  lookup: SyncRestoreHistoryLookup,
): boolean {
  return entry.userId === lookup.userId
    && entry.workspaceId === lookup.workspaceId
    && entry.installationId === lookup.installationId;
}

function loadSyncRestoreHistoryEnvelope(): SyncRestoreHistoryEnvelope {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return {
      version: syncRestoreHistoryVersion,
      entries: [],
    };
  }

  try {
    return parseSyncRestoreHistoryEnvelope(browserStorage.getItem(SYNC_RESTORE_HISTORY_STORAGE_KEY));
  } catch {
    return {
      version: syncRestoreHistoryVersion,
      entries: [],
    };
  }
}

function persistSyncRestoreHistoryEnvelope(envelope: SyncRestoreHistoryEnvelope): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return;
  }

  try {
    browserStorage.setItem(SYNC_RESTORE_HISTORY_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    return;
  }
}

export function loadSyncRestoreHistoryEntry(lookup: SyncRestoreHistoryLookup): SyncRestoreHistoryEntry | null {
  const envelope = loadSyncRestoreHistoryEnvelope();
  return envelope.entries.find((entry) => isMatchingSyncRestoreHistoryEntry(entry, lookup)) ?? null;
}

export function storeSyncRestoreHistoryEntry(
  input: Readonly<{
    userId: string;
    workspaceId: string;
    installationId: string;
    lastAppliedHotChangeId: number;
    localCardCount: number;
    persistentStorageState: PersistentStorageState;
  }>,
): SyncRestoreHistoryEntry {
  const hydratedAt = new Date().toISOString();
  const nextEntry: SyncRestoreHistoryEntry = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
    hydratedAt,
    webAppVersion,
    lastAppliedHotChangeId: input.lastAppliedHotChangeId,
    localCardCount: input.localCardCount,
    persistentStorageCheckedAt: hydratedAt,
    persistentStoragePersisted: input.persistentStorageState.persisted,
    persistentStorageUsage: input.persistentStorageState.usage,
    persistentStorageQuota: input.persistentStorageState.quota,
    persistentStorageErrorName: input.persistentStorageState.errorName,
    persistentStoragePersistAttempted: input.persistentStorageState.persistAttempted,
    persistentStoragePersistGranted: input.persistentStorageState.persistGranted,
  };
  const envelope = loadSyncRestoreHistoryEnvelope();
  const nextEntries = [
    nextEntry,
    ...envelope.entries.filter((entry) => isMatchingSyncRestoreHistoryEntry(entry, nextEntry) === false),
  ].slice(0, maximumSyncRestoreHistoryEntries);

  persistSyncRestoreHistoryEnvelope({
    version: syncRestoreHistoryVersion,
    entries: nextEntries,
  });

  return nextEntry;
}
