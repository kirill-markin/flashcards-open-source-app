import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import {
  applyUserDatabaseScopeInExecutor,
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "./db.js";

function makeQueryResult<Row extends pg.QueryResultRow>(): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: 0,
    oid: 0,
    fields: [],
    rows: [],
  };
}

test("applyUserDatabaseScopeInExecutor sets auth-side user scope and clears workspace scope", async () => {
  const calls: Array<Readonly<{ text: string; params: ReadonlyArray<unknown> }>> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      calls.push({ text, params });
      return makeQueryResult<Row>();
    },
  };

  await applyUserDatabaseScopeInExecutor(executor, { userId: "user-1" });

  assert.equal(calls.length, 1);
  assert.match(calls[0]?.text ?? "", /set_config\('app\.user_id'/);
  assert.deepEqual(calls[0]?.params, ["user-1", ""]);
});

test("applyWorkspaceDatabaseScopeInExecutor sets auth-side workspace scope", async () => {
  const calls: Array<Readonly<{ text: string; params: ReadonlyArray<unknown> }>> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      calls.push({ text, params });
      return makeQueryResult<Row>();
    },
  };

  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: "user-1",
    workspaceId: "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0]?.text ?? "", /set_config\('app\.workspace_id'/);
  assert.deepEqual(calls[0]?.params, [
    "user-1",
    "00000000-0000-4000-8000-000000000001",
  ]);
});
