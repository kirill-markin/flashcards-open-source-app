// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { putCard, queryLocalCardsPage } from "./cards";
import { legacyQueryCards, makeCard, sampleCards, seedCursorFixtures, workspaceId } from "./testSupport";
import type { QueryCardsInput } from "../types";

describe("localDb cards", () => {
  beforeEach(async () => {
    await seedCursorFixtures();
  });

  it("matches legacy cards query for default created-desc paging and filters", async () => {
    const inputs: ReadonlyArray<QueryCardsInput> = [
      { searchText: null, cursor: null, limit: 3, sorts: [], filter: null },
      { searchText: null, cursor: null, limit: 10, sorts: [], filter: { tags: [], effort: ["long"] } },
      { searchText: null, cursor: null, limit: 10, sorts: [], filter: { tags: ["grammar"], effort: [] } },
      { searchText: null, cursor: null, limit: 10, sorts: [], filter: { tags: ["code"], effort: ["long"] } },
      { searchText: "search", cursor: null, limit: 10, sorts: [], filter: null },
      { searchText: "search", cursor: null, limit: 10, sorts: [], filter: { tags: ["code"], effort: ["long"] } },
    ];

    for (const input of inputs) {
      const result = await queryLocalCardsPage(workspaceId, input);
      const legacy = legacyQueryCards(sampleCards, input);

      expect(result.cards.map((card) => card.cardId)).toEqual(legacy.cards.slice(0, input.limit).map((card) => card.cardId));
      expect(result.totalCount).toBe(legacy.totalCount);
    }
  });

  it("keeps cards pagination gap-free when createdAt ties", async () => {
    const firstPage = await queryLocalCardsPage(workspaceId, {
      searchText: null,
      cursor: null,
      limit: 2,
      sorts: [],
      filter: null,
    });
    const secondPage = await queryLocalCardsPage(workspaceId, {
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

    expect(firstPage.cards.map((card) => card.cardId)).toEqual(legacy.cards.slice(0, 2).map((card) => card.cardId));
    expect(secondPage.cards.map((card) => card.cardId)).toEqual(legacy.cards.slice(2, 4).map((card) => card.cardId));
  });

  it("keeps cards pagination gap-free for non-default local sorts without materializing a full page list", async () => {
    const firstPage = await queryLocalCardsPage(workspaceId, {
      searchText: null,
      cursor: null,
      limit: 3,
      sorts: [{ key: "reps", direction: "desc" }],
      filter: null,
    });
    const secondPage = await queryLocalCardsPage(workspaceId, {
      searchText: null,
      cursor: firstPage.nextCursor,
      limit: 3,
      sorts: [{ key: "reps", direction: "desc" }],
      filter: null,
    });
    const legacy = legacyQueryCards(sampleCards, {
      searchText: null,
      cursor: null,
      limit: 20,
      sorts: [{ key: "reps", direction: "desc" }],
      filter: null,
    });

    expect(firstPage.cards.map((card) => card.cardId)).toEqual(legacy.cards.slice(0, 3).map((card) => card.cardId));
    expect(secondPage.cards.map((card) => card.cardId)).toEqual(legacy.cards.slice(3, 6).map((card) => card.cardId));
    expect(firstPage.totalCount).toBe(legacy.totalCount);
    expect(secondPage.totalCount).toBe(legacy.totalCount);
  });

  it("reflects local DB changes immediately after a local mutation", async () => {
    const initialCardsPage = await queryLocalCardsPage(workspaceId, {
      searchText: null,
      cursor: null,
      limit: 20,
      sorts: [],
      filter: null,
    });
    expect(initialCardsPage.cards.map((card) => card.cardId)).not.toContain("new-sync-card");

    await putCard(workspaceId, makeCard({
      cardId: "new-sync-card",
      frontText: "Newest synced card",
      backText: "back",
      tags: ["grammar"],
      effortLevel: "fast",
      dueAt: null,
      createdAt: "2025-01-11T10:00:00.000Z",
    }));

    const nextCardsPage = await queryLocalCardsPage(workspaceId, {
      searchText: null,
      cursor: null,
      limit: 20,
      sorts: [],
      filter: null,
    });
    expect(nextCardsPage.cards.map((card) => card.cardId)[0]).toBe("new-sync-card");
  });
});
