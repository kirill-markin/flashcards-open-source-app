import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { HttpError } from "./errors";

type CodedError = Error & Readonly<{ code: string }>;

type QueryRecord = Readonly<{
  text: string;
  params: ReadonlyArray<unknown> | null;
}>;

function createCodedError(code: string, message: string): CodedError {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

test("unsafeTransaction classifies transaction failures and discards clients when needed", async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDbSecretArn = process.env.DB_SECRET_ARN;
  const originalPool = pg.Pool;
  const originalWarn = console.warn;
  const queries: Array<QueryRecord> = [];
  const warningRecords: Array<Readonly<Record<string, unknown>>> = [];
  const releaseArguments: Array<Error | boolean | undefined> = [];
  const transientBeginError = createCodedError("08006", "connection failure during begin");
  const transientCommitError = createCodedError("08006", "connection failure during commit");
  let beginError: CodedError | null = transientBeginError;
  let commitError: CodedError | null = transientCommitError;
  let rollbackError: CodedError | null = null;

  const fakeClient = {
    async query(text: string, params?: ReadonlyArray<unknown>): Promise<pg.QueryResult<pg.QueryResultRow>> {
      queries.push({
        text,
        params: params ?? null,
      });
      if (text === "BEGIN" && beginError !== null) {
        throw beginError;
      }

      if (text === "COMMIT" && commitError !== null) {
        throw commitError;
      }

      if (text === "ROLLBACK" && rollbackError !== null) {
        throw rollbackError;
      }

      return {
        command: "SELECT",
        rowCount: 0,
        oid: 0,
        fields: [],
        rows: [],
      };
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
  console.warn = (message?: unknown): void => {
    if (typeof message !== "string") {
      throw new Error("Expected rollback warning log to be a JSON string.");
    }

    warningRecords.push(JSON.parse(message) as Readonly<Record<string, unknown>>);
  };

  try {
    const dbCore = await import("./dbCore");

    await assert.rejects(
      dbCore.unsafeTransaction(async () => {
        throw new Error("Callback should not run when BEGIN fails.");
      }),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, "SERVICE_UNAVAILABLE");
        return true;
      },
    );

    assert.deepEqual(queries, [
      { text: "BEGIN", params: null },
    ]);
    assert.equal(releaseArguments.length, 1);
    assert.equal(releaseArguments[0], transientBeginError);

    beginError = null;
    queries.length = 0;
    releaseArguments.length = 0;

    await assert.rejects(
      dbCore.unsafeTransaction(async (executor) => {
        await executor.query("INSERT INTO app.cards VALUES ($1)", ["card-1"]);
        return "ok";
      }),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 500);
        assert.equal(error.code, "DATABASE_COMMIT_OUTCOME_UNKNOWN");
        return true;
      },
    );

    assert.deepEqual(queries, [
      { text: "BEGIN", params: null },
      { text: "INSERT INTO app.cards VALUES ($1)", params: ["card-1"] },
      { text: "COMMIT", params: null },
    ]);
    assert.deepEqual(releaseArguments, [transientCommitError]);

    const nonTransientCommitError = createCodedError("23514", "deferred check constraint violation");
    commitError = nonTransientCommitError;
    await assert.rejects(
      dbCore.unsafeTransaction(async (executor) => {
        await executor.query("INSERT INTO app.cards VALUES ($1)", ["card-1"]);
        return "ok";
      }),
      (error: unknown) => {
        assert.equal(error, commitError);
        assert.ok(!(error instanceof HttpError));
        return true;
      },
    );

    assert.deepEqual(queries, [
      { text: "BEGIN", params: null },
      { text: "INSERT INTO app.cards VALUES ($1)", params: ["card-1"] },
      { text: "COMMIT", params: null },
      { text: "BEGIN", params: null },
      { text: "INSERT INTO app.cards VALUES ($1)", params: ["card-1"] },
      { text: "COMMIT", params: null },
    ]);
    assert.deepEqual(releaseArguments, [transientCommitError, nonTransientCommitError]);

    commitError = null;
    rollbackError = createCodedError("57P01", "terminating connection due to administrator command");
    const callbackError = createCodedError("23514", "callback check constraint violation");
    await assert.rejects(
      dbCore.unsafeTransaction(async (executor) => {
        await executor.query("INSERT INTO app.cards VALUES ($1)", ["card-1"]);
        throw callbackError;
      }),
      (error: unknown) => {
        assert.equal(error, callbackError);
        return true;
      },
    );

    assert.deepEqual(queries, [
      { text: "BEGIN", params: null },
      { text: "INSERT INTO app.cards VALUES ($1)", params: ["card-1"] },
      { text: "COMMIT", params: null },
      { text: "BEGIN", params: null },
      { text: "INSERT INTO app.cards VALUES ($1)", params: ["card-1"] },
      { text: "COMMIT", params: null },
      { text: "BEGIN", params: null },
      { text: "INSERT INTO app.cards VALUES ($1)", params: ["card-1"] },
      { text: "ROLLBACK", params: null },
    ]);
    assert.deepEqual(releaseArguments, [transientCommitError, nonTransientCommitError, rollbackError]);
    assert.deepEqual(warningRecords, [
      {
        domain: "backend",
        action: "unsafe_transaction_rollback_failed",
        originalSqlState: "23514",
        originalErrorCode: "23514",
        originalErrorClass: "Error",
        originalErrorMessage: "callback check constraint violation",
        rollbackSqlState: "57P01",
        rollbackErrorCode: "57P01",
        rollbackErrorClass: "Error",
        rollbackErrorMessage: "terminating connection due to administrator command",
      },
    ]);
  } finally {
    (pg as unknown as { Pool: typeof pg.Pool }).Pool = originalPool;
    console.warn = originalWarn;
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
