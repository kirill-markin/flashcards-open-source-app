import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import { loadGeneratedMediaPromotionProtocolVersionInExecutor } from "./jobs";

const legacyWorkspaceId = "35274129-ef97-d366-954c-955b4bb0fbf0";
const jobId = "11111111-1111-4111-8111-111111111111";

test("promotion job protocol lookup accepts lowercase legacy workspaces only", async () => {
  let queryCount = 0;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      _text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queryCount += 1;
      assert.deepEqual(params, [legacyWorkspaceId, jobId]);
      return {
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ protocol_version: 2 } as unknown as Row],
      };
    },
  };

  assert.equal(
    await loadGeneratedMediaPromotionProtocolVersionInExecutor(
      executor,
      legacyWorkspaceId,
      jobId,
    ),
    2,
  );
  await assert.rejects(
    loadGeneratedMediaPromotionProtocolVersionInExecutor(
      executor,
      legacyWorkspaceId.toUpperCase(),
      jobId,
    ),
    /workspaceId must be a lowercase UUID/,
  );
  await assert.rejects(
    loadGeneratedMediaPromotionProtocolVersionInExecutor(
      executor,
      legacyWorkspaceId,
      legacyWorkspaceId,
    ),
    /jobId must be a lowercase UUID/,
  );
  assert.equal(queryCount, 1);
});
