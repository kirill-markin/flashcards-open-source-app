// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { replaceCards } from "./cards";
import { clearWebSyncCache } from "./cache";
import { getAllFromStore, openDatabase, type StoredCard } from "./core";
import { listOutboxRecords, putOutboxRecord, type PersistedOutboxRecord } from "./outbox";
import {
  loadLocalProgressDailyReviews,
  loadLocalProgressSummary,
  loadPendingProgressDailyReviews,
  loadReviewQueueChunk,
  loadReviewQueueSnapshot,
  loadReviewTimelinePage,
  putReviewEvent,
} from "./reviews";
import {
  deckFastGrammar,
  deckLongCode,
  isCardDueForTest,
  legacyReviewCards,
  makeCard,
  resolveLegacyReviewFilterForTest,
  sampleCards,
  seedCursorFixtures,
  workspaceId,
} from "./testSupport";
import type { Card } from "../types";

type LegacyStoredCard = Omit<StoredCard, "dueAt" | "dueAtMillis"> & Readonly<{
  dueAt?: string | null;
}>;

const webSyncDatabaseName = "flashcards-web-sync";

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

describe("localDb reviews", () => {
  beforeEach(async () => {
    await seedCursorFixtures();
  });

  it("migrates legacy dueAt into dueAtMillis and keeps pending card upserts uploadable", async () => {
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
      const migratedCalendarInvalidDueAt = storedCards.find((card) => card.cardId === "calendar-invalid-due");
      const migratedMissingDueAt = storedCards.find((card) => card.cardId === "missing-due-at");

      expect(cardsStoreIndexNames).toContain("workspaceId_dueAtMillis_cardId");
      expect(dueAtMillisByCardId.get("canonical-due")).toBe(Date.parse("2026-03-10T12:00:00.000Z"));
      expect(dueAtMillisByCardId.get("short-fraction-due")).toBe(Date.parse("2026-03-10T12:00:00.100Z"));
      expect(migratedCalendarInvalidDueAt?.dueAt).toBe("2026-02-31T12:00:00.000Z");
      expect(dueAtMillisByCardId.get("calendar-invalid-due")).toBeNull();
      expect(migratedMissingDueAt?.dueAt).toBeNull();
      expect(migratedMissingDueAt?.dueAtMillis).toBeNull();

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

  it("matches legacy review snapshot ordering and counts for all, deck, and tag filters", async () => {
    const nowTimestamp = Date.parse("2025-01-08T00:00:00.000Z");
    const originalNow = Date.now;
    Date.now = () => nowTimestamp;

    try {
      for (const reviewFilter of [
        { kind: "allCards" } as const,
        { kind: "deck", deckId: deckLongCode.deckId } as const,
        { kind: "effort", effortLevel: "medium" } as const,
        { kind: "tag", tag: "grammar" } as const,
      ]) {
        const result = await loadReviewQueueSnapshot(workspaceId, reviewFilter, 8);
        const legacyCards = legacyReviewCards(reviewFilter, sampleCards, [deckFastGrammar, deckLongCode], nowTimestamp);
        const legacyDueCards = legacyCards.filter((card) => isCardDueForTest(card, nowTimestamp));

        expect(result.resolvedReviewFilter).toEqual(
          resolveLegacyReviewFilterForTest(
            reviewFilter,
            sampleCards.filter((card) => card.deletedAt === null),
            [deckFastGrammar, deckLongCode],
          ),
        );
        expect(result.cards.map((card) => card.cardId)).toEqual(legacyDueCards.slice(0, 8).map((card) => card.cardId));
        expect(result.reviewCounts).toEqual({
          dueCount: legacyDueCards.length,
          totalCount: legacyCards.length,
        });
      }
    } finally {
      Date.now = originalNow;
    }
  });

  it("matches legacy review chunk ordering and respects excluded card ids", async () => {
    const nowTimestamp = Date.parse("2025-01-08T00:00:00.000Z");
    const originalNow = Date.now;
    Date.now = () => nowTimestamp;

    try {
      const initialSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "allCards" }, 2);
      const result = await loadReviewQueueChunk(
        workspaceId,
        { kind: "allCards" },
        initialSnapshot.nextCursor,
        2,
        new Set(["null-newer"]),
      );
      const legacyDueCards = legacyReviewCards(
        { kind: "allCards" },
        sampleCards,
        [deckFastGrammar, deckLongCode],
        nowTimestamp,
      ).filter((card) => isCardDueForTest(card, nowTimestamp) && card.cardId !== "null-newer");
      const cursorCardId = initialSnapshot.cards[initialSnapshot.cards.length - 1]?.cardId;
      const startIndex = cursorCardId === undefined
        ? 0
        : legacyDueCards.findIndex((card) => card.cardId === cursorCardId) + 1;

      expect(result.cards.map((card) => card.cardId)).toEqual(
        legacyDueCards.slice(startIndex, startIndex + 2).map((card) => card.cardId),
      );
    } finally {
      Date.now = originalNow;
    }
  });

  it("matches review timeline ordering with timed due cards before null and future cards", async () => {
    const nowTimestamp = Date.parse("2025-01-08T00:00:00.000Z");
    const originalNow = Date.now;
    Date.now = () => nowTimestamp;

    try {
      const result = await loadReviewTimelinePage(workspaceId, { kind: "allCards" }, 4, 0);
      const legacyCards = legacyReviewCards(
        { kind: "allCards" },
        sampleCards,
        [deckFastGrammar, deckLongCode],
        nowTimestamp,
      );

      expect(result.cards.map((card) => card.cardId)).toEqual(legacyCards.slice(0, 4).map((card) => card.cardId));
      expect(result.hasMoreCards).toBe(true);
      expect(result.cards.slice(0, 4).map((card) => card.cardId)).toEqual([
        "due-same-newer",
        "due-same-older",
        "due-other",
        "null-newer",
      ]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("orders active review queue by recent due, old due, then null and leaves future or malformed cards for timeline", async () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const originalNow = Date.now;
    Date.now = () => nowTimestamp;

    try {
      await replaceCards(workspaceId, [
        makeCard({
          cardId: "future-tomorrow",
          frontText: "Future tomorrow",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-11T12:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "recent-1155",
          frontText: "Recent 11:55",
          backText: "back",
          tags: ["code"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:55:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "new-null",
          frontText: "New null",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "malformed",
          frontText: "Malformed",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "not-a-date",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "old-yesterday",
          frontText: "Old yesterday",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-09T12:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "recent-1115",
          frontText: "Recent 11:15",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:15:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
      ]);

      const queueSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "allCards" }, 10);
      const timelinePage = await loadReviewTimelinePage(workspaceId, { kind: "allCards" }, 10, 0);
      const grammarQueueSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "tag", tag: "grammar" }, 10);

      expect(queueSnapshot.cards.map((card) => card.cardId)).toEqual([
        "recent-1115",
        "recent-1155",
        "old-yesterday",
        "new-null",
      ]);
      expect(queueSnapshot.reviewCounts).toEqual({
        dueCount: 4,
        totalCount: 6,
      });
      expect(timelinePage.cards.map((card) => card.cardId)).toEqual([
        "recent-1115",
        "recent-1155",
        "old-yesterday",
        "new-null",
        "future-tomorrow",
        "malformed",
      ]);
      expect(grammarQueueSnapshot.cards.map((card) => card.cardId)).toEqual([
        "recent-1115",
        "old-yesterday",
        "new-null",
      ]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("keeps recent due boundaries inclusive and excludes now plus one millisecond from the active queue", async () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const originalNow = Date.now;
    Date.now = () => nowTimestamp;

    try {
      await replaceCards(workspaceId, [
        makeCard({
          cardId: "future-one-ms",
          frontText: "Future one ms",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T12:00:00.001Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "malformed-in-range",
          frontText: "Malformed in range",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:30:broken",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "old-one-ms",
          frontText: "Old one ms",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T10:59:59.999Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "due-now",
          frontText: "Due now",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T12:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "new-null",
          frontText: "New null",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "recent-cutoff",
          frontText: "Recent cutoff",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
      ]);

      const queueSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "allCards" }, 10);
      const timelinePage = await loadReviewTimelinePage(workspaceId, { kind: "allCards" }, 10, 0);

      expect(queueSnapshot.cards.map((card) => card.cardId)).toEqual([
        "recent-cutoff",
        "due-now",
        "old-one-ms",
        "new-null",
      ]);
      expect(timelinePage.cards.map((card) => card.cardId)).toEqual([
        "recent-cutoff",
        "due-now",
        "old-one-ms",
        "new-null",
        "future-one-ms",
        "malformed-in-range",
      ]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("excludes calendar-invalid non-null dueAt values from the active queue", async () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const originalNow = Date.now;
    Date.now = () => nowTimestamp;

    try {
      await replaceCards(workspaceId, [
        makeCard({
          cardId: "valid-due",
          frontText: "Valid due",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:30:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "new-null",
          frontText: "New null",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "invalid-calendar-day",
          frontText: "Invalid calendar day",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-02-31T12:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "invalid-leap-day",
          frontText: "Invalid leap day",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-02-29T12:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "invalid-month",
          frontText: "Invalid month",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-13-10T12:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "invalid-minute",
          frontText: "Invalid minute",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T12:60:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "invalid-second",
          frontText: "Invalid second",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T12:00:60.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "numeric-string",
          frontText: "Numeric string",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "1000",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
      ]);

      const queueSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "allCards" }, 10);
      const timelinePage = await loadReviewTimelinePage(workspaceId, { kind: "allCards" }, 10, 0);

      expect(queueSnapshot.cards.map((card) => card.cardId)).toEqual([
        "valid-due",
        "new-null",
      ]);
      expect(queueSnapshot.reviewCounts).toEqual({
        dueCount: 2,
        totalCount: 8,
      });
      expect(timelinePage.cards.map((card) => card.cardId)).toEqual([
        "valid-due",
        "new-null",
        "invalid-calendar-day",
        "invalid-leap-day",
        "invalid-minute",
        "invalid-month",
        "invalid-second",
        "numeric-string",
      ]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("includes non-canonical whole-second dueAt at the inclusive now boundary", async () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const originalNow = Date.now;
    Date.now = () => nowTimestamp;

    try {
      await replaceCards(workspaceId, [
        makeCard({
          cardId: "due-now-short-z",
          frontText: "Due now short Z",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T12:00:00Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "future-one-ms",
          frontText: "Future one ms",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T12:00:00.001Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "malformed",
          frontText: "Malformed",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "not-a-date",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "new-null",
          frontText: "New null",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
      ]);

      const queueSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "allCards" }, 10);
      const timelinePage = await loadReviewTimelinePage(workspaceId, { kind: "allCards" }, 10, 0);
      const queueCardIds = queueSnapshot.cards.map((card) => card.cardId);

      expect(queueCardIds).toEqual([
        "due-now-short-z",
        "new-null",
      ]);
      expect(new Set(queueCardIds).size).toBe(queueCardIds.length);
      expect(timelinePage.cards.map((card) => card.cardId)).toEqual([
        "due-now-short-z",
        "new-null",
        "future-one-ms",
        "malformed",
      ]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("includes short fractional dueAt variants at the inclusive now boundary without duplicates", async () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.100Z");
    const originalNow = Date.now;
    Date.now = () => nowTimestamp;

    try {
      await replaceCards(workspaceId, [
        makeCard({
          cardId: "old-cutoff-second",
          frontText: "Old cutoff second",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:00:00Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "recent-cutoff-short-fraction",
          frontText: "Recent cutoff short fraction",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:00:00.1Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "due-now-canonical",
          frontText: "Due now canonical",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T12:00:00.100Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "due-now-short-fraction",
          frontText: "Due now short fraction",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T12:00:00.1Z",
          createdAt: "2026-03-10T09:03:00.000Z",
        }),
        makeCard({
          cardId: "due-now-two-digit-fraction",
          frontText: "Due now two digit fraction",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T12:00:00.10Z",
          createdAt: "2026-03-10T09:02:00.000Z",
        }),
        makeCard({
          cardId: "future-one-ms",
          frontText: "Future one ms",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T12:00:00.101Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "malformed",
          frontText: "Malformed",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T12:00:00.broken",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "new-null",
          frontText: "New null",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
      ]);

      const queueSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "allCards" }, 10);
      const timelinePage = await loadReviewTimelinePage(workspaceId, { kind: "allCards" }, 10, 0);
      const queueCardIds = queueSnapshot.cards.map((card) => card.cardId);

      expect(queueCardIds).toEqual([
        "recent-cutoff-short-fraction",
        "due-now-short-fraction",
        "due-now-two-digit-fraction",
        "due-now-canonical",
        "old-cutoff-second",
        "new-null",
      ]);
      expect(new Set(queueCardIds).size).toBe(queueCardIds.length);
      expect(timelinePage.cards.map((card) => card.cardId)).toEqual([
        "recent-cutoff-short-fraction",
        "due-now-short-fraction",
        "due-now-two-digit-fraction",
        "due-now-canonical",
        "old-cutoff-second",
        "new-null",
        "future-one-ms",
        "malformed",
      ]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("continues active review chunks across recent due, old due, and null buckets when the cursor card is excluded", async () => {
    const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const originalNow = Date.now;
    Date.now = () => nowTimestamp;

    try {
      await replaceCards(workspaceId, [
        makeCard({
          cardId: "recent-1115",
          frontText: "Recent 11:15",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:15:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "recent-1155",
          frontText: "Recent 11:55",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:55:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "old-yesterday",
          frontText: "Old yesterday",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-09T12:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "new-null",
          frontText: "New null",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "future-tomorrow",
          frontText: "Future tomorrow",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-11T12:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
      ]);

      const initialSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "allCards" }, 2);
      const chunk = await loadReviewQueueChunk(
        workspaceId,
        { kind: "allCards" },
        initialSnapshot.nextCursor,
        2,
        new Set(["recent-1155"]),
      );

      expect(initialSnapshot.cards.map((card) => card.cardId)).toEqual([
        "recent-1115",
        "recent-1155",
      ]);
      expect(chunk.cards.map((card) => card.cardId)).toEqual([
        "old-yesterday",
        "new-null",
      ]);
      expect(chunk.nextCursor).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });

  it("continues active review chunks from the original queue window when the recent boundary moves", async () => {
    const initialNowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
    const laterNowTimestamp = Date.parse("2026-03-10T12:20:00.000Z");
    const originalNow = Date.now;
    Date.now = () => initialNowTimestamp;

    try {
      await replaceCards(workspaceId, [
        makeCard({
          cardId: "recent-1105",
          frontText: "Recent 11:05",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:05:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "recent-1110",
          frontText: "Recent 11:10",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:10:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "recent-1115",
          frontText: "Recent 11:15",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:15:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "old-1000",
          frontText: "Old 10:00",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2026-03-10T10:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
        makeCard({
          cardId: "new-null",
          frontText: "New null",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2026-03-10T09:00:00.000Z",
        }),
      ]);

      const initialSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "allCards" }, 2);
      Date.now = () => laterNowTimestamp;
      const chunk = await loadReviewQueueChunk(
        workspaceId,
        { kind: "allCards" },
        initialSnapshot.nextCursor,
        2,
        new Set(initialSnapshot.cards.map((card) => card.cardId)),
      );

      expect(initialSnapshot.cards.map((card) => card.cardId)).toEqual([
        "recent-1105",
        "recent-1110",
      ]);
      expect(chunk.cards.map((card) => card.cardId)).toEqual([
        "recent-1115",
        "old-1000",
      ]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("keeps timed due ahead of null due ordering with stable cardId tie-breaks", async () => {
    const nowTimestamp = Date.parse("2025-01-08T00:00:00.000Z");
    const originalNow = Date.now;
    Date.now = () => nowTimestamp;

    try {
      await replaceCards(workspaceId, [
        makeCard({
          cardId: "card-b",
          frontText: "Null newer B",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2025-01-03T10:00:00.000Z",
        }),
        makeCard({
          cardId: "card-a",
          frontText: "Null newer A",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2025-01-03T10:00:00.000Z",
        }),
        makeCard({
          cardId: "null-older",
          frontText: "Null older",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2025-01-03T09:00:00.000Z",
        }),
        makeCard({
          cardId: "due-same-b",
          frontText: "Due same B",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2025-01-04T10:00:00.000Z",
          createdAt: "2025-01-05T10:00:00.000Z",
        }),
        makeCard({
          cardId: "due-same-a",
          frontText: "Due same A",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2025-01-04T10:00:00.000Z",
          createdAt: "2025-01-05T10:00:00.000Z",
        }),
        makeCard({
          cardId: "due-same-older",
          frontText: "Due same older",
          backText: "back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: "2025-01-04T10:00:00.000Z",
          createdAt: "2025-01-05T09:00:00.000Z",
        }),
      ]);

      const result = await loadReviewTimelinePage(workspaceId, { kind: "allCards" }, 6, 0);

      expect(result.cards.map((card) => card.cardId)).toEqual([
        "due-same-a",
        "due-same-b",
        "due-same-older",
        "card-a",
        "card-b",
        "null-older",
      ]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("counts only pending review-event outbox entries for progress", async () => {
    await putReviewEvent({
      reviewEventId: "synced-review",
      workspaceId,
      cardId: "due-other",
      replicaId: "device-1",
      clientEventId: "synced-client-event",
      rating: 2,
      reviewedAtClient: "2025-01-08T08:00:00.000Z",
      reviewedAtServer: "2025-01-08T08:00:00.000Z",
    });

    await putOutboxRecord({
      operationId: "pending-review-1",
      workspaceId,
      createdAt: "2025-01-08T09:00:00.000Z",
      attemptCount: 0,
      lastError: "",
      operation: {
        operationId: "pending-review-1",
        entityType: "review_event",
        entityId: "pending-review-1",
        action: "append",
        clientUpdatedAt: "2025-01-08T09:00:00.000Z",
        payload: {
          reviewEventId: "pending-review-1",
          cardId: "due-other",
          clientEventId: "pending-client-event-1",
          rating: 3,
          reviewedAtClient: "2025-01-08T09:00:00.000Z",
        },
      },
    });
    await putOutboxRecord({
      operationId: "pending-review-2",
      workspaceId: "workspace-2",
      createdAt: "2025-01-08T11:00:00.000Z",
      attemptCount: 0,
      lastError: "",
      operation: {
        operationId: "pending-review-2",
        entityType: "review_event",
        entityId: "pending-review-2",
        action: "append",
        clientUpdatedAt: "2025-01-08T11:00:00.000Z",
        payload: {
          reviewEventId: "pending-review-2",
          cardId: "card-2",
          clientEventId: "pending-client-event-2",
          rating: 1,
          reviewedAtClient: "2025-01-08T11:00:00.000Z",
        },
      },
    });
    await putOutboxRecord({
      operationId: "ignored-card-upsert",
      workspaceId,
      createdAt: "2025-01-08T10:00:00.000Z",
      attemptCount: 0,
      lastError: "",
      operation: {
        operationId: "ignored-card-upsert",
        entityType: "card",
        entityId: "due-other",
        action: "upsert",
        clientUpdatedAt: "2025-01-08T10:00:00.000Z",
        payload: {
          cardId: "due-other",
          frontText: "Front",
          backText: "Back",
          tags: [],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2025-01-08T10:00:00.000Z",
          reps: 1,
          lapses: 0,
          fsrsCardState: "new",
          fsrsStepIndex: null,
          fsrsStability: null,
          fsrsDifficulty: null,
          fsrsLastReviewedAt: null,
          fsrsScheduledDays: null,
          deletedAt: null,
        },
      },
    });
    await putOutboxRecord({
      operationId: "out-of-range-review",
      workspaceId,
      createdAt: "2025-01-07T23:59:00.000Z",
      attemptCount: 0,
      lastError: "",
      operation: {
        operationId: "out-of-range-review",
        entityType: "review_event",
        entityId: "out-of-range-review",
        action: "append",
        clientUpdatedAt: "2025-01-07T23:59:00.000Z",
        payload: {
          reviewEventId: "out-of-range-review",
          cardId: "due-other",
          clientEventId: "out-of-range-client-event",
          rating: 0,
          reviewedAtClient: "2025-01-07T23:59:00.000Z",
        },
      },
    });
    await putOutboxRecord({
      operationId: "inaccessible-review",
      workspaceId: "workspace-3",
      createdAt: "2025-01-08T12:00:00.000Z",
      attemptCount: 0,
      lastError: "",
      operation: {
        operationId: "inaccessible-review",
        entityType: "review_event",
        entityId: "inaccessible-review",
        action: "append",
        clientUpdatedAt: "2025-01-08T12:00:00.000Z",
        payload: {
          reviewEventId: "inaccessible-review",
          cardId: "card-3",
          clientEventId: "inaccessible-client-event",
          rating: 2,
          reviewedAtClient: "2025-01-08T12:00:00.000Z",
        },
      },
    });

    const result = await loadPendingProgressDailyReviews(
      [workspaceId, "workspace-2"],
      {
        timeZone: "UTC",
        from: "2025-01-08",
        to: "2025-01-08",
      },
    );

    expect(result).toEqual([
      {
        date: "2025-01-08",
        reviewCount: 2,
      },
    ]);
  });

  it("aggregates stored review history for local progress fallback using the browser timezone", async () => {
    await putReviewEvent({
      reviewEventId: "review-1",
      workspaceId,
      cardId: "due-other",
      replicaId: "device-1",
      clientEventId: "client-event-1",
      rating: 2,
      reviewedAtClient: "2025-01-07T23:30:00.000Z",
      reviewedAtServer: "2025-01-07T23:30:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "review-2",
      workspaceId,
      cardId: "due-same-a",
      replicaId: "device-1",
      clientEventId: "client-event-2",
      rating: 3,
      reviewedAtClient: "2025-01-08T10:00:00.000Z",
      reviewedAtServer: "2025-01-08T10:00:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "review-outside-local-range",
      workspaceId,
      cardId: "due-same-b",
      replicaId: "device-1",
      clientEventId: "client-event-outside-local-range",
      rating: 1,
      reviewedAtClient: "2025-01-08T23:30:00.000Z",
      reviewedAtServer: "2025-01-08T23:30:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "review-far-outside-range",
      workspaceId,
      cardId: "due-same-b",
      replicaId: "device-1",
      clientEventId: "client-event-far-outside-range",
      rating: 1,
      reviewedAtClient: "2024-08-08T12:00:00.000Z",
      reviewedAtServer: "2024-08-08T12:00:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "review-3",
      workspaceId: "workspace-2",
      cardId: "card-2",
      replicaId: "device-2",
      clientEventId: "client-event-3",
      rating: 1,
      reviewedAtClient: "2025-01-08T11:00:00.000Z",
      reviewedAtServer: "2025-01-08T11:00:00.000Z",
    });

    const result = await loadLocalProgressDailyReviews([workspaceId], {
      timeZone: "Europe/Madrid",
      from: "2025-01-07",
      to: "2025-01-08",
    });

    expect(result).toEqual([
      {
        date: "2025-01-08",
        reviewCount: 2,
      },
    ]);
  });

  it("computes all-time local progress summary from aggregate day counts", async () => {
    await putReviewEvent({
      reviewEventId: "summary-review-1",
      workspaceId,
      cardId: "due-other",
      replicaId: "device-1",
      clientEventId: "summary-client-event-1",
      rating: 2,
      reviewedAtClient: "2025-01-06T08:00:00.000Z",
      reviewedAtServer: "2025-01-06T08:00:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "summary-review-2",
      workspaceId,
      cardId: "due-same-a",
      replicaId: "device-1",
      clientEventId: "summary-client-event-2",
      rating: 3,
      reviewedAtClient: "2025-01-07T09:00:00.000Z",
      reviewedAtServer: "2025-01-07T09:00:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "summary-review-3",
      workspaceId: "workspace-2",
      cardId: "card-2",
      replicaId: "device-2",
      clientEventId: "summary-client-event-3",
      rating: 1,
      reviewedAtClient: "2025-01-08T10:00:00.000Z",
      reviewedAtServer: "2025-01-08T10:00:00.000Z",
    });

    const result = await loadLocalProgressSummary([workspaceId, "workspace-2"], {
      timeZone: "UTC",
      today: "2025-01-08",
    });

    expect(result).toEqual({
      currentStreakDays: 3,
      hasReviewedToday: true,
      lastReviewedOn: "2025-01-08",
      activeReviewDays: 3,
    });
  });
});
