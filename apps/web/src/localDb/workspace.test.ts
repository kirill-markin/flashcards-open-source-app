// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadDecksListSnapshot } from "./decks";
import { loadWorkspaceOverviewSnapshot, loadWorkspaceTagsSummary } from "./workspace";
import { sampleCards, seedCursorFixtures, workspaceId } from "./testSupport";

describe("localDb workspace", () => {
  beforeEach(async () => {
    await seedCursorFixtures();
  });

  it("builds workspace tag summaries from active card tags only", async () => {
    const result = await loadWorkspaceTagsSummary();

    expect(result.totalCards).toBe(7);
    expect(result.tags).toEqual([
      { tag: "grammar", cardsCount: 4 },
      { tag: "code", cardsCount: 3 },
      { tag: "shared", cardsCount: 2 },
    ]);
    expect(sampleCards.some((card) => card.cardId === "deleted-card")).toBe(true);
  });

  it("builds deck snapshots with stable due, new, and reviewed counts", async () => {
    const originalNow = Date.now;
    Date.now = () => Date.parse("2025-01-08T00:00:00.000Z");

    try {
      const result = await loadDecksListSnapshot();

      expect(result.allCardsStats).toEqual({
        totalCards: 7,
        dueCards: 5,
        newCards: 5,
        reviewedCards: 2,
      });
      expect(result.deckSummaries).toEqual([
        {
          deckId: "deck-long-code",
          name: "Long code",
          filterDefinition: {
            version: 2,
            effortLevels: ["long"],
            tags: ["code"],
          },
          createdAt: "2025-01-02T00:00:00.000Z",
          totalCards: 3,
          dueCards: 2,
          newCards: 1,
          reviewedCards: 2,
        },
        {
          deckId: "deck-fast-grammar",
          name: "Fast grammar",
          filterDefinition: {
            version: 2,
            effortLevels: ["fast"],
            tags: ["grammar"],
          },
          createdAt: "2025-01-01T00:00:00.000Z",
          totalCards: 3,
          dueCards: 2,
          newCards: 3,
          reviewedCards: 0,
        },
      ]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("builds workspace overview from the tag and deck snapshots", async () => {
    const originalNow = Date.now;
    Date.now = () => Date.parse("2025-01-08T00:00:00.000Z");

    try {
      const result = await loadWorkspaceOverviewSnapshot({
        workspaceId,
        name: "Personal",
        createdAt: "2025-01-01T00:00:00.000Z",
        isSelected: true,
      });

      expect(result).toEqual({
        workspaceName: "Personal",
        deckCount: 2,
        tagsCount: 3,
        totalCards: 7,
        dueCount: 5,
        newCount: 5,
        reviewedCount: 2,
      });
    } finally {
      Date.now = originalNow;
    }
  });
});
