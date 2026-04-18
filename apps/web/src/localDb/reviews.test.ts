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
