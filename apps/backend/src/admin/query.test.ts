import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { HttpError } from "../errors";
import {
  executeAdminQuery,
  splitAdminQueryStatements,
  type AdminQueryResponse,
} from "./query";

function createQueryResult(
  rows: ReadonlyArray<pg.QueryResultRow>,
): pg.QueryResult<pg.QueryResultRow> {
  const columns = rows.length === 0
    ? []
    : Object.keys(rows[0]).map((name) => ({ name }) as pg.FieldDef);

  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    rows: [...rows],
    fields: columns,
  } as pg.QueryResult<pg.QueryResultRow>;
}

test("splitAdminQueryStatements preserves comments and strings while splitting top-level statements", () => {
  const statements = splitAdminQueryStatements([
    "SELECT 'one;still one' AS value;",
    "-- comment with semicolon;",
    "SELECT 2 AS value",
  ].join("\n"));

  assert.deepEqual(statements, [
    "SELECT 'one;still one' AS value",
    "-- comment with semicolon;\nSELECT 2 AS value",
  ]);
});

test("splitAdminQueryStatements preserves dollar-quoted strings while splitting top-level statements", () => {
  const statements = splitAdminQueryStatements([
    "SELECT $$one;still one$$ AS value;",
    "SELECT $tag$two;still two$tag$ AS another_value",
  ].join("\n"));

  assert.deepEqual(statements, [
    "SELECT $$one;still one$$ AS value",
    "SELECT $tag$two;still two$tag$ AS another_value",
  ]);
});

test("executeAdminQuery returns ordered result sets for multi-statement reads", async () => {
  const executedBatches: Array<ReadonlyArray<string>> = [];
  const auditEvents: Array<Readonly<Record<string, string | number | boolean>>> = [];

  const response = await executeAdminQuery({
    sql: "SELECT 1 AS total; SELECT 'ok' AS status",
    adminEmail: "admin@example.com",
    requestId: "request-1",
    executedAt: new Date("2026-04-17T12:34:56Z"),
    executeStatementBatchFn: async (statementSqlList) => {
      executedBatches.push(statementSqlList);
      return [
        createQueryResult([{ total: 1 }]),
        createQueryResult([{ status: "ok" }]),
      ];
    },
    logAdminQueryEventFn: (payload) => {
      auditEvents.push(payload as Readonly<Record<string, string | number | boolean>>);
    },
  });

  const typedResponse = response as AdminQueryResponse;
  assert.deepEqual(executedBatches, [[
    "SELECT 1 AS total",
    "SELECT 'ok' AS status",
  ]]);
  assert.equal(typedResponse.executedAtUtc, "2026-04-17T12:34:56Z");
  assert.deepEqual(typedResponse.resultSets, [
    {
      statementIndex: 0,
      columns: ["total"],
      rowCount: 1,
      rows: [{ total: 1 }],
    },
    {
      statementIndex: 1,
      columns: ["status"],
      rowCount: 1,
      rows: [{ status: "ok" }],
    },
  ]);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]?.success, true);
  assert.equal(auditEvents[0]?.statementCount, 2);
});

test("executeAdminQuery serializes Date values to ISO strings", async () => {
  const response = await executeAdminQuery({
    sql: "SELECT NOW() AS created_at",
    adminEmail: "admin@example.com",
    requestId: "request-2",
    executedAt: new Date("2026-04-17T12:34:56Z"),
    executeStatementBatchFn: async () => [createQueryResult([{ created_at: new Date("2026-04-01T08:09:10Z") }])],
    logAdminQueryEventFn: () => {},
  });

  assert.deepEqual(response.resultSets[0]?.rows, [
    { created_at: "2026-04-01T08:09:10Z" },
  ]);
});

test("executeAdminQuery serializes arrays and objects recursively", async () => {
  const response = await executeAdminQuery({
    sql: "SELECT payload, timestamps FROM report_rows",
    adminEmail: "admin@example.com",
    requestId: "request-2b",
    executedAt: new Date("2026-04-17T12:34:56Z"),
    executeStatementBatchFn: async () => [createQueryResult([{
      payload: {
        meta: {
          total: 2,
          active: true,
          generated_at: new Date("2026-04-02T03:04:05Z"),
        },
        items: [
          { label: "first", tags: ["a", "b"] },
          { label: "second", tags: [] },
        ],
      },
      timestamps: [
        new Date("2026-04-03T01:02:03Z"),
        null,
      ],
    }])],
    logAdminQueryEventFn: () => {},
  });

  assert.deepEqual(response.resultSets[0]?.rows, [
    {
      payload: {
        meta: {
          total: 2,
          active: true,
          generated_at: "2026-04-02T03:04:05Z",
        },
        items: [
          { label: "first", tags: ["a", "b"] },
          { label: "second", tags: [] },
        ],
      },
      timestamps: ["2026-04-03T01:02:03Z", null],
    },
  ]);
});

test("executeAdminQuery rejects unsupported nested values with a precise path", async () => {
  await assert.rejects(
    executeAdminQuery({
      sql: "SELECT payload FROM report_rows",
      adminEmail: "admin@example.com",
      requestId: "request-2c",
      executedAt: new Date("2026-04-17T12:34:56Z"),
      executeStatementBatchFn: async () => [createQueryResult([{
        payload: {
          nested: [new Map([["key", "value"]])],
        },
      }])],
      logAdminQueryEventFn: () => {},
    }),
    (error: unknown) => error instanceof Error
      && error.message === 'Admin query returned unsupported value type at "payload.nested[0]": Map',
  );
});

test("executeAdminQuery rejects empty SQL", async () => {
  await assert.rejects(
    executeAdminQuery({
      sql: "   ",
      adminEmail: "admin@example.com",
      requestId: "request-3",
      executedAt: new Date("2026-04-17T12:34:56Z"),
      logAdminQueryEventFn: () => {},
    }),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 400
      && error.code === "ADMIN_QUERY_INVALID_REQUEST",
  );
});

test("executeAdminQuery rejects unsupported SQL before execution", async () => {
  let executeCalls = 0;

  await assert.rejects(
    executeAdminQuery({
      sql: "BEGIN; SELECT 1",
      adminEmail: "admin@example.com",
      requestId: "request-4",
      executedAt: new Date("2026-04-17T12:34:56Z"),
      executeStatementBatchFn: async () => {
        executeCalls += 1;
        return [createQueryResult([])];
      },
      logAdminQueryEventFn: () => {},
    }),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 400
      && error.code === "ADMIN_QUERY_INVALID_REQUEST",
  );

  assert.equal(executeCalls, 0);
});
