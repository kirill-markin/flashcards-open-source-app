import type {
  Card,
  CloudSettings,
  Deck,
  MediaAsset,
  ReviewEvent,
  WorkspaceSchedulerSettings,
} from "../../types";
import {
  addWebBreadcrumb,
  type IndexedDbOperation,
  type WebObservationScope,
} from "../../observability/webObservability";
import { upgradeDatabase } from "./databaseMigrations";
import { isIndexedDbOpenRecoveryError } from "./indexedDbOpenRecovery";
import { databaseName, databaseVersion } from "./databaseSchema";
import type { DatabaseStores } from "./databaseSchema";

export type { DatabaseStores } from "./databaseSchema";

export type StoredCard = Readonly<{
  workspaceId: string;
  cardId: string;
  frontText: string;
  backText: string;
  cardType: string;
  metadata: Card["metadata"];
  tags: ReadonlyArray<string>;
  dueAt: string | null;
  dueAtMillis: number | null;
  dueAtBucketMillis: number;
  createdAt: string;
  reps: number;
  lapses: number;
  fsrsCardState: Card["fsrsCardState"];
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: string | null;
  fsrsLastReviewedAtMillis: number | null;
  fsrsScheduledDays: number | null;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

export type WorkspaceSettingsRecord = Readonly<{
  workspaceId: string;
  settings: WorkspaceSchedulerSettings;
}>;

export type StoredMediaAsset = MediaAsset;

export type WorkspaceSyncStateRecord = Readonly<{
  workspaceId: string;
  lastAppliedHotChangeId: number;
  lastAppliedReviewSequenceId: number;
  hasHydratedHotState: boolean;
  hasHydratedReviewHistory: boolean;
  hotStateHydratedAt: string | null;
  reviewHistoryHydratedAt: string | null;
  updatedAt: string;
}>;

export type CloudSettingsRecord = Readonly<{
  key: "cloud_settings";
  settings: CloudSettings;
}>;

export type ProgressDailyCountRecord = Readonly<{
  workspaceId: string;
  localDate: string;
  reviewCount: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
}>;

export type ProgressCacheStateRecord = Readonly<{
  key: "progress_cache_state";
  timeZone: string;
  needsRebuild: boolean;
  updatedAt: string;
}>;

export type IndexedDbOpenLifecycleSnapshot = Readonly<{
  observedAt: string;
  databaseName: string;
  databaseVersion: number;
  oldVersion: number | null;
  newVersion: number;
  databaseCreated: boolean;
  databaseUpgraded: boolean;
}>;

const deleteDatabaseBlockedWaitMs = 3000;
const activeDatabaseOperationPromises = new Set<Promise<unknown>>();
let isDatabaseDeleteInProgress = false;
let activeDatabaseDeletePromise: Promise<void> | null = null;
let lastIndexedDbOpenLifecycleSnapshot: IndexedDbOpenLifecycleSnapshot | null = null;
let lastIndexedDbVersionChangeLifecycleSnapshot: IndexedDbOpenLifecycleSnapshot | null = null;

function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

function readNamedErrorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null || "name" in error === false) {
    return null;
  }

  const errorName = (error as Readonly<{ name: unknown }>).name;
  return typeof errorName === "string" && errorName.trim() !== "" ? errorName : null;
}

function getIndexedDbErrorName(error: unknown): string | null {
  return readNamedErrorName(error);
}

export function describeIndexedDbError(prefix: string, error: unknown): Error {
  if (isQuotaExceededError(error)) {
    return new Error(`${prefix}: browser storage quota was exceeded`);
  }

  if (error instanceof Error && error.message !== "") {
    return new Error(`${prefix}: ${error.message}`);
  }

  return new Error(`${prefix}: unknown error`);
}

function attachIndexedDbOperationMetadata(
  error: Error,
  operation: IndexedDbOperation,
  sourceError: unknown,
): Error {
  Object.assign(error, {
    indexedDbOperation: operation,
    databaseName,
    databaseVersion,
    indexedDbErrorName: getIndexedDbErrorName(sourceError),
  });
  return error;
}

function describeIndexedDbOperationError(
  prefix: string,
  error: unknown,
  operation: IndexedDbOperation,
): Error {
  return attachIndexedDbOperationMetadata(describeIndexedDbError(prefix, error), operation, error);
}

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildIndexedDbObservationScope(): WebObservationScope {
  return {
    app: "web",
    feature: "sync",
    userId: null,
    workspaceId: null,
    installationId: null,
    route: getCurrentRoute(),
    requestId: null,
    statusCode: null,
    code: null,
  };
}

function addIndexedDbOperationFailedBreadcrumb(
  operation: IndexedDbOperation,
  sourceError: unknown,
  error: Error,
): void {
  addWebBreadcrumb({
    action: "indexed_db_operation",
    scope: buildIndexedDbObservationScope(),
    details: {
      eventName: "indexed_db_operation_failed",
      indexedDbOperation: operation,
      databaseName,
      databaseVersion,
      indexedDbErrorName: getIndexedDbErrorName(sourceError),
      errorMessage: error.message,
    },
  });
}

export function readLastIndexedDbOpenLifecycleSnapshot(): IndexedDbOpenLifecycleSnapshot | null {
  return lastIndexedDbOpenLifecycleSnapshot;
}

export function readIndexedDbOpenLifecycleSnapshotForDiagnostics(): IndexedDbOpenLifecycleSnapshot | null {
  return lastIndexedDbVersionChangeLifecycleSnapshot ?? lastIndexedDbOpenLifecycleSnapshot;
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    let oldVersionDuringUpgrade: number | null = null;

    request.onerror = () => {
      const error = describeIndexedDbOperationError("Failed to open IndexedDB", request.error, "open");
      if (isIndexedDbOpenRecoveryError(error) === false) {
        addIndexedDbOperationFailedBreadcrumb("open", request.error, error);
      }
      reject(error);
    };

    request.onupgradeneeded = (event) => {
      const oldVersion = event.oldVersion;
      oldVersionDuringUpgrade = oldVersion;
      upgradeDatabase(request.result, oldVersion, request.result.version, request.transaction);
    };

    request.onsuccess = () => {
      // Release the connection as soon as another context requests a database
      // delete or upgrade; otherwise that request stays blocked for as long as
      // this connection lives (other tabs, or a cleanup in this tab).
      request.result.onversionchange = () => {
        request.result.close();
      };

      const indexedDbOpenLifecycleSnapshot: IndexedDbOpenLifecycleSnapshot = {
        observedAt: new Date().toISOString(),
        databaseName,
        databaseVersion,
        oldVersion: oldVersionDuringUpgrade,
        newVersion: request.result.version,
        databaseCreated: oldVersionDuringUpgrade === 0,
        databaseUpgraded: oldVersionDuringUpgrade !== null && oldVersionDuringUpgrade > 0,
      };
      lastIndexedDbOpenLifecycleSnapshot = indexedDbOpenLifecycleSnapshot;

      if (oldVersionDuringUpgrade !== null) {
        lastIndexedDbVersionChangeLifecycleSnapshot = indexedDbOpenLifecycleSnapshot;
        addWebBreadcrumb({
          action: "indexed_db_operation",
          scope: buildIndexedDbObservationScope(),
          details: {
            eventName: "indexed_db_open_lifecycle",
            databaseName,
            databaseVersion,
            indexedDbOldVersion: oldVersionDuringUpgrade,
            indexedDbNewVersion: request.result.version,
            indexedDbDatabaseCreated: indexedDbOpenLifecycleSnapshot.databaseCreated,
            indexedDbDatabaseUpgraded: indexedDbOpenLifecycleSnapshot.databaseUpgraded,
          },
        });
      }

      resolve(request.result);
    };
  });
}

function trackDatabaseOperation<ResultType>(
  createOperationTask: () => Promise<ResultType>,
): Promise<ResultType> {
  if (isDatabaseDeleteInProgress) {
    throw new Error("IndexedDB is unavailable while browser data is being reset");
  }

  const operationTask: Promise<ResultType> = Promise.resolve().then(createOperationTask);
  const trackedOperationTask = operationTask.finally(() => {
    activeDatabaseOperationPromises.delete(trackedOperationTask);
  });
  activeDatabaseOperationPromises.add(trackedOperationTask);
  return trackedOperationTask;
}

export function runReadonly<RequestResult>(
  database: IDBDatabase,
  storeName: DatabaseStores,
  callback: (store: IDBObjectStore) => IDBRequest<RequestResult>,
): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = callback(store);

    request.onerror = () => {
      reject(describeIndexedDbError("IndexedDB readonly request failed", request.error));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

export function runReadwrite<RequestResult>(
  database: IDBDatabase,
  storeNames: ReadonlyArray<DatabaseStores>,
  callback: (transaction: IDBTransaction) => IDBRequest<RequestResult> | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([...storeNames], "readwrite");
    const request = callback(transaction);

    if (request !== null) {
      request.onerror = () => {
        reject(describeIndexedDbError("IndexedDB write request failed", request.error));
      };
    }

    transaction.onerror = () => {
      reject(describeIndexedDbError("IndexedDB transaction failed", transaction.error));
    };

    transaction.oncomplete = () => {
      resolve();
    };
  });
}

export async function getAllFromStore<RecordType>(
  database: IDBDatabase,
  storeName: DatabaseStores,
): Promise<ReadonlyArray<RecordType>> {
  return runReadonly(database, storeName, (store) => store.getAll()) as Promise<ReadonlyArray<RecordType>>;
}

export async function getFromStore<RecordType>(
  database: IDBDatabase,
  storeName: DatabaseStores,
  key: IDBValidKey,
): Promise<RecordType | undefined> {
  const result = await runReadonly(database, storeName, (store) => store.get(key)) as RecordType | undefined;
  return result;
}

export async function closeDatabaseAfter<ResultType>(
  callback: (database: IDBDatabase) => Promise<ResultType>,
): Promise<ResultType> {
  return trackDatabaseOperation(async () => {
    const database = await openDatabase();
    try {
      return await callback(database);
    } finally {
      database.close();
    }
  });
}

export async function closeDatabaseAfterWrite(
  callback: (database: IDBDatabase) => Promise<void>,
): Promise<void> {
  await trackDatabaseOperation(async () => {
    const database = await openDatabase();
    try {
      await callback(database);
    } finally {
      database.close();
    }
  });
}

function clearAllObjectStores(database: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const storeNames = [...database.objectStoreNames];
    if (storeNames.length === 0) {
      resolve();
      return;
    }

    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(storeNames, "readwrite");
      for (const storeName of storeNames) {
        transaction.objectStore(storeName).clear();
      }
    } catch (error) {
      // transaction() and clear() throw synchronously when the connection was
      // closed concurrently (e.g. by the versionchange auto-close).
      const wrappedError = describeIndexedDbOperationError("Failed to clear IndexedDB stores", error, "clear");
      addIndexedDbOperationFailedBreadcrumb("clear", error, wrappedError);
      reject(wrappedError);
      return;
    }

    // Every failure path ends in `abort`: failed clear requests abort the
    // transaction, and forced closes or commit-time quota errors fire only
    // `abort`. Rejecting there (not in `error`) matters because
    // `transaction.error` is populated only once `abort` fires.
    transaction.onabort = () => {
      const error = describeIndexedDbOperationError("Failed to clear IndexedDB stores", transaction.error, "clear");
      addIndexedDbOperationFailedBreadcrumb("clear", transaction.error, error);
      reject(error);
    };

    transaction.oncomplete = () => {
      resolve();
    };
  });
}

async function wipeAllObjectStores(
  throwIfIndexedDbOpenRecoveryFailed: () => void,
): Promise<void> {
  const database = await openDatabase();
  try {
    throwIfIndexedDbOpenRecoveryFailed();
    await clearAllObjectStores(database);
    throwIfIndexedDbOpenRecoveryFailed();
  } catch (error) {
    throwIfIndexedDbOpenRecoveryFailed();
    throw error;
  } finally {
    database.close();
  }
}

async function databaseExists(
  throwIfIndexedDbOpenRecoveryFailed: () => void,
): Promise<boolean> {
  if (typeof indexedDB.databases !== "function") {
    // Capability missing in older browsers: assume the database exists; the
    // wipe open below creates it when absent, which is harmless.
    return true;
  }

  try {
    const databases = await indexedDB.databases();
    throwIfIndexedDbOpenRecoveryFailed();
    return databases.some((databaseInfo) => databaseInfo.name === databaseName);
  } catch (error) {
    throwIfIndexedDbOpenRecoveryFailed();
    if (isIndexedDbOpenRecoveryError(error)) {
      throw error;
    }
    // Enumeration failure is non-fatal: proceed with the wipe open, which
    // raises an actionable open error when storage is actually broken.
    console.warn("IndexedDB databases() enumeration failed", {
      databaseName,
      errorName: getIndexedDbErrorName(error),
    });
    return true;
  }
}

type DeleteDatabaseOutcome = "deleted" | "blocked_timeout" | "delete_error";

function addIndexedDbDeleteOutcomeBreadcrumb(
  outcome: Exclude<DeleteDatabaseOutcome, "deleted">,
  sourceError: unknown,
): void {
  addWebBreadcrumb({
    action: "indexed_db_operation",
    scope: buildIndexedDbObservationScope(),
    details: {
      eventName: "indexed_db_delete_lifecycle",
      databaseName,
      databaseVersion,
      indexedDbDeleteOutcome: outcome,
      indexedDbErrorName: getIndexedDbErrorName(sourceError),
    },
  });
}

/**
 * Requests full database deletion and reports the outcome instead of throwing.
 *
 * A `blocked` event is informational: the browser keeps the delete queued and
 * completes it once the remaining connections close. Safari also fires
 * `blocked` for connections that are already closing, so treating it as a
 * failure produced unrecoverable cleanup loops. After a bounded wait the
 * promise resolves anyway because user data was already wiped from the stores.
 *
 * On `blocked_timeout` the delete request stays queued in the browser, so the
 * next database open may wait briefly until the blocking connection closes
 * and the queued deletion completes.
 */
function requestDeleteDatabaseBestEffort(): Promise<DeleteDatabaseOutcome> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(databaseName);
    let blockedWaitTimeoutId: number | null = null;
    let isSettled = false;

    const settle = (outcome: DeleteDatabaseOutcome, sourceError: unknown): void => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      if (blockedWaitTimeoutId !== null) {
        window.clearTimeout(blockedWaitTimeoutId);
      }

      if (outcome !== "deleted") {
        addIndexedDbDeleteOutcomeBreadcrumb(outcome, sourceError);
      }

      resolve(outcome);
    };

    request.onsuccess = () => {
      settle("deleted", null);
    };

    request.onerror = () => {
      settle("delete_error", request.error);
    };

    request.onblocked = () => {
      if (isSettled || blockedWaitTimeoutId !== null) {
        return;
      }

      blockedWaitTimeoutId = window.setTimeout(() => {
        settle("blocked_timeout", null);
      }, deleteDatabaseBlockedWaitMs);
    };
  });
}

function ignoreIndexedDbOpenRecoveryFailure(): void {
}

async function waitForDatabaseCleanupPhase<ResultType>(
  phase: Promise<ResultType>,
  throwIfIndexedDbOpenRecoveryFailed: () => void,
): Promise<ResultType> {
  try {
    const result = await phase;
    throwIfIndexedDbOpenRecoveryFailed();
    return result;
  } catch (error) {
    throwIfIndexedDbOpenRecoveryFailed();
    throw error;
  }
}

function throwActiveIndexedDbOpenRecoveryFailure(
  results: ReadonlyArray<PromiseSettledResult<unknown>>,
): void {
  for (const result of results) {
    if (result.status === "rejected" && isIndexedDbOpenRecoveryError(result.reason)) {
      throw result.reason;
    }
  }
}

/**
 * Resets the local database for user-scoped cleanup.
 *
 * Object stores are wiped through a readwrite transaction first because store
 * clearing cannot be blocked by other open connections, then the database file
 * itself is deleted as a best-effort full reset. The cleanup succeeds when
 * either step removed the data; it fails only when the stores could not be
 * wiped and the database was not confirmed deleted.
 */
function startDatabaseDeletion(throwIfIndexedDbOpenRecoveryFailed: () => void): Promise<void> {
  throwIfIndexedDbOpenRecoveryFailed();
  const activeDelete = activeDatabaseDeletePromise;
  if (activeDelete !== null) {
    return waitForDatabaseCleanupPhase(activeDelete, throwIfIndexedDbOpenRecoveryFailed);
  }

  const deleteTask = (async (): Promise<void> => {
    isDatabaseDeleteInProgress = true;
    try {
      const activeOperationResults = await waitForDatabaseCleanupPhase(
        Promise.allSettled([...activeDatabaseOperationPromises]),
        throwIfIndexedDbOpenRecoveryFailed,
      );
      throwActiveIndexedDbOpenRecoveryFailure(activeOperationResults);

      let wipeError: Error | null = null;
      try {
        // A missing database has nothing to wipe; skipping avoids creating
        // the full schema just to delete it on fresh browsers.
        const doesDatabaseExist = await waitForDatabaseCleanupPhase(
          databaseExists(throwIfIndexedDbOpenRecoveryFailed),
          throwIfIndexedDbOpenRecoveryFailed,
        );
        if (doesDatabaseExist) {
          await waitForDatabaseCleanupPhase(
            wipeAllObjectStores(throwIfIndexedDbOpenRecoveryFailed),
            throwIfIndexedDbOpenRecoveryFailed,
          );
        }
      } catch (error) {
        throwIfIndexedDbOpenRecoveryFailed();
        if (isIndexedDbOpenRecoveryError(error)) {
          throw error;
        }
        wipeError = error instanceof Error ? error : new Error(String(error));
      }

      throwIfIndexedDbOpenRecoveryFailed();
      const deleteOutcome = await waitForDatabaseCleanupPhase(
        requestDeleteDatabaseBestEffort(),
        throwIfIndexedDbOpenRecoveryFailed,
      );
      if (wipeError !== null && deleteOutcome !== "deleted") {
        throw wipeError;
      }
    } finally {
      activeDatabaseDeletePromise = null;
      isDatabaseDeleteInProgress = false;
    }
  })();
  activeDatabaseDeletePromise = deleteTask;
  return deleteTask;
}

export function deleteDatabase(): Promise<void> {
  return startDatabaseDeletion(ignoreIndexedDbOpenRecoveryFailure);
}

export function deleteDatabaseForLocalBrowserDataCleanup(
  throwIfIndexedDbOpenRecoveryFailed: () => void,
): Promise<void> {
  return startDatabaseDeletion(throwIfIndexedDbOpenRecoveryFailed);
}

export type StoredEntity = StoredCard | Deck | ReviewEvent | ProgressDailyCountRecord;
