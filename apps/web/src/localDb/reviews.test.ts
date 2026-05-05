// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { replaceCards } from "./cards";
import { replaceDecks } from "./decks";
import {
  loadReviewQueueChunk,
  loadReviewQueueSnapshot,
  loadReviewTimelinePage,
} from "./reviews";
import {
  deckFastGrammar,
  deckLongCode,
  isCardDueForTest,
  legacyReviewCards,
  makeCard,
  makeDeck,
  resolveLegacyReviewFilterForTest,
  sampleCards,
  seedCursorFixtures,
  workspaceId,
} from "./testSupport";

describe("localDb reviews", () => {
  beforeEach(async () => {
    await seedCursorFixtures();
  });

  describe("queue filters", () => {
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

    it("matches local review tag and deck filters by normalized Unicode tag keys", async () => {
      const nowTimestamp = Date.parse("2026-03-10T12:00:00.000Z");
      const originalNow = Date.now;
      Date.now = () => nowTimestamp;

      try {
        const unicodeTagCard = makeCard({
          cardId: "unicode-tag-card",
          frontText: "Unicode tag",
          backText: "back",
          tags: ["Éclair"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:00:00.000Z",
          createdAt: "2026-03-10T09:00:00.000Z",
        });
        const otherCard = makeCard({
          cardId: "other-tag-card",
          frontText: "Other tag",
          backText: "back",
          tags: ["code"],
          effortLevel: "fast",
          dueAt: "2026-03-10T11:05:00.000Z",
          createdAt: "2026-03-10T09:05:00.000Z",
        });
        const unicodeDeck = makeDeck({
          deckId: "deck-unicode-tag",
          name: "Unicode tag",
          effortLevels: [],
          tags: ["éclair"],
          createdAt: "2026-03-10T08:00:00.000Z",
        });

        await replaceDecks(workspaceId, [unicodeDeck]);
        await replaceCards(workspaceId, [unicodeTagCard, otherCard]);

        const tagQueueSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "tag", tag: "éclair" }, 10);
        const deckQueueSnapshot = await loadReviewQueueSnapshot(workspaceId, { kind: "deck", deckId: unicodeDeck.deckId }, 10);
        const tagTimelinePage = await loadReviewTimelinePage(workspaceId, { kind: "tag", tag: "éclair" }, 10, 0);

        expect(tagQueueSnapshot.resolvedReviewFilter).toEqual({
          kind: "tag",
          tag: "Éclair",
        });
        expect(tagQueueSnapshot.cards.map((card) => card.cardId)).toEqual(["unicode-tag-card"]);
        expect(tagQueueSnapshot.reviewCounts).toEqual({
          dueCount: 1,
          totalCount: 1,
        });
        expect(deckQueueSnapshot.cards.map((card) => card.cardId)).toEqual(["unicode-tag-card"]);
        expect(tagTimelinePage.cards.map((card) => card.cardId)).toEqual(["unicode-tag-card"]);
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe("timeline ordering", () => {
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
    });

  describe("queue ordering", () => {
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
    });

  describe("boundary parsing", () => {
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
    });

  describe("cursor pagination", () => {
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
  });

});
