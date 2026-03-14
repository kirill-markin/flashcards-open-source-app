import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { configureRuntimeRole } from "./migrationRunner";

function makeQueryResult<Row extends pg.QueryResultRow>(rowCount: number): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount,
    oid: 0,
    fields: [],
    rows: [],
  };
}

test("configureRuntimeRole updates an existing runtime role password", async () => {
  const calls: Array<Readonly<{ text: string; params: ReadonlyArray<unknown> }>> = [];
  const client = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<pg.QueryResult<Row>> {
      calls.push({ text, params: params ?? [] });
      return makeQueryResult<Row>(calls.length === 1 ? 1 : 0);
    },
  } as unknown as Pick<pg.Client, "query">;

  const configured = await configureRuntimeRole(client, "backend_app", "secret-value");

  assert.equal(configured, true);
  assert.deepEqual(calls[0], {
    text: "SELECT 1 AS exists FROM pg_roles WHERE rolname = $1",
    params: ["backend_app"],
  });
  assert.equal(calls[1]?.text, `ALTER ROLE "backend_app" WITH PASSWORD 'secret-value'`);
});

test("configureRuntimeRole leaves missing runtime roles untouched", async () => {
  let updateCount = 0;
  const client = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.startsWith("ALTER ROLE")) {
        updateCount += 1;
      }
      return makeQueryResult<Row>(0);
    },
  } as unknown as Pick<pg.Client, "query">;

  const configured = await configureRuntimeRole(client, "auth_app", "secret-value");

  assert.equal(configured, false);
  assert.equal(updateCount, 0);
});
