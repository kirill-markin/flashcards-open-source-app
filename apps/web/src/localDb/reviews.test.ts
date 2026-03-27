// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { replaceCards } from "./cards";
import { loadReviewQueueChunk, loadReviewQueueSnapshot, loadReviewTimelinePage } from "./reviews";
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

  it("matches legacy review timeline ordering with equal dueAt and createdAt tie-breaks", async () => {
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
        "null-newer",
        "null-older",
        "due-same-newer",
        "due-same-older",
      ]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("keeps null due and equal due ordering aligned with stable cardId tie-breaks", async () => {
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
        "card-a",
        "card-b",
        "null-older",
        "due-same-a",
        "due-same-b",
        "due-same-older",
      ]);
    } finally {
      Date.now = originalNow;
    }
  });
});
