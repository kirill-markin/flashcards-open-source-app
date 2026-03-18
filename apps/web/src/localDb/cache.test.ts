// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearWebSyncCache } from "./cache";
import { putCloudSettings, loadCloudSettings } from "./cloudSettings";
import { replaceCards, loadCardById } from "./cards";
import { loadDeckById, replaceDecks } from "./decks";
import { putOutboxRecord, listOutboxRecords } from "./outbox";
import { loadReviewEventsForSql, replaceReviewEvents } from "./reviews";
import {
  hasHydratedHotState,
  loadLastAppliedHotChangeId,
  loadLastAppliedReviewSequenceId,
  loadWorkspaceSettings,
  setHotStateHydrated,
  setLastAppliedHotChangeId,
  setLastAppliedReviewSequenceId,
  putWorkspaceSettings,
} from "./workspace";
import { makeCard, makeDeck, workspaceId } from "./testSupport";

const workspaceTwoId = "workspace-2";

describe("localDb cache", () => {
  beforeEach(async () => {
    await clearWebSyncCache();
  });

  it("clears all persisted IndexedDB state", async () => {
    await replaceCards(workspaceId, [
      makeCard({
        cardId: "card-1",
        frontText: "Front",
        backText: "Back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-01T00:00:00.000Z",
      }),
    ]);
    await replaceDecks(workspaceId, [
      makeDeck({
        deckId: "deck-1",
        name: "Grammar",
        effortLevels: ["fast"],
        tags: ["grammar"],
        createdAt: "2025-01-01T00:00:00.000Z",
      }),
    ]);
    await replaceReviewEvents(workspaceId, [{
      reviewEventId: "review-1",
      workspaceId,
      cardId: "card-1",
      deviceId: "device-1",
      clientEventId: "event-1",
      rating: 2,
      reviewedAtClient: "2025-01-02T00:00:00.000Z",
      reviewedAtServer: "2025-01-02T00:00:00.000Z",
    }]);
    await putWorkspaceSettings(workspaceId, {
      algorithm: "fsrs-6",
      desiredRetention: 0.9,
      learningStepsMinutes: [1, 10],
      relearningStepsMinutes: [10],
      maximumIntervalDays: 36500,
      enableFuzz: true,
      clientUpdatedAt: "2025-01-01T00:00:00.000Z",
      lastModifiedByDeviceId: "device-1",
      lastOperationId: "settings-1",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    await setLastAppliedHotChangeId(workspaceId, 12);
    await setLastAppliedReviewSequenceId(workspaceId, 34);
    await setHotStateHydrated(workspaceId, true);
    await putOutboxRecord({
      operationId: "op-1",
      workspaceId,
      createdAt: "2025-01-02T00:00:00.000Z",
      attemptCount: 0,
      lastError: "",
      operation: {
        operationId: "op-1",
        entityType: "card",
        entityId: "card-1",
        action: "upsert",
        clientUpdatedAt: "2025-01-02T00:00:00.000Z",
        payload: {
          cardId: "card-1",
          frontText: "Front",
          backText: "Back",
          tags: ["grammar"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
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
    await putCloudSettings({
      deviceId: "device-1",
      cloudState: "linked",
      linkedUserId: "user-1",
      linkedWorkspaceId: workspaceId,
      linkedEmail: "test@example.com",
      onboardingCompleted: true,
      updatedAt: "2025-01-02T00:00:00.000Z",
    });

    await clearWebSyncCache();

    expect(await listOutboxRecords(workspaceId)).toEqual([]);
    expect(await loadCloudSettings()).toBeNull();
    expect(await loadReviewEventsForSql(workspaceId)).toEqual([]);
    expect(await loadWorkspaceSettings(workspaceId)).toBeNull();
    expect(await loadLastAppliedHotChangeId(workspaceId)).toBe(0);
    expect(await loadLastAppliedReviewSequenceId(workspaceId)).toBe(0);
    expect(await hasHydratedHotState(workspaceId)).toBe(false);
  });

  it("keeps data isolated across workspaces until the full cache is cleared", async () => {
    await replaceCards(workspaceId, [
      makeCard({
        cardId: "card-1",
        frontText: "Workspace one",
        backText: "Back",
        tags: ["grammar"],
        effortLevel: "fast",
        dueAt: null,
        createdAt: "2025-01-01T00:00:00.000Z",
      }),
    ]);
    await replaceCards(workspaceTwoId, [
      makeCard({
        cardId: "card-1",
        frontText: "Workspace two",
        backText: "Other back",
        tags: ["code"],
        effortLevel: "long",
        dueAt: null,
        createdAt: "2025-01-03T00:00:00.000Z",
      }),
    ]);
    await replaceDecks(workspaceId, [
      makeDeck({
        deckId: "deck-1",
        name: "Grammar",
        effortLevels: ["fast"],
        tags: ["grammar"],
        createdAt: "2025-01-01T00:00:00.000Z",
      }),
    ]);
    await replaceDecks(workspaceTwoId, [
      {
        ...makeDeck({
          deckId: "deck-1",
          name: "Code",
          effortLevels: ["long"],
          tags: ["code"],
          createdAt: "2025-01-02T00:00:00.000Z",
        }),
        workspaceId: workspaceTwoId,
      },
    ]);
    await replaceReviewEvents(workspaceTwoId, [{
      reviewEventId: "review-2",
      workspaceId: workspaceTwoId,
      cardId: "card-1",
      deviceId: "device-1",
      clientEventId: "event-2",
      rating: 3,
      reviewedAtClient: "2025-01-04T00:00:00.000Z",
      reviewedAtServer: "2025-01-04T00:00:00.000Z",
    }]);
    await putWorkspaceSettings(workspaceTwoId, {
      algorithm: "fsrs-6",
      desiredRetention: 0.92,
      learningStepsMinutes: [1, 10],
      relearningStepsMinutes: [10],
      maximumIntervalDays: 36500,
      enableFuzz: true,
      clientUpdatedAt: "2025-01-03T00:00:00.000Z",
      lastModifiedByDeviceId: "device-1",
      lastOperationId: "settings-2",
      updatedAt: "2025-01-03T00:00:00.000Z",
    });
    await setLastAppliedHotChangeId(workspaceId, 7);
    await setLastAppliedHotChangeId(workspaceTwoId, 19);

    expect((await loadCardById(workspaceId, "card-1"))?.frontText).toBe("Workspace one");
    expect((await loadCardById(workspaceTwoId, "card-1"))?.frontText).toBe("Workspace two");
    expect((await loadDeckById(workspaceId, "deck-1"))?.workspaceId).toBe(workspaceId);
    expect((await loadDeckById(workspaceTwoId, "deck-1"))?.workspaceId).toBe(workspaceTwoId);
    expect((await loadReviewEventsForSql(workspaceTwoId)).length).toBe(1);
    expect(await loadLastAppliedHotChangeId(workspaceId)).toBe(7);
    expect(await loadLastAppliedHotChangeId(workspaceTwoId)).toBe(19);
  });
});
