import assert from "node:assert/strict";
import test from "node:test";
import {
  listAgentCardsOperation,
  listAgentTagsOperation,
  loadAgentWorkspaceContextOperation,
  searchAgentCardsOperation,
  updateAgentDecksOperation,
  type AgentToolOperationDependencies,
} from "./agentToolOperations";
import type { Card, DeckSummary } from "../cards";
import type { Deck } from "../decks";
import type { WorkspaceSchedulerSettings } from "../workspaceSchedulerSettings";
import type { WorkspaceSummary } from "../workspaces";

function makeCard(cardId: string): Card {
  return {
    cardId,
    frontText: `Front ${cardId}`,
    backText: `Back ${cardId}`,
    tags: ["grammar"],
    effortLevel: "medium",
    dueAt: null,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "op-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
  };
}

function makeDeck(deckId: string): Deck {
  return {
    deckId,
    workspaceId: "workspace-1",
    name: "Grammar",
    filterDefinition: {
      version: 2,
      effortLevels: ["medium"],
      tags: ["grammar"],
    },
    createdAt: "2026-03-09T09:00:00.000Z",
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "deck-op-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
  };
}

function makeDeckSummary(): DeckSummary {
  return {
    totalCards: 10,
    dueCards: 4,
    newCards: 2,
    reviewedCards: 8,
    totalReps: 25,
    totalLapses: 3,
  };
}

function makeSchedulerSettings(): WorkspaceSchedulerSettings {
  return {
    algorithm: "fsrs-6",
    desiredRetention: 0.9,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    maximumIntervalDays: 365,
    enableFuzz: true,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "scheduler-op-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
  };
}

function makeWorkspaceSummary(workspaceId: string): WorkspaceSummary {
  return {
    workspaceId,
    name: "Personal",
    createdAt: "2026-03-01T00:00:00.000Z",
    isSelected: true,
  };
}

function createDependencies(
  overrides: Partial<AgentToolOperationDependencies>,
): AgentToolOperationDependencies {
  const defaultCardList = [makeCard("card-1")];
  const defaultDeckList = [makeDeck("deck-1")];

  return {
    async createCards() {
      return defaultCardList;
    },
    async deleteCards() {
      return {
        deletedCardIds: ["card-1"],
        deletedCount: 1,
      };
    },
    async getCards() {
      return defaultCardList;
    },
    async listReviewHistoryPage() {
      return {
        history: [],
        nextCursor: null,
      };
    },
    async listReviewQueuePage() {
      return {
        cards: defaultCardList,
        nextCursor: null,
      };
    },
    async listWorkspaceTagsSummary() {
      return {
        tags: [{
          tag: "grammar",
          cardsCount: 1,
        }],
        totalCards: 1,
      };
    },
    async queryCardsPage() {
      return {
        cards: defaultCardList,
        nextCursor: null,
        totalCount: defaultCardList.length,
      };
    },
    async summarizeDeckState() {
      return makeDeckSummary();
    },
    async updateCards() {
      return defaultCardList;
    },
    async ensureAgentSyncDevice() {
      return "device-1";
    },
    async createDecks() {
      return defaultDeckList;
    },
    async deleteDecks() {
      return {
        deletedDeckIds: ["deck-1"],
        deletedCount: 1,
      };
    },
    async getDecks() {
      return defaultDeckList;
    },
    async listDecksPage() {
      return {
        decks: defaultDeckList,
        nextCursor: null,
      };
    },
    async searchDecksPage() {
      return {
        decks: defaultDeckList,
        nextCursor: null,
      };
    },
    async updateDecks() {
      return defaultDeckList;
    },
    async getWorkspaceSchedulerSettings() {
      return makeSchedulerSettings();
    },
    async listUserWorkspacesForSelectedWorkspace() {
      return [makeWorkspaceSummary("workspace-1")];
    },
    ...overrides,
  };
}

test("listAgentCardsOperation returns a cursor-based page payload", async () => {
  const dependencies = createDependencies({
    async queryCardsPage(_workspaceId, input) {
      assert.equal(input.limit, 2);
      assert.equal(input.cursor, null);
      assert.equal(input.filter, null);
      return {
        cards: [makeCard("card-1"), makeCard("card-2")],
        nextCursor: "cursor-2",
        totalCount: 3,
      };
    },
  });

  const result = await listAgentCardsOperation(dependencies, {
    workspaceId: "workspace-1",
    cursor: null,
    limit: 2,
    filter: null,
  });

  assert.equal(result.cards.length, 2);
  assert.equal(result.nextCursor, "cursor-2");
});

test("searchAgentCardsOperation forwards card filters to queryCardsPage", async () => {
  const dependencies = createDependencies({
    async queryCardsPage(_workspaceId, input) {
      assert.equal(input.searchText, "grammar");
      assert.deepEqual(input.filter, {
        tags: ["grammar"],
        effort: ["fast"],
      });
      return {
        cards: [makeCard("card-1")],
        nextCursor: null,
        totalCount: 1,
      };
    },
  });

  const result = await searchAgentCardsOperation(dependencies, {
    workspaceId: "workspace-1",
    query: "grammar",
    cursor: null,
    limit: 20,
    filter: {
      tags: ["grammar"],
      effort: ["fast"],
    },
  });

  assert.equal(result.cards.length, 1);
  assert.equal(result.nextCursor, null);
});

test("loadAgentWorkspaceContextOperation combines workspace summary, deck summary, and scheduler settings", async () => {
  const dependencies = createDependencies({
    async listUserWorkspacesForSelectedWorkspace() {
      return [
        makeWorkspaceSummary("workspace-1"),
        makeWorkspaceSummary("workspace-2"),
      ];
    },
  });

  const result = await loadAgentWorkspaceContextOperation(dependencies, {
    userId: "user-1",
    workspaceId: "workspace-2",
    selectedWorkspaceId: "workspace-2",
  });

  assert.equal(result.workspace.workspaceId, "workspace-2");
  assert.deepEqual(result.deckSummary, makeDeckSummary());
  assert.deepEqual(result.schedulerSettings, makeSchedulerSettings());
});

test("listAgentTagsOperation returns workspace tags with per-tag counts and total cards", async () => {
  const dependencies = createDependencies({
    async listWorkspaceTagsSummary(workspaceId) {
      assert.equal(workspaceId, "workspace-1");
      return {
        tags: [
          { tag: "grammar", cardsCount: 3 },
          { tag: "verbs", cardsCount: 2 },
        ],
        totalCards: 4,
      };
    },
  });

  const result = await listAgentTagsOperation(dependencies, {
    workspaceId: "workspace-1",
  });

  assert.deepEqual(result, {
    tags: [
      { tag: "grammar", cardsCount: 3 },
      { tag: "verbs", cardsCount: 2 },
    ],
    totalCards: 4,
  });
});

test("updateAgentDecksOperation preserves current deck fields for null updates and forwards mutation metadata", async () => {
  const currentDeck = makeDeck("deck-1");
  let capturedDeckUpdates: ReadonlyArray<{
    deckId: string;
    input: {
      name: string;
      filterDefinition: {
        version: 2;
        effortLevels: ReadonlyArray<"fast" | "medium" | "long">;
        tags: ReadonlyArray<string>;
      };
    };
    metadata: {
      clientUpdatedAt: string;
      lastModifiedByDeviceId: string;
      lastOperationId: string;
    };
  }> = [];

  const dependencies = createDependencies({
    async getDecks() {
      return [currentDeck];
    },
    async updateDecks(workspaceId, items) {
      assert.equal(workspaceId, "workspace-1");
      capturedDeckUpdates = items;
      return [{
        ...currentDeck,
        name: items[0]?.input.name ?? currentDeck.name,
        filterDefinition: items[0]?.input.filterDefinition ?? currentDeck.filterDefinition,
      }];
    },
  });

  const result = await updateAgentDecksOperation(dependencies, {
    workspaceId: "workspace-1",
    userId: "user-1",
    connectionId: "connection-1",
    actionName: "update_decks",
    updates: [{
      deckId: "deck-1",
      name: null,
      effortLevels: ["fast", "medium"],
      tags: null,
    }],
  });

  assert.equal(result.updatedCount, 1);
  assert.equal(capturedDeckUpdates.length, 1);
  assert.equal(capturedDeckUpdates[0]?.input.name, currentDeck.name);
  assert.deepEqual(capturedDeckUpdates[0]?.input.filterDefinition, {
    version: 2,
    effortLevels: ["fast", "medium"],
    tags: currentDeck.filterDefinition.tags,
  });
  assert.equal(capturedDeckUpdates[0]?.metadata.lastModifiedByDeviceId, "device-1");
  assert.match(capturedDeckUpdates[0]?.metadata.lastOperationId ?? "", /^update_decks-0-/);
});
