import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "./db";
import {
  getInvalidFsrsStateReason,
  validateOrResetCardRowForRead,
} from "./cards";

test("getInvalidFsrsStateReason rejects a new card with persisted fsrs values", () => {
  assert.equal(
    getInvalidFsrsStateReason({
      due_at: null,
      reps: 0,
      lapses: 0,
      fsrs_card_state: "new",
      fsrs_step_index: 0,
      fsrs_stability: 0.212,
      fsrs_difficulty: 6.4133,
      fsrs_last_reviewed_at: "2026-03-08T09:00:00.000Z",
      fsrs_scheduled_days: 0,
    }),
    "New card has persisted FSRS state",
  );
});

test("getInvalidFsrsStateReason rejects a review card without full memory state", () => {
  assert.equal(
    getInvalidFsrsStateReason({
      due_at: "2026-03-16T09:00:00.000Z",
      reps: 1,
      lapses: 0,
      fsrs_card_state: "review",
      fsrs_step_index: null,
      fsrs_stability: null,
      fsrs_difficulty: 1,
      fsrs_last_reviewed_at: "2026-03-08T09:00:00.000Z",
      fsrs_scheduled_days: 8,
    }),
    "Persisted FSRS card state is incomplete",
  );
});

test("getInvalidFsrsStateReason rejects a learning card without step index", () => {
  assert.equal(
    getInvalidFsrsStateReason({
      due_at: "2026-03-08T09:10:00.000Z",
      reps: 1,
      lapses: 0,
      fsrs_card_state: "learning",
      fsrs_step_index: null,
      fsrs_stability: 2.3065,
      fsrs_difficulty: 2.11810397,
      fsrs_last_reviewed_at: "2026-03-08T09:00:00.000Z",
      fsrs_scheduled_days: 0,
    }),
    "Learning or relearning card is missing fsrs_step_index",
  );
});

test("validateOrResetCardRowForRead resets an invalid card to canonical new state", async () => {
  const invalidCard = {
    card_id: "broken-card",
    front_text: "front",
    back_text: "back",
    tags: ["tag"],
    effort_level: "fast" as const,
    due_at: "2026-03-16T09:00:00.000Z",
    reps: 1,
    lapses: 0,
    fsrs_card_state: "new" as const,
    fsrs_step_index: 0,
    fsrs_stability: 0.212,
    fsrs_difficulty: 6.4133,
    fsrs_last_reviewed_at: "2026-03-08T09:00:00.000Z",
    fsrs_scheduled_days: 0,
    client_updated_at: "2026-03-08T09:00:00.000Z",
    last_modified_by_device_id: "device-a",
    last_operation_id: "operation-a",
    updated_at: "2026-03-08T09:00:00.000Z",
    deleted_at: null,
  };
  const repairedCard = {
    ...invalidCard,
    due_at: null,
    reps: 0,
    lapses: 0,
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
    updated_at: "2026-03-08T09:05:00.000Z",
  };
  let queryCount = 0;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      queryCount += 1;
      assert.match(text, /UPDATE content\.cards/);
      assert.deepEqual(params, ["workspace-id", "broken-card"]);
      return {
        command: "UPDATE",
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [repairedCard as unknown as Row],
      };
    },
  };

  const actualCard = await validateOrResetCardRowForRead(
    executor,
    "workspace-id",
    invalidCard,
  );

  assert.equal(queryCount, 1);
  assert.deepEqual(actualCard, repairedCard);
});
