import { describe, expect, it, vi } from "vitest";
import { createLocalToolExecutor } from "./localToolExecutor";
import type { AppDataContextValue, MutableSnapshot } from "../appData/types";
import type { Card, CloudSettings, Deck, SessionInfo, WorkspaceSchedulerSettings, WorkspaceSummary } from "../types";

function makeCard(overrides: Partial<Card>): Card {
  return {
    cardId: "card-1",
    frontText: "Front",
    backText: "Back",
    tags: ["tag-a"],
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

function makeSnapshot(): MutableSnapshot {
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
    workspaceSettings: makeSchedulerSettings(),
    cloudSettings: makeCloudSettings(),
    outbox: [{
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
    }],
    lastAppliedChangeId: 12,
  };
}

function makeDependencies(snapshot: MutableSnapshot): Pick<
  AppDataContextValue,
  | "session"
  | "activeWorkspace"
  | "getLocalSnapshot"
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
    getLocalSnapshot: () => snapshot,
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

describe("createLocalToolExecutor", () => {
  it("supports SQL introspection and reads", async () => {
    const snapshot = makeSnapshot();
    const executor = createLocalToolExecutor(makeDependencies(snapshot));

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

    const aggregateResult = await executor.execute({
      toolCallId: "call-4",
      name: "sql",
      input: "{\"sql\":\"SELECT tag, COUNT(*) AS cards_count FROM cards UNNEST tags AS tag GROUP BY tag ORDER BY cards_count DESC LIMIT 20 OFFSET 0\"}",
    });
    const aggregatePayload = JSON.parse(aggregateResult.output) as Readonly<{ rows: ReadonlyArray<Readonly<Record<string, unknown>>> }>;
    expect(aggregatePayload.rows[0]).toMatchObject({
      tag: "tag-a",
      cards_count: 2,
    });
  });

  it("supports SQL mutations for cards", async () => {
    const snapshot = makeSnapshot();
    const dependencies = makeDependencies(snapshot);
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

  it("keeps cloud settings and outbox available as local-only tools", async () => {
    const snapshot = makeSnapshot();
    const executor = createLocalToolExecutor(makeDependencies(snapshot));

    const cloudResult = await executor.execute({
      toolCallId: "call-1",
      name: "get_cloud_settings",
      input: "{}",
    });
    expect(JSON.parse(cloudResult.output)).toEqual(snapshot.cloudSettings);

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
});
