import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createWorkspaceInExecutor } from "./agentApiKeys.js";
import { buildSystemWorkspaceReplicaId } from "../sync/workspaceReplicaId.js";
import type { DatabaseExecutor } from "../../db.js";

/**
 * Schema contract: the auth first-login workspace bootstrap must stay valid
 * against the live migration chain. This is the guard that would have caught
 * migration 0035 dropping sync.devices / fsrs_last_modified_by_device_id while
 * this hand-written copy still referenced them.
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

test("auth workspace bootstrap matches the live replica schema", { skip }, async () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Never committed: SET LOCAL ROLE and uncommitted work are discarded when
    // the connection ends, so the contract database stays clean for other tests.
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE auth_app");

    const executor: DatabaseExecutor = {
      query(text, params) {
        return client.query(text, params as Array<unknown>);
      },
    };

    const userId = randomUUID();
    // Production seeds org.user_settings before bootstrapping the first workspace
    // (org.workspace_memberships.user_id has a non-deferrable FK to
    // org.user_settings), so reproduce that precondition under the auth_app
    // security context, mirroring the caller in createAgentApiKeyFromIdToken.
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await client.query(
      "INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [userId],
    );
    const workspaceId = await createWorkspaceInExecutor(executor, userId);

    // The workspace<->replica foreign keys are DEFERRABLE INITIALLY DEFERRED, so
    // force them to validate now instead of only at COMMIT.
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");

    // auth_app may only INSERT into org.workspaces (no SELECT grant), matching
    // production where auth never reads it. SET CONSTRAINTS ALL IMMEDIATE above
    // already validated that the workspace's fsrs_last_modified_by_replica_id
    // foreign key resolves to an existing replica, so assert the rest via the
    // auth_app-readable workspace_seed replica and its deterministic id.
    const expectedReplicaId = buildSystemWorkspaceReplicaId(workspaceId, "workspace_seed", "workspace-seed");
    const replicaRows = await client.query<{ replica_id: string }>(
      "SELECT replica_id FROM sync.workspace_replicas WHERE workspace_id = $1 AND actor_kind = 'workspace_seed'",
      [workspaceId],
    );
    assert.equal(replicaRows.rowCount, 1, "workspace_seed replica row should exist");
    assert.equal(
      replicaRows.rows[0]?.replica_id,
      expectedReplicaId,
      "bootstrap replica should use the deterministic workspace_seed id",
    );
  } finally {
    await client.end();
  }
});
