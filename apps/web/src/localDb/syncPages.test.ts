// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReviewEvent, SyncBootstrapEntry } from "../types";
import { clearWebSyncCache } from "./cache";
import { loadCardById } from "./cards";
import { loadDeckById } from "./decks";
import { loadReviewEventsForSql } from "./reviews";
import { makeCard, makeDeck, workspaceId } from "./testSupport";
import {
  applyHotSyncPage,
  applyReviewHistorySyncPage,
  loadWorkspaceSettings,
  loadWorkspaceSyncState,
  loadWorkspaceTagsSummary,
  setHotStateHydrated,
  setLastAppliedHotChangeId,
  setLastAppliedReviewSequenceId,
  setReviewHistoryHydrated,
} from "./workspace";

describe("localDb sync page apply", () => {
  beforeEach(async () => {
    await clearWebSyncCache();
  });

  it("commits a mixed hot-sync page while preserving review sync state", async () => {
    await setLastAppliedReviewSequenceId(workspaceId, 88);
    await setReviewHistoryHydrated(workspaceId, true);

    const entries: ReadonlyArray<SyncBootstrapEntry> = [
      {
        entityType: "card",
        entityId: "card-1",
        action: "upsert",
        payload: makeCard({
          cardId: "card-1",
          frontText: "Question",
          backText: "Answer",
          tags: ["grammar", "shared"],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2026-03-18T10:00:00.000Z",
        }),
      },
      {
        entityType: "deck",
        entityId: "deck-1",
        action: "upsert",
        payload: makeDeck({
          deckId: "deck-1",
          name: "Grammar",
          effortLevels: ["fast"],
          tags: ["grammar"],
          createdAt: "2026-03-18T10:00:00.000Z",
        }),
      },
      {
        entityType: "workspace_scheduler_settings",
        entityId: "workspace-1",
        action: "upsert",
        payload: {
          algorithm: "fsrs-6",
          desiredRetention: 0.93,
          learningStepsMinutes: [1, 10],
          relearningStepsMinutes: [10],
          maximumIntervalDays: 36500,
          enableFuzz: true,
          clientUpdatedAt: "2026-03-18T10:00:00.000Z",
          lastModifiedByDeviceId: "device-1",
          lastOperationId: "settings-1",
          updatedAt: "2026-03-18T10:00:00.000Z",
        },
      },
    ];

    await applyHotSyncPage(workspaceId, entries, {
      lastAppliedHotChangeId: 41,
      markHotStateHydrated: true,
    });

    expect(await loadCardById(workspaceId, "card-1")).toEqual(expect.objectContaining({
      frontText: "Question",
      backText: "Answer",
    }));
    expect(await loadDeckById(workspaceId, "deck-1")).toEqual(expect.objectContaining({
      name: "Grammar",
      workspaceId,
    }));
    expect(await loadWorkspaceSettings(workspaceId)).toEqual(expect.objectContaining({
      desiredRetention: 0.93,
      lastOperationId: "settings-1",
    }));
    expect(await loadWorkspaceTagsSummary(workspaceId)).toEqual({
      tags: [
        { tag: "grammar", cardsCount: 1 },
        { tag: "shared", cardsCount: 1 },
      ],
      totalCards: 1,
    });
    expect(await loadWorkspaceSyncState(workspaceId)).toEqual(expect.objectContaining({
      workspaceId,
      lastAppliedHotChangeId: 41,
      lastAppliedReviewSequenceId: 88,
      hasHydratedHotState: true,
      hasHydratedReviewHistory: true,
    }));
  });

  it("commits a review-history page while preserving hot sync state", async () => {
    await setLastAppliedHotChangeId(workspaceId, 33);
    await setHotStateHydrated(workspaceId, true);

    const reviewEvent: ReviewEvent = {
      reviewEventId: "review-1",
      workspaceId,
      cardId: "card-1",
      deviceId: "device-1",
      clientEventId: "event-1",
      rating: 3,
      reviewedAtClient: "2026-03-18T11:00:00.000Z",
      reviewedAtServer: "2026-03-18T11:00:01.000Z",
    };

    await applyReviewHistorySyncPage(workspaceId, [reviewEvent], {
      lastAppliedReviewSequenceId: 55,
      markReviewHistoryHydrated: true,
    });

    expect(await loadReviewEventsForSql(workspaceId)).toEqual([reviewEvent]);
    expect(await loadWorkspaceSyncState(workspaceId)).toEqual(expect.objectContaining({
      workspaceId,
      lastAppliedHotChangeId: 33,
      lastAppliedReviewSequenceId: 55,
      hasHydratedHotState: true,
      hasHydratedReviewHistory: true,
    }));
  });
});
