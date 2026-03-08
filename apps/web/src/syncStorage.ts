import type {
  Card,
  Deck,
  ReviewEvent,
  SyncPushOperation,
  WorkspaceSchedulerSettings,
} from "./types";

export type PersistedOutboxRecord = Readonly<{
  operationId: string;
  workspaceId: string;
  createdAt: string;
  attemptCount: number;
  lastError: string;
  operation: SyncPushOperation;
}>;

type WorkspaceSettingsRecord = Readonly<{
  id: "workspace";
  settings: WorkspaceSchedulerSettings;
}>;

type SyncStateRecord = Readonly<{
  key: "sync_state";
  workspaceId: string;
  lastAppliedChangeId: number;
  updatedAt: string;
}>;

type DatabaseStores = "cards" | "decks" | "reviewEvents" | "workspaceSettings" | "outbox" | "meta";

type StoredRecord =
  | Card
  | Deck
  | ReviewEvent
  | WorkspaceSettingsRecord
  | PersistedOutboxRecord
  | SyncStateRecord;

export type WebSyncCache = Readonly<{
  workspaceId: string | null;
  cards: ReadonlyArray<Card>;
  decks: ReadonlyArray<Deck>;
  reviewEvents: ReadonlyArray<ReviewEvent>;
  workspaceSettings: WorkspaceSchedulerSettings | null;
  outbox: ReadonlyArray<PersistedOutboxRecord>;
  lastAppliedChangeId: number;
}>;

const databaseName = "flashcards-web-sync";
const databaseVersion = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message ?? "unknown error"}`));
    };

    request.onupgradeneeded = () => {
      const database = request.result;

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
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function runReadonly<RequestResult>(
  database: IDBDatabase,
  storeName: DatabaseStores,
  callback: (store: IDBObjectStore) => IDBRequest<RequestResult>,
): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = callback(store);

    request.onerror = () => {
      reject(new Error(`IndexedDB readonly request failed: ${request.error?.message ?? "unknown error"}`));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function runReadwrite<RequestResult>(
  database: IDBDatabase,
  storeNames: ReadonlyArray<DatabaseStores>,
  callback: (transaction: IDBTransaction) => IDBRequest<RequestResult> | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([...storeNames], "readwrite");
    const request = callback(transaction);

    if (request !== null) {
      request.onerror = () => {
        reject(new Error(`IndexedDB write request failed: ${request.error?.message ?? "unknown error"}`));
      };
    }

    transaction.onerror = () => {
      reject(new Error(`IndexedDB transaction failed: ${transaction.error?.message ?? "unknown error"}`));
    };

    transaction.oncomplete = () => {
      resolve();
    };
  });
}

async function getAllFromStore<RecordType extends StoredRecord>(
  database: IDBDatabase,
  storeName: DatabaseStores,
): Promise<ReadonlyArray<RecordType>> {
  return runReadonly(database, storeName, (store) => store.getAll()) as Promise<ReadonlyArray<RecordType>>;
}

async function getFromStore<RecordType extends StoredRecord>(
  database: IDBDatabase,
  storeName: DatabaseStores,
  key: IDBValidKey,
): Promise<RecordType | undefined> {
  const result = await runReadonly(database, storeName, (store) => store.get(key)) as RecordType | undefined;
  return result;
}

export async function loadWebSyncCache(): Promise<WebSyncCache> {
  const database = await openDatabase();
  const [cards, decks, reviewEvents, workspaceSettingsRecords, outbox, syncState] = await Promise.all([
    getAllFromStore<Card>(database, "cards"),
    getAllFromStore<Deck>(database, "decks"),
    getAllFromStore<ReviewEvent>(database, "reviewEvents"),
    getAllFromStore<WorkspaceSettingsRecord>(database, "workspaceSettings"),
    getAllFromStore<PersistedOutboxRecord>(database, "outbox"),
    getFromStore<SyncStateRecord>(database, "meta", "sync_state"),
  ]);

  database.close();

  return {
    workspaceId: syncState?.workspaceId ?? null,
    cards,
    decks,
    reviewEvents,
    workspaceSettings: workspaceSettingsRecords[0]?.settings ?? null,
    outbox: [...outbox].sort((left: PersistedOutboxRecord, right: PersistedOutboxRecord) => left.createdAt.localeCompare(right.createdAt)),
    lastAppliedChangeId: syncState?.lastAppliedChangeId ?? 0,
  };
}

export async function ensureWorkspaceCache(workspaceId: string): Promise<void> {
  const database = await openDatabase();
  const syncState = await getFromStore<SyncStateRecord>(database, "meta", "sync_state");

  if (syncState === undefined) {
    await runReadwrite(database, ["meta"], (transaction) => transaction.objectStore("meta").put({
      key: "sync_state",
      workspaceId,
      lastAppliedChangeId: 0,
      updatedAt: new Date().toISOString(),
    } satisfies SyncStateRecord));
    database.close();
    return;
  }

  if (syncState.workspaceId === workspaceId) {
    database.close();
    return;
  }

  await runReadwrite(
    database,
    ["cards", "decks", "reviewEvents", "workspaceSettings", "outbox", "meta"],
    (transaction) => {
      transaction.objectStore("cards").clear();
      transaction.objectStore("decks").clear();
      transaction.objectStore("reviewEvents").clear();
      transaction.objectStore("workspaceSettings").clear();
      transaction.objectStore("outbox").clear();
      transaction.objectStore("meta").put({
        key: "sync_state",
        workspaceId,
        lastAppliedChangeId: 0,
        updatedAt: new Date().toISOString(),
      } satisfies SyncStateRecord);
      return null;
    },
  );

  database.close();
}

export async function replaceCards(cards: ReadonlyArray<Card>): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["cards"], (transaction) => {
    const store = transaction.objectStore("cards");
    store.clear();
    for (const card of cards) {
      store.put(card);
    }
    return null;
  });
  database.close();
}

export async function replaceDecks(decks: ReadonlyArray<Deck>): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["decks"], (transaction) => {
    const store = transaction.objectStore("decks");
    store.clear();
    for (const deck of decks) {
      store.put(deck);
    }
    return null;
  });
  database.close();
}

export async function replaceReviewEvents(reviewEvents: ReadonlyArray<ReviewEvent>): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["reviewEvents"], (transaction) => {
    const store = transaction.objectStore("reviewEvents");
    store.clear();
    for (const reviewEvent of reviewEvents) {
      store.put(reviewEvent);
    }
    return null;
  });
  database.close();
}

export async function putCard(card: Card): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["cards"], (transaction) => transaction.objectStore("cards").put(card));
  database.close();
}

export async function putDeck(deck: Deck): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["decks"], (transaction) => transaction.objectStore("decks").put(deck));
  database.close();
}

export async function putReviewEvent(reviewEvent: ReviewEvent): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["reviewEvents"], (transaction) => transaction.objectStore("reviewEvents").put(reviewEvent));
  database.close();
}

export async function putWorkspaceSettings(settings: WorkspaceSchedulerSettings): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["workspaceSettings"], (transaction) => transaction.objectStore("workspaceSettings").put({
    id: "workspace",
    settings,
  } satisfies WorkspaceSettingsRecord));
  database.close();
}

export async function putOutboxRecord(record: PersistedOutboxRecord): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["outbox"], (transaction) => transaction.objectStore("outbox").put(record));
  database.close();
}

export async function deleteOutboxRecord(operationId: string): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["outbox"], (transaction) => transaction.objectStore("outbox").delete(operationId));
  database.close();
}

export async function listOutboxRecords(workspaceId: string): Promise<ReadonlyArray<PersistedOutboxRecord>> {
  const database = await openDatabase();
  const rows = await getAllFromStore<PersistedOutboxRecord>(database, "outbox");
  database.close();
  return rows
    .filter((row) => row.workspaceId === workspaceId)
    .sort((left: PersistedOutboxRecord, right: PersistedOutboxRecord) => left.createdAt.localeCompare(right.createdAt));
}

export async function setLastAppliedChangeId(workspaceId: string, lastAppliedChangeId: number): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["meta"], (transaction) => transaction.objectStore("meta").put({
    key: "sync_state",
    workspaceId,
    lastAppliedChangeId,
    updatedAt: new Date().toISOString(),
  } satisfies SyncStateRecord));
  database.close();
}
