import assert from "node:assert/strict";
import type pg from "pg";
import type { DatabaseExecutor } from "../db";
import { handleAuthExecutorQuery } from "./handlers/auth";
import { handleContentExecutorQuery } from "./handlers/content";
import { handleSyncExecutorQuery } from "./handlers/sync";
import { handleUserSettingsExecutorQuery } from "./handlers/userSettings";
import { handleWorkspaceExecutorQuery } from "./handlers/workspaces";
import {
  type GuestUpgradeExecutorParam,
  type GuestUpgradeHandlerContext,
  type MutableState,
} from "./models";
import { createQueryResult } from "./queryResult";

function handleExecutorScopeQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  const { state } = context;

  if (!text.includes("set_config('app.user_id'")) {
    return null;
  }

  state.currentUserId = typeof params[0] === "string" ? params[0] : null;
  state.currentWorkspaceId = typeof params[1] === "string" && params[1] !== "" ? params[1] : null;
  return createQueryResult<Row>([]);
}

export function createGuestUpgradeExecutor(state: MutableState): DatabaseExecutor {
  function requireCurrentUserScope(userId: string): void {
    assert.equal(
      state.currentUserId,
      userId,
      `Expected app.user_id scope ${userId}, got ${state.currentUserId ?? "null"}`,
    );
  }

  function requireCurrentWorkspaceScope(userId: string, workspaceId: string): void {
    requireCurrentUserScope(userId);
    assert.equal(
      state.currentWorkspaceId,
      workspaceId,
      `Expected app.workspace_id scope ${workspaceId}, got ${state.currentWorkspaceId ?? "null"}`,
    );
  }

  const context: GuestUpgradeHandlerContext = {
    state,
    scope: {
      requireCurrentUserScope,
      requireCurrentWorkspaceScope,
    },
  };

  return {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<GuestUpgradeExecutorParam>,
    ): Promise<pg.QueryResult<Row>> {
      const scopeResult = handleExecutorScopeQuery<Row>(context, text, params);
      if (scopeResult !== null) {
        return scopeResult;
      }

      const authResult = handleAuthExecutorQuery<Row>(context, text, params);
      if (authResult !== null) {
        return authResult;
      }

      const userSettingsResult = handleUserSettingsExecutorQuery<Row>(context, text, params);
      if (userSettingsResult !== null) {
        return userSettingsResult;
      }

      const workspaceResult = handleWorkspaceExecutorQuery<Row>(context, text, params);
      if (workspaceResult !== null) {
        return workspaceResult;
      }

      const syncResult = handleSyncExecutorQuery<Row>(context, text, params);
      if (syncResult !== null) {
        return syncResult;
      }

      const contentResult = handleContentExecutorQuery<Row>(context, text, params);
      if (contentResult !== null) {
        return contentResult;
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

export function isGuestUpgradeMergeOnlyExecutorQuery(text: string): boolean {
  return text.includes("FROM sync.claim_installation")
    || (text.startsWith("SELECT") && text.includes("FROM sync.workspace_replicas"))
    || text.includes("INSERT INTO sync.workspace_replicas")
    || text.includes("UPDATE sync.workspace_replicas")
    || text.includes("INSERT INTO auth.guest_upgrade_history")
    || text.includes("INSERT INTO auth.guest_replica_aliases")
    || text === "UPDATE auth.guest_sessions SET revoked_at = now() WHERE session_id = $1"
    || text === "SELECT workspace_id FROM sync.find_conflicting_workspace_id($1, $2) LIMIT 1"
    || text.includes("FROM sync.hot_changes")
    || text.includes("INSERT INTO sync.hot_changes")
    || text.startsWith("DELETE FROM content.")
    || text.startsWith("INSERT INTO content.")
    || text.startsWith("UPDATE content.")
    || text.startsWith("DELETE FROM org.workspaces")
    || text === "DELETE FROM org.user_settings WHERE user_id = $1"
    || text
      === "INSERT INTO org.workspaces ( workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id ) VALUES ($1, $2, $3, $4, $5)"
    || text === "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')"
    || text
      === "INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at) VALUES ($1, 0, now()) ON CONFLICT (workspace_id) DO NOTHING"
    || text === "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2"
    || text.startsWith("UPDATE org.workspaces SET");
}
