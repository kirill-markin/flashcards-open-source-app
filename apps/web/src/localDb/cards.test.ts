// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { queryLocalCardsPage, replaceCards } from "./cards";
import { clearWebSyncCache } from "./cache";
import { legacyQueryCards, makeCard, workspaceId } from "./testSupport";
import type { Card, QueryCardsInput } from "../types";

function makeQueryInput(input: Readonly<{
  cursor: string | null;
  limit: number;
  sorts: QueryCardsInput["sorts"];
}>): QueryCardsInput {
  return {
    searchText: null,
    cursor: input.cursor,
    limit: input.limit,
    sorts: input.sorts,
    filter: null,
  };
}

describe("localDb cards", () => {
  beforeEach(async () => {
    await clearWebSyncCache();
  });

  it("orders cards by updatedAt descending by default", async () => {
    const cards: ReadonlyArray<Card> = [
      makeCard({
        cardId: "card-newest-update",
        frontText: "Newest update",
        backText: "back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-05T00:00:00.000Z",
      }),
      makeCard({
        cardId: "card-middle-update",
        frontText: "Middle update",
        backText: "back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-03T00:00:00.000Z",
        updatedAt: "2025-01-04T00:00:00.000Z",
      }),
      makeCard({
        cardId: "card-oldest-update",
        frontText: "Oldest update",
        backText: "back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-04T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      }),
    ];
    await replaceCards(workspaceId, cards);

    const input = makeQueryInput({
      cursor: null,
      limit: 10,
      sorts: [],
    });
    const result = await queryLocalCardsPage(workspaceId, input);

    expect(result.cards.map((card) => card.cardId)).toEqual(
      legacyQueryCards(cards, input).cards.map((card) => card.cardId),
    );
    expect(result.cards.map((card) => card.cardId)).toEqual([
      "card-newest-update",
      "card-middle-update",
      "card-oldest-update",
    ]);
  });

  it("matches query card tag filters by normalized Unicode tag keys", async () => {
    const cards: ReadonlyArray<Card> = [
      makeCard({
        cardId: "unicode-tag-card",
        frontText: "Unicode tag",
        backText: "back",
        tags: ["Éclair"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-05T00:00:00.000Z",
      }),
      makeCard({
        cardId: "other-tag-card",
        frontText: "Other tag",
        backText: "back",
        tags: ["code"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-02T00:00:00.000Z",
        updatedAt: "2025-01-04T00:00:00.000Z",
      }),
    ];
    await replaceCards(workspaceId, cards);

    const result = await queryLocalCardsPage(workspaceId, {
      searchText: null,
      cursor: null,
      limit: 10,
      sorts: [],
      filter: {
        tags: ["éclair"],
        effort: [],
      },
    });

    expect(result.cards.map((card) => card.cardId)).toEqual(["unicode-tag-card"]);
    expect(result.totalCount).toBe(1);
  });

  it("keeps pagination stable when multiple cards share the same updatedAt", async () => {
    const cards: ReadonlyArray<Card> = [
      makeCard({
        cardId: "card-c",
        frontText: "Card C",
        backText: "back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-05T00:00:00.000Z",
      }),
      makeCard({
        cardId: "card-a",
        frontText: "Card A",
        backText: "back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-02T00:00:00.000Z",
        updatedAt: "2025-01-05T00:00:00.000Z",
      }),
      makeCard({
        cardId: "card-b",
        frontText: "Card B",
        backText: "back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-03T00:00:00.000Z",
        updatedAt: "2025-01-05T00:00:00.000Z",
      }),
      makeCard({
        cardId: "card-d",
        frontText: "Card D",
        backText: "back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-04T00:00:00.000Z",
        updatedAt: "2025-01-04T00:00:00.000Z",
      }),
    ];
    await replaceCards(workspaceId, cards);

    const firstPage = await queryLocalCardsPage(workspaceId, makeQueryInput({
      cursor: null,
      limit: 2,
      sorts: [],
    }));
    const secondPage = await queryLocalCardsPage(workspaceId, makeQueryInput({
      cursor: firstPage.nextCursor,
      limit: 2,
      sorts: [],
    }));

    expect(firstPage.cards.map((card) => card.cardId)).toEqual(["card-a", "card-b"]);
    expect(secondPage.cards.map((card) => card.cardId)).toEqual(["card-c", "card-d"]);
  });

  it("supports explicit updatedAt sorting in both directions", async () => {
    const cards: ReadonlyArray<Card> = [
      makeCard({
        cardId: "card-1",
        frontText: "Card 1",
        backText: "back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-03T00:00:00.000Z",
      }),
      makeCard({
        cardId: "card-2",
        frontText: "Card 2",
        backText: "back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-02T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
      makeCard({
        cardId: "card-3",
        frontText: "Card 3",
        backText: "back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-03T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      }),
    ];
    await replaceCards(workspaceId, cards);

    const ascendingInput = makeQueryInput({
      cursor: null,
      limit: 10,
      sorts: [{ key: "updatedAt", direction: "asc" }],
    });
    const descendingInput = makeQueryInput({
      cursor: null,
      limit: 10,
      sorts: [{ key: "updatedAt", direction: "desc" }],
    });
    const ascendingResult = await queryLocalCardsPage(workspaceId, ascendingInput);
    const descendingResult = await queryLocalCardsPage(workspaceId, descendingInput);

    expect(ascendingResult.cards.map((card) => card.cardId)).toEqual(
      legacyQueryCards(cards, ascendingInput).cards.map((card) => card.cardId),
    );
    expect(descendingResult.cards.map((card) => card.cardId)).toEqual(
      legacyQueryCards(cards, descendingInput).cards.map((card) => card.cardId),
    );
    expect(ascendingResult.cards.map((card) => card.cardId)).toEqual(["card-2", "card-3", "card-1"]);
    expect(descendingResult.cards.map((card) => card.cardId)).toEqual(["card-1", "card-3", "card-2"]);
  });
});
