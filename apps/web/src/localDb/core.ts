import type {
  Card,
  CloudSettings,
  Deck,
  ReviewEvent,
  WorkspaceSchedulerSettings,
} from "../types";

export type WorkspaceSettingsRecord = Readonly<{
  id: "workspace";
  settings: WorkspaceSchedulerSettings;
}>;

export type SyncStateRecord = Readonly<{
  key: "sync_state";
  workspaceId: string;
  lastAppliedChangeId: number;
  updatedAt: string;
}>;

export type CloudSettingsRecord = Readonly<{
  key: "cloud_settings";
  settings: CloudSettings;
}>;

export type DatabaseStores =
  | "cards"
  | "cardTags"
  | "decks"
  | "reviewEvents"
  | "workspaceSettings"
  | "outbox"
  | "meta";

const databaseName = "flashcards-web-sync";
const databaseVersion = 3;

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

function ensureCardsStoreIndexes(store: IDBObjectStore): void {
  if (store.indexNames.contains("createdAt_cardId") === false) {
    store.createIndex("createdAt_cardId", ["createdAt", "cardId"], { unique: false });
  }

  if (store.indexNames.contains("dueAt_cardId") === false) {
    store.createIndex("dueAt_cardId", ["dueAt", "cardId"], { unique: false });
  }

  if (store.indexNames.contains("effort_createdAt_cardId") === false) {
    store.createIndex("effort_createdAt_cardId", ["effortLevel", "createdAt", "cardId"], { unique: false });
  }
}

function ensureDecksStoreIndexes(store: IDBObjectStore): void {
  if (store.indexNames.contains("createdAt_deckId") === false) {
    store.createIndex("createdAt_deckId", ["createdAt", "deckId"], { unique: false });
  }
}

function ensureCardTagsStoreIndexes(store: IDBObjectStore): void {
  if (store.indexNames.contains("tag_cardId") === false) {
    store.createIndex("tag_cardId", ["tag", "cardId"], { unique: false });
  }

  if (store.indexNames.contains("cardId_tag") === false) {
    store.createIndex("cardId_tag", ["cardId", "tag"], { unique: false });
  }
}

function upgradeToVersion1(database: IDBDatabase): void {
  if (database.objectStoreNames.contains("cards") === false) {
    database.createObjectStore("cards", { keyPath: "cardId" });
  }

  if (database.objectStoreNames.contains("decks") === false) {
    database.createObjectStore("decks", { keyPath: "deckId" });
  }

  if (database.objectStoreNames.contains("reviewEvents") === false) {
    database.createObjectStore("reviewEvents", { keyPath: "reviewEventId" });
  }

  if (database.objectStoreNames.contains("workspaceSettings") === false) {
    database.createObjectStore("workspaceSettings", { keyPath: "id" });
  }

  if (database.objectStoreNames.contains("outbox") === false) {
    const outboxStore = database.createObjectStore("outbox", { keyPath: "operationId" });
    outboxStore.createIndex("workspaceId_createdAt", ["workspaceId", "createdAt"], { unique: false });
  }

  if (database.objectStoreNames.contains("meta") === false) {
    database.createObjectStore("meta", { keyPath: "key" });
  }
}

function backfillCardTagsStore(transaction: IDBTransaction): void {
  const cardsStore = transaction.objectStore("cards");
  const cardTagsStore = transaction.objectStore("cardTags");
  cardsStore.openCursor().onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (cursor === null) {
      return;
    }

    const card = cursor.value as Card;
    if (card.deletedAt === null) {
      for (const tag of card.tags) {
        if (tag === "") {
          continue;
        }

        cardTagsStore.put({
          cardId: card.cardId,
          tag,
        });
      }
    }

    cursor.continue();
  };
}

function upgradeToVersion2(database: IDBDatabase, transaction: IDBTransaction): void {
  ensureCardsStoreIndexes(transaction.objectStore("cards"));

  if (database.objectStoreNames.contains("cardTags") === false) {
    database.createObjectStore("cardTags", { keyPath: ["cardId", "tag"] });
  }
  ensureCardTagsStoreIndexes(transaction.objectStore("cardTags"));
  ensureDecksStoreIndexes(transaction.objectStore("decks"));

  backfillCardTagsStore(transaction);
}

function upgradeToVersion3(transaction: IDBTransaction): void {
  ensureCardsStoreIndexes(transaction.objectStore("cards"));
  ensureDecksStoreIndexes(transaction.objectStore("decks"));
  ensureCardTagsStoreIndexes(transaction.objectStore("cardTags"));
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onerror = () => {
      reject(describeIndexedDbError("Failed to open IndexedDB", request.error));
    };

    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction;
      if (transaction === null) {
        reject(new Error("IndexedDB upgrade transaction is unavailable"));
        return;
      }

      if (event.oldVersion < 1) {
        upgradeToVersion1(database);
      }
      if (event.oldVersion < 2) {
        upgradeToVersion2(database, transaction);
      }
      if (event.oldVersion < 3) {
        upgradeToVersion3(transaction);
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

export type StoredEntity = Card | Deck | ReviewEvent;
