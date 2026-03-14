import type {
  Card,
  CloudSettings,
  DeckCardStats,
  DecksListSnapshot,
  Deck,
  QueryCardsInput,
  QueryCardsPage,
  ReviewEvent,
  ReviewCounts,
  ReviewFilter,
  ReviewQueueSnapshot,
  ReviewTimelinePage,
  SyncPushOperation,
  WorkspaceOverviewSnapshot,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
  WorkspaceTagsSummary,
} from "./types";
import {
  ALL_CARDS_REVIEW_FILTER,
  compareCardsForReviewOrder,
  isCardDue,
  isCardNew,
  isCardReviewed,
  isReviewFilterEqual,
  makeDeckCardStats,
  matchesCardFilter,
  matchesDeckFilterDefinition,
} from "./appData/domain";

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

type CardCursorIndexName = "createdAt_cardId" | "dueAt_cardId" | "effort_createdAt_cardId";

type IndexedCardCursorOptions = Readonly<{
  indexName: CardCursorIndexName;
  range: IDBKeyRange | null;
  direction: IDBCursorDirection;
}>;

type ReviewCandidateAccumulator = Readonly<{
  matchingCards: ReadonlyArray<Card>;
  dueCards: ReadonlyArray<Card>;
}>;

type CardPageAccumulator = Readonly<{
  matchingCount: number;
  pageCards: ReadonlyArray<Card>;
  nextCursor: string | null;
}>;

type ReviewFilterResolution = Readonly<{
  resolvedReviewFilter: ReviewFilter;
  deck: Deck | null;
  allowedTagCardIds: ReadonlySet<string> | null;
}>;

type DeckStatsAccumulator = Readonly<{
  totalCards: number;
  dueCards: number;
  newCards: number;
  reviewedCards: number;
}>;

const databaseName = "flashcards-web-sync";
const databaseVersion = 3;

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
        } satisfies CardTagRecord);
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

function openIndexedCursor(
  store: IDBObjectStore,
  options: IndexedCardCursorOptions,
): IDBRequest<IDBCursorWithValue | null> {
  return store.index(options.indexName).openCursor(options.range, options.direction);
}

async function iterateCardsByIndex(
  database: IDBDatabase,
  options: IndexedCardCursorOptions,
  onCard: (card: Card) => boolean | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["cards"], "readonly");
    const cardsStore = transaction.objectStore("cards");
    const request = openIndexedCursor(cardsStore, options);
    let isResolved = false;

    const finish = (): void => {
      if (isResolved) {
        return;
      }

      isResolved = true;
      resolve();
    };

    request.onerror = () => {
      reject(describeIndexedDbError("IndexedDB cursor iteration failed", request.error));
    };

    transaction.onerror = () => {
      reject(describeIndexedDbError("IndexedDB transaction failed", transaction.error));
    };

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor === null) {
        finish();
        return;
      }

      const shouldContinue = onCard(cursor.value as Card);
      if (shouldContinue === false) {
        finish();
        return;
      }

      cursor.continue();
    };
  });
}

async function iterateCardsByCreatedAtDesc(
  database: IDBDatabase,
  onCard: (card: Card) => boolean | void,
): Promise<void> {
  let currentCreatedAt: string | null | undefined;
  let currentGroup: Array<Card> = [];
  let shouldStop = false;

  function flushCurrentGroup(): boolean {
    const sortedGroup = [...currentGroup].sort((leftCard, rightCard) => leftCard.cardId.localeCompare(rightCard.cardId));
    currentGroup = [];

    for (const card of sortedGroup) {
      if (onCard(card) === false) {
        shouldStop = true;
        return false;
      }
    }

    return true;
  }

  await iterateCardsByIndex(
    database,
    {
      indexName: "createdAt_cardId",
      range: null,
      direction: "prev",
    },
    (card) => {
      if (shouldStop) {
        return false;
      }

      if (currentCreatedAt === undefined) {
        currentCreatedAt = card.createdAt;
        currentGroup = [card];
        return true;
      }

      if (currentCreatedAt === card.createdAt) {
        currentGroup.push(card);
        return true;
      }

      if (flushCurrentGroup() === false) {
        return false;
      }

      currentCreatedAt = card.createdAt;
      currentGroup = [card];
      return true;
    },
  );

  if (shouldStop === false && currentGroup.length > 0) {
    flushCurrentGroup();
  }
}

async function iterateCardsByDueAtAsc(
  database: IDBDatabase,
  onCard: (card: Card) => boolean | void,
): Promise<void> {
  await iterateCardsByIndex(
    database,
    {
      indexName: "dueAt_cardId",
      range: null,
      direction: "next",
    },
    onCard,
  );
}

async function iterateCardsByEffortAndCreatedAtDesc(
  database: IDBDatabase,
  effortLevel: Card["effortLevel"],
  onCard: (card: Card) => boolean | void,
): Promise<void> {
  let currentCreatedAt: string | null | undefined;
  let currentGroup: Array<Card> = [];
  let shouldStop = false;

  function flushCurrentGroup(): boolean {
    const sortedGroup = [...currentGroup].sort((leftCard, rightCard) => leftCard.cardId.localeCompare(rightCard.cardId));
    currentGroup = [];

    for (const card of sortedGroup) {
      if (onCard(card) === false) {
        shouldStop = true;
        return false;
      }
    }

    return true;
  }

  await iterateCardsByIndex(
    database,
    {
      indexName: "effort_createdAt_cardId",
      range: IDBKeyRange.bound(
        [effortLevel, "", ""],
        [effortLevel, "\uffff", "\uffff"],
      ),
      direction: "prev",
    },
    (card) => {
      if (shouldStop) {
        return false;
      }

      if (currentCreatedAt === undefined) {
        currentCreatedAt = card.createdAt;
        currentGroup = [card];
        return true;
      }

      if (currentCreatedAt === card.createdAt) {
        currentGroup.push(card);
        return true;
      }

      if (flushCurrentGroup() === false) {
        return false;
      }

      currentCreatedAt = card.createdAt;
      currentGroup = [card];
      return true;
    },
  );

  if (shouldStop === false && currentGroup.length > 0) {
    flushCurrentGroup();
  }
}

async function iterateCardTagsByTag(
  database: IDBDatabase,
  tag: string,
  onRecord: (record: CardTagRecord) => boolean | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["cardTags"], "readonly");
    const cardTagsStore = transaction.objectStore("cardTags");
    const request = cardTagsStore.index("tag_cardId").openCursor(
      IDBKeyRange.bound(
        [tag, ""],
        [tag, "\uffff"],
      ),
      "next",
    );
    let isResolved = false;

    const finish = (): void => {
      if (isResolved) {
        return;
      }

      isResolved = true;
      resolve();
    };

    request.onerror = () => {
      reject(describeIndexedDbError("IndexedDB card tag iteration failed", request.error));
    };

    transaction.onerror = () => {
      reject(describeIndexedDbError("IndexedDB transaction failed", transaction.error));
    };

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor === null) {
        finish();
        return;
      }

      const shouldContinue = onRecord(cursor.value as CardTagRecord);
      if (shouldContinue === false) {
        finish();
        return;
      }

      cursor.continue();
    };
  });
}

async function iterateAllCardTags(
  database: IDBDatabase,
  onRecord: (record: CardTagRecord) => boolean | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["cardTags"], "readonly");
    const cardTagsStore = transaction.objectStore("cardTags");
    const request = cardTagsStore.index("tag_cardId").openCursor(null, "next");
    let isResolved = false;

    const finish = (): void => {
      if (isResolved) {
        return;
      }

      isResolved = true;
      resolve();
    };

    request.onerror = () => {
      reject(describeIndexedDbError("IndexedDB card tag iteration failed", request.error));
    };

    transaction.onerror = () => {
      reject(describeIndexedDbError("IndexedDB transaction failed", transaction.error));
    };

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor === null) {
        finish();
        return;
      }

      const shouldContinue = onRecord(cursor.value as CardTagRecord);
      if (shouldContinue === false) {
        finish();
        return;
      }

      cursor.continue();
    };
  });
}

async function iterateDecksByCreatedAtDesc(
  database: IDBDatabase,
  onDeck: (deck: Deck) => boolean | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["decks"], "readonly");
    const decksStore = transaction.objectStore("decks");
    const request = decksStore.index("createdAt_deckId").openCursor(null, "prev");
    let isResolved = false;

    const finish = (): void => {
      if (isResolved) {
        return;
      }

      isResolved = true;
      resolve();
    };

    request.onerror = () => {
      reject(describeIndexedDbError("IndexedDB deck iteration failed", request.error));
    };

    transaction.onerror = () => {
      reject(describeIndexedDbError("IndexedDB transaction failed", transaction.error));
    };

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor === null) {
        finish();
        return;
      }

      const shouldContinue = onDeck(cursor.value as Deck);
      if (shouldContinue === false) {
        finish();
        return;
      }

      cursor.continue();
    };
  });
}

async function loadDeckRecord(database: IDBDatabase, deckId: string): Promise<Deck | null> {
  const deck = await getFromStore<Deck>(database, "decks", deckId);
  if (deck === undefined || deck.deletedAt !== null) {
    return null;
  }

  return deck;
}

async function loadAllowedCardIdsForTags(
  database: IDBDatabase,
  tags: ReadonlyArray<string>,
): Promise<ReadonlySet<string>> {
  const allowedCardIds = new Set<string>();

  for (const tag of tags) {
    await iterateCardTagsByTag(database, tag, (record) => {
      allowedCardIds.add(record.cardId);
      return true;
    });
  }

  return allowedCardIds;
}

async function resolveReviewFilterFromIndexedDb(
  database: IDBDatabase,
  reviewFilter: ReviewFilter,
): Promise<ReviewFilterResolution> {
  if (reviewFilter.kind === "allCards") {
    return {
      resolvedReviewFilter: ALL_CARDS_REVIEW_FILTER,
      deck: null,
      allowedTagCardIds: null,
    };
  }

  if (reviewFilter.kind === "deck") {
    const deck = await loadDeckRecord(database, reviewFilter.deckId);
    if (deck === null) {
      return {
        resolvedReviewFilter: ALL_CARDS_REVIEW_FILTER,
        deck: null,
        allowedTagCardIds: null,
      };
    }

    return {
      resolvedReviewFilter: reviewFilter,
      deck,
      allowedTagCardIds: null,
    };
  }

  const allowedTagCardIds = await loadAllowedCardIdsForTags(database, [reviewFilter.tag]);
  if (allowedTagCardIds.size === 0) {
    return {
      resolvedReviewFilter: ALL_CARDS_REVIEW_FILTER,
      deck: null,
      allowedTagCardIds: null,
    };
  }

  return {
    resolvedReviewFilter: reviewFilter,
    deck: null,
    allowedTagCardIds,
  };
}

function matchesResolvedReviewFilter(
  card: Card,
  filterResolution: ReviewFilterResolution,
): boolean {
  if (filterResolution.resolvedReviewFilter.kind === "allCards") {
    return true;
  }

  if (filterResolution.resolvedReviewFilter.kind === "deck") {
    if (filterResolution.deck === null) {
      return true;
    }

    return matchesDeckFilterDefinition(filterResolution.deck.filterDefinition, card);
  }

  return filterResolution.allowedTagCardIds?.has(card.cardId) ?? false;
}

function createEmptyReviewCandidateAccumulator(): ReviewCandidateAccumulator {
  return {
    matchingCards: [],
    dueCards: [],
  };
}

function appendReviewCandidate(
  accumulator: ReviewCandidateAccumulator,
  card: Card,
  nowTimestamp: number,
): ReviewCandidateAccumulator {
  return {
    matchingCards: [...accumulator.matchingCards, card],
    dueCards: isCardDue(card, nowTimestamp)
      ? [...accumulator.dueCards, card]
      : accumulator.dueCards,
  };
}

async function collectReviewCandidates(
  database: IDBDatabase,
  reviewFilter: ReviewFilter,
  nowTimestamp: number,
): Promise<Readonly<{
  filterResolution: ReviewFilterResolution;
  accumulator: ReviewCandidateAccumulator;
}>> {
  const filterResolution = await resolveReviewFilterFromIndexedDb(database, reviewFilter);
  let accumulator = createEmptyReviewCandidateAccumulator();
  await iterateReviewCardsInCanonicalOrder(database, nowTimestamp, (card) => {
    if (matchesResolvedReviewFilter(card, filterResolution) === false) {
      return true;
    }

    accumulator = appendReviewCandidate(accumulator, card, nowTimestamp);
    return true;
  });

  return {
    filterResolution,
    accumulator,
  };
}

async function iterateReviewCardsInCanonicalOrder(
  database: IDBDatabase,
  nowTimestamp: number,
  onCard: (card: Card) => boolean | void,
): Promise<void> {
  let shouldStop = false;

  await iterateCardsByCreatedAtDesc(database, (card) => {
    if (shouldStop) {
      return false;
    }
    if (card.deletedAt !== null || card.dueAt !== null) {
      return true;
    }

    if (onCard(card) === false) {
      shouldStop = true;
      return false;
    }

    return true;
  });

  if (shouldStop) {
    return;
  }

  let currentDueAt: string | null | undefined;
  let currentGroup: Array<Card> = [];

  function flushCurrentGroup(): boolean {
    const sortedGroup = [...currentGroup].sort((leftCard, rightCard) => compareCardsForReviewOrder(leftCard, rightCard, nowTimestamp));
    currentGroup = [];

    for (const card of sortedGroup) {
      if (onCard(card) === false) {
        shouldStop = true;
        return false;
      }
    }

    return true;
  }

  await iterateCardsByDueAtAsc(database, (card) => {
    if (shouldStop) {
      return false;
    }
    if (card.deletedAt !== null || card.dueAt === null) {
      return true;
    }

    if (currentDueAt === undefined) {
      currentDueAt = card.dueAt;
      currentGroup = [card];
      return true;
    }

    if (currentDueAt === card.dueAt) {
      currentGroup = [...currentGroup, card];
      return true;
    }

    if (flushCurrentGroup() === false) {
      return false;
    }

    currentDueAt = card.dueAt;
    currentGroup = [card];
    return true;
  });

  if (shouldStop === false && currentGroup.length > 0) {
    flushCurrentGroup();
  }
}

function isDefaultCreatedAtDescendingSort(
  sorts: QueryCardsInput["sorts"],
): boolean {
  return sorts.length === 0 || (
    sorts.length === 1
    && sorts[0]?.key === "createdAt"
    && sorts[0].direction === "desc"
  );
}

function makeCursorCardIdPredicate(cursor: string | null): Readonly<{
  matches: (cardId: string) => boolean;
  isSet: boolean;
}> {
  if (cursor === null) {
    return {
      matches: () => false,
      isSet: false,
    };
  }

  const parsedCursor = decodeCursor(cursor);
  const cardId = parsedCursor.cardId;
  if (typeof cardId !== "string" || cardId === "") {
    throw new Error("cards cursor.cardId must be a non-empty string");
  }

  return {
    matches: (candidateCardId) => candidateCardId === cardId,
    isSet: true,
  };
}

function makeReviewCursorCardIdPredicate(cursor: string | null): Readonly<{
  matches: (cardId: string) => boolean;
  isSet: boolean;
}> {
  if (cursor === null) {
    return {
      matches: () => false,
      isSet: false,
    };
  }

  const parsedCursor = decodeCursor(cursor);
  const cardId = parsedCursor.cardId;
  if (typeof cardId !== "string" || cardId === "") {
    throw new Error("review cursor.cardId must be a non-empty string");
  }

  return {
    matches: (candidateCardId) => candidateCardId === cardId,
    isSet: true,
  };
}

function compareTagSummaries(
  leftTag: Readonly<{ tag: string; cardsCount: number }>,
  rightTag: Readonly<{ tag: string; cardsCount: number }>,
): number {
  if (leftTag.cardsCount !== rightTag.cardsCount) {
    return rightTag.cardsCount - leftTag.cardsCount;
  }

  return leftTag.tag.localeCompare(rightTag.tag, undefined, { sensitivity: "base" });
}

function normalizeSearchText(searchText: string | null): string | null {
  if (searchText === null) {
    return null;
  }

  const normalizedSearchText = searchText.trim().toLowerCase();
  return normalizedSearchText === "" ? null : normalizedSearchText;
}

function matchesSearchText(card: Card, searchText: string | null): boolean {
  if (searchText === null) {
    return true;
  }

  const cardFields = [card.frontText, card.backText, ...card.tags].map((value) => value.toLowerCase());
  return cardFields.some((value) => value.includes(searchText));
}

function compareNullableText(left: string | null, right: string | null, direction: "asc" | "desc"): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return direction === "asc" ? -1 : 1;
  }
  if (right === null) {
    return direction === "asc" ? 1 : -1;
  }

  return direction === "asc"
    ? left.localeCompare(right)
    : right.localeCompare(left);
}

function compareText(left: string, right: string, direction: "asc" | "desc"): number {
  return direction === "asc"
    ? left.localeCompare(right, undefined, { sensitivity: "base" })
    : right.localeCompare(left, undefined, { sensitivity: "base" });
}

function compareNumber(left: number, right: number, direction: "asc" | "desc"): number {
  return direction === "asc" ? left - right : right - left;
}

function compareCardsForCardsQuery(
  leftCard: Card,
  rightCard: Card,
  sorts: QueryCardsInput["sorts"],
): number {
  for (const sort of sorts) {
    let difference = 0;

    if (sort.key === "frontText") {
      difference = compareText(leftCard.frontText, rightCard.frontText, sort.direction);
    } else if (sort.key === "backText") {
      difference = compareText(leftCard.backText, rightCard.backText, sort.direction);
    } else if (sort.key === "tags") {
      difference = compareText(leftCard.tags.join(","), rightCard.tags.join(","), sort.direction);
    } else if (sort.key === "effortLevel") {
      difference = compareText(leftCard.effortLevel, rightCard.effortLevel, sort.direction);
    } else if (sort.key === "dueAt") {
      difference = compareNullableText(leftCard.dueAt, rightCard.dueAt, sort.direction);
    } else if (sort.key === "reps") {
      difference = compareNumber(leftCard.reps, rightCard.reps, sort.direction);
    } else if (sort.key === "lapses") {
      difference = compareNumber(leftCard.lapses, rightCard.lapses, sort.direction);
    } else if (sort.key === "createdAt") {
      difference = compareText(leftCard.createdAt, rightCard.createdAt, sort.direction);
    }

    if (difference !== 0) {
      return difference;
    }
  }

  const createdAtDifference = rightCard.createdAt.localeCompare(leftCard.createdAt);
  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return leftCard.cardId.localeCompare(rightCard.cardId);
}

function encodeCursor(value: Record<string, string | number | null>): string {
  return globalThis.btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    const normalizedCursor = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const paddingLength = (4 - (normalizedCursor.length % 4)) % 4;
    const paddedCursor = `${normalizedCursor}${"=".repeat(paddingLength)}`;
    const parsedValue = JSON.parse(globalThis.atob(paddedCursor)) as unknown;

    if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
      throw new Error("cursor must decode to an object");
    }

    return parsedValue as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cursor is invalid: ${message}`);
  }
}

function resolveCardsPageStartIndex(cards: ReadonlyArray<Card>, cursor: string | null): number {
  if (cursor === null) {
    return 0;
  }

  const parsedCursor = decodeCursor(cursor);
  const cardId = parsedCursor.cardId;
  if (typeof cardId !== "string" || cardId === "") {
    throw new Error("cards cursor.cardId must be a non-empty string");
  }

  const index = cards.findIndex((card) => card.cardId === cardId);
  if (index === -1) {
    return 0;
  }

  return index + 1;
}

function buildCardsPageCursor(cards: ReadonlyArray<Card>, pageCards: ReadonlyArray<Card>): string | null {
  if (pageCards.length === 0) {
    return null;
  }

  const lastCard = pageCards[pageCards.length - 1];
  const lastCardIndex = cards.findIndex((card) => card.cardId === lastCard.cardId);
  if (lastCardIndex === -1 || lastCardIndex >= cards.length - 1) {
    return null;
  }

  return encodeCursor({ cardId: lastCard.cardId });
}

function makeReviewCountsFromCards(cards: ReadonlyArray<Card>, nowTimestamp: number): ReviewCounts {
  return cards.reduce<ReviewCounts>((result, card) => ({
    dueCount: result.dueCount + (isCardDue(card, nowTimestamp) ? 1 : 0),
    totalCount: result.totalCount + 1,
  }), {
    dueCount: 0,
    totalCount: 0,
  });
}

function buildReviewQueueCursor(cards: ReadonlyArray<Card>, pageCards: ReadonlyArray<Card>): string | null {
  if (pageCards.length === 0) {
    return null;
  }

  const lastCard = pageCards[pageCards.length - 1];
  const lastCardIndex = cards.findIndex((card) => card.cardId === lastCard.cardId);
  if (lastCardIndex === -1 || lastCardIndex >= cards.length - 1) {
    return null;
  }

  return encodeCursor({ cardId: lastCard.cardId });
}

function emptyDeckStatsAccumulator(): DeckStatsAccumulator {
  return {
    totalCards: 0,
    dueCards: 0,
    newCards: 0,
    reviewedCards: 0,
  };
}

function appendCardToDeckStats(
  stats: DeckStatsAccumulator,
  card: Card,
  nowTimestamp: number,
): DeckStatsAccumulator {
  return {
    totalCards: stats.totalCards + 1,
    dueCards: stats.dueCards + (isCardDue(card, nowTimestamp) ? 1 : 0),
    newCards: stats.newCards + (isCardNew(card) ? 1 : 0),
    reviewedCards: stats.reviewedCards + (isCardReviewed(card) ? 1 : 0),
  };
}

function toDeckCardStats(stats: DeckStatsAccumulator): DeckCardStats {
  return {
    totalCards: stats.totalCards,
    dueCards: stats.dueCards,
    newCards: stats.newCards,
    reviewedCards: stats.reviewedCards,
  };
}

async function loadActiveCardCountWithDatabase(database: IDBDatabase): Promise<number> {
  let count = 0;
  await iterateCardsByCreatedAtDesc(database, (card) => {
    if (card.deletedAt === null) {
      count += 1;
    }
    return true;
  });
  return count;
}

async function loadActiveDecksWithDatabase(database: IDBDatabase): Promise<ReadonlyArray<Deck>> {
  const decks: Array<Deck> = [];
  await iterateDecksByCreatedAtDesc(database, (deck) => {
    if (deck.deletedAt === null) {
      decks.push(deck);
    }
    return true;
  });
  return decks;
}

async function loadActiveCardsForSqlWithDatabase(database: IDBDatabase): Promise<ReadonlyArray<Card>> {
  const cards: Array<Card> = [];
  await iterateCardsByCreatedAtDesc(database, (card) => {
    if (card.deletedAt === null) {
      cards.push(card);
    }
    return true;
  });
  return cards;
}

async function readWebSyncCache(): Promise<WebSyncCache> {
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

export async function loadCloudSettings(): Promise<CloudSettings | null> {
  const database = await openDatabase();
  const cloudSettingsRecord = await getFromStore<CloudSettingsRecord>(database, "meta", "cloud_settings");
  database.close();
  return cloudSettingsRecord?.settings ?? null;
}

export async function loadLastAppliedChangeId(): Promise<number> {
  const database = await openDatabase();
  const syncState = await getFromStore<SyncStateRecord>(database, "meta", "sync_state");
  database.close();
  return syncState?.lastAppliedChangeId ?? 0;
}

export async function loadWorkspaceSettings(): Promise<WorkspaceSchedulerSettings | null> {
  const database = await openDatabase();
  const workspaceSettingsRecords = await getAllFromStore<WorkspaceSettingsRecord>(database, "workspaceSettings");
  database.close();
  return workspaceSettingsRecords[0]?.settings ?? null;
}

export async function loadActiveCardCount(): Promise<number> {
  const database = await openDatabase();
  try {
    return await loadActiveCardCountWithDatabase(database);
  } finally {
    database.close();
  }
}

export async function loadAllActiveCardsForSql(): Promise<ReadonlyArray<Card>> {
  const database = await openDatabase();
  try {
    return await loadActiveCardsForSqlWithDatabase(database);
  } finally {
    database.close();
  }
}

export async function loadAllActiveDecksForSql(): Promise<ReadonlyArray<Deck>> {
  const database = await openDatabase();
  try {
    return await loadActiveDecksWithDatabase(database);
  } finally {
    database.close();
  }
}

export async function loadReviewEventsForSql(workspaceId: string): Promise<ReadonlyArray<ReviewEvent>> {
  const database = await openDatabase();
  try {
    const reviewEvents = await getAllFromStore<ReviewEvent>(database, "reviewEvents");
    return reviewEvents
      .filter((reviewEvent) => reviewEvent.workspaceId === workspaceId)
      .sort((leftEvent, rightEvent) => rightEvent.reviewedAtServer.localeCompare(leftEvent.reviewedAtServer));
  } finally {
    database.close();
  }
}

/**
 * Query-driven cards page used by the web cards tab. This intentionally reads
 * from the local IndexedDB mirror so first paint does not depend on backend
 * list endpoints or a pre-hydrated app-wide cards array.
 */
export async function queryLocalCardsPage(input: QueryCardsInput): Promise<QueryCardsPage> {
  const database = await openDatabase();
  try {
    const normalizedSearchText = normalizeSearchText(input.searchText);
    const allowedTagCardIds = input.filter === null || input.filter.tags.length === 0
      ? null
      : await loadAllowedCardIdsForTags(database, input.filter.tags);
    const canUseStreamingPage = isDefaultCreatedAtDescendingSort(input.sorts);

    if (canUseStreamingPage) {
      const cursorPredicate = makeCursorCardIdPredicate(input.cursor);
      let hasReachedCursor = cursorPredicate.isSet === false;
      let matchingCount = 0;
      let pageCards: Array<Card> = [];
      let hasMoreCards = false;

      const iterateCards = input.filter !== null && input.filter.effort.length === 1
        ? iterateCardsByEffortAndCreatedAtDesc(database, input.filter.effort[0], (card) => {
          if (card.deletedAt !== null) {
            return true;
          }
          if (allowedTagCardIds !== null && allowedTagCardIds.has(card.cardId) === false) {
            return true;
          }
          if (input.filter !== null && matchesCardFilter(input.filter, card) === false) {
            return true;
          }
          if (matchesSearchText(card, normalizedSearchText) === false) {
            return true;
          }

          matchingCount += 1;

          if (hasReachedCursor === false) {
            if (cursorPredicate.matches(card.cardId)) {
              hasReachedCursor = true;
            }
            return true;
          }

          if (pageCards.length < input.limit) {
            pageCards = [...pageCards, card];
            return true;
          }

          hasMoreCards = true;
          return true;
        })
        : iterateCardsByCreatedAtDesc(database, (card) => {
          if (card.deletedAt !== null) {
            return true;
          }
          if (allowedTagCardIds !== null && allowedTagCardIds.has(card.cardId) === false) {
            return true;
          }
          if (input.filter !== null && matchesCardFilter(input.filter, card) === false) {
            return true;
          }
          if (matchesSearchText(card, normalizedSearchText) === false) {
            return true;
          }

          matchingCount += 1;

          if (hasReachedCursor === false) {
            if (cursorPredicate.matches(card.cardId)) {
              hasReachedCursor = true;
            }
            return true;
          }

          if (pageCards.length < input.limit) {
            pageCards = [...pageCards, card];
            return true;
          }

          hasMoreCards = true;
          return true;
        });

      await iterateCards;

      const accumulator: CardPageAccumulator = {
        matchingCount,
        pageCards,
        nextCursor: hasMoreCards && pageCards.length > 0
          ? encodeCursor({ cardId: pageCards[pageCards.length - 1]?.cardId ?? "" })
          : null,
      };

      return {
        cards: accumulator.pageCards,
        nextCursor: accumulator.nextCursor,
        totalCount: accumulator.matchingCount,
      };
    }

    let matchingCards: Array<Card> = [];
    const baseIterator = input.sorts[0]?.key === "dueAt"
      ? iterateCardsByDueAtAsc(database, (card) => {
        if (card.deletedAt !== null) {
          return true;
        }
        if (allowedTagCardIds !== null && allowedTagCardIds.has(card.cardId) === false) {
          return true;
        }
        if (input.filter !== null && matchesCardFilter(input.filter, card) === false) {
          return true;
        }
        if (matchesSearchText(card, normalizedSearchText) === false) {
          return true;
        }

        matchingCards = [...matchingCards, card];
        return true;
      })
      : iterateCardsByCreatedAtDesc(database, (card) => {
        if (card.deletedAt !== null) {
          return true;
        }
        if (allowedTagCardIds !== null && allowedTagCardIds.has(card.cardId) === false) {
          return true;
        }
        if (input.filter !== null && matchesCardFilter(input.filter, card) === false) {
          return true;
        }
        if (matchesSearchText(card, normalizedSearchText) === false) {
          return true;
        }

        matchingCards = [...matchingCards, card];
        return true;
      });

    await baseIterator;
    matchingCards = [...matchingCards].sort((leftCard, rightCard) => compareCardsForCardsQuery(leftCard, rightCard, input.sorts));

    const startIndex = resolveCardsPageStartIndex(matchingCards, input.cursor);
    const pageCards = matchingCards.slice(startIndex, startIndex + input.limit);

    return {
      cards: pageCards,
      nextCursor: buildCardsPageCursor(matchingCards, pageCards),
      totalCount: matchingCards.length,
    };
  } finally {
    database.close();
  }
}

export async function loadWorkspaceTagsSummary(): Promise<WorkspaceTagsSummary> {
  const database = await openDatabase();
  try {
    const counts = new Map<string, number>();
    await iterateAllCardTags(database, (record) => {
      counts.set(record.tag, (counts.get(record.tag) ?? 0) + 1);
      return true;
    });

    return {
      tags: [...counts.entries()]
        .map(([tag, cardsCount]) => ({
          tag,
          cardsCount,
        }))
        .sort(compareTagSummaries),
      totalCards: await loadActiveCardCountWithDatabase(database),
    };
  } finally {
    database.close();
  }
}

export async function loadDecksListSnapshot(): Promise<DecksListSnapshot> {
  const database = await openDatabase();
  try {
    const nowTimestamp = Date.now();
    const decks = await loadActiveDecksWithDatabase(database);
    let allCardsStats = emptyDeckStatsAccumulator();
    const deckStatsById = new Map<string, DeckStatsAccumulator>(
      decks.map((deck) => [deck.deckId, emptyDeckStatsAccumulator()] as const),
    );

    await iterateCardsByCreatedAtDesc(database, (card) => {
      if (card.deletedAt !== null) {
        return true;
      }

      allCardsStats = appendCardToDeckStats(allCardsStats, card, nowTimestamp);
      for (const deck of decks) {
        if (matchesDeckFilterDefinition(deck.filterDefinition, card) === false) {
          continue;
        }

        const currentStats = deckStatsById.get(deck.deckId);
        if (currentStats === undefined) {
          throw new Error(`Deck stats accumulator is missing: ${deck.deckId}`);
        }
        deckStatsById.set(deck.deckId, appendCardToDeckStats(currentStats, card, nowTimestamp));
      }
      return true;
    });

    return {
      allCardsStats: toDeckCardStats(allCardsStats),
      deckSummaries: decks.map((deck) => {
        const stats = deckStatsById.get(deck.deckId);
        if (stats === undefined) {
          throw new Error(`Deck stats accumulator is missing: ${deck.deckId}`);
        }

        return {
          deckId: deck.deckId,
          name: deck.name,
          filterDefinition: deck.filterDefinition,
          createdAt: deck.createdAt,
          totalCards: stats.totalCards,
          dueCards: stats.dueCards,
          newCards: stats.newCards,
          reviewedCards: stats.reviewedCards,
        };
      }),
    };
  } finally {
    database.close();
  }
}

export async function loadWorkspaceOverviewSnapshot(workspace: WorkspaceSummary): Promise<WorkspaceOverviewSnapshot> {
  const [tagsSummary, decksSnapshot] = await Promise.all([
    loadWorkspaceTagsSummary(),
    loadDecksListSnapshot(),
  ]);

  return {
    workspaceName: workspace.name,
    deckCount: decksSnapshot.deckSummaries.length,
    tagsCount: tagsSummary.tags.length,
    totalCards: decksSnapshot.allCardsStats.totalCards,
    dueCount: decksSnapshot.allCardsStats.dueCards,
    newCount: decksSnapshot.allCardsStats.newCards,
    reviewedCount: decksSnapshot.allCardsStats.reviewedCards,
  };
}

export async function loadDeckById(deckId: string): Promise<Deck | null> {
  const database = await openDatabase();
  const deck = await getFromStore<Deck>(database, "decks", deckId);
  database.close();

  if (deck === undefined || deck.deletedAt !== null) {
    return null;
  }

  return deck;
}

export async function loadCardById(cardId: string): Promise<Card | null> {
  const database = await openDatabase();
  const card = await getFromStore<Card>(database, "cards", cardId);
  database.close();

  if (card === undefined || card.deletedAt !== null) {
    return null;
  }

  return card;
}

export async function loadCardsMatchingDeck(filterDefinition: Deck["filterDefinition"]): Promise<ReadonlyArray<Card>> {
  const database = await openDatabase();
  try {
    const cards: Array<Card> = [];
    await iterateCardsByCreatedAtDesc(database, (card) => {
      if (card.deletedAt !== null) {
        return true;
      }
      if (matchesDeckFilterDefinition(filterDefinition, card)) {
        cards.push(card);
      }
      return true;
    });
    return cards;
  } finally {
    database.close();
  }
}

export async function loadReviewQueueSnapshot(
  reviewFilter: ReviewFilter,
  limit: number,
): Promise<ReviewQueueSnapshot> {
  const database = await openDatabase();
  try {
    const nowTimestamp = Date.now();
    const { filterResolution, accumulator } = await collectReviewCandidates(database, reviewFilter, nowTimestamp);
    const pageCards = accumulator.dueCards.slice(0, limit);

    return {
      resolvedReviewFilter: filterResolution.resolvedReviewFilter,
      cards: pageCards,
      nextCursor: buildReviewQueueCursor(accumulator.dueCards, pageCards),
      reviewCounts: makeReviewCountsFromCards(accumulator.matchingCards, nowTimestamp),
    };
  } finally {
    database.close();
  }
}

export async function loadReviewQueueChunk(
  reviewFilter: ReviewFilter,
  cursor: string | null,
  limit: number,
  excludedCardIds: ReadonlySet<string>,
): Promise<Readonly<{ cards: ReadonlyArray<Card>; nextCursor: string | null }>> {
  const database = await openDatabase();
  try {
    const nowTimestamp = Date.now();
    const filterResolution = await resolveReviewFilterFromIndexedDb(database, reviewFilter);
    const cursorPredicate = makeReviewCursorCardIdPredicate(cursor);
    let hasReachedCursor = cursorPredicate.isSet === false;
    let pageCards: Array<Card> = [];
    let hasMoreCards = false;

    await iterateReviewCardsInCanonicalOrder(database, nowTimestamp, (card) => {
      if (excludedCardIds.has(card.cardId)) {
        return true;
      }
      if (matchesResolvedReviewFilter(card, filterResolution) === false) {
        return true;
      }
      if (isCardDue(card, nowTimestamp) === false) {
        return true;
      }

      if (hasReachedCursor === false) {
        if (cursorPredicate.matches(card.cardId)) {
          hasReachedCursor = true;
        }
        return true;
      }

      if (pageCards.length < limit) {
        pageCards = [...pageCards, card];
        return true;
      }

      hasMoreCards = true;
      return false;
    });

    return {
      cards: pageCards,
      nextCursor: hasMoreCards && pageCards.length > 0
        ? encodeCursor({ cardId: pageCards[pageCards.length - 1]?.cardId ?? "" })
        : null,
    };
  } finally {
    database.close();
  }
}

export async function loadReviewTimelinePage(
  reviewFilter: ReviewFilter,
  limit: number,
  offset: number,
): Promise<ReviewTimelinePage> {
  const database = await openDatabase();
  try {
    const nowTimestamp = Date.now();
    const filterResolution = await resolveReviewFilterFromIndexedDb(database, reviewFilter);
    let matchingIndex = 0;
    let pageCards: Array<Card> = [];
    let hasMoreCards = false;

    await iterateReviewCardsInCanonicalOrder(database, nowTimestamp, (card) => {
      if (matchesResolvedReviewFilter(card, filterResolution) === false) {
        return true;
      }

      if (matchingIndex >= offset && pageCards.length < limit) {
        pageCards = [...pageCards, card];
      } else if (matchingIndex >= offset + limit) {
        hasMoreCards = true;
        return false;
      }

      matchingIndex += 1;
      return true;
    });

    return {
      cards: pageCards,
      hasMoreCards,
    };
  } finally {
    database.close();
  }
}

export async function relinkWorkspaceCache(workspaceId: string): Promise<void> {
  const cache = await readWebSyncCache();
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
