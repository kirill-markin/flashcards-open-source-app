import assert from "node:assert/strict";
import test from "node:test";
import { executeAgentSql } from "./agentSql";
import type { AgentToolOperationDependencies } from "./agentToolOperations";
import { MAX_SQL_RECORD_LIMIT } from "./sqlToolLimits";
import type { Card } from "../cards";
import type { Deck } from "../decks";
import type { WorkspaceSchedulerSettings } from "../workspaceSchedulerSettings";
import type { WorkspaceSummary } from "../workspaces";
import { HttpError } from "../errors";

function makeCard(cardId: string): Card {
  return {
    cardId,
    frontText: `Front ${cardId}`,
    backText: `Back ${cardId}`,
    tags: ["grammar"],
    effortLevel: "medium",
    dueAt: null,
    createdAt: "2026-03-09T09:00:00.000Z",
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
    async queryCardsPage() {
      return {
        cards: defaultCardList,
        nextCursor: null,
        totalCount: defaultCardList.length,
      };
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

function makeContext(): Readonly<{
  userId: string;
  workspaceId: string;
  selectedWorkspaceId: string | null;
  connectionId: string;
}> {
  return {
    userId: "user-1",
    workspaceId: "workspace-1",
    selectedWorkspaceId: "workspace-1",
    connectionId: "connection-1",
  };
}

test("executeAgentSql keeps single-statement responses unchanged", async () => {
  const result = await executeAgentSql(
    makeContext(),
    "SHOW TABLES",
    createDependencies({}),
  );

  assert.equal(result.data.statementType, "show_tables");
  assert.ok("rows" in result.data);
});

test("executeAgentSql returns a batch payload for read-only multi-statement SQL", async () => {
  const result = await executeAgentSql(
    makeContext(),
    "SHOW TABLES; SELECT * FROM workspace LIMIT 1 OFFSET 0",
    createDependencies({}),
  );

  assert.equal(result.data.statementType, "batch");
  assert.equal(result.data.statementCount, 2);
  assert.equal(result.data.affectedCountTotal, null);
  assert.deepEqual(
    result.data.statements.map((statement) => statement.statementType),
    ["show_tables", "select"],
  );
  assert.equal(
    result.instructions,
    "Read rows from data.statements. Each entry preserves the single-statement payload shape. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the full contract.",
  );
});

test("executeAgentSql rejects mixed read and mutation batches", async () => {
  await assert.rejects(
    () => executeAgentSql(
      makeContext(),
      "SHOW TABLES; UPDATE cards SET back_text = 'Updated answer' WHERE card_id = 'card-1'",
      createDependencies({}),
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.match(error.message, /must contain only read statements or only mutation statements/);
      return true;
    },
  );
});

test("executeAgentSql reports the failing statement index for invalid SQL in a batch", async () => {
  await assert.rejects(
    () => executeAgentSql(
      makeContext(),
      "SHOW TABLES; SELECT * FROM workspace LIMIT nope OFFSET 0",
      createDependencies({}),
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.match(error.message, /SQL batch statement 2 failed/);
      return true;
    },
  );
});

test("executeAgentSql rejects INSERT statements above the per-statement record limit", async () => {
  const values = Array.from({ length: MAX_SQL_RECORD_LIMIT + 1 }, (_value, index) => (
    `('Front ${index + 1}', 'Back ${index + 1}', ('tag-a'), 'medium')`
  )).join(", ");

  await assert.rejects(
    () => executeAgentSql(
      makeContext(),
      `INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES ${values}`,
      createDependencies({}),
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.match(error.message, /INSERT may affect at most 100 records per statement/);
      return true;
    },
  );
});

test("executeAgentSql resolves SQL predicates before single-statement card updates", async () => {
  const result = await executeAgentSql(
    makeContext(),
    "UPDATE cards SET back_text = 'Updated answer' WHERE card_id = 'card-1'",
    createDependencies({
      async queryCardsPage() {
        return {
          cards: [makeCard("card-1"), makeCard("card-2")],
          nextCursor: null,
          totalCount: 2,
        };
      },
      async updateCards(_userId, _workspaceId, updates) {
        assert.equal(updates.length, 1);
        assert.equal(updates[0]?.cardId, "card-1");
        assert.deepEqual(updates[0]?.input, {
          backText: "Updated answer",
        });
        assert.equal(updates[0]?.metadata.lastModifiedByDeviceId, "device-1");
        assert.match(updates[0]?.metadata.lastOperationId ?? "", /^update_cards-0-/);

        return [{
          ...makeCard("card-1"),
          backText: "Updated answer",
        }];
      },
    }),
  );

  assert.equal(result.data.statementType, "update");
  assert.equal(result.data.affectedCount, 1);
  assert.equal(result.data.rows.length, 1);
  assert.equal(result.data.rows[0]?.card_id, "card-1");
  assert.equal(result.data.rows[0]?.back_text, "Updated answer");
});

test("executeAgentSql resolves SQL predicates before single-statement deck deletes", async () => {
  const result = await executeAgentSql(
    makeContext(),
    "DELETE FROM decks WHERE deck_id = 'deck-1'",
    createDependencies({
      async listDecksPage() {
        return {
          decks: [makeDeck("deck-1"), makeDeck("deck-2")],
          nextCursor: null,
        };
      },
      async deleteDecks(_userId, _workspaceId, items) {
        assert.equal(items.length, 1);
        assert.equal(items[0]?.deckId, "deck-1");
        assert.equal(items[0]?.metadata.lastModifiedByDeviceId, "device-1");
        assert.match(items[0]?.metadata.lastOperationId ?? "", /^delete_decks-0-/);

        return {
          deletedDeckIds: ["deck-1"],
          deletedCount: 1,
        };
      },
    }),
  );

  assert.equal(result.data.statementType, "delete");
  assert.equal(result.data.affectedCount, 1);
  assert.deepEqual(result.data.rows, []);
});

test("executeAgentSql prefixes execution-time batch failures with the statement preview", async () => {
  await assert.rejects(
    () => executeAgentSql(
      makeContext(),
      "SELECT * FROM workspace LIMIT 0 OFFSET 0; SHOW TABLES",
      createDependencies({}),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /SQL batch statement 1 failed: LIMIT must be greater than 0/);
      assert.match(error.message, /Statement: SELECT \* FROM workspace LIMIT 0 OFFSET 0/);
      return true;
    },
  );
});
