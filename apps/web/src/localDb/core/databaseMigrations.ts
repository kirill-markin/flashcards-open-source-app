import { normalizeCardMetadata, normalizeCardType } from "../../appData/domain/cardMetadata";
import { deriveDueAtBucketMillis, deriveDueAtMillis, parseDueAtMillis } from "../../appData/domain/dueAt";
import { appendLegacyEffortTag } from "../../legacyEffort";
import type { Card, Deck, LegacyEffortLevel, SyncPushOperation } from "../../types";
import type { ProgressCacheStateRecord, StoredCard } from "./database";
import {
  createCardTagsStore,
  createCardsDueAtBucketMillisIndex,
  createCardsDueAtMillisIndex,
  createCardsFsrsLastReviewedAtMillisIndex,
  createCardsStore,
  createCardsUpdatedAtIndexes,
  createDecksStore,
  createMediaAssetsStore,
  createMetaStore,
  createOutboxStore,
  createProgressDailyCountsStore,
  createReviewEventsIndexes,
  createReviewEventsStore,
  createWorkspaceSettingsStore,
  createWorkspaceSyncStateStore,
  deleteExistingIndex,
  deleteExistingStore,
  progressCacheStateKey,
  version4DatabaseStoreNames,
} from "./databaseSchema";

type StoredCardMetadataMigrationFields = Readonly<{
  cardType?: unknown;
  metadata?: unknown;
}>;

type StoredCardMetadataMigrationRecord = Omit<StoredCard, "cardType" | "metadata"> & StoredCardMetadataMigrationFields;

type StoredCardDueAtMigrationRecord = Omit<
  StoredCard,
  "dueAt" | "dueAtMillis" | "dueAtBucketMillis" | "fsrsLastReviewedAtMillis" | "cardType" | "metadata"
> & StoredCardMetadataMigrationFields & Readonly<{
  dueAt?: string | null;
  dueAtMillis?: number | null;
  dueAtBucketMillis?: number;
  fsrsLastReviewedAtMillis?: number | null;
}>;

type StoredCardLegacyEffortMigrationRecord = StoredCardDueAtMigrationRecord & Readonly<{
  effortLevel?: LegacyEffortLevel;
}>;

type StoredDeckLegacyEffortMigrationRecord = Omit<Deck, "filterDefinition"> & Readonly<{
  filterDefinition: Readonly<{
    version: 2;
    effortLevels?: ReadonlyArray<LegacyEffortLevel>;
    tags: ReadonlyArray<string>;
  }>;
}>;

type CardUpsertOperation = Extract<
  SyncPushOperation,
  Readonly<{ entityType: "card"; action: "upsert" }>
>;

type CardUpsertLegacyEffortMigrationOperation = Omit<CardUpsertOperation, "payload"> & Readonly<{
  payload: Omit<CardUpsertOperation["payload"], "cardType" | "metadata"> & Readonly<{
    cardType?: unknown;
    metadata?: unknown;
  }>;
}>;

type DeckUpsertLegacyEffortMigrationOperation = Extract<
  SyncPushOperation,
  Readonly<{ entityType: "deck"; action: "upsert" }>
>;

type StoredOutboxLegacyEffortMigrationRecord = Readonly<{
  operation: SyncPushOperation;
}>;

function hasOwnProperty(objectValue: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(objectValue, key);
}

function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

function describeIndexedDbMigrationError(prefix: string, error: unknown): Error {
  if (isQuotaExceededError(error)) {
    return new Error(`${prefix}: browser storage quota was exceeded`);
  }

  if (error instanceof Error && error.message !== "") {
    return new Error(`${prefix}: ${error.message}`);
  }

  return new Error(`${prefix}: unknown error`);
}

function requireUpgradeTransaction(transaction: IDBTransaction | null): IDBTransaction {
  if (transaction === null) {
    throw new Error("IndexedDB upgrade transaction is unavailable");
  }

  return transaction;
}

function shouldRunVersionUpgrade(oldVersion: number, newVersion: number, targetVersion: number): boolean {
  return oldVersion < targetVersion && targetVersion <= newVersion;
}

function upgradeToVersion4(database: IDBDatabase): void {
  for (const storeName of version4DatabaseStoreNames) {
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

function normalizeStoredCardMetadataFields(record: StoredCardMetadataMigrationRecord): StoredCard {
  return {
    ...record,
    cardType: normalizeCardType(record.cardType),
    metadata: normalizeCardMetadata(record.metadata, record.createdAt),
  };
}

function normalizeStoredCardDueAtDerivedFields(record: StoredCardDueAtMigrationRecord): StoredCard {
  const dueAt = record.dueAt ?? null;
  return normalizeStoredCardMetadataFields({
    ...record,
    dueAt,
    dueAtMillis: deriveDueAtMillis(dueAt),
    dueAtBucketMillis: deriveDueAtBucketMillis(dueAt),
    fsrsLastReviewedAtMillis: normalizeStoredCardFsrsLastReviewedAtMillis(record),
  });
}

function normalizeStoredCardLegacyEffort(record: StoredCardLegacyEffortMigrationRecord): StoredCard {
  const { effortLevel, ...storedCardRecord } = record;
  return {
    ...normalizeStoredCardDueAtDerivedFields(storedCardRecord),
    tags: appendLegacyEffortTag(record.tags, effortLevel),
  };
}

function appendLegacyEffortLevelsToTags(
  tags: ReadonlyArray<string>,
  effortLevels: ReadonlyArray<LegacyEffortLevel>,
): ReadonlyArray<string> {
  return effortLevels.reduce(
    (currentTags, effortLevel) => appendLegacyEffortTag(currentTags, effortLevel),
    tags,
  );
}

function normalizeStoredDeckLegacyEffort(record: StoredDeckLegacyEffortMigrationRecord): Deck {
  const {
    filterDefinition,
    ...storedDeckRecord
  } = record;

  return {
    ...storedDeckRecord,
    filterDefinition: {
      version: filterDefinition.version,
      tags: appendLegacyEffortLevelsToTags(filterDefinition.tags, filterDefinition.effortLevels ?? []),
    },
  };
}

function normalizeOutboxCardUpsertLegacyEffort(
  operation: CardUpsertLegacyEffortMigrationOperation,
): CardUpsertOperation {
  const { cardType, metadata, ...payloadWithoutMetadataFields } = operation.payload;
  const metadataFields: {
    cardType?: NonNullable<CardUpsertOperation["payload"]["cardType"]>;
    metadata?: NonNullable<CardUpsertOperation["payload"]["metadata"]>;
  } = {};
  if (hasOwnProperty(operation.payload, "cardType")) {
    metadataFields.cardType = normalizeCardType(cardType);
  }
  if (hasOwnProperty(operation.payload, "metadata")) {
    metadataFields.metadata = normalizeCardMetadata(metadata, operation.payload.createdAt);
  }

  return {
    ...operation,
    payload: {
      ...payloadWithoutMetadataFields,
      ...metadataFields,
      tags: appendLegacyEffortTag(operation.payload.tags, operation.payload.effortLevel),
      effortLevel: "fast",
    },
  };
}

function normalizeOutboxDeckUpsertLegacyEffort(
  operation: DeckUpsertLegacyEffortMigrationOperation,
): DeckUpsertLegacyEffortMigrationOperation {
  return {
    ...operation,
    payload: {
      ...operation.payload,
      filterDefinition: {
        version: operation.payload.filterDefinition.version,
        effortLevels: [],
        tags: appendLegacyEffortLevelsToTags(
          operation.payload.filterDefinition.tags,
          operation.payload.filterDefinition.effortLevels,
        ),
      },
    },
  };
}

function normalizeOutboxOperationLegacyEffort(operation: SyncPushOperation): SyncPushOperation {
  if (operation.entityType === "card" && operation.action === "upsert") {
    return normalizeOutboxCardUpsertLegacyEffort(operation);
  }

  if (operation.entityType === "deck" && operation.action === "upsert") {
    return normalizeOutboxDeckUpsertLegacyEffort(operation);
  }

  return operation;
}

function normalizeStoredOutboxLegacyEffort(
  record: StoredOutboxLegacyEffortMigrationRecord,
): StoredOutboxLegacyEffortMigrationRecord {
  return {
    ...record,
    // TODO: Remove this legacy outbox shim when the backend sync wire contract drops effort.
    operation: normalizeOutboxOperationLegacyEffort(record.operation),
  };
}

function normalizeStoredCardFsrsLastReviewedAtMillis(
  record: Pick<StoredCard, "fsrsLastReviewedAt"> & Readonly<{ fsrsLastReviewedAtMillis?: number | null }>,
): number | null {
  if (typeof record.fsrsLastReviewedAtMillis === "number" && Number.isFinite(record.fsrsLastReviewedAtMillis)) {
    return record.fsrsLastReviewedAtMillis;
  }

  if (record.fsrsLastReviewedAt === null) {
    return null;
  }

  return parseDueAtMillis(record.fsrsLastReviewedAt);
}

function migrateCardsDueAtDerivedFields(cardsStore: IDBObjectStore, errorPrefix: string): void {
  const request = cardsStore.openCursor();
  request.onerror = () => {
    throw describeIndexedDbMigrationError(errorPrefix, request.error);
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

function upgradeToVersion13(transaction: IDBTransaction): void {
  const cardsStore = transaction.objectStore("cards");
  createCardsFsrsLastReviewedAtMillisIndex(cardsStore);
  migrateCardsDueAtDerivedFields(cardsStore, "IndexedDB fsrsLastReviewedAtMillis migration failed");
}

function upgradeToVersion14(transaction: IDBTransaction): void {
  transaction.objectStore("progressDailyCounts").clear();
  const metaStore = transaction.objectStore("meta");
  const cacheStateRequest = metaStore.get(progressCacheStateKey);

  cacheStateRequest.onerror = () => {
    throw describeIndexedDbMigrationError("IndexedDB progress rating-count migration failed", cacheStateRequest.error);
  };
  cacheStateRequest.onsuccess = () => {
    const cacheState = cacheStateRequest.result as ProgressCacheStateRecord | undefined;
    if (cacheState === undefined) {
      return;
    }

    metaStore.put({
      ...cacheState,
      needsRebuild: true,
      updatedAt: new Date().toISOString(),
    });
  };
}

function migrateCardsLegacyEffortTags(cardsStore: IDBObjectStore, cardTagsStore: IDBObjectStore): void {
  const request = cardsStore.openCursor();
  request.onerror = () => {
    throw describeIndexedDbMigrationError("IndexedDB legacy effort migration failed", request.error);
  };
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }

    const migratedCard = normalizeStoredCardLegacyEffort(cursor.value as StoredCardLegacyEffortMigrationRecord);
    cursor.update(migratedCard);
    if (migratedCard.deletedAt === null) {
      for (const tag of migratedCard.tags) {
        if (tag === "") {
          continue;
        }

        cardTagsStore.put({
          workspaceId: migratedCard.workspaceId,
          cardId: migratedCard.cardId,
          tag,
        });
      }
    }
    cursor.continue();
  };
}

function migrateDecksLegacyEffortTags(decksStore: IDBObjectStore): void {
  const request = decksStore.openCursor();
  request.onerror = () => {
    throw describeIndexedDbMigrationError("IndexedDB legacy deck effort migration failed", request.error);
  };
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }

    cursor.update(normalizeStoredDeckLegacyEffort(cursor.value as StoredDeckLegacyEffortMigrationRecord));
    cursor.continue();
  };
}

function migrateOutboxLegacyEffortOperations(outboxStore: IDBObjectStore): void {
  const request = outboxStore.openCursor();
  request.onerror = () => {
    throw describeIndexedDbMigrationError("IndexedDB legacy outbox effort migration failed", request.error);
  };
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }

    cursor.update(normalizeStoredOutboxLegacyEffort(cursor.value as StoredOutboxLegacyEffortMigrationRecord));
    cursor.continue();
  };
}

function upgradeToVersion15(transaction: IDBTransaction): void {
  const cardsStore = transaction.objectStore("cards");
  deleteExistingIndex(cardsStore, "workspaceId_effort_createdAt_cardId");
  deleteExistingIndex(cardsStore, "workspaceId_effort_updatedAt_cardId");
  migrateCardsLegacyEffortTags(cardsStore, transaction.objectStore("cardTags"));
  migrateDecksLegacyEffortTags(transaction.objectStore("decks"));
  migrateOutboxLegacyEffortOperations(transaction.objectStore("outbox"));
}

function migrateCardsMetadataFields(cardsStore: IDBObjectStore): void {
  const request = cardsStore.openCursor();
  request.onerror = () => {
    throw describeIndexedDbMigrationError("IndexedDB card metadata migration failed", request.error);
  };
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }

    cursor.update(normalizeStoredCardLegacyEffort(cursor.value as StoredCardLegacyEffortMigrationRecord));
    cursor.continue();
  };
}

function migrateOutboxCardMetadataOperations(outboxStore: IDBObjectStore): void {
  const request = outboxStore.openCursor();
  request.onerror = () => {
    throw describeIndexedDbMigrationError("IndexedDB outbox card metadata migration failed", request.error);
  };
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }

    cursor.update(normalizeStoredOutboxLegacyEffort(cursor.value as StoredOutboxLegacyEffortMigrationRecord));
    cursor.continue();
  };
}

function upgradeToVersion16(transaction: IDBTransaction): void {
  migrateCardsMetadataFields(transaction.objectStore("cards"));
  migrateOutboxCardMetadataOperations(transaction.objectStore("outbox"));
}

function upgradeToVersion17(database: IDBDatabase): void {
  if (database.objectStoreNames.contains("mediaAssets") === false) {
    createMediaAssetsStore(database);
  }
}

export function upgradeDatabase(
  database: IDBDatabase,
  oldVersion: number,
  newVersion: number,
  transaction: IDBTransaction | null,
): void {
  if (shouldRunVersionUpgrade(oldVersion, newVersion, 4)) {
    upgradeToVersion4(database);
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 5)) {
    upgradeToVersion5(database);
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 6)) {
    upgradeToVersion6(database);
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 7)) {
    upgradeToVersion7(requireUpgradeTransaction(transaction));
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 8)) {
    upgradeToVersion8(requireUpgradeTransaction(transaction));
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 9)) {
    upgradeToVersion9(database);
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 10)) {
    upgradeToVersion10(requireUpgradeTransaction(transaction));
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 11)) {
    upgradeToVersion11(requireUpgradeTransaction(transaction));
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 12)) {
    upgradeToVersion12(requireUpgradeTransaction(transaction));
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 13)) {
    upgradeToVersion13(requireUpgradeTransaction(transaction));
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 14)) {
    upgradeToVersion14(requireUpgradeTransaction(transaction));
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 15)) {
    upgradeToVersion15(requireUpgradeTransaction(transaction));
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 16)) {
    upgradeToVersion16(requireUpgradeTransaction(transaction));
  }

  if (shouldRunVersionUpgrade(oldVersion, newVersion, 17)) {
    upgradeToVersion17(database);
  }
}
