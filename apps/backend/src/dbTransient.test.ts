import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./errors";
import {
  DatabaseCommitOutcomeUnknownError,
  getDatabaseErrorFields,
  isTransientDatabaseError,
  retryTransientDatabaseOperationWithDependencies,
  toDatabaseBoundaryError,
  toDatabaseCommitBoundaryError,
  toDatabaseCommitOutcomeUnknownError,
} from "./dbTransient";

function createCodedError(code: string, message: string): Error & Readonly<{ code: string }> {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

test("isTransientDatabaseError recognizes RDS and network transient failures", () => {
  assert.equal(isTransientDatabaseError(createCodedError("40001", "serialization failure")), true);
  assert.equal(isTransientDatabaseError(createCodedError("40P01", "deadlock detected")), true);
  assert.equal(isTransientDatabaseError(createCodedError("57P01", "admin shutdown")), true);
  assert.equal(isTransientDatabaseError(createCodedError("08006", "connection failure")), true);
  assert.equal(isTransientDatabaseError(createCodedError("ECONNRESET", "socket reset")), true);
  assert.equal(
    isTransientDatabaseError(new Error("terminating connection due to administrator command")),
    true,
  );
  assert.equal(isTransientDatabaseError(new Error("Connection terminated unexpectedly")), true);
  assert.equal(isTransientDatabaseError(createCodedError("23505", "duplicate key")), false);
});

test("getDatabaseErrorFields separates sqlState from network errorCode", () => {
  assert.deepEqual(getDatabaseErrorFields(createCodedError("57P03", "starting up")), {
    sqlState: "57P03",
    errorCode: "57P03",
    errorClass: "Error",
    errorMessage: "starting up",
  });
  assert.deepEqual(getDatabaseErrorFields(createCodedError("23505", "duplicate key")), {
    sqlState: "23505",
    errorCode: "23505",
    errorClass: "Error",
    errorMessage: "duplicate key",
  });
  assert.deepEqual(getDatabaseErrorFields(createCodedError("ETIMEDOUT", "timeout")), {
    sqlState: null,
    errorCode: "ETIMEDOUT",
    errorClass: "Error",
    errorMessage: "timeout",
  });
});

test("toDatabaseBoundaryError maps transient DB errors to public service unavailable", () => {
  const mappedError = toDatabaseBoundaryError(createCodedError("53300", "too many connections"));

  assert.ok(mappedError instanceof HttpError);
  assert.equal(mappedError.statusCode, 503);
  assert.equal(mappedError.message, "Service is temporarily unavailable. Retry shortly.");
  assert.equal(mappedError.code, "SERVICE_UNAVAILABLE");
  assert.equal(getDatabaseErrorFields(mappedError).sqlState, "53300");
  assert.equal(getDatabaseErrorFields(mappedError).errorCode, "53300");
});

test("toDatabaseCommitOutcomeUnknownError maps commit errors to non-retryable internal errors", () => {
  const mappedError = toDatabaseCommitOutcomeUnknownError(createCodedError("08006", "connection failure"));

  assert.ok(mappedError instanceof DatabaseCommitOutcomeUnknownError);
  assert.equal(mappedError.statusCode, 500);
  assert.equal(mappedError.code, "DATABASE_COMMIT_OUTCOME_UNKNOWN");
  assert.equal(mappedError.message, "Request outcome could not be confirmed. Check current state before retrying the request.");
  assert.equal(getDatabaseErrorFields(mappedError).sqlState, "08006");
  assert.equal(getDatabaseErrorFields(mappedError).errorCode, "08006");
});

test("toDatabaseCommitBoundaryError maps only transient commit failures to unknown outcome", () => {
  const mappedError = toDatabaseCommitBoundaryError(createCodedError("08006", "connection failure"));

  assert.ok(mappedError instanceof DatabaseCommitOutcomeUnknownError);
  assert.equal(mappedError.code, "DATABASE_COMMIT_OUTCOME_UNKNOWN");
});

test("toDatabaseCommitBoundaryError keeps non-transient commit failures on normal DB boundary mapping", () => {
  const sourceError = createCodedError("23514", "deferred check constraint violation");
  const mappedError = toDatabaseCommitBoundaryError(sourceError);

  assert.equal(mappedError, sourceError);
});

test("retryTransientDatabaseOperationWithDependencies retries transient DB errors with full jitter", async () => {
  const delays: Array<number> = [];
  const warningRecords: Array<Readonly<Record<string, unknown>>> = [];
  const originalWarn = console.warn;
  let calls = 0;

  console.warn = (message?: unknown): void => {
    if (typeof message !== "string") {
      throw new Error("Expected retry warning log to be a JSON string.");
    }

    warningRecords.push(JSON.parse(message) as Readonly<Record<string, unknown>>);
  };

  try {
    const result = await retryTransientDatabaseOperationWithDependencies(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw createCodedError("ECONNRESET", "socket reset");
        }

        return "ok";
      },
      {
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
        random: () => 0.5,
      },
    );

    assert.equal(result, "ok");
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(calls, 3);
  assert.deepEqual(delays, [50, 100]);
  assert.deepEqual(warningRecords, [
    {
      domain: "backend",
      action: "database_transient_retry",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 50,
      sqlState: null,
      errorCode: "ECONNRESET",
      errorClass: "Error",
      errorMessage: "socket reset",
    },
    {
      domain: "backend",
      action: "database_transient_retry",
      attempt: 2,
      maxAttempts: 3,
      delayMs: 100,
      sqlState: null,
      errorCode: "ECONNRESET",
      errorClass: "Error",
      errorMessage: "socket reset",
    },
  ]);
});

test("retryTransientDatabaseOperationWithDependencies does not retry non-transient errors", async () => {
  let calls = 0;

  await assert.rejects(
    retryTransientDatabaseOperationWithDependencies(
      async () => {
        calls += 1;
        throw createCodedError("23505", "duplicate key");
      },
      {
        sleep: async () => {},
        random: () => 0.5,
      },
    ),
    (error: unknown) => error instanceof Error && error.message === "duplicate key",
  );

  assert.equal(calls, 1);
});
