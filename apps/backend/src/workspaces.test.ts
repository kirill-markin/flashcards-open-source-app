import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "./db";
import {
  deleteWorkspaceConfirmationText,
  deleteWorkspaceInExecutor,
  ensureUserSelectedWorkspaceInExecutor,
  loadWorkspaceDeletePreviewInExecutor,
  renameWorkspaceInExecutor,
  setSelectedWorkspaceForApiKeyConnectionInExecutor,
} from "./workspaces";

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

test("renameWorkspaceInExecutor updates the workspace name and returns the renamed summary", async () => {
  let updatedWorkspaceName: string | null = null;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at, memberships.role")) {
        assert.deepEqual(params, ["user-1", "workspace-1"]);
        return makeQueryResult<Row>([{
          workspace_id: "workspace-1",
          name: "Before rename",
          created_at: "2026-03-16T09:00:00.000Z",
          role: "owner",
          member_count: 1,
        }]);
      }

      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["user-1", "workspace-1"]);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("UPDATE org.workspaces SET name = $1")) {
        assert.deepEqual(params, ["After rename", "workspace-1"]);
        updatedWorkspaceName = params[0] as string;
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at FROM org.workspace_memberships")) {
        assert.deepEqual(params, ["user-1", "workspace-1"]);
        return makeQueryResult<Row>([{
          workspace_id: "workspace-1",
          name: updatedWorkspaceName,
          created_at: "2026-03-16T09:00:00.000Z",
        }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const workspace = await renameWorkspaceInExecutor(
    executor,
    "user-1",
    "workspace-1",
    "After rename",
    "workspace-1",
  );

  assert.equal(updatedWorkspaceName, "After rename");
  assert.deepEqual(workspace, {
    workspaceId: "workspace-1",
    name: "After rename",
    createdAt: "2026-03-16T09:00:00.000Z",
    isSelected: true,
  });
});

test("loadWorkspaceDeletePreviewInExecutor returns the active card count and last-workspace state", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at, memberships.role")) {
        assert.deepEqual(params, ["user-1", "workspace-1"]);
        return makeQueryResult<Row>([{
          workspace_id: "workspace-1",
          name: "Personal",
          created_at: "2026-03-16T09:00:00.000Z",
          role: "owner",
          member_count: 1,
        }]);
      }

      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["user-1", "workspace-1"]);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT COUNT(*)::int AS active_card_count")) {
        assert.deepEqual(params, ["workspace-1"]);
        return makeQueryResult<Row>([{ active_card_count: 3 }]);
      }

      if (text.includes("SELECT memberships.workspace_id")) {
        assert.deepEqual(params, ["user-1"]);
        return makeQueryResult<Row>([{ workspace_id: "workspace-1" }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const preview = await loadWorkspaceDeletePreviewInExecutor(executor, "user-1", "workspace-1");

  assert.deepEqual(preview, {
    workspaceId: "workspace-1",
    workspaceName: "Personal",
    activeCardCount: 3,
    confirmationText: deleteWorkspaceConfirmationText,
    isLastAccessibleWorkspace: true,
  });
});

test("deleteWorkspaceInExecutor deletes the workspace and selects the earliest remaining workspace", async () => {
  let deletedWorkspaceId: string | null = null;
  let updatedWorkspaceId: string | null = null;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at, memberships.role")) {
        assert.deepEqual(params, ["user-1", "workspace-delete"]);
        return makeQueryResult<Row>([{
          workspace_id: "workspace-delete",
          name: "Delete me",
          created_at: "2026-03-16T09:00:00.000Z",
          role: "owner",
          member_count: 1,
        }]);
      }

      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["user-1", "workspace-delete"]);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT COUNT(*)::int AS active_card_count")) {
        assert.deepEqual(params, ["workspace-delete"]);
        return makeQueryResult<Row>([{ active_card_count: 4 }]);
      }

      if (text.includes("DELETE FROM org.workspaces WHERE workspace_id = $1")) {
        assert.deepEqual(params, ["workspace-delete"]);
        deletedWorkspaceId = params[0] as string;
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT memberships.workspace_id")) {
        assert.deepEqual(params, ["user-1"]);
        return makeQueryResult<Row>([
          { workspace_id: "workspace-a" },
          { workspace_id: "workspace-b" },
        ]);
      }

      if (text.includes("UPDATE org.user_settings SET workspace_id")) {
        assert.deepEqual(params, ["workspace-a", "user-1"]);
        updatedWorkspaceId = params[0] as string;
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at FROM org.workspace_memberships")) {
        assert.deepEqual(params, ["user-1", "workspace-a"]);
        return makeQueryResult<Row>([{
          workspace_id: "workspace-a",
          name: "Keep me",
          created_at: "2026-03-16T08:00:00.000Z",
        }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const response = await deleteWorkspaceInExecutor(
    executor,
    "user-1",
    "workspace-delete",
    deleteWorkspaceConfirmationText,
  );

  assert.equal(deletedWorkspaceId, "workspace-delete");
  assert.equal(updatedWorkspaceId, "workspace-a");
  assert.deepEqual(response, {
    ok: true,
    deletedWorkspaceId: "workspace-delete",
    deletedCardsCount: 4,
    workspace: {
      workspaceId: "workspace-a",
      name: "Keep me",
      createdAt: "2026-03-16T08:00:00.000Z",
      isSelected: true,
    },
  });
});

test("deleteWorkspaceInExecutor auto-creates a replacement workspace when the deleted workspace was the last one", async () => {
  let createdWorkspaceId: string | null = null;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at, memberships.role")) {
        assert.deepEqual(params, ["user-1", "workspace-delete"]);
        return makeQueryResult<Row>([{
          workspace_id: "workspace-delete",
          name: "Only workspace",
          created_at: "2026-03-16T09:00:00.000Z",
          role: "owner",
          member_count: 1,
        }]);
      }

      if (text.includes("set_config('app.user_id'")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT COUNT(*)::int AS active_card_count")) {
        assert.deepEqual(params, ["workspace-delete"]);
        return makeQueryResult<Row>([{ active_card_count: 0 }]);
      }

      if (text.includes("DELETE FROM org.workspaces WHERE workspace_id = $1")) {
        assert.deepEqual(params, ["workspace-delete"]);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT memberships.workspace_id")) {
        assert.deepEqual(params, ["user-1"]);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO org.user_settings (user_id) VALUES ($1)")) {
        assert.deepEqual(params, ["user-1"]);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO org.workspaces")) {
        const workspaceId = params[0];
        if (typeof workspaceId !== "string") {
          throw new Error("Expected created workspace id to be a string");
        }
        createdWorkspaceId = workspaceId;
        assert.equal(params[1], "Personal");
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO org.workspace_memberships")) {
        assert.equal(params[0], createdWorkspaceId);
        assert.equal(params[1], "user-1");
        return makeQueryResult<Row>([]);
      }

      if (text.includes("FROM org.workspaces WHERE workspace_id = $1")) {
        assert.equal(params[0], createdWorkspaceId);
        return makeQueryResult<Row>([{
          fsrs_algorithm: "fsrs-6",
          fsrs_desired_retention: 0.9,
          fsrs_learning_steps_minutes: [1, 10],
          fsrs_relearning_steps_minutes: [10],
          fsrs_maximum_interval_days: 36500,
          fsrs_enable_fuzz: true,
          fsrs_client_updated_at: "2026-03-16T10:00:00.000Z",
          fsrs_last_modified_by_device_id: "device-1",
          fsrs_last_operation_id: "bootstrap-workspace",
          fsrs_updated_at: "2026-03-16T10:00:00.000Z",
        }]);
      }

      if (text.includes("INSERT INTO sync.devices")) {
        assert.equal(params[1], createdWorkspaceId);
        assert.equal(params[2], "user-1");
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO sync.hot_changes")) {
        assert.equal(params[0], createdWorkspaceId);
        return makeQueryResult<Row>([{ change_id: 1 }]);
      }

      if (text.includes("UPDATE org.user_settings SET workspace_id")) {
        assert.equal(params[0], createdWorkspaceId);
        assert.equal(params[1], "user-1");
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at FROM org.workspace_memberships")) {
        assert.deepEqual(params, ["user-1", createdWorkspaceId]);
        return makeQueryResult<Row>([{
          workspace_id: createdWorkspaceId,
          name: "Personal",
          created_at: "2026-03-16T10:00:00.000Z",
        }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const response = await deleteWorkspaceInExecutor(
    executor,
    "user-1",
    "workspace-delete",
    deleteWorkspaceConfirmationText,
  );

  assert.ok(createdWorkspaceId !== null);
  assert.equal(response.workspace.workspaceId, createdWorkspaceId);
  assert.equal(response.workspace.name, "Personal");
  assert.equal(response.workspace.isSelected, true);
});

test("deleteWorkspaceInExecutor rejects an invalid confirmation phrase", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(): Promise<pg.QueryResult<Row>> {
      throw new Error("Query should not run");
    },
  };

  await assert.rejects(
    deleteWorkspaceInExecutor(executor, "user-1", "workspace-1", "wrong phrase"),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "WORKSPACE_DELETE_CONFIRMATION_INVALID",
  );
});

test("deleteWorkspaceInExecutor rejects deleting a shared workspace", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at, memberships.role")) {
        assert.deepEqual(params, ["user-1", "workspace-1"]);
        return makeQueryResult<Row>([{
          workspace_id: "workspace-1",
          name: "Shared workspace",
          created_at: "2026-03-16T09:00:00.000Z",
          role: "owner",
          member_count: 2,
        }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await assert.rejects(
    deleteWorkspaceInExecutor(executor, "user-1", "workspace-1", deleteWorkspaceConfirmationText),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "WORKSPACE_DELETE_SHARED",
  );
});

test("renameWorkspaceInExecutor rejects non-owner access", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at, memberships.role")) {
        assert.deepEqual(params, ["user-1", "workspace-1"]);
        return makeQueryResult<Row>([{
          workspace_id: "workspace-1",
          name: "Workspace",
          created_at: "2026-03-16T09:00:00.000Z",
          role: "viewer",
          member_count: 1,
        }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await assert.rejects(
    renameWorkspaceInExecutor(executor, "user-1", "workspace-1", "Next name", "workspace-1"),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "WORKSPACE_OWNER_REQUIRED",
  );
});

test("loadWorkspaceDeletePreviewInExecutor returns not found for an inaccessible workspace", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at, memberships.role")) {
        assert.deepEqual(params, ["user-1", "workspace-missing"]);
        return makeQueryResult<Row>([]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await assert.rejects(
    loadWorkspaceDeletePreviewInExecutor(executor, "user-1", "workspace-missing"),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "WORKSPACE_NOT_FOUND",
  );
});

test("setSelectedWorkspaceForApiKeyConnectionInExecutor rejects inaccessible non-null workspaces", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT workspace_id FROM org.workspace_memberships")) {
        assert.deepEqual(params, ["user-1", "workspace-missing"]);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("UPDATE auth.agent_api_keys")) {
        throw new Error("Update should not run when workspace access is missing");
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await assert.rejects(
    setSelectedWorkspaceForApiKeyConnectionInExecutor(
      executor,
      "user-1",
      "connection-1",
      "workspace-missing",
    ),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "WORKSPACE_NOT_FOUND",
  );
});

test("setSelectedWorkspaceForApiKeyConnectionInExecutor allows null selection without membership lookup", async () => {
  let updateRan = false;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("SELECT workspace_id FROM org.workspace_memberships")) {
        throw new Error("Membership lookup should not run for null selection");
      }

      if (text.includes("UPDATE auth.agent_api_keys")) {
        assert.deepEqual(params, [null, "user-1", "connection-1"]);
        updateRan = true;
        return makeQueryResult<Row>([{ connection_id: "connection-1" }]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  await setSelectedWorkspaceForApiKeyConnectionInExecutor(
    executor,
    "user-1",
    "connection-1",
    null,
  );

  assert.equal(updateRan, true);
});
