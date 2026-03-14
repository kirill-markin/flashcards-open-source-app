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

function resolveReviewFilterFromLocalData(
  reviewFilter: ReviewFilter,
  cards: ReadonlyArray<Card>,
  decks: ReadonlyArray<Deck>,
): ReviewFilter {
  if (reviewFilter.kind === "allCards") {
    return ALL_CARDS_REVIEW_FILTER;
  }

  if (reviewFilter.kind === "deck") {
    const matchingDeck = decks.find((deck) => deck.deckId === reviewFilter.deckId);
    return matchingDeck === undefined ? ALL_CARDS_REVIEW_FILTER : reviewFilter;
  }

  const hasActiveTag = cards.some((card) => card.tags.includes(reviewFilter.tag));
  return hasActiveTag ? reviewFilter : ALL_CARDS_REVIEW_FILTER;
}

function cardsMatchingReviewFilter(
  reviewFilter: ReviewFilter,
  cards: ReadonlyArray<Card>,
  decks: ReadonlyArray<Deck>,
): ReadonlyArray<Card> {
  const resolvedReviewFilter = resolveReviewFilterFromLocalData(reviewFilter, cards, decks);

  if (resolvedReviewFilter.kind === "allCards") {
    return cards;
  }

  if (resolvedReviewFilter.kind === "deck") {
    const deck = decks.find((candidateDeck) => candidateDeck.deckId === resolvedReviewFilter.deckId);
    if (deck === undefined) {
      return cards;
    }

    return cards.filter((card) => matchesDeckFilterDefinition(deck.filterDefinition, card));
  }

  return cards.filter((card) => card.tags.includes(resolvedReviewFilter.tag));
}

async function listAllCards(database: IDBDatabase): Promise<ReadonlyArray<Card>> {
  const cards = await getAllFromStore<Card>(database, "cards");
  return cards.filter((card) => card.deletedAt === null);
}

async function listAllDecks(database: IDBDatabase): Promise<ReadonlyArray<Deck>> {
  const decks = await getAllFromStore<Deck>(database, "decks");
  return decks.filter((deck) => deck.deletedAt === null);
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

function resolveReviewStartIndex(cards: ReadonlyArray<Card>, cursor: string | null): number {
  if (cursor === null) {
    return 0;
  }

  const parsedCursor = decodeCursor(cursor);
  const cardId = parsedCursor.cardId;
  if (typeof cardId !== "string" || cardId === "") {
    throw new Error("review cursor.cardId must be a non-empty string");
  }

  const index = cards.findIndex((card) => card.cardId === cardId);
  if (index === -1) {
    return 0;
  }

  return index + 1;
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

/**
 * Local chat and settings diagnostics still need a holistic workspace view,
 * but they now build it directly from IndexedDB on demand instead of relying
 * on a UI-hydrated in-memory snapshot.
 */
export async function loadLocalSnapshot(): Promise<WebSyncCache> {
  return readWebSyncCache();
}

export async function loadCloudSettings(): Promise<CloudSettings | null> {
  const database = await openDatabase();
  const cloudSettingsRecord = await getFromStore<CloudSettingsRecord>(database, "meta", "cloud_settings");
  database.close();
  return cloudSettingsRecord?.settings ?? null;
}

export async function loadWorkspaceSettings(): Promise<WorkspaceSchedulerSettings | null> {
  const database = await openDatabase();
  const workspaceSettingsRecords = await getAllFromStore<WorkspaceSettingsRecord>(database, "workspaceSettings");
  database.close();
  return workspaceSettingsRecords[0]?.settings ?? null;
}

/**
 * Query-driven cards page used by the web cards tab. This intentionally reads
 * from the local IndexedDB mirror so first paint does not depend on backend
 * list endpoints or a pre-hydrated app-wide cards array.
 */
export async function queryLocalCardsPage(input: QueryCardsInput): Promise<QueryCardsPage> {
  const database = await openDatabase();
  const normalizedSearchText = normalizeSearchText(input.searchText);
  const allCards = await listAllCards(database);
  database.close();

  const filteredCards = allCards
    .filter((card) => matchesSearchText(card, normalizedSearchText))
    .filter((card) => input.filter === null || matchesCardFilter(input.filter, card))
    .sort((leftCard, rightCard) => compareCardsForCardsQuery(leftCard, rightCard, input.sorts));

  const startIndex = resolveCardsPageStartIndex(filteredCards, input.cursor);
  const pageCards = filteredCards.slice(startIndex, startIndex + input.limit);

  return {
    cards: pageCards,
    nextCursor: buildCardsPageCursor(filteredCards, pageCards),
    totalCount: filteredCards.length,
  };
}

export async function loadWorkspaceTagsSummary(): Promise<WorkspaceTagsSummary> {
  const database = await openDatabase();
  const cards = await listAllCards(database);
  database.close();

  const counts = cards.reduce((result, card) => {
    for (const tag of new Set(card.tags)) {
      result.set(tag, (result.get(tag) ?? 0) + 1);
    }

    return result;
  }, new Map<string, number>());

  return {
    tags: [...counts.entries()]
      .map(([tag, cardsCount]) => ({
        tag,
        cardsCount,
      }))
      .sort(compareTagSummaries),
    totalCards: cards.length,
  };
}

export async function loadDecksListSnapshot(): Promise<DecksListSnapshot> {
  const database = await openDatabase();
  const cards = await listAllCards(database);
  const decks = await listAllDecks(database);
  database.close();
  const nowTimestamp = Date.now();

  return {
    allCardsStats: makeDeckCardStats(cards, nowTimestamp),
    deckSummaries: decks
      .map((deck) => {
        const matchingCards = cards.filter((card) => matchesDeckFilterDefinition(deck.filterDefinition, card));
        const stats = makeDeckCardStats(matchingCards, nowTimestamp);
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
      })
      .sort((leftDeck, rightDeck) => {
        const createdAtDifference = rightDeck.createdAt.localeCompare(leftDeck.createdAt);
        if (createdAtDifference !== 0) {
          return createdAtDifference;
        }

        return rightDeck.deckId.localeCompare(leftDeck.deckId);
      }),
  };
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
  const cards = await listAllCards(database);
  database.close();
  return cards
    .filter((card) => matchesDeckFilterDefinition(filterDefinition, card))
    .sort((leftCard, rightCard) => rightCard.createdAt.localeCompare(leftCard.createdAt) || leftCard.cardId.localeCompare(rightCard.cardId));
}

export async function loadReviewQueueSnapshot(
  reviewFilter: ReviewFilter,
  limit: number,
): Promise<ReviewQueueSnapshot> {
  const database = await openDatabase();
  const cards = await listAllCards(database);
  const decks = await listAllDecks(database);
  database.close();
  const nowTimestamp = Date.now();
  const resolvedReviewFilter = resolveReviewFilterFromLocalData(reviewFilter, cards, decks);
  const matchingCards = [...cardsMatchingReviewFilter(resolvedReviewFilter, cards, decks)]
    .sort((leftCard: Card, rightCard: Card) => compareCardsForReviewOrder(leftCard, rightCard, nowTimestamp));
  const dueCards = matchingCards.filter((card) => isCardDue(card, nowTimestamp));
  const pageCards = dueCards.slice(0, limit);

  return {
    resolvedReviewFilter,
    cards: pageCards,
    nextCursor: buildReviewQueueCursor(dueCards, pageCards),
    reviewCounts: makeReviewCountsFromCards(matchingCards, nowTimestamp),
  };
}

export async function loadReviewQueueChunk(
  reviewFilter: ReviewFilter,
  cursor: string | null,
  limit: number,
  excludedCardIds: ReadonlySet<string>,
): Promise<Readonly<{ cards: ReadonlyArray<Card>; nextCursor: string | null }>> {
  const database = await openDatabase();
  const cards = await listAllCards(database);
  const decks = await listAllDecks(database);
  database.close();
  const nowTimestamp = Date.now();
  const resolvedReviewFilter = resolveReviewFilterFromLocalData(reviewFilter, cards, decks);
  const dueCards = [...cardsMatchingReviewFilter(resolvedReviewFilter, cards, decks)]
    .filter((card) => excludedCardIds.has(card.cardId) === false)
    .filter((card) => isCardDue(card, nowTimestamp))
    .sort((leftCard: Card, rightCard: Card) => compareCardsForReviewOrder(leftCard, rightCard, nowTimestamp));
  const startIndex = resolveReviewStartIndex(dueCards, cursor);
  const pageCards = dueCards.slice(startIndex, startIndex + limit);

  return {
    cards: pageCards,
    nextCursor: buildReviewQueueCursor(dueCards, pageCards),
  };
}

export async function loadReviewTimelinePage(
  reviewFilter: ReviewFilter,
  limit: number,
  offset: number,
): Promise<ReviewTimelinePage> {
  const database = await openDatabase();
  const cards = await listAllCards(database);
  const decks = await listAllDecks(database);
  database.close();
  const nowTimestamp = Date.now();
  const resolvedReviewFilter = resolveReviewFilterFromLocalData(reviewFilter, cards, decks);
  const matchingCards = [...cardsMatchingReviewFilter(resolvedReviewFilter, cards, decks)]
    .sort((leftCard: Card, rightCard: Card) => compareCardsForReviewOrder(leftCard, rightCard, nowTimestamp));
  const pageCards = matchingCards.slice(offset, offset + limit + 1);

  return {
    cards: pageCards.slice(0, limit),
    hasMoreCards: pageCards.length > limit,
  };
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
