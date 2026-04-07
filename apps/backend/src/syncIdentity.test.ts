import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "./db";
import { HttpError } from "./errors";
import {
  buildSystemWorkspaceReplicaId,
  ensureSystemWorkspaceReplicaInExecutor,
  ensureWorkspaceReplicaInExecutor,
} from "./syncIdentity";

type ClaimStatus = "inserted" | "refreshed" | "reassigned" | "platform_mismatch";

type RecordedQuery = Readonly<{
  text: string;
  params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>;
}>;

type SyncIdentityExecutorOptions = Readonly<{
  claimStatus: ClaimStatus;
  expectedWorkspaceReplicaInsertCount: number;
}>;

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createSyncIdentityExecutor(
  options: SyncIdentityExecutorOptions,
): Readonly<{
  executor: DatabaseExecutor;
  recordedQueries: Array<RecordedQuery>;
}> {
  const recordedQueries: Array<RecordedQuery> = [];
  let currentUserId: string | null = null;
  let currentWorkspaceId: string | null = null;

  function requireCurrentWorkspaceScope(userId: string, workspaceId: string): void {
    assert.equal(currentUserId, userId);
    assert.equal(currentWorkspaceId, workspaceId);
  }

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      recordedQueries.push({ text, params });

      if (text.includes("set_config('app.user_id'")) {
        currentUserId = typeof params[0] === "string" ? params[0] : null;
        currentWorkspaceId = typeof params[1] === "string" && params[1] !== "" ? params[1] : null;
        return createQueryResult<Row>([]);
      }

      if (text.includes("FROM sync.claim_installation")) {
        return createQueryResult<Row>([{
          claim_status: options.claimStatus,
          installation_id: "installation-1",
          platform: "ios",
          previous_user_id: options.claimStatus === "inserted" ? null : "user-a",
          current_user_id: "user-b",
        } as unknown as Row]);
      }

      if (text.includes("INSERT INTO sync.workspace_replicas")) {
        if (options.expectedWorkspaceReplicaInsertCount === 0) {
          throw new Error("Workspace replica insert was not expected");
        }

        requireCurrentWorkspaceScope(String(params[2]), String(params[1]));

        return createQueryResult<Row>([{
          replica_id: params[0],
          platform: params[6],
        } as unknown as Row]);
      }

      if (text.includes("UPDATE sync.workspace_replicas")) {
        return createQueryResult<Row>([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  return {
    executor,
    recordedQueries,
  };
}

test("ensureWorkspaceReplicaInExecutor accepts inserted, refreshed, and reassigned claims", async () => {
  for (const claimStatus of ["inserted", "refreshed", "reassigned"] as const) {
    const { executor, recordedQueries } = createSyncIdentityExecutor({
      claimStatus,
      expectedWorkspaceReplicaInsertCount: 1,
    });

    const replicaId = await ensureWorkspaceReplicaInExecutor(executor, {
      workspaceId: "workspace-1",
      userId: "user-b",
      installationId: "installation-1",
      platform: "ios",
      appVersion: "1.2.3",
    });

    assert.equal(recordedQueries.length, 3);
    assert.match(recordedQueries[0]!.text, /set_config\('app\.user_id'/);
    assert.deepEqual(recordedQueries[0]!.params, ["user-b", "workspace-1"]);
    assert.match(recordedQueries[1]!.text, /FROM sync\.claim_installation/);
    assert.deepEqual(recordedQueries[1]!.params, ["installation-1", "ios", "user-b", "1.2.3"]);
    assert.match(recordedQueries[2]!.text, /INSERT INTO sync\.workspace_replicas/);
    assert.equal(replicaId, recordedQueries[2]!.params[0]);
  }
});

test("ensureWorkspaceReplicaInExecutor raises platform mismatch without touching workspace_replicas", async () => {
  const { executor, recordedQueries } = createSyncIdentityExecutor({
    claimStatus: "platform_mismatch",
    expectedWorkspaceReplicaInsertCount: 0,
  });

  await assert.rejects(
    ensureWorkspaceReplicaInExecutor(executor, {
      workspaceId: "workspace-1",
      userId: "user-b",
      installationId: "installation-1",
      platform: "ios",
      appVersion: "1.2.3",
    }),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "SYNC_INSTALLATION_PLATFORM_MISMATCH");
      return true;
    },
  );

  assert.equal(recordedQueries.length, 2);
  assert.match(recordedQueries[0]!.text, /set_config\('app\.user_id'/);
  assert.match(recordedQueries[1]!.text, /FROM sync\.claim_installation/);
});

test("ensureSystemWorkspaceReplicaInExecutor does not claim installations", async () => {
  const recordedQueries: Array<RecordedQuery> = [];
  let currentUserId: string | null = null;
  let currentWorkspaceId: string | null = null;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      recordedQueries.push({ text, params });

      if (text.includes("set_config('app.user_id'")) {
        currentUserId = typeof params[0] === "string" ? params[0] : null;
        currentWorkspaceId = typeof params[1] === "string" && params[1] !== "" ? params[1] : null;
        return createQueryResult<Row>([]);
      }

      if (text.includes("sync.claim_installation")) {
        throw new Error("System actors must not claim client installations");
      }

      if (text.includes("INSERT INTO sync.workspace_replicas")) {
        assert.equal(currentUserId, String(params[2]));
        assert.equal(currentWorkspaceId, String(params[1]));
        return createQueryResult<Row>([{
          replica_id: params[0],
          platform: params[6],
        } as unknown as Row]);
      }

      if (text.includes("UPDATE sync.workspace_replicas")) {
        return createQueryResult<Row>([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const replicaId = await ensureSystemWorkspaceReplicaInExecutor(executor, {
    workspaceId: "workspace-1",
    userId: "user-b",
    actorKind: "ai_chat",
    actorKey: "chat-session-1",
    platform: "web",
    appVersion: "1.2.3",
  });

  assert.equal(replicaId, buildSystemWorkspaceReplicaId("workspace-1", "ai_chat", "chat-session-1"));
  assert.equal(recordedQueries.length, 2);
  assert.match(recordedQueries[0]!.text, /set_config\('app\.user_id'/);
  assert.match(recordedQueries[1]!.text, /INSERT INTO sync\.workspace_replicas/);
});

test("ensureSystemWorkspaceReplicaInExecutor accepts workspace_reset actors", async () => {
  const recordedQueries: Array<RecordedQuery> = [];
  let currentUserId: string | null = null;
  let currentWorkspaceId: string | null = null;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      recordedQueries.push({ text, params });

      if (text.includes("set_config('app.user_id'")) {
        currentUserId = typeof params[0] === "string" ? params[0] : null;
        currentWorkspaceId = typeof params[1] === "string" && params[1] !== "" ? params[1] : null;
        return createQueryResult<Row>([]);
      }

      if (text.includes("sync.claim_installation")) {
        throw new Error("System actors must not claim client installations");
      }

      if (text.includes("INSERT INTO sync.workspace_replicas")) {
        assert.equal(currentUserId, String(params[2]));
        assert.equal(currentWorkspaceId, String(params[1]));
        return createQueryResult<Row>([{
          replica_id: params[0],
          platform: params[6],
        } as unknown as Row]);
      }

      if (text.includes("UPDATE sync.workspace_replicas")) {
        return createQueryResult<Row>([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const replicaId = await ensureSystemWorkspaceReplicaInExecutor(executor, {
    workspaceId: "workspace-1",
    userId: "user-b",
    actorKind: "workspace_reset",
    actorKey: "reset-progress",
    platform: "system",
    appVersion: null,
  });

  assert.equal(replicaId, buildSystemWorkspaceReplicaId("workspace-1", "workspace_reset", "reset-progress"));
  assert.equal(recordedQueries.length, 2);
  assert.match(recordedQueries[0]!.text, /set_config\('app\.user_id'/);
  assert.match(recordedQueries[1]!.text, /INSERT INTO sync\.workspace_replicas/);
  assert.deepEqual(recordedQueries[1]!.params, [
    replicaId,
    "workspace-1",
    "user-b",
    "workspace_reset",
    null,
    "reset-progress",
    "system",
    null,
  ]);
});
