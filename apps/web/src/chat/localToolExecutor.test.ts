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
  it("returns exact local read payloads for workspace, scheduler, cloud, and outbox tools", async () => {
    const snapshot = makeSnapshot();
    const executor = createLocalToolExecutor(makeDependencies(snapshot));

    const workspaceContextResult = await executor.execute({
      toolCallId: "call-1",
      name: "get_workspace_context",
      input: "{}",
    });
    const workspaceContext = JSON.parse(workspaceContextResult.output) as Record<string, unknown>;
    expect(workspaceContext).toEqual({
      workspace: {
        workspaceId: "workspace-1",
        name: "Personal",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
      userSettings: {
        userId: "user-1",
        workspaceId: "workspace-1",
        email: "test@example.com",
        locale: "en",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
      schedulerSettings: snapshot.workspaceSettings,
      cloudSettings: snapshot.cloudSettings,
      homeSnapshot: {
        deckCount: 1,
        totalCards: 2,
        dueCount: 2,
        newCount: 1,
        reviewedCount: 1,
      },
    });

    const schedulerResult = await executor.execute({
      toolCallId: "call-2",
      name: "get_scheduler_settings",
      input: "{}",
    });
    expect(JSON.parse(schedulerResult.output)).toEqual(snapshot.workspaceSettings);

    const cloudResult = await executor.execute({
      toolCallId: "call-3",
      name: "get_cloud_settings",
      input: "{}",
    });
    expect(JSON.parse(cloudResult.output)).toEqual(snapshot.cloudSettings);

    const outboxResult = await executor.execute({
      toolCallId: "call-4",
      name: "list_outbox",
      input: "{\"limit\":null}",
    });
    expect(JSON.parse(outboxResult.output)).toEqual([{
      operationId: "outbox-1",
      workspaceId: "workspace-1",
      entityType: "card",
      entityId: "card-2",
      action: "upsert",
      clientUpdatedAt: "2026-03-10T08:00:00.000Z",
      createdAt: "2026-03-10T08:00:00.000Z",
      attemptCount: 1,
      lastError: "Temporary failure",
      payloadSummary: "card card-2",
    }]);
  });

  it("keeps summarize_deck_state available in the browser local runtime", async () => {
    const executor = createLocalToolExecutor(makeDependencies(makeSnapshot()));

    const summaryResult = await executor.execute({
      toolCallId: "call-summary",
      name: "summarize_deck_state",
      input: "{}",
    });

    expect(JSON.parse(summaryResult.output)).toEqual({
      totalCards: 2,
      dueCards: 2,
      newCards: 1,
      reviewedCards: 1,
      totalReps: 2,
      totalLapses: 0,
    });
  });

  it("resolves nullable update fields against existing local records and mutates only once per item", async () => {
    const snapshot = makeSnapshot();
    const dependencies = makeDependencies(snapshot);
    const executor = createLocalToolExecutor(dependencies);

    await executor.execute({
      toolCallId: "call-update",
      name: "update_cards",
      input: "{\"updates\":[{\"cardId\":\"card-1\",\"frontText\":null,\"backText\":\"Updated Back\",\"tags\":null,\"effortLevel\":null}]}",
    });

    expect(dependencies.updateCardItem).toHaveBeenCalledTimes(1);
    expect(dependencies.updateCardItem).toHaveBeenCalledWith("card-1", {
      frontText: "Front",
      backText: "Updated Back",
      tags: ["tag-a"],
      effortLevel: "medium",
    });
  });
});
