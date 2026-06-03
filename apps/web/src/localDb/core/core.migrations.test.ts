// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { malformedDueAtBucketMillis, nullDueAtBucketMillis, parseDueAtMillis } from "../../appData/domain/dueAt";
import { clearWebSyncCache } from "./cache";
import { closeDatabaseAfter, deleteDatabase, getAllFromStore, openDatabase, type StoredCard } from "./database";
import { listOutboxRecords, type PersistedOutboxRecord } from "../sync/outbox";
import { loadReviewQueueSnapshot } from "../reviews";
import { makeCard, workspaceId } from "./testSupport";
import type { Card } from "../../types";

const observabilityMocks = vi.hoisted(() => ({
  addWebBreadcrumbMock: vi.fn(),
}));

vi.mock("../../observability/webObservability", () => ({
  addWebBreadcrumb: observabilityMocks.addWebBreadcrumbMock,
}));

type LegacyStoredCard = Omit<StoredCard, "dueAt" | "dueAtMillis" | "dueAtBucketMillis" | "fsrsLastReviewedAtMillis"> & Readonly<{
  dueAt?: string | null;
}>;

const webSyncDatabaseName = "flashcards-web-sync";
const legacyNullDueAtBucketMillis = -1;
const legacyMalformedDueAtBucketMillis = -2;

type DeferredVoid = Readonly<{
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}>;

function createDeferredVoid(): DeferredVoid {
  let resolvePromise: (() => void) | null = null;
  let rejectPromise: ((error: Error) => void) | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  if (resolvePromise === null || rejectPromise === null) {
    throw new Error("Failed to create deferred promise");
  }

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function createLegacyCardsStore(database: IDBDatabase): void {
  const cardsStore = database.createObjectStore("cards", { keyPath: ["workspaceId", "cardId"] });
  cardsStore.createIndex("workspaceId_createdAt_cardId", ["workspaceId", "createdAt", "cardId"], { unique: false });
  cardsStore.createIndex("workspaceId_dueAt_cardId", ["workspaceId", "dueAt", "cardId"], { unique: false });
  cardsStore.createIndex("workspaceId_effort_createdAt_cardId", ["workspaceId", "effortLevel", "createdAt", "cardId"], { unique: false });
  cardsStore.createIndex("workspaceId_updatedAt_cardId", ["workspaceId", "updatedAt", "cardId"], { unique: false });
  cardsStore.createIndex("workspaceId_effort_updatedAt_cardId", ["workspaceId", "effortLevel", "updatedAt", "cardId"], { unique: false });
}

function createLegacyCardTagsStore(database: IDBDatabase): void {
  const cardTagsStore = database.createObjectStore("cardTags", { keyPath: ["workspaceId", "cardId", "tag"] });
  cardTagsStore.createIndex("workspaceId_tag_cardId", ["workspaceId", "tag", "cardId"], { unique: false });
  cardTagsStore.createIndex("workspaceId_cardId_tag", ["workspaceId", "cardId", "tag"], { unique: false });
}

function createLegacyReviewEventsStore(database: IDBDatabase): void {
  const reviewEventsStore = database.createObjectStore("reviewEvents", { keyPath: ["workspaceId", "reviewEventId"] });
  reviewEventsStore.createIndex(
    "workspaceId_reviewedAtClient_reviewEventId",
    ["workspaceId", "reviewedAtClient", "reviewEventId"],
    { unique: false },
  );
}

function createLegacyVersion9Schema(database: IDBDatabase): void {
  createLegacyCardsStore(database);
  createLegacyCardTagsStore(database);
  database.createObjectStore("decks", { keyPath: ["workspaceId", "deckId"] })
    .createIndex("workspaceId_createdAt_deckId", ["workspaceId", "createdAt", "deckId"], { unique: false });
  database.createObjectStore("progressDailyCounts", { keyPath: ["workspaceId", "localDate"] });
  createLegacyReviewEventsStore(database);
  database.createObjectStore("workspaceSettings", { keyPath: "workspaceId" });
  database.createObjectStore("workspaceSyncState", { keyPath: "workspaceId" });
  database.createObjectStore("outbox", { keyPath: ["workspaceId", "operationId"] })
    .createIndex("workspaceId_createdAt", ["workspaceId", "createdAt"], { unique: false });
  database.createObjectStore("meta", { keyPath: "key" });
}

function createLegacyDueAtIndexes(transaction: IDBTransaction): void {
  const cardsStore = transaction.objectStore("cards");
  cardsStore.createIndex("workspaceId_dueAtMillis_cardId", ["workspaceId", "dueAtMillis", "cardId"], { unique: false });
  cardsStore.createIndex("workspaceId_dueAtBucketMillis_cardId", ["workspaceId", "dueAtBucketMillis", "cardId"], { unique: false });
}

function makeLegacyStoredCard(card: Card): LegacyStoredCard {
  return {
    workspaceId,
    cardId: card.cardId,
    frontText: card.frontText,
    backText: card.backText,
    tags: card.tags,
    effortLevel: card.effortLevel,
    dueAt: card.dueAt,
    createdAt: card.createdAt,
    reps: card.reps,
    lapses: card.lapses,
    fsrsCardState: card.fsrsCardState,
    fsrsStepIndex: card.fsrsStepIndex,
    fsrsStability: card.fsrsStability,
    fsrsDifficulty: card.fsrsDifficulty,
    fsrsLastReviewedAt: card.fsrsLastReviewedAt,
    fsrsScheduledDays: card.fsrsScheduledDays,
    clientUpdatedAt: card.clientUpdatedAt,
    lastModifiedByReplicaId: card.lastModifiedByReplicaId,
    lastOperationId: card.lastOperationId,
    updatedAt: card.updatedAt,
    deletedAt: card.deletedAt,
  };
}

function makeLegacyVersion11StoredCard(
  card: Card,
  dueAtMillis: number | null,
  dueAtBucketMillis: number,
): StoredCard {
  return {
    ...makeLegacyStoredCard(card),
    dueAt: card.dueAt,
    dueAtMillis,
    dueAtBucketMillis,
    fsrsLastReviewedAtMillis: card.fsrsLastReviewedAt === null ? null : parseDueAtMillis(card.fsrsLastReviewedAt),
  };
}

function putLegacyRecords(
  database: IDBDatabase,
  cards: ReadonlyArray<LegacyStoredCard>,
  outboxRecords: ReadonlyArray<PersistedOutboxRecord>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["cards", "outbox"], "readwrite");
    const cardsStore = transaction.objectStore("cards");
    const outboxStore = transaction.objectStore("outbox");

    for (const card of cards) {
      cardsStore.put(card);
    }

    for (const outboxRecord of outboxRecords) {
      outboxStore.put(outboxRecord);
    }

    transaction.onerror = () => {
      reject(new Error(`Legacy IndexedDB seed failed: ${transaction.error?.message ?? "unknown error"}`));
    };
    transaction.oncomplete = () => {
      resolve();
    };
  });
}

async function seedLegacyVersion9Database(
  cards: ReadonlyArray<LegacyStoredCard>,
  outboxRecords: ReadonlyArray<PersistedOutboxRecord>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(webSyncDatabaseName, 9);
    request.onerror = () => {
      reject(new Error(`Legacy IndexedDB open failed: ${request.error?.message ?? "unknown error"}`));
    };
    request.onupgradeneeded = () => {
      createLegacyVersion9Schema(request.result);
    };
    request.onsuccess = () => {
      const database = request.result;
      putLegacyRecords(database, cards, outboxRecords)
        .then(() => {
          database.close();
          resolve();
        })
        .catch((error: unknown) => {
          database.close();
          reject(error);
        });
    };
  });
}

async function seedLegacyVersion11Database(cards: ReadonlyArray<StoredCard>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(webSyncDatabaseName, 11);
    request.onerror = () => {
      reject(new Error(`Legacy IndexedDB open failed: ${request.error?.message ?? "unknown error"}`));
    };
    request.onupgradeneeded = () => {
      createLegacyVersion9Schema(request.result);
      const transaction = request.transaction;
      if (transaction === null) {
        throw new Error("Legacy IndexedDB upgrade transaction is unavailable");
      }
      createLegacyDueAtIndexes(transaction);
    };
    request.onsuccess = () => {
      const database = request.result;
      putLegacyRecords(database, cards, [])
        .then(() => {
          database.close();
          resolve();
        })
        .catch((error: unknown) => {
          database.close();
          reject(error);
        });
    };
  });
}

async function loadStoredCardsForTest(): Promise<ReadonlyArray<StoredCard>> {
  const database = await openDatabase();
  try {
    return await getAllFromStore<StoredCard>(database, "cards");
  } finally {
    database.close();
  }
}

async function loadCardsStoreIndexNamesForTest(): Promise<ReadonlyArray<string>> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["cards"], "readonly");
    const indexNames = transaction.objectStore("cards").indexNames;
    const result: Array<string> = [];
    for (let index = 0; index < indexNames.length; index += 1) {
      const indexName = indexNames.item(index);
      if (indexName === null) {
        throw new Error(`IndexedDB cards index name is missing at position ${index}`);
      }
      result.push(indexName);
    }
    return result;
  } finally {
    database.close();
  }
}

describe("localDb core migrations", () => {
  it("adds IndexedDB open metadata and breadcrumb when opening database fails", async () => {
    const sourceError = new DOMException("Open failed", "InvalidStateError");
    const openRequest = {
      error: sourceError,
      onerror: null,
      onsuccess: null,
      onupgradeneeded: null,
    } as unknown as IDBOpenDBRequest;
    const openDatabaseSpy = vi.spyOn(indexedDB, "open").mockReturnValue(openRequest);
    observabilityMocks.addWebBreadcrumbMock.mockReset();

    try {
      const openTask = openDatabase();
      if (openRequest.onerror === null) {
        throw new Error("IndexedDB open error handler was not registered");
      }

      openRequest.onerror.call(openRequest, new Event("error"));

      await expect(openTask).rejects.toMatchObject({
        indexedDbOperation: "open",
        databaseName: webSyncDatabaseName,
        databaseVersion: 13,
        indexedDbErrorName: "InvalidStateError",
      });
      expect(observabilityMocks.addWebBreadcrumbMock).toHaveBeenCalledWith(expect.objectContaining({
        action: "indexed_db_operation",
        details: expect.objectContaining({
          eventName: "indexed_db_operation_failed",
          indexedDbOperation: "open",
          databaseName: webSyncDatabaseName,
          databaseVersion: 13,
          indexedDbErrorName: "InvalidStateError",
        }),
      }));
    } finally {
      openDatabaseSpy.mockRestore();
    }
  });

  it("waits for managed IndexedDB operations before deleting browser data", async () => {
    await clearWebSyncCache();
    const readStarted = createDeferredVoid();
    const releaseRead = createDeferredVoid();
    const readTask = closeDatabaseAfter(async () => {
      readStarted.resolve();
      await releaseRead.promise;
    });
    await readStarted.promise;

    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    const deleteTask = deleteDatabase();

    try {
      expect(deleteDatabaseSpy).not.toHaveBeenCalled();
      await expect(closeDatabaseAfter(async () => undefined)).rejects.toThrow(
        "IndexedDB is unavailable while browser data is being reset",
      );

      releaseRead.resolve();
      await readTask;
      await deleteTask;
      expect(deleteDatabaseSpy).toHaveBeenCalledTimes(1);
    } finally {
      releaseRead.resolve();
      await Promise.allSettled([readTask, deleteTask]);
      deleteDatabaseSpy.mockRestore();
    }
  });

  it("migrates legacy dueAt into numeric due fields and keeps pending card upserts uploadable", async () => {
    await clearWebSyncCache();
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.100Z");
    const originalNow = Date.now;
    Date.now = () => nowTimestamp;

    try {
      const missingDueAtBase = makeLegacyStoredCard(makeCard({
        cardId: "missing-due-at",
        frontText: "Missing dueAt",
        backText: "back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2026-03-10T09:00:00.000Z",
      }));
      const { dueAt, ...missingDueAtRecord } = missingDueAtBase;
      void dueAt;

      await seedLegacyVersion9Database(
        [
          makeLegacyStoredCard(makeCard({
            cardId: "canonical-due",
            frontText: "Canonical due",
            backText: "back",
            tags: ["grammar"],
            effortLevel: "fast",
            dueAt: "2026-03-10T12:00:00.000Z",
            createdAt: "2026-03-10T09:00:00.000Z",
            fsrsLastReviewedAt: "2026-03-10T12:00:00.000Z",
          })),
          makeLegacyStoredCard(makeCard({
            cardId: "short-fraction-due",
            frontText: "Short fraction due",
            backText: "back",
            tags: ["grammar"],
            effortLevel: "fast",
            dueAt: "2026-03-10T12:00:00.1Z",
            createdAt: "2026-03-10T09:00:00.000Z",
          })),
          makeLegacyStoredCard(makeCard({
            cardId: "calendar-invalid-due",
            frontText: "Calendar invalid due",
            backText: "back",
            tags: ["grammar"],
            effortLevel: "fast",
            dueAt: "2026-02-31T12:00:00.000Z",
            createdAt: "2026-03-10T09:00:00.000Z",
          })),
          missingDueAtRecord,
        ],
        [
          {
            operationId: "pending-card-upsert",
            workspaceId,
            createdAt: "2026-03-10T12:00:00.000Z",
            attemptCount: 0,
            lastError: "",
            operation: {
              operationId: "pending-card-upsert",
              entityType: "card",
              entityId: "canonical-due",
              action: "upsert",
              clientUpdatedAt: "2026-03-10T12:00:00.000Z",
              payload: {
                cardId: "canonical-due",
                frontText: "Canonical due",
                backText: "back",
                tags: ["grammar"],
                effortLevel: "fast",
                dueAt: "2026-03-10T12:00:00.000Z",
                createdAt: "2026-03-10T09:00:00.000Z",
                reps: 1,
                lapses: 0,
                fsrsCardState: "review",
                fsrsStepIndex: null,
                fsrsStability: 1,
                fsrsDifficulty: 5,
                fsrsLastReviewedAt: "2026-03-10T12:00:00.000Z",
                fsrsScheduledDays: 1,
                deletedAt: null,
              },
            },
          },
        ],
      );

      const storedCards = await loadStoredCardsForTest();
      const cardsStoreIndexNames = await loadCardsStoreIndexNamesForTest();
      const dueAtMillisByCardId = new Map(storedCards.map((card) => [card.cardId, card.dueAtMillis]));
      const dueAtBucketMillisByCardId = new Map(storedCards.map((card) => [card.cardId, card.dueAtBucketMillis]));
      const fsrsLastReviewedAtMillisByCardId = new Map(storedCards.map((card) => [card.cardId, card.fsrsLastReviewedAtMillis]));
      const migratedCalendarInvalidDueAt = storedCards.find((card) => card.cardId === "calendar-invalid-due");
      const migratedMissingDueAt = storedCards.find((card) => card.cardId === "missing-due-at");

      expect(cardsStoreIndexNames).toContain("workspaceId_dueAtMillis_cardId");
      expect(cardsStoreIndexNames).toContain("workspaceId_dueAtBucketMillis_cardId");
      expect(cardsStoreIndexNames).toContain("workspaceId_fsrsLastReviewedAtMillis_dueAtMillis_cardId");
      expect(cardsStoreIndexNames).not.toContain("workspaceId_fsrsLastReviewedAt_dueAtMillis_cardId");
      expect(dueAtMillisByCardId.get("canonical-due")).toBe(Date.parse("2026-03-10T12:00:00.000Z"));
      expect(dueAtBucketMillisByCardId.get("canonical-due")).toBe(Date.parse("2026-03-10T12:00:00.000Z"));
      expect(fsrsLastReviewedAtMillisByCardId.get("canonical-due")).toBe(Date.parse("2026-03-10T12:00:00.000Z"));
      expect(dueAtMillisByCardId.get("short-fraction-due")).toBe(Date.parse("2026-03-10T12:00:00.100Z"));
      expect(dueAtBucketMillisByCardId.get("short-fraction-due")).toBe(Date.parse("2026-03-10T12:00:00.100Z"));
      expect(migratedCalendarInvalidDueAt?.dueAt).toBe("2026-02-31T12:00:00.000Z");
      expect(dueAtMillisByCardId.get("calendar-invalid-due")).toBeNull();
      expect(dueAtBucketMillisByCardId.get("calendar-invalid-due")).toBe(malformedDueAtBucketMillis);
      expect(migratedMissingDueAt?.dueAt).toBeNull();
      expect(migratedMissingDueAt?.dueAtMillis).toBeNull();
      expect(migratedMissingDueAt?.dueAtBucketMillis).toBe(nullDueAtBucketMillis);

      const queueSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "allCards" }, 10);
      expect(queueSnapshot.cards.map((card) => card.cardId)).toEqual([
        "canonical-due",
        "short-fraction-due",
        "missing-due-at",
      ]);

      const pendingOutboxRecords = await listOutboxRecords(workspaceId);
      expect(pendingOutboxRecords).toHaveLength(1);
      const pendingOutboxRecord = pendingOutboxRecords[0];
      if (pendingOutboxRecord === undefined) {
        throw new Error("Expected migrated outbox record to exist");
      }
      const pendingOperation = pendingOutboxRecord.operation;
      expect(pendingOperation.entityType).toBe("card");
      if (pendingOperation.entityType !== "card") {
        throw new Error("Expected migrated outbox record to remain a card upsert");
      }
      expect(pendingOperation.payload.dueAt).toBe("2026-03-10T12:00:00.000Z");
    } finally {
      Date.now = originalNow;
    }
  });

  it("migrates legacy due bucket sentinels without colliding with pre-1970 due dates", async () => {
    await clearWebSyncCache();
    const pre1970DueAt = "1969-12-31T23:59:59.999Z";
    const canonicalDueAt = "2026-03-10T12:00:00.000Z";

    await seedLegacyVersion11Database([
      makeLegacyVersion11StoredCard(
        makeCard({
          cardId: "legacy-null-due",
          frontText: "Legacy null due",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        legacyNullDueAtBucketMillis,
        legacyNullDueAtBucketMillis,
      ),
      makeLegacyVersion11StoredCard(
        makeCard({
          cardId: "legacy-malformed-due",
          frontText: "Legacy malformed due",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-02-31T12:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        legacyMalformedDueAtBucketMillis,
        legacyMalformedDueAtBucketMillis,
      ),
      makeLegacyVersion11StoredCard(
        makeCard({
          cardId: "pre-1970-due",
          frontText: "Pre 1970 due",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: pre1970DueAt,
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        legacyNullDueAtBucketMillis,
        legacyNullDueAtBucketMillis,
      ),
      makeLegacyVersion11StoredCard(
        makeCard({
          cardId: "canonical-due",
          frontText: "Canonical due",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: canonicalDueAt,
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        legacyNullDueAtBucketMillis,
        legacyNullDueAtBucketMillis,
      ),
    ]);

    const storedCards = await loadStoredCardsForTest();
    const dueAtMillisByCardId = new Map(storedCards.map((card) => [card.cardId, card.dueAtMillis]));
    const dueAtBucketMillisByCardId = new Map(storedCards.map((card) => [card.cardId, card.dueAtBucketMillis]));

    expect(dueAtMillisByCardId.get("legacy-null-due")).toBeNull();
    expect(dueAtBucketMillisByCardId.get("legacy-null-due")).toBe(nullDueAtBucketMillis);
    expect(dueAtMillisByCardId.get("legacy-malformed-due")).toBeNull();
    expect(dueAtBucketMillisByCardId.get("legacy-malformed-due")).toBe(malformedDueAtBucketMillis);
    expect(dueAtMillisByCardId.get("pre-1970-due")).toBe(Date.parse(pre1970DueAt));
    expect(dueAtBucketMillisByCardId.get("pre-1970-due")).toBe(Date.parse(pre1970DueAt));
    expect(dueAtMillisByCardId.get("canonical-due")).toBe(Date.parse(canonicalDueAt));
    expect(dueAtBucketMillisByCardId.get("canonical-due")).toBe(Date.parse(canonicalDueAt));
  });
});
