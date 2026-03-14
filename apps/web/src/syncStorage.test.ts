// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { compareCardsForReviewOrder, matchesCardFilter, matchesDeckFilterDefinition } from "./appData/domain";
import {
  clearWebSyncCache,
  loadReviewQueueChunk,
  loadReviewQueueSnapshot,
  loadReviewTimelinePage,
  putCard,
  queryLocalCardsPage,
  replaceCards,
  replaceDecks,
} from "./syncStorage";
import type { Card, Deck, QueryCardsInput, ReviewFilter } from "./types";

const workspaceId = "workspace-1";

function makeCard(input: Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: Card["effortLevel"];
  dueAt: string | null;
  createdAt: string;
  reps?: number;
  lapses?: number;
  deletedAt?: string | null;
}>): Card {
  return {
    cardId: input.cardId,
    frontText: input.frontText,
    backText: input.backText,
    tags: [...input.tags],
    effortLevel: input.effortLevel,
    dueAt: input.dueAt,
    createdAt: input.createdAt,
    reps: input.reps ?? 0,
    lapses: input.lapses ?? 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: input.createdAt,
    lastModifiedByDeviceId: "device-1",
    lastOperationId: `op-${input.cardId}`,
    updatedAt: input.createdAt,
    deletedAt: input.deletedAt ?? null,
  };
}

function makeDeck(input: Readonly<{
  deckId: string;
  name: string;
  effortLevels: ReadonlyArray<Card["effortLevel"]>;
  tags: ReadonlyArray<string>;
  createdAt: string;
}>): Deck {
  return {
    deckId: input.deckId,
    workspaceId,
    name: input.name,
    filterDefinition: {
      version: 2,
      effortLevels: [...input.effortLevels],
      tags: [...input.tags],
    },
    createdAt: input.createdAt,
    clientUpdatedAt: input.createdAt,
    lastModifiedByDeviceId: "device-1",
    lastOperationId: `op-${input.deckId}`,
    updatedAt: input.createdAt,
    deletedAt: null,
  };
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

function isCardDue(card: Card, nowTimestamp: number): boolean {
  if (card.dueAt === null) {
    return true;
  }

  return Date.parse(card.dueAt) <= nowTimestamp;
}

function resolveLegacyReviewFilter(
  reviewFilter: ReviewFilter,
  cards: ReadonlyArray<Card>,
  decks: ReadonlyArray<Deck>,
): ReviewFilter {
  if (reviewFilter.kind === "allCards") {
    return reviewFilter;
  }

  if (reviewFilter.kind === "deck") {
    return decks.some((deck) => deck.deckId === reviewFilter.deckId)
      ? reviewFilter
      : { kind: "allCards" };
  }

  return cards.some((card) => card.tags.includes(reviewFilter.tag))
    ? reviewFilter
    : { kind: "allCards" };
}

function legacyReviewCards(
  reviewFilter: ReviewFilter,
  cards: ReadonlyArray<Card>,
  decks: ReadonlyArray<Deck>,
  nowTimestamp: number,
): ReadonlyArray<Card> {
  const activeCards = cards.filter((card) => card.deletedAt === null);
  const resolvedReviewFilter = resolveLegacyReviewFilter(reviewFilter, activeCards, decks);

  const matchingCards = resolvedReviewFilter.kind === "allCards"
    ? activeCards
    : resolvedReviewFilter.kind === "deck"
      ? activeCards.filter((card) => {
        const deck = decks.find((candidateDeck) => candidateDeck.deckId === resolvedReviewFilter.deckId);
        return deck === undefined ? true : matchesDeckFilterDefinition(deck.filterDefinition, card);
      })
      : activeCards.filter((card) => card.tags.includes(resolvedReviewFilter.tag));

  return [...matchingCards].sort((leftCard, rightCard) => compareCardsForReviewOrder(leftCard, rightCard, nowTimestamp));
}

function legacyQueryCards(
  cards: ReadonlyArray<Card>,
  input: QueryCardsInput,
): Readonly<{
  cards: ReadonlyArray<Card>;
  totalCount: number;
}> {
  const activeCards = cards.filter((card) => card.deletedAt === null);
  const matchingCards = activeCards
    .filter((card) => matchesSearchText(card, normalizeSearchText(input.searchText)))
    .filter((card) => input.filter === null || matchesCardFilter(input.filter, card))
    .sort((leftCard, rightCard) => compareCardsForCardsQuery(leftCard, rightCard, input.sorts));

  return {
    cards: matchingCards,
    totalCount: matchingCards.length,
  };
}

const deckFastGrammar = makeDeck({
  deckId: "deck-fast-grammar",
  name: "Fast grammar",
  effortLevels: ["fast"],
  tags: ["grammar"],
  createdAt: "2025-01-01T00:00:00.000Z",
});

const deckLongCode = makeDeck({
  deckId: "deck-long-code",
  name: "Long code",
  effortLevels: ["long"],
  tags: ["code"],
  createdAt: "2025-01-02T00:00:00.000Z",
});

const sampleCards: ReadonlyArray<Card> = [
  makeCard({
    cardId: "null-newer",
    frontText: "Null newer",
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
    tags: ["grammar", "shared"],
    effortLevel: "fast",
    dueAt: null,
    createdAt: "2025-01-03T09:00:00.000Z",
  }),
  makeCard({
    cardId: "due-same-newer",
    frontText: "Due same newer",
    backText: "search target",
    tags: ["code", "shared"],
    effortLevel: "long",
    dueAt: "2025-01-04T10:00:00.000Z",
    createdAt: "2025-01-05T10:00:00.000Z",
    reps: 2,
  }),
  makeCard({
    cardId: "due-same-older",
    frontText: "Due same older",
    backText: "search target older",
    tags: ["code"],
    effortLevel: "long",
    dueAt: "2025-01-04T10:00:00.000Z",
    createdAt: "2025-01-05T09:00:00.000Z",
    reps: 1,
  }),
  makeCard({
    cardId: "due-other",
    frontText: "Due other",
    backText: "back",
    tags: ["grammar"],
    effortLevel: "medium",
    dueAt: "2025-01-06T08:00:00.000Z",
    createdAt: "2025-01-06T09:00:00.000Z",
  }),
  makeCard({
    cardId: "future-a",
    frontText: "Future A",
    backText: "future back",
    tags: ["grammar"],
    effortLevel: "fast",
    dueAt: "2025-01-09T12:00:00.000Z",
    createdAt: "2025-01-07T09:00:00.000Z",
  }),
  makeCard({
    cardId: "future-b",
    frontText: "Future B",
    backText: "future search",
    tags: ["code"],
    effortLevel: "long",
    dueAt: "2025-01-10T12:00:00.000Z",
    createdAt: "2025-01-08T09:00:00.000Z",
  }),
  makeCard({
    cardId: "deleted-card",
    frontText: "Deleted",
    backText: "back",
    tags: ["grammar"],
    effortLevel: "fast",
    dueAt: null,
    createdAt: "2025-01-08T10:00:00.000Z",
    deletedAt: "2025-01-08T12:00:00.000Z",
  }),
];

describe("syncStorage cursor queries", () => {
  beforeEach(async () => {
    await clearWebSyncCache();
    await replaceDecks([deckFastGrammar, deckLongCode]);
    await replaceCards(sampleCards);
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
        const result = await loadReviewQueueSnapshot(reviewFilter, 8);
        const legacyCards = legacyReviewCards(reviewFilter, sampleCards, [deckFastGrammar, deckLongCode], nowTimestamp);
        const legacyDueCards = legacyCards.filter((card) => isCardDue(card, nowTimestamp));

        expect(result.resolvedReviewFilter).toEqual(resolveLegacyReviewFilter(reviewFilter, sampleCards.filter((card) => card.deletedAt === null), [deckFastGrammar, deckLongCode]));
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
      const initialSnapshot = await loadReviewQueueSnapshot({ kind: "allCards" }, 2);
      const result = await loadReviewQueueChunk(
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
      ).filter((card) => isCardDue(card, nowTimestamp) && card.cardId !== "null-newer");
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
      const result = await loadReviewTimelinePage({ kind: "allCards" }, 4, 0);
      const legacyCards = legacyReviewCards(
        { kind: "allCards" },
        sampleCards,
        [deckFastGrammar, deckLongCode],
        nowTimestamp,
      );

      expect(result.cards.map((card) => card.cardId)).toEqual(
        legacyCards.slice(0, 4).map((card) => card.cardId),
      );
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

  it("matches legacy cards query for default created-desc paging and filters", async () => {
    const inputs: ReadonlyArray<QueryCardsInput> = [
      {
        searchText: null,
        cursor: null,
        limit: 3,
        sorts: [],
        filter: null,
      },
      {
        searchText: null,
        cursor: null,
        limit: 10,
        sorts: [],
        filter: { tags: [], effort: ["long"] },
      },
      {
        searchText: null,
        cursor: null,
        limit: 10,
        sorts: [],
        filter: { tags: ["grammar"], effort: [] },
      },
      {
        searchText: null,
        cursor: null,
        limit: 10,
        sorts: [],
        filter: { tags: ["code"], effort: ["long"] },
      },
      {
        searchText: "search",
        cursor: null,
        limit: 10,
        sorts: [],
        filter: null,
      },
      {
        searchText: "search",
        cursor: null,
        limit: 10,
        sorts: [],
        filter: { tags: ["code"], effort: ["long"] },
      },
    ];

    for (const input of inputs) {
      const result = await queryLocalCardsPage(input);
      const legacy = legacyQueryCards(sampleCards, input);

      expect(result.cards.map((card) => card.cardId)).toEqual(legacy.cards.slice(0, input.limit).map((card) => card.cardId));
      expect(result.totalCount).toBe(legacy.totalCount);
    }
  });

  it("keeps cards pagination gap-free when createdAt ties", async () => {
    const firstPage = await queryLocalCardsPage({
      searchText: null,
      cursor: null,
      limit: 2,
      sorts: [],
      filter: null,
    });
    const secondPage = await queryLocalCardsPage({
      searchText: null,
      cursor: firstPage.nextCursor,
      limit: 2,
      sorts: [],
      filter: null,
    });
    const legacy = legacyQueryCards(sampleCards, {
      searchText: null,
      cursor: null,
      limit: 10,
      sorts: [],
      filter: null,
    });

    expect(firstPage.cards.map((card) => card.cardId)).toEqual(
      legacy.cards.slice(0, 2).map((card) => card.cardId),
    );
    expect(secondPage.cards.map((card) => card.cardId)).toEqual(
      legacy.cards.slice(2, 4).map((card) => card.cardId),
    );
  });

  it("keeps cards pagination gap-free for non-default local sorts without materializing a full page list", async () => {
    const firstPage = await queryLocalCardsPage({
      searchText: null,
      cursor: null,
      limit: 3,
      sorts: [{
        key: "reps",
        direction: "desc",
      }],
      filter: null,
    });
    const secondPage = await queryLocalCardsPage({
      searchText: null,
      cursor: firstPage.nextCursor,
      limit: 3,
      sorts: [{
        key: "reps",
        direction: "desc",
      }],
      filter: null,
    });
    const legacy = legacyQueryCards(sampleCards, {
      searchText: null,
      cursor: null,
      limit: 20,
      sorts: [{
        key: "reps",
        direction: "desc",
      }],
      filter: null,
    });

    expect(firstPage.cards.map((card) => card.cardId)).toEqual(
      legacy.cards.slice(0, 3).map((card) => card.cardId),
    );
    expect(secondPage.cards.map((card) => card.cardId)).toEqual(
      legacy.cards.slice(3, 6).map((card) => card.cardId),
    );
    expect(firstPage.totalCount).toBe(legacy.totalCount);
    expect(secondPage.totalCount).toBe(legacy.totalCount);
  });

  it("reflects local DB changes immediately after a local mutation", async () => {
    const initialCardsPage = await queryLocalCardsPage({
      searchText: null,
      cursor: null,
      limit: 20,
      sorts: [],
      filter: null,
    });
    expect(initialCardsPage.cards.map((card) => card.cardId)).not.toContain("new-sync-card");

    await putCard(makeCard({
      cardId: "new-sync-card",
      frontText: "Newest synced card",
      backText: "back",
      tags: ["grammar"],
      effortLevel: "fast",
      dueAt: null,
      createdAt: "2025-01-11T10:00:00.000Z",
    }));

    const nextCardsPage = await queryLocalCardsPage({
      searchText: null,
      cursor: null,
      limit: 20,
      sorts: [],
      filter: null,
    });
    expect(nextCardsPage.cards.map((card) => card.cardId)[0]).toBe("new-sync-card");
  });
});
