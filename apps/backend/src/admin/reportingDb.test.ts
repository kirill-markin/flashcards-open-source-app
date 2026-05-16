import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

function createCodedError(code: string, message: string): Error & Readonly<{ code: string }> {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

test("withReportingReadOnlyTransaction preserves original error when rollback cleanup fails", async () => {
  const originalConnect = pg.Pool.prototype.connect;
  const originalWarn = console.warn;
  const originalReportingDatabaseUrl = process.env.REPORTING_DATABASE_URL;
  const originalReportingSecretArn = process.env.REPORTING_DB_SECRET_ARN;
  const originalError = createCodedError("42601", "syntax error at or near select");
  const rollbackError = createCodedError("57P01", "terminating connection due to administrator command");
  const executedStatements: Array<string> = [];
  const warningRecords: Array<Readonly<Record<string, unknown>>> = [];
  const releaseArguments: Array<Error | boolean | undefined> = [];

  const client = {
    query: async (statement: string): Promise<pg.QueryResult<pg.QueryResultRow>> => {
      executedStatements.push(statement);
      if (statement === "ROLLBACK") {
        throw rollbackError;
      }

      return {
        command: statement,
        rowCount: 0,
        oid: 0,
        rows: [],
        fields: [],
      };
    },
    release: (error?: Error | boolean): void => {
      releaseArguments.push(error);
    },
  };

  process.env.REPORTING_DATABASE_URL = "postgresql://user:pass@localhost:5432/reporting";
  delete process.env.REPORTING_DB_SECRET_ARN;
  pg.Pool.prototype.connect = async (): Promise<pg.PoolClient> => client as pg.PoolClient;
  console.warn = (message?: unknown): void => {
    if (typeof message !== "string") {
      throw new Error("Expected rollback warning log to be a JSON string.");
    }

    warningRecords.push(JSON.parse(message) as Readonly<Record<string, unknown>>);
  };

  try {
    const { withReportingReadOnlyTransaction } = await import("./reportingDb");

    await assert.rejects(
      withReportingReadOnlyTransaction(async () => {
        throw originalError;
      }),
      (error: unknown) => error === originalError,
    );
  } finally {
    pg.Pool.prototype.connect = originalConnect;
    console.warn = originalWarn;
    if (originalReportingDatabaseUrl === undefined) {
      delete process.env.REPORTING_DATABASE_URL;
    } else {
      process.env.REPORTING_DATABASE_URL = originalReportingDatabaseUrl;
    }

    if (originalReportingSecretArn === undefined) {
      delete process.env.REPORTING_DB_SECRET_ARN;
    } else {
      process.env.REPORTING_DB_SECRET_ARN = originalReportingSecretArn;
    }
  }

  assert.deepEqual(executedStatements, [
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    "ROLLBACK",
  ]);
  assert.deepEqual(releaseArguments, [rollbackError]);
  assert.deepEqual(warningRecords, [
    {
      domain: "backend",
      action: "reporting_read_only_transaction_rollback_failed",
      originalSqlState: "42601",
      originalErrorCode: "42601",
      originalErrorClass: "Error",
      originalErrorMessage: "syntax error at or near select",
      rollbackSqlState: "57P01",
      rollbackErrorCode: "57P01",
      rollbackErrorClass: "Error",
      rollbackErrorMessage: "terminating connection due to administrator command",
    },
  ]);
});
