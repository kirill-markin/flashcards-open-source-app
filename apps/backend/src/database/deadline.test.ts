import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  DatabaseDeadlineExceededError,
  transactionWithPostgresDeadline,
} from "./deadline";
import { DatabaseCommitOutcomeUnknownError } from "./transient";

type Deferred<Value> = Readonly<{
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
}>;

type FakeDatabase = Readonly<{
  pool: pg.Pool;
  queryTexts: Array<string>;
  releaseArguments: Array<Error | boolean | undefined>;
}>;

type QueryResponder = (
  text: string,
) => Promise<pg.QueryResult<pg.QueryResultRow>>;

function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function settleBeforeTestWatchdog<Value>(
  operation: Promise<Value>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function readQueryText(query: string | pg.QueryConfig): string {
  return typeof query === "string" ? query : query.text;
}

function createQueryResult(command: string): pg.QueryResult<pg.QueryResultRow> {
  return {
    command,
    rowCount: 0,
    oid: 0,
    fields: [],
    rows: [],
  };
}

async function respondWithSuccessfulQuery(
  text: string,
): Promise<pg.QueryResult<pg.QueryResultRow>> {
  return createQueryResult(text);
}

function createFakeDatabase(respondToQuery: QueryResponder): FakeDatabase {
  const queryTexts: Array<string> = [];
  const releaseArguments: Array<Error | boolean | undefined> = [];
  const client = {
    async query(query: string | pg.QueryConfig): Promise<pg.QueryResult<pg.QueryResultRow>> {
      const text = readQueryText(query);
      queryTexts.push(text);
      return respondToQuery(text);
    },
    release(error?: Error | boolean): void {
      releaseArguments.push(error);
    },
  };
  const pool = {
    async connect(): Promise<pg.PoolClient> {
      return client as unknown as pg.PoolClient;
    },
  } as pg.Pool;
  return { pool, queryTexts, releaseArguments };
}

test("checkout at the deadline releases its client and rejects without a pending branch", async () => {
  const database = createFakeDatabase(respondWithSuccessfulQuery);
  const originalDateNow = Date.now;
  const nowMs = originalDateNow();
  const deadlineAtMs = nowMs + 1_000;
  let dateReadCount = 0;
  Date.now = (): number => {
    dateReadCount += 1;
    return dateReadCount < 3 ? nowMs : deadlineAtMs;
  };

  try {
    const operation = transactionWithPostgresDeadline(
      database.pool,
      deadlineAtMs,
      async () => "unreachable",
    );

    await assert.rejects(
      settleBeforeTestWatchdog(
        operation,
        100,
        "Deadline checkout promise remained pending.",
      ),
      (error: unknown) => error instanceof DatabaseDeadlineExceededError
        && error.phase === "pool_checkout",
    );
    assert.equal(database.releaseArguments.length, 1);
    assert.equal(database.releaseArguments[0], undefined);
    assert.deepEqual(database.queryTexts, []);
  } finally {
    Date.now = originalDateNow;
  }
});

test("transaction waits for every started executor operation before commit and release", async () => {
  const configurationGate = createDeferred<pg.QueryResult<pg.QueryResultRow>>();
  const callerSqlGate = createDeferred<pg.QueryResult<pg.QueryResultRow>>();
  const database = createFakeDatabase(async (text) => {
    if (text.includes("set_config")) return configurationGate.promise;
    if (text === "INSERT") return callerSqlGate.promise;
    return createQueryResult(text);
  });

  const operation = transactionWithPostgresDeadline(
    database.pool,
    Date.now() + 5_000,
    async (executor) => {
      void executor.query("INSERT", []);
      return "callback result";
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(database.queryTexts[0], "BEGIN");
  assert.equal(database.queryTexts[1]?.includes("set_config"), true);
  assert.equal(database.queryTexts.includes("COMMIT"), false);
  assert.equal(database.releaseArguments.length, 0);

  configurationGate.resolve(createQueryResult("SELECT"));
  for (let attempt = 0; attempt < 20 && !database.queryTexts.includes("INSERT"); attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(database.queryTexts.includes("INSERT"), true);
  assert.equal(database.queryTexts.includes("COMMIT"), false);
  assert.equal(database.releaseArguments.length, 0);

  callerSqlGate.resolve(createQueryResult("INSERT"));
  assert.equal(await operation, "callback result");
  assert.deepEqual(
    database.queryTexts.map((text) => text.includes("set_config") ? "CONFIGURE" : text),
    ["BEGIN", "CONFIGURE", "INSERT", "COMMIT"],
  );
  assert.deepEqual(database.releaseArguments, [undefined]);

  const expiringConfigurationGate = createDeferred<pg.QueryResult<pg.QueryResultRow>>();
  const expiringDatabase = createFakeDatabase(async (text) => {
    if (text.includes("set_config")) return expiringConfigurationGate.promise;
    return createQueryResult(text);
  });
  const expiringOperation = transactionWithPostgresDeadline(
    expiringDatabase.pool,
    Date.now() + 100,
    async (executor) => {
      void executor.query("LATE INSERT", []);
      return "expired operation";
    },
  );
  await assert.rejects(
    settleBeforeTestWatchdog(
      expiringOperation,
      1_000,
      "Started executor operation did not expire.",
    ),
    (error: unknown) => error instanceof DatabaseDeadlineExceededError
      && error.phase === "executor_operations",
  );
  assert.ok(expiringDatabase.releaseArguments[0] instanceof DatabaseDeadlineExceededError);

  expiringConfigurationGate.resolve(createQueryResult("SELECT"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(expiringDatabase.queryTexts.includes("LATE INSERT"), false);
  assert.equal(expiringDatabase.queryTexts.includes("COMMIT"), false);
});

test("callback expiry discards the client and observes late callback settlement", async () => {
  const resolvingDatabase = createFakeDatabase(respondWithSuccessfulQuery);
  const callbackGate = createDeferred<void>();
  const callbackFinished = createDeferred<void>();
  let lateQueryError: unknown = null;

  const resolvingOperation = transactionWithPostgresDeadline(
    resolvingDatabase.pool,
    Date.now() + 100,
    async (executor) => {
      await callbackGate.promise;
      try {
        await executor.query("SELECT 1", []);
      } catch (error) {
        lateQueryError = error;
      }
      callbackFinished.resolve();
      return "late result";
    },
  );

  await assert.rejects(
    settleBeforeTestWatchdog(
      resolvingOperation,
      1_000,
      "Deadline callback promise did not reject promptly.",
    ),
    (error: unknown) => error instanceof DatabaseDeadlineExceededError
      && error.phase === "transaction_callback",
  );
  assert.equal(resolvingDatabase.releaseArguments.length, 1);
  assert.ok(resolvingDatabase.releaseArguments[0] instanceof DatabaseDeadlineExceededError);

  callbackGate.resolve();
  await callbackFinished.promise;
  assert.ok(lateQueryError instanceof DatabaseDeadlineExceededError);
  assert.equal(lateQueryError.phase, "transaction_callback");
  assert.deepEqual(resolvingDatabase.queryTexts, ["BEGIN"]);

  const rejectingDatabase = createFakeDatabase(respondWithSuccessfulQuery);
  const lateCallback = createDeferred<string>();
  const rejectingOperation = transactionWithPostgresDeadline(
    rejectingDatabase.pool,
    Date.now() + 100,
    async () => lateCallback.promise,
  );

  await assert.rejects(
    settleBeforeTestWatchdog(
      rejectingOperation,
      1_000,
      "Deadline callback promise did not reject promptly.",
    ),
    (error: unknown) => error instanceof DatabaseDeadlineExceededError
      && error.phase === "transaction_callback",
  );
  lateCallback.reject(new Error("late callback rejection"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(rejectingDatabase.releaseArguments.length, 1);
  assert.deepEqual(rejectingDatabase.queryTexts, ["BEGIN"]);
});

test("commit distinguishes explicit server errors from response loss", async () => {
  const serverError = new pg.DatabaseError("terminating connection due to administrator command", 0, "error");
  serverError.code = "57P01";
  const serverErrorDatabase = createFakeDatabase(async (text) => {
    if (text === "COMMIT") throw serverError;
    return createQueryResult(text);
  });

  await assert.rejects(
    transactionWithPostgresDeadline(
      serverErrorDatabase.pool,
      Date.now() + 5_000,
      async () => "server error",
    ),
    (error: unknown) => error === serverError,
  );
  assert.deepEqual(serverErrorDatabase.releaseArguments, [serverError]);

  const responseLossDatabase = createFakeDatabase(async (text) => {
    if (text === "COMMIT") throw new Error("Query read timeout");
    return createQueryResult(text);
  });
  await assert.rejects(
    transactionWithPostgresDeadline(
      responseLossDatabase.pool,
      Date.now() + 5_000,
      async () => "unknown outcome",
    ),
    (error: unknown) => error instanceof DatabaseCommitOutcomeUnknownError
      && error.code === "DATABASE_COMMIT_OUTCOME_UNKNOWN",
  );
  assert.ok(
    responseLossDatabase.releaseArguments[0] instanceof DatabaseCommitOutcomeUnknownError,
  );
});
