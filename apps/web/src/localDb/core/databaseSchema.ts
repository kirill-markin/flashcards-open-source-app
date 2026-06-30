export type DatabaseStores =
  | "cards"
  | "cardTags"
  | "decks"
  | "mediaAssets"
  | "progressDailyCounts"
  | "reviewEvents"
  | "workspaceSettings"
  | "workspaceSyncState"
  | "outbox"
  | "meta";

export const databaseName = "flashcards-web-sync";
export const databaseVersion = 17;
export const progressCacheStateKey = "progress_cache_state";

export const version4DatabaseStoreNames: ReadonlyArray<DatabaseStores> = [
  "cards",
  "cardTags",
  "decks",
  "progressDailyCounts",
  "reviewEvents",
  "workspaceSettings",
  "workspaceSyncState",
  "outbox",
  "meta",
];

export function deleteExistingStore(database: IDBDatabase, storeName: string): void {
  if (database.objectStoreNames.contains(storeName)) {
    database.deleteObjectStore(storeName);
  }
}

export function deleteExistingIndex(store: IDBObjectStore, indexName: string): void {
  if (store.indexNames.contains(indexName)) {
    store.deleteIndex(indexName);
  }
}

export function createReviewEventsIndexes(reviewEventsStore: IDBObjectStore): void {
  if (!reviewEventsStore.indexNames.contains("workspaceId_reviewedAtClient_reviewEventId")) {
    reviewEventsStore.createIndex(
      "workspaceId_reviewedAtClient_reviewEventId",
      ["workspaceId", "reviewedAtClient", "reviewEventId"],
      { unique: false },
    );
  }
}

export function createCardsUpdatedAtIndexes(cardsStore: IDBObjectStore): void {
  if (!cardsStore.indexNames.contains("workspaceId_updatedAt_cardId")) {
    cardsStore.createIndex("workspaceId_updatedAt_cardId", ["workspaceId", "updatedAt", "cardId"], { unique: false });
  }
}

export function createCardsDueAtMillisIndex(cardsStore: IDBObjectStore): void {
  if (!cardsStore.indexNames.contains("workspaceId_dueAtMillis_cardId")) {
    cardsStore.createIndex("workspaceId_dueAtMillis_cardId", ["workspaceId", "dueAtMillis", "cardId"], { unique: false });
  }
}

export function createCardsDueAtBucketMillisIndex(cardsStore: IDBObjectStore): void {
  if (!cardsStore.indexNames.contains("workspaceId_dueAtBucketMillis_cardId")) {
    cardsStore.createIndex("workspaceId_dueAtBucketMillis_cardId", ["workspaceId", "dueAtBucketMillis", "cardId"], { unique: false });
  }
}

export function createCardsFsrsLastReviewedAtMillisIndex(cardsStore: IDBObjectStore): void {
  if (!cardsStore.indexNames.contains("workspaceId_fsrsLastReviewedAtMillis_dueAtMillis_cardId")) {
    cardsStore.createIndex(
      "workspaceId_fsrsLastReviewedAtMillis_dueAtMillis_cardId",
      ["workspaceId", "fsrsLastReviewedAtMillis", "dueAtMillis", "cardId"],
      { unique: false },
    );
  }
}

export function createCardsStore(database: IDBDatabase): void {
  const cardsStore = database.createObjectStore("cards", { keyPath: ["workspaceId", "cardId"] });
  cardsStore.createIndex("workspaceId_createdAt_cardId", ["workspaceId", "createdAt", "cardId"], { unique: false });
  // TODO: Drop this legacy dueAt index after cards-list sorting no longer depends on the boundary string field.
  cardsStore.createIndex("workspaceId_dueAt_cardId", ["workspaceId", "dueAt", "cardId"], { unique: false });
  createCardsDueAtMillisIndex(cardsStore);
  createCardsDueAtBucketMillisIndex(cardsStore);
  createCardsUpdatedAtIndexes(cardsStore);
  createCardsFsrsLastReviewedAtMillisIndex(cardsStore);
}

export function createCardTagsStore(database: IDBDatabase): void {
  const cardTagsStore = database.createObjectStore("cardTags", { keyPath: ["workspaceId", "cardId", "tag"] });
  cardTagsStore.createIndex("workspaceId_tag_cardId", ["workspaceId", "tag", "cardId"], { unique: false });
  cardTagsStore.createIndex("workspaceId_cardId_tag", ["workspaceId", "cardId", "tag"], { unique: false });
}

export function createDecksStore(database: IDBDatabase): void {
  const decksStore = database.createObjectStore("decks", { keyPath: ["workspaceId", "deckId"] });
  decksStore.createIndex("workspaceId_createdAt_deckId", ["workspaceId", "createdAt", "deckId"], { unique: false });
}

export function createMediaAssetsStore(database: IDBDatabase): void {
  const mediaAssetsStore = database.createObjectStore("mediaAssets", { keyPath: ["workspaceId", "mediaAssetId"] });
  mediaAssetsStore.createIndex("workspaceId_updatedAt_mediaAssetId", ["workspaceId", "updatedAt", "mediaAssetId"], { unique: false });
}

export function createReviewEventsStore(database: IDBDatabase): void {
  const reviewEventsStore = database.createObjectStore("reviewEvents", { keyPath: ["workspaceId", "reviewEventId"] });
  createReviewEventsIndexes(reviewEventsStore);
}

export function createProgressDailyCountsStore(database: IDBDatabase): void {
  database.createObjectStore("progressDailyCounts", { keyPath: ["workspaceId", "localDate"] });
}

export function createWorkspaceSettingsStore(database: IDBDatabase): void {
  database.createObjectStore("workspaceSettings", { keyPath: "workspaceId" });
}

export function createWorkspaceSyncStateStore(database: IDBDatabase): void {
  database.createObjectStore("workspaceSyncState", { keyPath: "workspaceId" });
}

export function createOutboxStore(database: IDBDatabase): void {
  const outboxStore = database.createObjectStore("outbox", { keyPath: ["workspaceId", "operationId"] });
  outboxStore.createIndex("workspaceId_createdAt", ["workspaceId", "createdAt"], { unique: false });
}

export function createMetaStore(database: IDBDatabase): void {
  database.createObjectStore("meta", { keyPath: "key" });
}
