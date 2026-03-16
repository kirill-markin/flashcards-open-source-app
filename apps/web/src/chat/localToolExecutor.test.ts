import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalToolExecutor } from "./localToolExecutor";
import { MAX_SQL_LIMIT } from "./localToolExecutorTypes";
import type { AppDataContextValue } from "../appData/types";
import {
  loadCardById,
  replaceCards,
} from "../localDb/cards";
import { clearWebSyncCache } from "../localDb/cache";
import { putCloudSettings } from "../localDb/cloudSettings";
import { replaceDecks } from "../localDb/decks";
import { putOutboxRecord } from "../localDb/outbox";
import { replaceReviewEvents } from "../localDb/reviews";
import { putWorkspaceSettings, setLastAppliedChangeId } from "../localDb/workspace";
import type { Card, CloudSettings, Deck, SessionInfo, WorkspaceSchedulerSettings, WorkspaceSummary } from "../types";

const localStorageState = new Map<string, string>();

beforeEach(() => {
  localStorageState.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string): string | null {
        return localStorageState.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        localStorageState.set(key, value);
      },
      removeItem(key: string): void {
        localStorageState.delete(key);
      },
      clear(): void {
        localStorageState.clear();
      },
    } satisfies Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear">,
  });
});

function makeCard(overrides: Partial<Card>): Card {
  return {
    cardId: "card-1",
    frontText: "Front",
    backText: "Back",
    tags: ["tag-a"],
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
    ...overrides,
  };
}

function makeDeck(overrides: Partial<Deck>): Deck {
  return {
    deckId: "deck-1",
    workspaceId: "workspace-1",
    name: "Grammar",
    filterDefinition: {
      version: 2,
      effortLevels: ["medium"],
      tags: ["tag-a"],
    },
    createdAt: "2026-03-09T09:00:00.000Z",
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "op-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
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

function makeCloudSettings(): CloudSettings {
  return {
    deviceId: "device-1",
    cloudState: "linked",
    linkedUserId: "user-1",
    linkedWorkspaceId: "workspace-1",
    linkedEmail: "test@example.com",
    onboardingCompleted: true,
    updatedAt: "2026-03-10T09:00:00.000Z",
  };
}

function makeSession(): SessionInfo {
  return {
    userId: "user-1",
    selectedWorkspaceId: "workspace-1",
    authTransport: "session",
    csrfToken: "csrf-1",
    profile: {
      email: "test@example.com",
      locale: "en",
      createdAt: "2026-03-01T00:00:00.000Z",
    },
  };
}

function makeWorkspace(): WorkspaceSummary {
  return {
    workspaceId: "workspace-1",
    name: "Personal",
    createdAt: "2026-03-01T00:00:00.000Z",
    isSelected: true,
  };
}

function makeSeedData(): Readonly<{
  cards: ReadonlyArray<Card>;
  decks: ReadonlyArray<Deck>;
  reviewEvents: ReadonlyArray<{
    reviewEventId: string;
    workspaceId: string;
    cardId: string;
    deviceId: string;
    clientEventId: string;
    rating: 0 | 1 | 2 | 3;
    reviewedAtClient: string;
    reviewedAtServer: string;
  }>;
  cloudSettings: CloudSettings;
}> {
  return {
    cards: [
      makeCard({ cardId: "card-1", tags: ["tag-a"], updatedAt: "2026-03-10T09:00:00.000Z" }),
      makeCard({
        cardId: "card-2",
        frontText: "Second",
        reps: 2,
        dueAt: "2026-03-10T08:00:00.000Z",
        updatedAt: "2026-03-10T08:00:00.000Z",
      }),
    ],
    decks: [makeDeck({})],
    reviewEvents: [{
      reviewEventId: "review-1",
      workspaceId: "workspace-1",
      cardId: "card-2",
      deviceId: "device-1",
      clientEventId: "event-1",
      rating: 2,
      reviewedAtClient: "2026-03-10T08:00:00.000Z",
      reviewedAtServer: "2026-03-10T08:00:01.000Z",
    }],
    cloudSettings: makeCloudSettings(),
  };
}

function buildKeywordHeavyBackText(): string {
  return [
    "This text mentions where, order by, group by, limit, offset, and, or.",
    "It also keeps commas, equals = signs, and parentheses like fn(where_value).",
    "",
    "```python",
    "query = 'where order by limit'",
    "print('group by and or')",
    "```",
    "",
    "It's important that doubled quotes stay exact.",
  ].join("\n");
}

async function seedLocalDatabase(cards: ReadonlyArray<Card>): Promise<void> {
  const seedData = makeSeedData();
  await clearWebSyncCache();
  await replaceCards(cards);
  await replaceDecks(seedData.decks);
  await replaceReviewEvents(seedData.reviewEvents);
  await putWorkspaceSettings(makeSchedulerSettings());
  await putCloudSettings(seedData.cloudSettings);
  await putOutboxRecord({
    operationId: "outbox-1",
    workspaceId: "workspace-1",
    createdAt: "2026-03-10T08:00:00.000Z",
    attemptCount: 1,
    lastError: "Temporary failure",
    operation: {
      operationId: "outbox-1",
      entityType: "card",
      entityId: "card-2",
      action: "upsert",
      clientUpdatedAt: "2026-03-10T08:00:00.000Z",
      payload: {
        cardId: "card-2",
        frontText: "Second",
        backText: "Back",
        tags: ["tag-a"],
        effortLevel: "medium",
        dueAt: null,
        createdAt: "2026-03-10T08:00:00.000Z",
        reps: 0,
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
  await setLastAppliedChangeId("workspace-1", 12);
}

function makeDependencies(): Pick<
  AppDataContextValue,
  | "session"
  | "activeWorkspace"
  | "refreshLocalData"
  | "createCardItem"
  | "createDeckItem"
  | "updateCardItem"
  | "updateDeckItem"
  | "deleteCardItem"
  | "deleteDeckItem"
> {
  return {
    session: makeSession(),
    activeWorkspace: makeWorkspace(),
    refreshLocalData: vi.fn(async () => undefined),
    createCardItem: vi.fn(async (input) => makeCard({ cardId: "created-card", ...input })),
    createDeckItem: vi.fn(async (input) => makeDeck({
      deckId: "created-deck",
      name: input.name,
      filterDefinition: input.filterDefinition,
    })),
    updateCardItem: vi.fn(async (cardId, input) => makeCard({ cardId, ...input })),
    updateDeckItem: vi.fn(async (deckId, input) => makeDeck({
      deckId,
      name: input.name,
      filterDefinition: input.filterDefinition,
    })),
    deleteCardItem: vi.fn(async (cardId) => makeCard({ cardId, deletedAt: "2026-03-10T10:00:00.000Z" })),
    deleteDeckItem: vi.fn(async (deckId) => makeDeck({ deckId, deletedAt: "2026-03-10T10:00:00.000Z" })),
  };
}

function toSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

describe("createLocalToolExecutor", () => {
  it("supports SQL introspection and reads", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const executor = createLocalToolExecutor(makeDependencies());

    const tablesResult = await executor.execute({
      toolCallId: "call-1",
      name: "sql",
      input: "{\"sql\":\"SHOW TABLES\"}",
    });
    const tablesPayload = JSON.parse(tablesResult.output) as Readonly<{ rows: ReadonlyArray<Readonly<Record<string, unknown>>> }>;
    expect(tablesPayload.rows.some((row) => row.table_name === "workspace")).toBe(true);
    expect(tablesPayload.rows.some((row) => row.table_name === "cards")).toBe(true);
    expect(tablesPayload.rows.some((row) => row.table_name === "review_events")).toBe(true);

    const workspaceResult = await executor.execute({
      toolCallId: "call-2",
      name: "sql",
      input: "{\"sql\":\"SELECT * FROM workspace LIMIT 1 OFFSET 0\"}",
    });
    const workspacePayload = JSON.parse(workspaceResult.output) as Readonly<{ rows: ReadonlyArray<Readonly<Record<string, unknown>>> }>;
    expect(workspacePayload.rows[0]).toMatchObject({
      workspace_id: "workspace-1",
      name: "Personal",
      algorithm: "fsrs-6",
    });

    const cardsResult = await executor.execute({
      toolCallId: "call-3",
      name: "sql",
      input: "{\"sql\":\"SELECT * FROM cards ORDER BY updated_at DESC LIMIT 1 OFFSET 0\"}",
    });
    const cardsPayload = JSON.parse(cardsResult.output) as Readonly<{ rows: ReadonlyArray<Card>; rowCount: number; limit: number; offset: number }>;
    expect(cardsPayload.rowCount).toBe(1);
    expect(cardsPayload.limit).toBe(1);
    expect(cardsPayload.offset).toBe(0);
    expect(cardsPayload.rows[0]).toMatchObject({
      card_id: "card-1",
    });

    const projectedResult = await executor.execute({
      toolCallId: "call-4",
      name: "sql",
      input: "{\"sql\":\"SELECT card_id, front_text, back_text, tags FROM cards WHERE LOWER(front_text) LIKE '%front%' OR LOWER(back_text) LIKE '%front%' ORDER BY updated_at DESC LIMIT 20 OFFSET 0\"}",
    });
    const projectedPayload = JSON.parse(projectedResult.output) as Readonly<{ rows: ReadonlyArray<Readonly<Record<string, unknown>>>; rowCount: number }>;
    expect(projectedPayload.rowCount).toBe(1);
    expect(projectedPayload.rows[0]).toEqual({
      card_id: "card-1",
      front_text: "Front",
      back_text: "Back",
      tags: ["tag-a"],
    });

    const aggregateResult = await executor.execute({
      toolCallId: "call-5",
      name: "sql",
      input: "{\"sql\":\"SELECT tag, COUNT(*) AS cards_count FROM cards UNNEST tags AS tag GROUP BY tag ORDER BY cards_count DESC LIMIT 20 OFFSET 0\"}",
    });
    const aggregatePayload = JSON.parse(aggregateResult.output) as Readonly<{ rows: ReadonlyArray<Readonly<Record<string, unknown>>> }>;
    expect(aggregatePayload.rows[0]).toMatchObject({
      tag: "tag-a",
      cards_count: 2,
    });
  });

  it("supports case-insensitive exact matches on unnested tags", async () => {
    await seedLocalDatabase([
      makeCard({
        cardId: "card-1",
        frontText: "TypeScript note",
        tags: ["TypeScript", "frontend"],
        updatedAt: "2026-03-10T09:00:00.000Z",
      }),
      makeCard({
        cardId: "card-2",
        frontText: "Other note",
        tags: ["backend"],
        updatedAt: "2026-03-10T08:00:00.000Z",
      }),
    ]);
    const executor = createLocalToolExecutor(makeDependencies());

    const result = await executor.execute({
      toolCallId: "call-unnest-exact-tag",
      name: "sql",
      input: JSON.stringify({
        sql: "SELECT card_id, front_text, back_text, tags FROM cards UNNEST tags AS tag WHERE LOWER(tag) = 'typescript' ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0",
      }),
    });
    const payload = JSON.parse(result.output) as Readonly<{
      rowCount: number;
      rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }>;

    expect(payload.rowCount).toBe(1);
    expect(payload.rows[0]?.front_text).toBe("TypeScript note");
    expect(payload.rows[0]?.tags).toEqual(["TypeScript", "frontend"]);
  });

  it("supports standalone ORDER BY RANDOM() for SQL reads", async () => {
    const seedData = makeSeedData();
    const cards = [...seedData.cards, 
      makeCard({
        cardId: "card-3",
        frontText: "Third",
        backText: "Third Back",
        tags: ["tag-c"],
        updatedAt: "2026-03-10T07:00:00.000Z",
      }),
    ];
    await seedLocalDatabase(cards);
    const executor = createLocalToolExecutor(makeDependencies());
    const randomSpy = vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.8);

    try {
      const randomResult = await executor.execute({
        toolCallId: "call-random",
        name: "sql",
        input: "{\"sql\":\"SELECT card_id, front_text, back_text, tags FROM cards ORDER BY RANDOM() LIMIT 2 OFFSET 1\"}",
      });
      const randomPayload = JSON.parse(randomResult.output) as Readonly<{
        rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
        rowCount: number;
        limit: number;
        offset: number;
      }>;

      expect(randomPayload.rowCount).toBe(2);
      expect(randomPayload.limit).toBe(2);
      expect(randomPayload.offset).toBe(1);
      expect(randomPayload.rows).toEqual([
        {
          card_id: "card-2",
          front_text: "Second",
          back_text: "Back",
          tags: ["tag-a"],
        },
        {
          card_id: "card-1",
          front_text: "Front",
          back_text: "Back",
          tags: ["tag-a"],
        },
      ]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("supports SQL mutations for cards", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const dependencies = makeDependencies();
    const executor = createLocalToolExecutor(dependencies);

    const insertResult = await executor.execute({
      toolCallId: "call-1",
      name: "sql",
      input: "{\"sql\":\"INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES ('Question', 'Answer', ('tag-b'), 'medium')\"}",
    });
    const insertPayload = JSON.parse(insertResult.output) as Readonly<{ affectedCount: number; rows: ReadonlyArray<Readonly<Record<string, unknown>>> }>;
    expect(insertPayload.affectedCount).toBe(1);
    expect(insertPayload.rows[0]?.card_id).toBe("created-card");
    expect(dependencies.createCardItem).toHaveBeenCalledTimes(1);

    const updateResult = await executor.execute({
      toolCallId: "call-2",
      name: "sql",
      input: "{\"sql\":\"UPDATE cards SET back_text = 'Updated Back' WHERE card_id = 'card-1'\"}",
    });
    const updatePayload = JSON.parse(updateResult.output) as Readonly<{ affectedCount: number }>;
    expect(updatePayload.affectedCount).toBe(1);
    expect(dependencies.updateCardItem).toHaveBeenCalledWith("card-1", expect.objectContaining({
      backText: "Updated Back",
    }));

    const deleteResult = await executor.execute({
      toolCallId: "call-3",
      name: "sql",
      input: "{\"sql\":\"DELETE FROM cards WHERE card_id = 'card-2'\"}",
    });
    const deletePayload = JSON.parse(deleteResult.output) as Readonly<{ affectedCount: number }>;
    expect(deletePayload.affectedCount).toBe(1);
    expect(dependencies.deleteCardItem).toHaveBeenCalledWith("card-2");
    expect(insertResult.didMutateAppState).toBe(true);
    expect(updateResult.didMutateAppState).toBe(true);
    expect(deleteResult.didMutateAppState).toBe(true);
  });

  it("supports read-only multi-statement SQL batches", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const executor = createLocalToolExecutor(makeDependencies());

    const result = await executor.execute({
      toolCallId: "call-read-batch",
      name: "sql",
      input: JSON.stringify({
        sql: "SHOW TABLES; SELECT * FROM workspace LIMIT 1 OFFSET 0",
      }),
    });
    const payload = JSON.parse(result.output) as Readonly<{
      statementType: string;
      statementCount: number;
      affectedCountTotal: number | null;
      statements: ReadonlyArray<Readonly<{ statementType: string }>>;
    }>;

    expect(payload.statementType).toBe("batch");
    expect(payload.statementCount).toBe(2);
    expect(payload.affectedCountTotal).toBe(null);
    expect(payload.statements.map((statement) => statement.statementType)).toEqual(["show_tables", "select"]);
    expect(result.didMutateAppState).toBe(false);
  });

  it("supports mutation multi-statement SQL batches and refreshes once", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const dependencies = makeDependencies();
    const executor = createLocalToolExecutor(dependencies);

    const result = await executor.execute({
      toolCallId: "call-mutation-batch",
      name: "sql",
      input: JSON.stringify({
        sql: "UPDATE cards SET back_text = 'Batch Back 1' WHERE card_id = 'card-1'; UPDATE cards SET back_text = 'Batch Back 2' WHERE card_id = 'card-2'",
      }),
    });
    const payload = JSON.parse(result.output) as Readonly<{
      statementType: string;
      statementCount: number;
      affectedCountTotal: number | null;
      statements: ReadonlyArray<Readonly<{ statementType: string; affectedCount: number }>>;
    }>;
    const updatedCardOne = await loadCardById("card-1");
    const updatedCardTwo = await loadCardById("card-2");

    expect(payload.statementType).toBe("batch");
    expect(payload.statementCount).toBe(2);
    expect(payload.affectedCountTotal).toBe(2);
    expect(payload.statements.map((statement) => ({
      statementType: statement.statementType,
      affectedCount: statement.affectedCount,
    }))).toEqual([
      { statementType: "update", affectedCount: 1 },
      { statementType: "update", affectedCount: 1 },
    ]);
    expect(updatedCardOne?.backText).toBe("Batch Back 1");
    expect(updatedCardTwo?.backText).toBe("Batch Back 2");
    expect(dependencies.refreshLocalData).toHaveBeenCalledTimes(1);
    expect(result.didMutateAppState).toBe(true);
  });

  it("rejects mixed read and mutation SQL batches", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const executor = createLocalToolExecutor(makeDependencies());

    await expect(executor.execute({
      toolCallId: "call-mixed-batch",
      name: "sql",
      input: JSON.stringify({
        sql: "SHOW TABLES; UPDATE cards SET back_text = 'Updated Back' WHERE card_id = 'card-1'",
      }),
    })).rejects.toThrow("SQL batch must contain only read statements or only mutation statements");
  });

  it("rejects INSERT statements above the per-statement record limit", async () => {
    const executor = createLocalToolExecutor(makeDependencies());
    const values = Array.from({ length: MAX_SQL_LIMIT + 1 }, (_value, index) => (
      `('Front ${index + 1}', 'Back ${index + 1}', ('tag-a'), 'medium')`
    )).join(", ");

    await expect(executor.execute({
      toolCallId: "call-too-many-insert-rows",
      name: "sql",
      input: JSON.stringify({
        sql: `INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES ${values}`,
      }),
    })).rejects.toThrow("INSERT may affect at most 100 records per statement");
  });

  it("keeps mutation batches all-or-nothing when a later statement fails", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const dependencies = makeDependencies();
    const executor = createLocalToolExecutor(dependencies);

    await expect(executor.execute({
      toolCallId: "call-failing-batch",
      name: "sql",
      input: JSON.stringify({
        sql: "UPDATE cards SET back_text = 'First change' WHERE card_id = 'card-1'; UPDATE cards SET back_text = 'Second change' WHERE missing_column = 'x'",
      }),
    })).rejects.toThrow();

    const unchangedCard = await loadCardById("card-1");
    expect(unchangedCard?.backText).toBe("Back");
    expect(dependencies.refreshLocalData).not.toHaveBeenCalled();
  });

  it("preserves multiline back_text in SQL updates", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const dependencies = makeDependencies();
    const executor = createLocalToolExecutor(dependencies);
    const backText = [
      "Dijkstra finds the shortest paths.",
      "",
      "```python",
      "print('hello')",
      "```",
    ].join("\n");

    const updateResult = await executor.execute({
      toolCallId: "call-multiline-update",
      name: "sql",
      input: JSON.stringify({
        sql: `UPDATE cards SET back_text = ${toSqlStringLiteral(backText)} WHERE card_id = 'card-1'`,
      }),
    });
    const updatePayload = JSON.parse(updateResult.output) as Readonly<{
      affectedCount: number;
      rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }>;

    expect(updatePayload.affectedCount).toBe(1);
    expect(updatePayload.rows[0]?.back_text).toBe(backText);
    expect(dependencies.updateCardItem).toHaveBeenCalledWith("card-1", expect.objectContaining({
      backText,
    }));
  });

  it("supports keyword-heavy string literals in SQL updates and LIKE filters", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const dependencies = makeDependencies();
    const executor = createLocalToolExecutor(dependencies);
    const backText = buildKeywordHeavyBackText();

    const updateResult = await executor.execute({
      toolCallId: "call-keyword-heavy-update",
      name: "sql",
      input: JSON.stringify({
        sql: `UPDATE cards SET back_text = ${toSqlStringLiteral(backText)} WHERE card_id = 'card-1'`,
      }),
    });
    const updatePayload = JSON.parse(updateResult.output) as Readonly<{
      affectedCount: number;
      rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }>;
    expect(updatePayload.affectedCount).toBe(1);
    expect(updatePayload.rows[0]?.back_text).toBe(backText);

    const selectResult = await executor.execute({
      toolCallId: "call-keyword-heavy-select",
      name: "sql",
      input: JSON.stringify({
        sql: "SELECT card_id, back_text FROM cards WHERE LOWER(back_text) LIKE '%order by%' ORDER BY updated_at DESC LIMIT 20 OFFSET 0",
      }),
    });
    const selectPayload = JSON.parse(selectResult.output) as Readonly<{
      rowCount: number;
      rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }>;
    expect(selectPayload.rowCount).toBe(0);
    expect(selectPayload.rows).toEqual([]);
    expect(dependencies.updateCardItem).toHaveBeenCalledWith("card-1", expect.objectContaining({
      backText,
    }));
  });

  it("keeps cloud settings and outbox available as local-only tools", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const executor = createLocalToolExecutor(makeDependencies());

    const cloudResult = await executor.execute({
      toolCallId: "call-1",
      name: "get_cloud_settings",
      input: "{}",
    });
    expect(JSON.parse(cloudResult.output)).toEqual(seedData.cloudSettings);

    const outboxResult = await executor.execute({
      toolCallId: "call-2",
      name: "list_outbox",
      input: "{\"cursor\":null,\"limit\":100}",
    });
    const outboxPayload = JSON.parse(outboxResult.output) as Readonly<{ outbox: ReadonlyArray<Readonly<Record<string, unknown>>>; nextCursor: string | null }>;
    expect(outboxPayload.outbox).toHaveLength(1);
    expect(outboxPayload.outbox[0]?.operationId).toBe("outbox-1");
    expect(outboxPayload.nextCursor).toBe(null);
  });

  it("wraps invalid sql tool input JSON errors", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const executor = createLocalToolExecutor(makeDependencies());

    await expect(executor.execute({
      toolCallId: "call-invalid-json",
      name: "sql",
      input: "{\"sql\":\"SHOW TABLES\"}\n{\"sql\":\"DESCRIBE cards\"}",
    })).rejects.toThrow("Tool sql input is invalid JSON:");
  });

  it("rejects invalid outbox cursors", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const executor = createLocalToolExecutor(makeDependencies());

    await expect(executor.execute({
      toolCallId: "call-invalid-cursor",
      name: "list_outbox",
      input: JSON.stringify({
        cursor: "not-base64",
        limit: 20,
      }),
    })).rejects.toThrow("cursor is invalid:");
  });

  it("rejects outbox limits outside the supported range", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const executor = createLocalToolExecutor(makeDependencies());

    await expect(executor.execute({
      toolCallId: "call-invalid-limit",
      name: "list_outbox",
      input: JSON.stringify({
        cursor: null,
        limit: 101,
      }),
    })).rejects.toThrow("limit must be an integer between 1 and 100");
  });

  it("rejects unsupported local tool names", async () => {
    const seedData = makeSeedData();
    await seedLocalDatabase(seedData.cards);
    const executor = createLocalToolExecutor(makeDependencies());

    await expect(executor.execute({
      toolCallId: "call-unsupported-tool",
      name: "legacy_shared_tool",
      input: "{}",
    })).rejects.toThrow("Unsupported AI tool: legacy_shared_tool");
  });
});
