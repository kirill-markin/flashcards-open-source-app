import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createWorkspaceInExecutor } from "./create";
import type { DatabaseExecutor } from "../database";

/**
 * Schema contract: the canonical backend workspace bootstrap must stay valid
 * against the live migration chain. Pairs with the auth bootstrap contract test
 * so both independent copies are checked against the same real schema.
 *
 * Runs only when BOOTSTRAP_CONTRACT_DATABASE_URL points at a throwaway Postgres
 * with every db/migrations file applied (see
 * apps/backend/scripts/apply-schema-contract-db.mjs); the default offline
 * `npm test` skips it.
 */
const databaseUrl = process.env.BOOTSTRAP_CONTRACT_DATABASE_URL;
const skip = databaseUrl
  ? false
  : "requires BOOTSTRAP_CONTRACT_DATABASE_URL (real Postgres with all migrations applied)";

test("backend workspace bootstrap matches the live replica schema", { skip }, async () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Never committed: SET LOCAL ROLE and uncommitted work are discarded when
    // the connection ends, so the contract database stays clean for other tests.
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE backend_app");

    const executor: DatabaseExecutor = {
      query(text, params) {
        return client.query(text, params as Array<unknown>);
      },
    };

    const userId = randomUUID();
    const workspaceId = await createWorkspaceInExecutor(executor, userId, "Personal");

    // The workspace<->replica foreign keys are DEFERRABLE INITIALLY DEFERRED, so
    // force them to validate now instead of only at COMMIT.
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");

    const workspaceRows = await client.query<{ fsrs_last_modified_by_replica_id: string }>(
      "SELECT fsrs_last_modified_by_replica_id FROM org.workspaces WHERE workspace_id = $1",
      [workspaceId],
    );
    assert.equal(workspaceRows.rowCount, 1, "workspace row should exist");

    const replicaRows = await client.query<{ replica_id: string }>(
      "SELECT replica_id FROM sync.workspace_replicas WHERE workspace_id = $1 AND actor_kind = 'workspace_seed'",
      [workspaceId],
    );
    assert.equal(replicaRows.rowCount, 1, "workspace_seed replica row should exist");
    assert.equal(
      workspaceRows.rows[0]?.fsrs_last_modified_by_replica_id,
      replicaRows.rows[0]?.replica_id,
      "workspace fsrs replica pointer should reference the bootstrap replica",
    );
  } finally {
    await client.end();
  }
});
