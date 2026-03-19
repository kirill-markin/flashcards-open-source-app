import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "../db";
import { buildHotChangesFromRows } from "./hotPull";

function makeQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

const executor: DatabaseExecutor = {
  async query<Row extends pg.QueryResultRow>(text: string): Promise<pg.QueryResult<Row>> {
    if (text.includes("FROM content.cards")) {
      return makeQueryResult([]) as pg.QueryResult<Row>;
    }

    throw new Error(`Unexpected query: ${text}`);
  },
};

test("buildHotChangesFromRows fails when a referenced card winner is missing", async () => {
  await assert.rejects(
    () => buildHotChangesFromRows(
      executor,
      "workspace-1",
      [{
        change_id: 12,
        entity_type: "card",
        entity_id: "card-1",
      }],
    ),
    /Hot sync card card-1 is missing/,
  );
});
