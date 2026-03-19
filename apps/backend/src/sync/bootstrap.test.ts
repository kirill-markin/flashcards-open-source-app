import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../errors";
import {
  decodeBootstrapCursor,
  encodeBootstrapCursor,
  parseBootstrapEntryRow,
} from "./bootstrap";

test("bootstrap cursor round-trips opaque pagination state", () => {
  const encoded = encodeBootstrapCursor({
    bootstrapHotChangeId: 17,
    entityRank: 2,
    entityId: "deck-1",
  });

  assert.deepEqual(
    decodeBootstrapCursor(encoded),
    {
      bootstrapHotChangeId: 17,
      entityRank: 2,
      entityId: "deck-1",
    },
  );
});

test("bootstrap cursor rejects malformed values", () => {
  assert.throws(() => {
    decodeBootstrapCursor("bm90LWEtY3Vyc29y");
  }, (error: unknown) => error instanceof HttpError && error.statusCode === 400);
});

test("parseBootstrapEntryRow parses card payload rows", () => {
  const entry = parseBootstrapEntryRow({
    entity_rank: 1,
    entity_type: "card",
    entity_id: "card-1",
    payload: {
      cardId: "card-1",
      frontText: "Front",
      backText: "Back",
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
      clientUpdatedAt: "2026-03-09T10:00:00.000Z",
      lastModifiedByDeviceId: "device-1",
      lastOperationId: "operation-1",
      updatedAt: "2026-03-09T10:00:00.000Z",
      deletedAt: null,
    },
  });

  assert.equal(entry.entityType, "card");
  assert.equal(entry.entityId, "card-1");
});
