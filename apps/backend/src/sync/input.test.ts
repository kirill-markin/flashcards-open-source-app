import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../errors";
import {
  parseSyncBootstrapInput,
  parseSyncPullInput,
  parseSyncPushInput,
  parseSyncReviewHistoryImportInput,
  parseSyncReviewHistoryPullInput,
} from "./input";

function expectHttpError(error: unknown): HttpError {
  if ((error instanceof HttpError) === false) {
    throw error;
  }

  return error;
}

test("parseSyncPushInput accepts card operations with empty backText", () => {
  const result = parseSyncPushInput({
    deviceId: "device-1",
    platform: "ios",
    appVersion: "1.0.1",
    operations: [
      {
        operationId: "operation-1",
        entityType: "card",
        entityId: "card-1",
        action: "upsert",
        clientUpdatedAt: "2026-03-09T10:00:00.000Z",
        payload: {
          cardId: "card-1",
          frontText: "Front",
          backText: "",
          tags: [],
          effortLevel: "fast",
          dueAt: null,
          createdAt: "2026-03-09T10:00:00.000Z",
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
    ],
  });

  assert.equal(result.operations[0]?.entityType, "card");
  if (result.operations[0]?.entityType !== "card") {
    throw new Error("Expected a card operation");
  }
  assert.equal(result.operations[0].payload.backText, "");
});

test("parseSyncPullInput accepts hot change cursors", () => {
  const result = parseSyncPullInput({
    deviceId: "device-1",
    platform: "ios",
    appVersion: "1.0.1",
    afterHotChangeId: 17,
    limit: 200,
  });

  assert.equal(result.afterHotChangeId, 17);
  assert.equal(result.limit, 200);
});

test("parseSyncBootstrapInput accepts explicit null bootstrap cursor on first page", () => {
  const result = parseSyncBootstrapInput({
    mode: "pull",
    deviceId: "device-1",
    platform: "ios",
    appVersion: "1.0.1",
    cursor: null,
    limit: 200,
  });

  assert.equal(result.mode, "pull");
  if (result.mode !== "pull") {
    throw new Error("Expected bootstrap pull input");
  }
  assert.equal(result.cursor, null);
  assert.equal(result.limit, 200);
});

test("parseSyncBootstrapInput rejects bootstrap pull requests that omit cursor", () => {
  assert.throws(() => {
    parseSyncBootstrapInput({
      mode: "pull",
      deviceId: "device-1",
      platform: "ios",
      appVersion: "1.0.1",
      limit: 200,
    });
  }, (error: unknown) => {
    const httpError = expectHttpError(error);
    assert.equal(httpError.statusCode, 400);
    assert.equal(httpError.code, "SYNC_INVALID_INPUT");
    assert.equal(httpError.details?.validationIssues[0]?.path, "cursor");
    return true;
  });
});

test("parseSyncBootstrapInput accepts bootstrap push entries for hot current state", () => {
  const result = parseSyncBootstrapInput({
    mode: "push",
    deviceId: "device-1",
    platform: "ios",
    appVersion: "1.0.1",
    entries: [
      {
        entityType: "workspace_scheduler_settings",
        entityId: "workspace-1",
        action: "upsert",
        payload: {
          algorithm: "fsrs-6",
          desiredRetention: 0.9,
          learningStepsMinutes: [1, 10],
          relearningStepsMinutes: [10],
          maximumIntervalDays: 365,
          enableFuzz: true,
          clientUpdatedAt: "2026-03-09T10:00:00.000Z",
          lastModifiedByDeviceId: "device-1",
          lastOperationId: "operation-1",
          updatedAt: "2026-03-09T10:00:00.000Z",
        },
      },
    ],
  });

  assert.equal(result.mode, "push");
  if (result.mode !== "push") {
    throw new Error("Expected bootstrap push input");
  }
  assert.equal(result.entries[0]?.entityType, "workspace_scheduler_settings");
});

test("parseSyncReviewHistoryPullInput accepts independent review history cursors", () => {
  const result = parseSyncReviewHistoryPullInput({
    deviceId: "device-1",
    platform: "ios",
    appVersion: "1.0.1",
    afterReviewSequenceId: 42,
    limit: 100,
  });

  assert.equal(result.afterReviewSequenceId, 42);
  assert.equal(result.limit, 100);
});

test("parseSyncReviewHistoryImportInput accepts append-only review events", () => {
  const result = parseSyncReviewHistoryImportInput({
    deviceId: "device-1",
    platform: "ios",
    appVersion: "1.0.1",
    reviewEvents: [
      {
        reviewEventId: "review-1",
        workspaceId: "workspace-1",
        cardId: "card-1",
        deviceId: "device-1",
        clientEventId: "client-event-1",
        rating: 2,
        reviewedAtClient: "2026-03-09T10:00:00.000Z",
        reviewedAtServer: "2026-03-09T10:00:01.000Z",
      },
    ],
  });

  assert.equal(result.reviewEvents.length, 1);
  assert.equal(result.reviewEvents[0]?.reviewEventId, "review-1");
});
