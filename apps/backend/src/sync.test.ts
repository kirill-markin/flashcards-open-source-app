import assert from "node:assert/strict";
import test from "node:test";
import { parseSyncPushInput } from "./sync";

test("parseSyncPushInput accepts card operations with empty backText", () => {
  const result = parseSyncPushInput({
    deviceId: "device-1",
    platform: "ios",
    appVersion: "1.0.0",
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
