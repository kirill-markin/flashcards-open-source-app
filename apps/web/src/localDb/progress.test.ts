// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearWebSyncCache } from "./cache";
import { putOutboxRecord } from "./outbox";
import {
  loadLocalProgressDailyReviews,
  loadLocalProgressSummary,
  loadPendingProgressDailyReviews,
} from "./progress";
import { putReviewEvent } from "./reviews";
import { workspaceId } from "./testSupport";

describe("localDb progress", () => {
  beforeEach(async () => {
    await clearWebSyncCache();
  });

  it("counts only pending review-event outbox entries for progress", async () => {
    await putReviewEvent({
      reviewEventId: "synced-review",
      workspaceId,
      cardId: "due-other",
      replicaId: "device-1",
      clientEventId: "synced-client-event",
      rating: 2,
      reviewedAtClient: "2025-01-08T08:00:00.000Z",
      reviewedAtServer: "2025-01-08T08:00:00.000Z",
    });

    await putOutboxRecord({
      operationId: "pending-review-1",
      workspaceId,
      createdAt: "2025-01-08T09:00:00.000Z",
      attemptCount: 0,
      lastError: "",
      operation: {
        operationId: "pending-review-1",
        entityType: "review_event",
        entityId: "pending-review-1",
        action: "append",
        clientUpdatedAt: "2025-01-08T09:00:00.000Z",
        payload: {
          reviewEventId: "pending-review-1",
          cardId: "due-other",
          clientEventId: "pending-client-event-1",
          rating: 3,
          reviewedAtClient: "2025-01-08T09:00:00.000Z",
        },
      },
    });
    await putOutboxRecord({
      operationId: "pending-review-2",
      workspaceId: "workspace-2",
      createdAt: "2025-01-08T11:00:00.000Z",
      attemptCount: 0,
      lastError: "",
      operation: {
        operationId: "pending-review-2",
        entityType: "review_event",
        entityId: "pending-review-2",
        action: "append",
        clientUpdatedAt: "2025-01-08T11:00:00.000Z",
        payload: {
          reviewEventId: "pending-review-2",
          cardId: "card-2",
          clientEventId: "pending-client-event-2",
          rating: 1,
          reviewedAtClient: "2025-01-08T11:00:00.000Z",
        },
      },
    });
    await putOutboxRecord({
      operationId: "ignored-card-upsert",
      workspaceId,
      createdAt: "2025-01-08T10:00:00.000Z",
      attemptCount: 0,
      lastError: "",
      operation: {
        operationId: "ignored-card-upsert",
        entityType: "card",
        entityId: "due-other",
        action: "upsert",
        clientUpdatedAt: "2025-01-08T10:00:00.000Z",
        payload: {
          cardId: "due-other",
          frontText: "Front",
          backText: "Back",
          tags: [],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2025-01-08T10:00:00.000Z",
          reps: 1,
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
    await putOutboxRecord({
      operationId: "out-of-range-review",
      workspaceId,
      createdAt: "2025-01-07T23:59:00.000Z",
      attemptCount: 0,
      lastError: "",
      operation: {
        operationId: "out-of-range-review",
        entityType: "review_event",
        entityId: "out-of-range-review",
        action: "append",
        clientUpdatedAt: "2025-01-07T23:59:00.000Z",
        payload: {
          reviewEventId: "out-of-range-review",
          cardId: "due-other",
          clientEventId: "out-of-range-client-event",
          rating: 0,
          reviewedAtClient: "2025-01-07T23:59:00.000Z",
        },
      },
    });
    await putOutboxRecord({
      operationId: "inaccessible-review",
      workspaceId: "workspace-3",
      createdAt: "2025-01-08T12:00:00.000Z",
      attemptCount: 0,
      lastError: "",
      operation: {
        operationId: "inaccessible-review",
        entityType: "review_event",
        entityId: "inaccessible-review",
        action: "append",
        clientUpdatedAt: "2025-01-08T12:00:00.000Z",
        payload: {
          reviewEventId: "inaccessible-review",
          cardId: "card-3",
          clientEventId: "inaccessible-client-event",
          rating: 2,
          reviewedAtClient: "2025-01-08T12:00:00.000Z",
        },
      },
    });

    const result = await loadPendingProgressDailyReviews(
      [workspaceId, "workspace-2"],
      {
        timeZone: "UTC",
        from: "2025-01-08",
        to: "2025-01-08",
      },
    );

    expect(result).toEqual([
      {
        date: "2025-01-08",
        reviewCount: 2,
      },
    ]);
  });

  it("aggregates stored review history for local progress fallback using the browser timezone", async () => {
    await putReviewEvent({
      reviewEventId: "review-1",
      workspaceId,
      cardId: "due-other",
      replicaId: "device-1",
      clientEventId: "client-event-1",
      rating: 2,
      reviewedAtClient: "2025-01-07T23:30:00.000Z",
      reviewedAtServer: "2025-01-07T23:30:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "review-2",
      workspaceId,
      cardId: "due-same-a",
      replicaId: "device-1",
      clientEventId: "client-event-2",
      rating: 3,
      reviewedAtClient: "2025-01-08T10:00:00.000Z",
      reviewedAtServer: "2025-01-08T10:00:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "review-outside-local-range",
      workspaceId,
      cardId: "due-same-b",
      replicaId: "device-1",
      clientEventId: "client-event-outside-local-range",
      rating: 1,
      reviewedAtClient: "2025-01-08T23:30:00.000Z",
      reviewedAtServer: "2025-01-08T23:30:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "review-far-outside-range",
      workspaceId,
      cardId: "due-same-b",
      replicaId: "device-1",
      clientEventId: "client-event-far-outside-range",
      rating: 1,
      reviewedAtClient: "2024-08-08T12:00:00.000Z",
      reviewedAtServer: "2024-08-08T12:00:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "review-3",
      workspaceId: "workspace-2",
      cardId: "card-2",
      replicaId: "device-2",
      clientEventId: "client-event-3",
      rating: 1,
      reviewedAtClient: "2025-01-08T11:00:00.000Z",
      reviewedAtServer: "2025-01-08T11:00:00.000Z",
    });

    const result = await loadLocalProgressDailyReviews([workspaceId], {
      timeZone: "Europe/Madrid",
      from: "2025-01-07",
      to: "2025-01-08",
    });

    expect(result).toEqual([
      {
        date: "2025-01-08",
        reviewCount: 2,
      },
    ]);
  });

  it("computes all-time local progress summary from aggregate day counts", async () => {
    await putReviewEvent({
      reviewEventId: "summary-review-1",
      workspaceId,
      cardId: "due-other",
      replicaId: "device-1",
      clientEventId: "summary-client-event-1",
      rating: 2,
      reviewedAtClient: "2025-01-06T08:00:00.000Z",
      reviewedAtServer: "2025-01-06T08:00:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "summary-review-2",
      workspaceId,
      cardId: "due-same-a",
      replicaId: "device-1",
      clientEventId: "summary-client-event-2",
      rating: 3,
      reviewedAtClient: "2025-01-07T09:00:00.000Z",
      reviewedAtServer: "2025-01-07T09:00:00.000Z",
    });
    await putReviewEvent({
      reviewEventId: "summary-review-3",
      workspaceId: "workspace-2",
      cardId: "card-2",
      replicaId: "device-2",
      clientEventId: "summary-client-event-3",
      rating: 1,
      reviewedAtClient: "2025-01-08T10:00:00.000Z",
      reviewedAtServer: "2025-01-08T10:00:00.000Z",
    });

    const result = await loadLocalProgressSummary([workspaceId, "workspace-2"], {
      timeZone: "UTC",
      today: "2025-01-08",
    });

    expect(result).toEqual({
      currentStreakDays: 3,
      hasReviewedToday: true,
      lastReviewedOn: "2025-01-08",
      activeReviewDays: 3,
    });
  });
});
