import assert from "node:assert/strict";
import test from "node:test";
import {
  SecretsManagerClient,
  type GetSecretValueCommandOutput,
} from "@aws-sdk/client-secrets-manager";
import pg from "pg";
import { DatabaseDeadlineExceededError } from "./deadline";

type Deferred<Value> = Readonly<{
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
}>;

type SecretSendOptions = Readonly<{
  abortSignal?: AbortSignal;
}>;

type SecretSend = (
  command: object,
  options?: SecretSendOptions,
) => Promise<GetSecretValueCommandOutput>;

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
  timeoutMessage: string,
): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), 1_000);
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

test("deadline wrappers abort cold initialization without publishing late pool state", async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDbSecretArn = process.env.DB_SECRET_ARN;
  const originalDbHost = process.env.DB_HOST;
  const originalDbName = process.env.DB_NAME;
  const originalPool = pg.Pool;
  const secretsPrototype = SecretsManagerClient.prototype as unknown as {
    send: SecretSend;
  };
  const originalSecretSend = secretsPrototype.send;
  const observedAbortSignals: Array<AbortSignal | null> = [];
  let pendingSecret = createDeferred<GetSecretValueCommandOutput>();
  let poolConstructionCount = 0;

  class FakePool {
    constructor(_config: pg.PoolConfig) {
      poolConstructionCount += 1;
    }

    on(_event: string, _listener: (error: Error) => void): void {}

    async connect(): Promise<pg.PoolClient> {
      throw new Error("Deadline initialization test must not connect.");
    }

    async end(): Promise<void> {}
  }

  delete process.env.DATABASE_URL;
  process.env.DB_SECRET_ARN = "deadline-test-secret";
  process.env.DB_HOST = "deadline-test-host";
  process.env.DB_NAME = "deadline-test-database";
  (pg as unknown as { Pool: typeof pg.Pool }).Pool = FakePool as unknown as typeof pg.Pool;
  secretsPrototype.send = (_command, options) => {
    observedAbortSignals.push(options?.abortSignal ?? null);
    return pendingSecret.promise;
  };

  try {
    const dbCore = await import("./core");
    const queryOperation = dbCore.unsafeQueryWithDeadline(
      Date.now() + 100,
      "SELECT 1",
      [],
    );
    await assert.rejects(
      settleBeforeTestWatchdog(
        queryOperation,
        "Query wrapper did not reject expired pool initialization.",
      ),
      (error: unknown) => error instanceof DatabaseDeadlineExceededError
        && error.phase === "pool_checkout",
    );
    assert.equal(observedAbortSignals[0]?.aborted, true);
    assert.equal(poolConstructionCount, 0);

    pendingSecret.resolve({
      $metadata: {},
      SecretString: JSON.stringify({ username: "late-user", password: "late-password" }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(poolConstructionCount, 0);

    pendingSecret = createDeferred<GetSecretValueCommandOutput>();
    let callbackCalled = false;
    const transactionOperation = dbCore.unsafeTransactionWithDeadline(
      Date.now() + 100,
      async () => {
        callbackCalled = true;
        return "unreachable";
      },
    );
    await assert.rejects(
      settleBeforeTestWatchdog(
        transactionOperation,
        "Transaction wrapper did not reject expired pool initialization.",
      ),
      (error: unknown) => error instanceof DatabaseDeadlineExceededError
        && error.phase === "pool_checkout",
    );
    assert.equal(observedAbortSignals[1]?.aborted, true);
    assert.equal(callbackCalled, false);
    assert.equal(poolConstructionCount, 0);

    pendingSecret.reject(new Error("late secret rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(poolConstructionCount, 0);
  } finally {
    secretsPrototype.send = originalSecretSend;
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
    if (originalDbHost === undefined) {
      delete process.env.DB_HOST;
    } else {
      process.env.DB_HOST = originalDbHost;
    }
    if (originalDbName === undefined) {
      delete process.env.DB_NAME;
    } else {
      process.env.DB_NAME = originalDbName;
    }
  }
});
