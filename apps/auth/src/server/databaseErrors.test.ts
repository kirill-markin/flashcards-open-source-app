import assert from "node:assert/strict";
import test from "node:test";
import {
  getDatabaseErrorCode,
  getDatabaseErrorSqlState,
  isTransientDatabaseError,
} from "./databaseErrors.js";

type ErrorWithCode = Error & Readonly<{
  code: string;
}>;

function createErrorWithCode(message: string, code: string): ErrorWithCode {
  const error = new Error(message) as ErrorWithCode;
  Object.defineProperty(error, "code", {
    value: code,
    enumerable: true,
  });
  return error;
}

test("transient database classifier recognizes retryable SQLSTATE values", () => {
  const restartError = createErrorWithCode("terminating connection", "57P01");
  const serializationError = createErrorWithCode("serialization failure", "40001");
  const deadlockError = createErrorWithCode("deadlock detected", "40P01");

  assert.equal(isTransientDatabaseError(restartError), true);
  assert.equal(getDatabaseErrorCode(restartError), "57P01");
  assert.equal(getDatabaseErrorSqlState(restartError), "57P01");
  assert.equal(isTransientDatabaseError(serializationError), true);
  assert.equal(getDatabaseErrorSqlState(serializationError), "40001");
  assert.equal(isTransientDatabaseError(deadlockError), true);
  assert.equal(getDatabaseErrorSqlState(deadlockError), "40P01");
});

test("transient database classifier recognizes network error codes", () => {
  const error = createErrorWithCode("socket hang up", "ECONNRESET");

  assert.equal(isTransientDatabaseError(error), true);
  assert.equal(getDatabaseErrorCode(error), "ECONNRESET");
  assert.equal(getDatabaseErrorSqlState(error), null);
});

test("transient database classifier recognizes pg termination messages", () => {
  assert.equal(
    isTransientDatabaseError(new Error("Connection terminated unexpectedly")),
    true,
  );
  assert.equal(
    isTransientDatabaseError(new Error("terminating connection due to administrator command")),
    true,
  );
});

test("transient database classifier rejects ordinary errors", () => {
  const error = createErrorWithCode("duplicate key value violates unique constraint", "23505");

  assert.equal(isTransientDatabaseError(error), false);
  assert.equal(getDatabaseErrorSqlState(error), "23505");
});
