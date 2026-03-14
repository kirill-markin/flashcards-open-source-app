import type {
  Card,
  CloudSettings,
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

type CloudSettingsRecord = Readonly<{
  key: "cloud_settings";
  settings: CloudSettings;
}>;

type CardTagRecord = Readonly<{
  cardId: string;
  tag: string;
}>;

type DatabaseStores = "cards" | "cardTags" | "decks" | "reviewEvents" | "workspaceSettings" | "outbox" | "meta";

type StoredRecord =
  | Card
  | CardTagRecord
  | Deck
  | ReviewEvent
  | WorkspaceSettingsRecord
  | PersistedOutboxRecord
  | SyncStateRecord
  | CloudSettingsRecord;

type MetaRecord = SyncStateRecord | CloudSettingsRecord;

export type WebSyncCache = Readonly<{
  workspaceId: string | null;
  cards: ReadonlyArray<Card>;
  decks: ReadonlyArray<Deck>;
  reviewEvents: ReadonlyArray<ReviewEvent>;
  workspaceSettings: WorkspaceSchedulerSettings | null;
  cloudSettings: CloudSettings | null;
  outbox: ReadonlyArray<PersistedOutboxRecord>;
  lastAppliedChangeId: number;
}>;

export type PersistentStorageState = Readonly<{
  persisted: boolean | null;
  quota: number | null;
  usage: number | null;
}>;

const databaseName = "flashcards-web-sync";
const databaseVersion = 2;

function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

function describeIndexedDbError(prefix: string, error: unknown): Error {
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

function writeCardTagRecords(transaction: IDBTransaction, card: Card): void {
  const cardTagsStore = transaction.objectStore("cardTags");
  const existingIndex = cardTagsStore.index("cardId_tag");
  const range = IDBKeyRange.bound(
    [card.cardId, ""],
    [card.cardId, "\uffff"],
  );
  existingIndex.openKeyCursor(range).onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
    if (cursor === null) {
      if (card.deletedAt !== null) {
        return;
      }

      for (const tag of card.tags) {
        if (tag === "") {
          continue;
        }

        cardTagsStore.put({
          cardId: card.cardId,
          tag,
        } satisfies CardTagRecord);
      }
      return;
    }

    cardTagsStore.delete(cursor.primaryKey);
    cursor.continue();
  };
}

function openDatabase(): Promise<IDBDatabase> {
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

      if (database.objectStoreNames.contains("cards") === false) {
        database.createObjectStore("cards", { keyPath: "cardId" });
      }
      ensureCardsStoreIndexes(transaction.objectStore("cards"));

      if (database.objectStoreNames.contains("cardTags") === false) {
        database.createObjectStore("cardTags", { keyPath: ["cardId", "tag"] });
      }
      ensureCardTagsStoreIndexes(transaction.objectStore("cardTags"));

      if (database.objectStoreNames.contains("decks") === false) {
        database.createObjectStore("decks", { keyPath: "deckId" });
      }
      ensureDecksStoreIndexes(transaction.objectStore("decks"));

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

      if (event.oldVersion < 2) {
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
              } satisfies CardTagRecord);
            }
          }

          cursor.continue();
        };
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
      reject(describeIndexedDbError("IndexedDB readonly request failed", request.error));
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
  const [cards, decks, reviewEvents, workspaceSettingsRecords, outbox, syncState, cloudSettingsRecord] = await Promise.all([
    getAllFromStore<Card>(database, "cards"),
    getAllFromStore<Deck>(database, "decks"),
    getAllFromStore<ReviewEvent>(database, "reviewEvents"),
    getAllFromStore<WorkspaceSettingsRecord>(database, "workspaceSettings"),
    getAllFromStore<PersistedOutboxRecord>(database, "outbox"),
    getFromStore<SyncStateRecord>(database, "meta", "sync_state"),
    getFromStore<CloudSettingsRecord>(database, "meta", "cloud_settings"),
  ]);

  database.close();

  return {
    workspaceId: syncState?.workspaceId ?? null,
    cards,
    decks,
    reviewEvents: [...reviewEvents].sort((left: ReviewEvent, right: ReviewEvent) => right.reviewedAtServer.localeCompare(left.reviewedAtServer)),
    workspaceSettings: workspaceSettingsRecords[0]?.settings ?? null,
    cloudSettings: cloudSettingsRecord?.settings ?? null,
    outbox: [...outbox].sort((left: PersistedOutboxRecord, right: PersistedOutboxRecord) => left.createdAt.localeCompare(right.createdAt)),
    lastAppliedChangeId: syncState?.lastAppliedChangeId ?? 0,
  };
}

export async function relinkWorkspaceCache(workspaceId: string): Promise<void> {
  const cache = await loadWebSyncCache();
  if (cache.workspaceId === workspaceId) {
    return;
  }

  const database = await openDatabase();
  await runReadwrite(
    database,
    ["cards", "cardTags", "decks", "reviewEvents", "workspaceSettings", "outbox", "meta"],
    (transaction) => {
      const cardsStore = transaction.objectStore("cards");
      const cardTagsStore = transaction.objectStore("cardTags");
      const decksStore = transaction.objectStore("decks");
      const reviewEventsStore = transaction.objectStore("reviewEvents");
      const workspaceSettingsStore = transaction.objectStore("workspaceSettings");
      const outboxStore = transaction.objectStore("outbox");
      const metaStore = transaction.objectStore("meta");

      cardsStore.clear();
      cardTagsStore.clear();
      decksStore.clear();
      reviewEventsStore.clear();
      workspaceSettingsStore.clear();
      outboxStore.clear();

      for (const card of cache.cards) {
        const linkedCard = card;
        cardsStore.put(linkedCard);
        if (linkedCard.deletedAt === null) {
          for (const tag of linkedCard.tags) {
            if (tag === "") {
              continue;
            }

            cardTagsStore.put({
              cardId: linkedCard.cardId,
              tag,
            } satisfies CardTagRecord);
          }
        }
      }

      for (const deck of cache.decks) {
        decksStore.put({
          ...deck,
          workspaceId,
        } satisfies Deck);
      }

      for (const reviewEvent of cache.reviewEvents) {
        reviewEventsStore.put({
          ...reviewEvent,
          workspaceId,
        } satisfies ReviewEvent);
      }

      if (cache.workspaceSettings !== null) {
        workspaceSettingsStore.put({
          id: "workspace",
          settings: cache.workspaceSettings,
        } satisfies WorkspaceSettingsRecord);
      }

      for (const record of cache.outbox) {
        outboxStore.put({
          ...record,
          workspaceId,
        } satisfies PersistedOutboxRecord);
      }

      metaStore.put({
        key: "sync_state",
        workspaceId,
        lastAppliedChangeId: 0,
        updatedAt: new Date().toISOString(),
      } satisfies SyncStateRecord);
      if (cache.cloudSettings !== null) {
        metaStore.put({
          key: "cloud_settings",
          settings: {
            ...cache.cloudSettings,
            linkedWorkspaceId: cache.cloudSettings.linkedWorkspaceId === null ? null : workspaceId,
          },
        } satisfies CloudSettingsRecord);
      }
      return null;
    },
  );
  database.close();
}

export async function clearWebSyncCache(): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(
    database,
    ["cards", "cardTags", "decks", "reviewEvents", "workspaceSettings", "outbox", "meta"],
    (transaction) => {
      transaction.objectStore("cards").clear();
      transaction.objectStore("cardTags").clear();
      transaction.objectStore("decks").clear();
      transaction.objectStore("reviewEvents").clear();
      transaction.objectStore("workspaceSettings").clear();
      transaction.objectStore("outbox").clear();
      transaction.objectStore("meta").clear();
      return null;
    },
  );
  database.close();
}

export async function replaceCards(cards: ReadonlyArray<Card>): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["cards", "cardTags"], (transaction) => {
    const store = transaction.objectStore("cards");
    const cardTagsStore = transaction.objectStore("cardTags");
    store.clear();
    cardTagsStore.clear();
    for (const card of cards) {
      store.put(card);
      if (card.deletedAt === null) {
        for (const tag of card.tags) {
          if (tag === "") {
            continue;
          }

          cardTagsStore.put({
            cardId: card.cardId,
            tag,
          } satisfies CardTagRecord);
        }
      }
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
  await runReadwrite(database, ["cards", "cardTags"], (transaction) => {
    transaction.objectStore("cards").put(card);
    writeCardTagRecords(transaction, card);
    return null;
  });
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

/**
 * Persists browser-local cloud metadata used by web local AI tools so those
 * payloads can match iOS local chat without inventing values on the fly.
 */
export async function putCloudSettings(settings: CloudSettings): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["meta"], (transaction) => transaction.objectStore("meta").put({
    key: "cloud_settings",
    settings,
  } satisfies CloudSettingsRecord));
  database.close();
}

export async function clearCloudSettings(): Promise<void> {
  const database = await openDatabase();
  await runReadwrite(database, ["meta"], (transaction) => transaction.objectStore("meta").delete("cloud_settings"));
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

/**
 * Requests persistent browser storage for the local sync database when the
 * platform exposes the Storage API. Browser storage is less durable than iOS
 * app-sandbox SQLite, so local chat should ask for persistence proactively.
 */
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
