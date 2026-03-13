import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "./db";
import { ensureUserSelectedWorkspaceInExecutor } from "./workspaces";

function makeQueryResult<Row extends pg.QueryResultRow>(
  rows: ReadonlyArray<pg.QueryResultRow>,
): pg.QueryResult<Row> {
  return {
    command: rows.length > 0 ? "SELECT" : "UPDATE",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows] as Array<Row>,
  };
}

test("ensureUserSelectedWorkspaceInExecutor updates selection only to an accessible workspace", async () => {
  let updatedWorkspaceId: string | null = null;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT memberships.workspace_id")) {
        assert.deepEqual(params, ["user-1"]);
        return makeQueryResult<Row>([
          { workspace_id: "workspace-a" },
          { workspace_id: "workspace-b" },
        ]);
      }

      if (text.includes("UPDATE org.user_settings SET workspace_id")) {
        const nextWorkspaceId = params[0];
        const updatedUserId = params[1];
        if (typeof nextWorkspaceId !== "string") {
          throw new Error("Expected selected workspace id to be a string");
        }
        if (updatedUserId !== "user-1") {
          throw new Error("Expected selected workspace update to target the current user");
        }

        updatedWorkspaceId = nextWorkspaceId;
        return makeQueryResult<Row>([]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const selectedWorkspaceId = await ensureUserSelectedWorkspaceInExecutor(
    executor,
    "user-1",
    "workspace-missing",
  );

  assert.equal(updatedWorkspaceId, "workspace-a");
  assert.equal(selectedWorkspaceId, "workspace-a");
});

test("ensureUserSelectedWorkspaceInExecutor keeps an accessible selection without rewriting user settings", async () => {
  let updatedSelectionCount = 0;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT memberships.workspace_id")) {
        assert.deepEqual(params, ["user-1"]);
        return makeQueryResult<Row>([
          { workspace_id: "workspace-a" },
          { workspace_id: "workspace-b" },
        ]);
      }

      if (text.includes("UPDATE org.user_settings SET workspace_id")) {
        updatedSelectionCount += 1;
        return makeQueryResult<Row>([]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const selectedWorkspaceId = await ensureUserSelectedWorkspaceInExecutor(
    executor,
    "user-1",
    "workspace-b",
  );

  assert.equal(selectedWorkspaceId, "workspace-b");
  assert.equal(updatedSelectionCount, 0);
});
