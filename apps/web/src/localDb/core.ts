import type {
  Card,
  CloudSettings,
  Deck,
  ReviewEvent,
  WorkspaceSchedulerSettings,
} from "../types";
import { deriveDueAtBucketMillis, deriveDueAtMillis } from "../appData/dueAt";

export type StoredCard = Readonly<{
  workspaceId: string;
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: Card["effortLevel"];
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
}>;

export type ProgressCacheStateRecord = Readonly<{
  key: "progress_cache_state";
  timeZone: string;
  needsRebuild: boolean;
  updatedAt: string;
}>;

export type DatabaseStores =
  | "cards"
  | "cardTags"
  | "decks"
  | "progressDailyCounts"
  | "reviewEvents"
  | "workspaceSettings"
  | "workspaceSyncState"
  | "outbox"
  | "meta";

const databaseName = "flashcards-web-sync";
const databaseVersion = 12;

type StoredCardDueAtMigrationRecord = Omit<StoredCard, "dueAt" | "dueAtMillis" | "dueAtBucketMillis"> & Readonly<{
  dueAt?: string | null;
  dueAtMillis?: number | null;
  dueAtBucketMillis?: number;
}>;

function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
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

function deleteExistingStore(database: IDBDatabase, storeName: string): void {
  if (database.objectStoreNames.contains(storeName)) {
    database.deleteObjectStore(storeName);
  }
}

function createReviewEventsIndexes(reviewEventsStore: IDBObjectStore): void {
  if (!reviewEventsStore.indexNames.contains("workspaceId_reviewedAtClient_reviewEventId")) {
    reviewEventsStore.createIndex(
      "workspaceId_reviewedAtClient_reviewEventId",
      ["workspaceId", "reviewedAtClient", "reviewEventId"],
      { unique: false },
    );
  }
}

function createCardsUpdatedAtIndexes(cardsStore: IDBObjectStore): void {
  if (!cardsStore.indexNames.contains("workspaceId_updatedAt_cardId")) {
    cardsStore.createIndex("workspaceId_updatedAt_cardId", ["workspaceId", "updatedAt", "cardId"], { unique: false });
  }
  if (!cardsStore.indexNames.contains("workspaceId_effort_updatedAt_cardId")) {
    cardsStore.createIndex("workspaceId_effort_updatedAt_cardId", ["workspaceId", "effortLevel", "updatedAt", "cardId"], { unique: false });
  }
}

function createCardsDueAtMillisIndex(cardsStore: IDBObjectStore): void {
  if (!cardsStore.indexNames.contains("workspaceId_dueAtMillis_cardId")) {
    cardsStore.createIndex("workspaceId_dueAtMillis_cardId", ["workspaceId", "dueAtMillis", "cardId"], { unique: false });
  }
}

function createCardsDueAtBucketMillisIndex(cardsStore: IDBObjectStore): void {
  if (!cardsStore.indexNames.contains("workspaceId_dueAtBucketMillis_cardId")) {
    cardsStore.createIndex("workspaceId_dueAtBucketMillis_cardId", ["workspaceId", "dueAtBucketMillis", "cardId"], { unique: false });
  }
}

function createCardsStore(database: IDBDatabase): void {
  const cardsStore = database.createObjectStore("cards", { keyPath: ["workspaceId", "cardId"] });
  cardsStore.createIndex("workspaceId_createdAt_cardId", ["workspaceId", "createdAt", "cardId"], { unique: false });
  // TODO: Drop this legacy dueAt index after cards-list sorting no longer depends on the boundary string field.
  cardsStore.createIndex("workspaceId_dueAt_cardId", ["workspaceId", "dueAt", "cardId"], { unique: false });
  cardsStore.createIndex("workspaceId_effort_createdAt_cardId", ["workspaceId", "effortLevel", "createdAt", "cardId"], { unique: false });
  createCardsDueAtMillisIndex(cardsStore);
  createCardsDueAtBucketMillisIndex(cardsStore);
  createCardsUpdatedAtIndexes(cardsStore);
}

function createCardTagsStore(database: IDBDatabase): void {
  const cardTagsStore = database.createObjectStore("cardTags", { keyPath: ["workspaceId", "cardId", "tag"] });
  cardTagsStore.createIndex("workspaceId_tag_cardId", ["workspaceId", "tag", "cardId"], { unique: false });
  cardTagsStore.createIndex("workspaceId_cardId_tag", ["workspaceId", "cardId", "tag"], { unique: false });
}

function createDecksStore(database: IDBDatabase): void {
  const decksStore = database.createObjectStore("decks", { keyPath: ["workspaceId", "deckId"] });
  decksStore.createIndex("workspaceId_createdAt_deckId", ["workspaceId", "createdAt", "deckId"], { unique: false });
}

function createReviewEventsStore(database: IDBDatabase): void {
  const reviewEventsStore = database.createObjectStore("reviewEvents", { keyPath: ["workspaceId", "reviewEventId"] });
  createReviewEventsIndexes(reviewEventsStore);
}

function createProgressDailyCountsStore(database: IDBDatabase): void {
  database.createObjectStore("progressDailyCounts", { keyPath: ["workspaceId", "localDate"] });
}

function createWorkspaceSettingsStore(database: IDBDatabase): void {
  database.createObjectStore("workspaceSettings", { keyPath: "workspaceId" });
}

function createWorkspaceSyncStateStore(database: IDBDatabase): void {
  database.createObjectStore("workspaceSyncState", { keyPath: "workspaceId" });
}

function createOutboxStore(database: IDBDatabase): void {
  const outboxStore = database.createObjectStore("outbox", { keyPath: ["workspaceId", "operationId"] });
  outboxStore.createIndex("workspaceId_createdAt", ["workspaceId", "createdAt"], { unique: false });
}

function createMetaStore(database: IDBDatabase): void {
  database.createObjectStore("meta", { keyPath: "key" });
}

function upgradeToVersion4(database: IDBDatabase): void {
  for (const storeName of [
    "cards",
    "cardTags",
    "decks",
    "progressDailyCounts",
    "reviewEvents",
    "workspaceSettings",
    "workspaceSyncState",
    "outbox",
    "meta",
  ]) {
    deleteExistingStore(database, storeName);
  }

  createCardsStore(database);
  createCardTagsStore(database);
  createDecksStore(database);
  createProgressDailyCountsStore(database);
  createReviewEventsStore(database);
  createWorkspaceSettingsStore(database);
  createWorkspaceSyncStateStore(database);
  createOutboxStore(database);
  createMetaStore(database);
}

function upgradeToVersion5(database: IDBDatabase): void {
  deleteExistingStore(database, "workspaceSyncState");
  createWorkspaceSyncStateStore(database);
}

function upgradeToVersion6(database: IDBDatabase): void {
  upgradeToVersion4(database);
}

function upgradeToVersion7(transaction: IDBTransaction): void {
  const cardsStore = transaction.objectStore("cards");
  createCardsUpdatedAtIndexes(cardsStore);
}

function upgradeToVersion8(transaction: IDBTransaction): void {
  const reviewEventsStore = transaction.objectStore("reviewEvents");
  createReviewEventsIndexes(reviewEventsStore);
}

function upgradeToVersion9(database: IDBDatabase): void {
  if (database.objectStoreNames.contains("progressDailyCounts") === false) {
    createProgressDailyCountsStore(database);
  }
}

function normalizeStoredCardDueAtDerivedFields(record: StoredCardDueAtMigrationRecord): StoredCard {
  const dueAt = record.dueAt ?? null;
  return {
    ...record,
    dueAt,
    dueAtMillis: deriveDueAtMillis(dueAt),
    dueAtBucketMillis: deriveDueAtBucketMillis(dueAt),
  };
}

function migrateCardsDueAtDerivedFields(cardsStore: IDBObjectStore, errorPrefix: string): void {
  const request = cardsStore.openCursor();
  request.onerror = () => {
    throw describeIndexedDbError(errorPrefix, request.error);
  };
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }

    cursor.update(normalizeStoredCardDueAtDerivedFields(cursor.value as StoredCardDueAtMigrationRecord));
    cursor.continue();
  };
}

function migrateCardsDueAtMillis(cardsStore: IDBObjectStore): void {
  migrateCardsDueAtDerivedFields(cardsStore, "IndexedDB dueAtMillis migration failed");
}

function upgradeToVersion10(transaction: IDBTransaction): void {
  const cardsStore = transaction.objectStore("cards");
  createCardsDueAtMillisIndex(cardsStore);
  migrateCardsDueAtMillis(cardsStore);
}

function migrateCardsDueAtBucketMillis(cardsStore: IDBObjectStore): void {
  migrateCardsDueAtDerivedFields(cardsStore, "IndexedDB dueAtBucketMillis migration failed");
}

function upgradeToVersion11(transaction: IDBTransaction): void {
  const cardsStore = transaction.objectStore("cards");
  createCardsDueAtBucketMillisIndex(cardsStore);
  migrateCardsDueAtBucketMillis(cardsStore);
}

function upgradeToVersion12(transaction: IDBTransaction): void {
  const cardsStore = transaction.objectStore("cards");
  migrateCardsDueAtDerivedFields(cardsStore, "IndexedDB dueAt sentinel migration failed");
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onerror = () => {
      reject(describeIndexedDbError("Failed to open IndexedDB", request.error));
    };

    request.onupgradeneeded = (event) => {
      const oldVersion = event.oldVersion;

      if (oldVersion < 4) {
        upgradeToVersion4(request.result);
      }

      if (oldVersion < 5) {
        upgradeToVersion5(request.result);
      }

      if (oldVersion < 6) {
        upgradeToVersion6(request.result);
      }

      if (oldVersion < 7) {
        const transaction = request.transaction;
        if (transaction === null) {
          throw new Error("IndexedDB upgrade transaction is unavailable");
        }

        upgradeToVersion7(transaction);
      }

      if (oldVersion < 8) {
        const transaction = request.transaction;
        if (transaction === null) {
          throw new Error("IndexedDB upgrade transaction is unavailable");
        }

        upgradeToVersion8(transaction);
      }

      if (oldVersion < 9) {
        upgradeToVersion9(request.result);
      }

      if (oldVersion < 10) {
        const transaction = request.transaction;
        if (transaction === null) {
          throw new Error("IndexedDB upgrade transaction is unavailable");
        }

        upgradeToVersion10(transaction);
      }

      if (oldVersion < 11) {
        const transaction = request.transaction;
        if (transaction === null) {
          throw new Error("IndexedDB upgrade transaction is unavailable");
        }

        upgradeToVersion11(transaction);
      }

      if (oldVersion < 12) {
        const transaction = request.transaction;
        if (transaction === null) {
          throw new Error("IndexedDB upgrade transaction is unavailable");
        }

        upgradeToVersion12(transaction);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
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
  const database = await openDatabase();
  try {
    return await callback(database);
  } finally {
    database.close();
  }
}

export async function closeDatabaseAfterWrite(
  callback: (database: IDBDatabase) => Promise<void>,
): Promise<void> {
  const database = await openDatabase();
  try {
    await callback(database);
  } finally {
    database.close();
  }
}

export function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);

    request.onerror = () => {
      reject(describeIndexedDbError("Failed to delete IndexedDB", request.error));
    };

    request.onsuccess = () => {
      resolve();
    };

    request.onblocked = () => {
      reject(new Error("Failed to delete IndexedDB: delete request was blocked"));
    };
  });
}

export type StoredEntity = StoredCard | Deck | ReviewEvent | ProgressDailyCountRecord;
