// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearWebSyncCache, relinkWorkspaceCache } from "./cache";
import { putCloudSettings, loadCloudSettings } from "./cloudSettings";
import { loadDeckById, replaceDecks } from "./decks";
import { putOutboxRecord, listOutboxRecords } from "./outbox";
import { loadReviewEventsForSql, replaceReviewEvents } from "./reviews";
import { loadLastAppliedChangeId, putWorkspaceSettings } from "./workspace";
import { makeCard, makeDeck, seedCursorFixtures, workspaceId } from "./testSupport";
import { replaceCards } from "./cards";

describe("localDb cache", () => {
  beforeEach(async () => {
    await clearWebSyncCache();
  });

  it("clears all persisted IndexedDB state", async () => {
    await seedCursorFixtures();

    await clearWebSyncCache();

    expect(await listOutboxRecords(workspaceId)).toEqual([]);
    expect(await loadCloudSettings()).toBeNull();
    expect(await loadReviewEventsForSql(workspaceId)).toEqual([]);
  });

  it("relinks cached workspace-owned records and resets the sync cursor", async () => {
    await replaceCards([
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
    await replaceDecks([
      makeDeck({
        deckId: "deck-1",
        name: "Grammar",
        effortLevels: ["fast"],
        tags: ["grammar"],
        createdAt: "2025-01-01T00:00:00.000Z",
      }),
    ]);
    await replaceReviewEvents([{
      reviewEventId: "review-1",
      workspaceId,
      cardId: "card-1",
      deviceId: "device-1",
      clientEventId: "event-1",
      rating: 2,
      reviewedAtClient: "2025-01-02T00:00:00.000Z",
      reviewedAtServer: "2025-01-02T00:00:00.000Z",
    }]);
    await putWorkspaceSettings({
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

    await relinkWorkspaceCache("workspace-2");

    expect((await loadDeckById("deck-1"))?.workspaceId).toBe("workspace-2");
    expect((await listOutboxRecords("workspace-2")).length).toBe(1);
    expect((await loadReviewEventsForSql("workspace-2")).length).toBe(1);
    expect(await loadLastAppliedChangeId()).toBe(0);
    expect((await loadCloudSettings())?.linkedWorkspaceId).toBe("workspace-2");
  });
});
