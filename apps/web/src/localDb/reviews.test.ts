// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { replaceCards } from "./cards";
import { putOutboxRecord } from "./outbox";
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

describe("localDb reviews", () => {
  beforeEach(async () => {
    await seedCursorFixtures();
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
