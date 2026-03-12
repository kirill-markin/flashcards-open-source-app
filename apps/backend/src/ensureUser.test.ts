import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "./db";
import { ensureUserProfileInExecutor } from "./ensureUser";

const lockedUserSettingsSelectSql = "SELECT workspace_id, email, locale, created_at FROM org.user_settings WHERE user_id = $1 FOR UPDATE";

function assertUserSettingsInsertParams(
  params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
  userId: string,
  email: string,
): void {
  assert.ok(
    (
      params.length === 2
      && params[0] === userId
      && params[1] === email
    )
    || (
      params.length === 1
      && params[0] === userId
    ),
  );
}

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

test("ensureUserProfileInExecutor auto-provisions workspace and scheduler seed when user has no memberships", async () => {
  let savedWorkspaceId: string | null = null;
  let syncChangeInsertCount = 0;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("INSERT INTO org.user_settings")) {
        assertUserSettingsInsertParams(params, "new-user", "new-user@example.com");
        return makeQueryResult<Row>([]);
      }

      if (text.includes(lockedUserSettingsSelectSql)) {
        return makeQueryResult<Row>([{
          workspace_id: null,
          email: "new-user@example.com",
          locale: "en",
          created_at: "2026-03-11T10:00:00.000Z",
        }]);
      }

      if (text.includes("SELECT memberships.workspace_id")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO org.workspaces")) {
        const bootstrapTimestamp = params[2];
        const bootstrapDeviceId = params[3];
        const bootstrapOperationId = params[4];
        if (typeof bootstrapTimestamp !== "string") {
          throw new Error("Expected bootstrap timestamp to be a string");
        }
        if (typeof bootstrapDeviceId !== "string") {
          throw new Error("Expected bootstrap device id to be a string");
        }
        if (typeof bootstrapOperationId !== "string") {
          throw new Error("Expected bootstrap operation id to be a string");
        }

        return makeQueryResult<Row>([{
          fsrs_algorithm: "fsrs-6",
          fsrs_desired_retention: 0.9,
          fsrs_learning_steps_minutes: [1, 10],
          fsrs_relearning_steps_minutes: [10],
          fsrs_maximum_interval_days: 36500,
          fsrs_enable_fuzz: true,
          fsrs_client_updated_at: bootstrapTimestamp,
          fsrs_last_modified_by_device_id: bootstrapDeviceId,
          fsrs_last_operation_id: bootstrapOperationId,
          fsrs_updated_at: "2026-03-11T10:00:00.000Z",
        }]);
      }

      if (
        text.includes("INSERT INTO sync.devices")
        || text.includes("INSERT INTO org.workspace_memberships")
      ) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO sync.changes")) {
        syncChangeInsertCount += 1;
        return makeQueryResult<Row>([{
          change_id: 1,
        }]);
      }

      if (text.includes("UPDATE org.user_settings SET workspace_id")) {
        const nextWorkspaceId = params[0];
        if (typeof nextWorkspaceId !== "string") {
          throw new Error("Expected selected workspace id to be a string");
        }
        savedWorkspaceId = nextWorkspaceId;
        return makeQueryResult<Row>([]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const profile = await ensureUserProfileInExecutor(executor, "new-user", "new-user@example.com");
  assert.ok(savedWorkspaceId !== null);
  assert.equal(profile.selectedWorkspaceId, savedWorkspaceId);
  assert.equal(profile.email, "new-user@example.com");
  assert.equal(syncChangeInsertCount, 1);
});

test("ensureUserProfileInExecutor repairs missing selected workspace with earliest accessible workspace", async () => {
  let updatedWorkspaceId: string | null = null;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("INSERT INTO org.user_settings")) {
        assertUserSettingsInsertParams(params, "existing-user", "existing@example.com");
        return makeQueryResult<Row>([]);
      }

      if (text.includes(lockedUserSettingsSelectSql)) {
        return makeQueryResult<Row>([{
          workspace_id: "missing-workspace",
          email: "existing@example.com",
          locale: "en",
          created_at: "2026-03-10T10:00:00.000Z",
        }]);
      }

      if (text.includes("SELECT memberships.workspace_id")) {
        return makeQueryResult<Row>([
          { workspace_id: "workspace-a" },
          { workspace_id: "workspace-b" },
        ]);
      }

      if (text.includes("UPDATE org.user_settings SET workspace_id")) {
        const nextWorkspaceId = params[0];
        if (typeof nextWorkspaceId !== "string") {
          throw new Error("Expected selected workspace id to be a string");
        }
        updatedWorkspaceId = nextWorkspaceId;
        return makeQueryResult<Row>([]);
      }

      if (
        text.includes("INSERT INTO org.workspaces")
        || text.includes("INSERT INTO sync.devices")
        || text.includes("INSERT INTO org.workspace_memberships")
        || text.includes("INSERT INTO sync.changes")
      ) {
        throw new Error("Workspace auto-provisioning should not run for users with existing memberships");
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const profile = await ensureUserProfileInExecutor(executor, "existing-user", "existing@example.com");
  assert.equal(updatedWorkspaceId, "workspace-a");
  assert.equal(profile.selectedWorkspaceId, "workspace-a");
  assert.equal(profile.email, "existing@example.com");
});

test("ensureUserProfileInExecutor keeps selected workspace when it is accessible", async () => {
  let selectionUpdates = 0;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("INSERT INTO org.user_settings")) {
        assertUserSettingsInsertParams(params, "selected-user", "selected@example.com");
        return makeQueryResult<Row>([]);
      }

      if (text.includes(lockedUserSettingsSelectSql)) {
        return makeQueryResult<Row>([{
          workspace_id: "workspace-b",
          email: "selected@example.com",
          locale: "en",
          created_at: "2026-03-10T10:00:00.000Z",
        }]);
      }

      if (text.includes("SELECT memberships.workspace_id")) {
        return makeQueryResult<Row>([
          { workspace_id: "workspace-a" },
          { workspace_id: "workspace-b" },
        ]);
      }

      if (text.includes("UPDATE org.user_settings SET workspace_id")) {
        selectionUpdates += 1;
        return makeQueryResult<Row>([]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const profile = await ensureUserProfileInExecutor(executor, "selected-user", "selected@example.com");
  assert.equal(profile.selectedWorkspaceId, "workspace-b");
  assert.equal(selectionUpdates, 0);
});

test("ensureUserProfileInExecutor reuses existing membership when selection is empty", async () => {
  let updatedWorkspaceId: string | null = null;

  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("INSERT INTO org.user_settings")) {
        assertUserSettingsInsertParams(params, "linked-user", "linked@example.com");
        return makeQueryResult<Row>([]);
      }

      if (text.includes(lockedUserSettingsSelectSql)) {
        return makeQueryResult<Row>([{
          workspace_id: null,
          email: "linked@example.com",
          locale: "en",
          created_at: "2026-03-10T10:00:00.000Z",
        }]);
      }

      if (text.includes("SELECT memberships.workspace_id")) {
        return makeQueryResult<Row>([
          { workspace_id: "workspace-existing" },
        ]);
      }

      if (text.includes("UPDATE org.user_settings SET workspace_id")) {
        const nextWorkspaceId = params[0];
        if (typeof nextWorkspaceId !== "string") {
          throw new Error("Expected selected workspace id to be a string");
        }
        updatedWorkspaceId = nextWorkspaceId;
        return makeQueryResult<Row>([]);
      }

      if (
        text.includes("INSERT INTO org.workspaces")
        || text.includes("INSERT INTO sync.devices")
        || text.includes("INSERT INTO org.workspace_memberships")
        || text.includes("INSERT INTO sync.changes")
      ) {
        throw new Error("Workspace auto-provisioning should not run when a membership already exists");
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const profile = await ensureUserProfileInExecutor(executor, "linked-user", "linked@example.com");
  assert.equal(updatedWorkspaceId, "workspace-existing");
  assert.equal(profile.selectedWorkspaceId, "workspace-existing");
  assert.equal(profile.email, "linked@example.com");
});

test("ensureUserProfileInExecutor keeps existing non-null email value", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("INSERT INTO org.user_settings")) {
        assertUserSettingsInsertParams(params, "stable-user", "new@example.com");
        return makeQueryResult<Row>([]);
      }

      if (text.includes(lockedUserSettingsSelectSql)) {
        return makeQueryResult<Row>([{
          workspace_id: "workspace-stable",
          email: "stable@example.com",
          locale: "en",
          created_at: "2026-03-10T10:00:00.000Z",
        }]);
      }

      if (text.includes("SELECT memberships.workspace_id")) {
        return makeQueryResult<Row>([
          { workspace_id: "workspace-stable" },
        ]);
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    },
  };

  const profile = await ensureUserProfileInExecutor(executor, "stable-user", "new@example.com");
  assert.equal(profile.email, "stable@example.com");
});
