import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor } from "../database";
import { HttpError } from "../shared/errors";
import {
  getInvalidFsrsStateReason,
  listCardsInExecutor,
  submitReview,
} from "./index";
import type { CardMetadata, CardRow, ReviewableCardRow } from "./types";

type QueryRecord = Readonly<{
  text: string;
  params: ReadonlyArray<unknown> | null;
}>;

function createCardMetadata(createdAt: string): CardMetadata {
  return {
    version: 1,
    source: {
      label: null,
      author: null,
      comment: null,
      createdAt,
      importedAt: null,
      importId: null,
    },
  };
}

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

test("listCardsInExecutor maps invalid persisted fsrs rows without repairing them", async () => {
  const invalidCard: CardRow = {
    card_id: "broken-card",
    front_text: "front",
    back_text: "back",
    card_type: "basic",
    metadata: createCardMetadata("2026-03-08T09:00:00.000Z"),
    tags: ["tag"],
    effort_level: "fast" as const,
    due_at: "2026-03-16T09:00:00.000Z",
    created_at: "2026-03-08T09:00:00.000Z",
    reps: 1,
    lapses: 0,
    fsrs_card_state: "new" as const,
    fsrs_step_index: 0,
    fsrs_stability: 0.212,
    fsrs_difficulty: 6.4133,
    fsrs_last_reviewed_at: "2026-03-08T09:00:00.000Z",
    fsrs_scheduled_days: 0,
    client_updated_at: "2026-03-08T09:00:00.000Z",
    last_modified_by_replica_id: "device-a",
    last_operation_id: "operation-a",
    updated_at: "2026-03-08T09:00:00.000Z",
    deleted_at: null,
  };
  const queries: Array<QueryRecord> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string> | ReadonlyArray<number>>,
    ): Promise<pg.QueryResult<Row>> {
      assert.doesNotMatch(text, /UPDATE content\.cards/);
      queries.push({ text, params });
      return {
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [invalidCard as unknown as Row],
      };
    },
  };

  const cards = await listCardsInExecutor(
    executor,
    "workspace-id",
  );

  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0]?.params, ["workspace-id"]);
  assert.equal(cards[0]?.cardId, "broken-card");
  assert.equal(cards[0]?.fsrsCardState, "new");
  assert.equal(cards[0]?.fsrsStepIndex, 0);
});

test("submitReview fails invalid persisted fsrs state without repairing the card", async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDbSecretArn = process.env.DB_SECRET_ARN;
  const originalPool = pg.Pool;
  const queries: Array<QueryRecord> = [];
  const releaseArguments: Array<Error | boolean | undefined> = [];
  const invalidReviewableCard: ReviewableCardRow = {
    card_id: "broken-card",
    front_text: "front",
    back_text: "back",
    due_at: null,
    reps: 1,
    lapses: 0,
    fsrs_card_state: "new",
    fsrs_step_index: 0,
    fsrs_stability: 0.212,
    fsrs_difficulty: 6.4133,
    fsrs_last_reviewed_at: "2026-03-08T09:00:00.000Z",
    fsrs_scheduled_days: 0,
  };

  const fakeClient = {
    async query(text: string, params?: ReadonlyArray<unknown>): Promise<pg.QueryResult<pg.QueryResultRow>> {
      assert.doesNotMatch(text, /UPDATE content\.cards/);
      queries.push({
        text,
        params: params ?? null,
      });

      if (
        text === "BEGIN"
        || text === "ROLLBACK"
        || text.includes("set_config")
      ) {
        return {
          command: "SELECT",
          rowCount: 0,
          oid: 0,
          fields: [],
          rows: [],
        };
      }

      if (text.includes("FROM content.cards") && text.includes("FOR UPDATE")) {
        return {
          command: "SELECT",
          rowCount: 1,
          oid: 0,
          fields: [],
          rows: [invalidReviewableCard],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    release(error?: Error | boolean): void {
      releaseArguments.push(error);
    },
  };

  class FakePool {
    constructor(_config: pg.PoolConfig) {}

    on(_event: string, _listener: (error: Error) => void): void {}

    async connect(): Promise<pg.PoolClient> {
      return fakeClient as unknown as pg.PoolClient;
    }
  }

  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
  delete process.env.DB_SECRET_ARN;
  (pg as unknown as { Pool: typeof pg.Pool }).Pool = FakePool as unknown as typeof pg.Pool;

  try {
    await assert.rejects(
      submitReview(
        "user-id",
        "workspace-id",
        "replica-id",
        {
          cardId: "broken-card",
          rating: 3,
          reviewedAtClient: "2026-03-08T09:10:00.000Z",
        },
        {
          clientUpdatedAt: "2026-03-08T09:10:00.000Z",
          lastModifiedByReplicaId: "replica-id",
          lastOperationId: "operation-id",
        },
      ),
      (error: unknown) => {
        if (error instanceof HttpError === false) {
          return false;
        }

        assert.equal(error.statusCode, 500);
        assert.equal(error.code, "CARD_FSRS_STATE_INVALID");
        assert.match(error.message, /New card has persisted FSRS state/);
        return true;
      },
    );

    assert.deepEqual(queries.map((query) => query.text), [
      "BEGIN",
      "SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)",
      [
        "SELECT",
        "card_id, front_text, back_text, due_at, reps, lapses, fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days",
        "FROM content.cards",
        "WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
        "FOR UPDATE",
      ].join(" "),
      "ROLLBACK",
    ]);
    assert.deepEqual(releaseArguments, [undefined]);
  } finally {
    (pg as unknown as { Pool: typeof pg.Pool }).Pool = originalPool;
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    if (originalDbSecretArn === undefined) {
      delete process.env.DB_SECRET_ARN;
    } else {
      process.env.DB_SECRET_ARN = originalDbSecretArn;
    }
  }
});
