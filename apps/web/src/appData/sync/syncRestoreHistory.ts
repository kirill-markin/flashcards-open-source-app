import { webAppVersion } from "../../clientIdentity";

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

function isSyncRestoreHistoryEntry(value: unknown): value is SyncRestoreHistoryEntry {
  return isRecord(value)
    && isNonEmptyString(value.userId)
    && isNonEmptyString(value.workspaceId)
    && isNonEmptyString(value.installationId)
    && isNonEmptyString(value.hydratedAt)
    && isNonEmptyString(value.webAppVersion)
    && isFiniteNumber(value.lastAppliedHotChangeId)
    && isFiniteNumber(value.localCardCount);
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

    const entries = parsedValue.entries.filter(isSyncRestoreHistoryEntry);
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
  }>,
): SyncRestoreHistoryEntry {
  const nextEntry: SyncRestoreHistoryEntry = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
    hydratedAt: new Date().toISOString(),
    webAppVersion,
    lastAppliedHotChangeId: input.lastAppliedHotChangeId,
    localCardCount: input.localCardCount,
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
