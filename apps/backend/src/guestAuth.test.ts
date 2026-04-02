import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "./db";
import { completeGuestUpgradeInExecutor } from "./guestAuth";

type GuestSessionState = Readonly<{
  session_id: string;
  session_secret_hash: string;
  user_id: string;
  revoked_at: string | null;
}>;

type UserSettingsState = Readonly<{
  user_id: string;
  workspace_id: string | null;
}>;

type WorkspaceState = Readonly<{
  workspace_id: string;
  name: string;
  created_at: string;
  fsrs_algorithm: string;
  fsrs_desired_retention: number;
  fsrs_learning_steps_minutes: ReadonlyArray<number>;
  fsrs_relearning_steps_minutes: ReadonlyArray<number>;
  fsrs_maximum_interval_days: number;
  fsrs_enable_fuzz: boolean;
  fsrs_client_updated_at: string;
  fsrs_last_modified_by_replica_id: string;
  fsrs_last_operation_id: string;
  fsrs_updated_at: string;
}>;

type WorkspaceReplicaState = Readonly<{
  replica_id: string;
  workspace_id: string;
  user_id: string;
  actor_kind: "client_installation" | "workspace_seed" | "agent_connection" | "ai_chat";
  installation_id: string | null;
  actor_key: string | null;
  platform: "ios" | "android" | "web" | "system";
  app_version: string | null;
  created_at: string;
  last_seen_at: string;
}>;

type InstallationState = Readonly<{
  installation_id: string;
  user_id: string;
  platform: "ios" | "android" | "web";
  app_version: string | null;
}>;

type GuestUpgradeHistoryState = Readonly<{
  upgrade_id: string;
  source_guest_user_id: string;
  source_guest_workspace_id: string;
  source_guest_session_id: string;
  target_subject_user_id: string;
  target_user_id: string;
  target_workspace_id: string;
  selection_type: string;
}>;

type GuestReplicaAliasState = Readonly<{
  source_guest_replica_id: string;
  upgrade_id: string;
  target_replica_id: string;
}>;

type MutableState = {
  currentUserId: string | null;
  currentWorkspaceId: string | null;
  guestSession: GuestSessionState;
  identityMappings: Map<string, string>;
  userSettings: Map<string, UserSettingsState>;
  workspaces: Map<string, WorkspaceState>;
  workspaceMemberships: Set<string>;
  workspaceReplicas: Array<WorkspaceReplicaState>;
  installations: Map<string, InstallationState>;
  guestUpgradeHistory: Array<GuestUpgradeHistoryState>;
  guestReplicaAliases: Array<GuestReplicaAliasState>;
};

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function membershipKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}

function hashGuestToken(guestToken: string): string {
  return createHash("sha256").update(guestToken, "utf8").digest("hex");
}

function createGuestUpgradeExecutor(state: MutableState): DatabaseExecutor {
  return {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string>>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        state.currentUserId = typeof params[0] === "string" ? params[0] : null;
        state.currentWorkspaceId = typeof params[1] === "string" && params[1] !== "" ? params[1] : null;
        return createQueryResult<Row>([]);
      }

      if (text.includes("FROM auth.guest_sessions")) {
        const requestedHash = params[0];
        const guestSession = state.guestSession;
        const rows = requestedHash === guestSession.session_secret_hash ? [{
          session_id: guestSession.session_id,
          user_id: guestSession.user_id,
          revoked_at: guestSession.revoked_at,
        } as unknown as Row] : [];
        return createQueryResult<Row>(rows);
      }

      if (text.includes("FROM auth.user_identities")) {
        const providerSubject = params[0];
        const mappedUserId = typeof providerSubject === "string"
          ? state.identityMappings.get(providerSubject) ?? null
          : null;
        const rows = mappedUserId === null ? [] : [{ user_id: mappedUserId } as unknown as Row];
        return createQueryResult<Row>(rows);
      }

      if (text.includes("SELECT workspace_id FROM org.user_settings")) {
        const userId = params[0];
        const row = typeof userId === "string" ? state.userSettings.get(userId) ?? null : null;
        const rows = row === null ? [] : [{ workspace_id: row.workspace_id } as unknown as Row];
        return createQueryResult<Row>(rows);
      }

      if (text.includes("FROM org.workspaces AS workspaces")) {
        const userId = params[0];
        const workspaceId = params[1];
        if (typeof userId !== "string" || typeof workspaceId !== "string") {
          return createQueryResult<Row>([]);
        }

        if (!state.workspaceMemberships.has(membershipKey(userId, workspaceId))) {
          return createQueryResult<Row>([]);
        }

        const workspace = state.workspaces.get(workspaceId);
        const rows = workspace === undefined ? [] : [{
          workspace_id: workspace.workspace_id,
          name: workspace.name,
          created_at: workspace.created_at,
        } as unknown as Row];
        return createQueryResult<Row>(rows);
      }

      if (text.includes("FROM sync.workspace_replicas")) {
        const workspaceId = params[0];
        const rows = typeof workspaceId !== "string"
          ? []
          : state.workspaceReplicas
            .filter((replica) => replica.workspace_id === workspaceId)
            .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.replica_id.localeCompare(right.replica_id))
            .map((replica) => ({ ...replica } as unknown as Row));
        return createQueryResult<Row>(rows);
      }

      if (
        text.includes("FROM content.cards")
        || text.includes("FROM content.decks")
        || text.includes("FROM content.review_events")
      ) {
        return createQueryResult<Row>([]);
      }

      if (text.includes("FROM org.workspaces") && text.includes("fsrs_algorithm")) {
        const workspaceId = params[0];
        const workspace = typeof workspaceId === "string" ? state.workspaces.get(workspaceId) : undefined;
        const rows = workspace === undefined ? [] : [{
          fsrs_algorithm: workspace.fsrs_algorithm,
          fsrs_desired_retention: workspace.fsrs_desired_retention,
          fsrs_learning_steps_minutes: workspace.fsrs_learning_steps_minutes,
          fsrs_relearning_steps_minutes: workspace.fsrs_relearning_steps_minutes,
          fsrs_maximum_interval_days: workspace.fsrs_maximum_interval_days,
          fsrs_enable_fuzz: workspace.fsrs_enable_fuzz,
          fsrs_client_updated_at: workspace.fsrs_client_updated_at,
          fsrs_last_modified_by_replica_id: workspace.fsrs_last_modified_by_replica_id,
          fsrs_last_operation_id: workspace.fsrs_last_operation_id,
          fsrs_updated_at: workspace.fsrs_updated_at,
        } as unknown as Row];
        return createQueryResult<Row>(rows);
      }

      if (
        text === "DELETE FROM content.decks WHERE workspace_id = $1"
        || text === "DELETE FROM content.cards WHERE workspace_id = $1"
      ) {
        return createQueryResult<Row>([]);
      }

      if (text.includes("FROM sync.claim_installation")) {
        const installationId = params[0];
        const expectedPlatform = params[1];
        const targetUserId = params[2];
        const nextAppVersion = params[3];

        if (
          typeof installationId !== "string"
          || typeof expectedPlatform !== "string"
          || typeof targetUserId !== "string"
        ) {
          throw new Error("Invalid sync.claim_installation arguments");
        }

        const installation = state.installations.get(installationId);
        if (installation === undefined) {
          throw new Error("Expected installation row to exist for guest merge test");
        }

        if (installation.platform !== expectedPlatform) {
          return createQueryResult<Row>([{
            claim_status: "platform_mismatch",
            installation_id: installation.installation_id,
            platform: installation.platform,
            previous_user_id: installation.user_id,
            current_user_id: installation.user_id,
          } as unknown as Row]);
        }

        const claimStatus = installation.user_id === targetUserId ? "refreshed" : "reassigned";
        state.installations.set(installationId, {
          installation_id: installation.installation_id,
          user_id: targetUserId,
          platform: installation.platform,
          app_version: typeof nextAppVersion === "string" ? nextAppVersion : null,
        });

        return createQueryResult<Row>([{
          claim_status: claimStatus,
          installation_id: installation.installation_id,
          platform: installation.platform,
          previous_user_id: installation.user_id,
          current_user_id: targetUserId,
        } as unknown as Row]);
      }

      if (text.includes("INSERT INTO sync.workspace_replicas")) {
        const existingReplica = state.workspaceReplicas.find((replica) => replica.replica_id === params[0]);
        if (existingReplica !== undefined) {
          return createQueryResult<Row>([]);
        }

        const nextReplica: WorkspaceReplicaState = {
          replica_id: String(params[0]),
          workspace_id: String(params[1]),
          user_id: String(params[2]),
          actor_kind: String(params[3]) as WorkspaceReplicaState["actor_kind"],
          installation_id: params[4] === null ? null : String(params[4]),
          actor_key: params[5] === null ? null : String(params[5]),
          platform: String(params[6]) as WorkspaceReplicaState["platform"],
          app_version: params[7] === null ? null : String(params[7]),
          created_at: "2026-04-02T14:01:15.000Z",
          last_seen_at: "2026-04-02T14:01:15.000Z",
        };
        state.workspaceReplicas.push(nextReplica);
        return createQueryResult<Row>([{
          replica_id: nextReplica.replica_id,
          platform: nextReplica.platform,
        } as unknown as Row]);
      }

      if (text.includes("UPDATE sync.workspace_replicas")) {
        return createQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO auth.guest_upgrade_history")) {
        state.guestUpgradeHistory.push({
          upgrade_id: String(params[0]),
          source_guest_user_id: String(params[1]),
          source_guest_workspace_id: String(params[2]),
          source_guest_session_id: String(params[3]),
          target_subject_user_id: String(params[4]),
          target_user_id: String(params[5]),
          target_workspace_id: String(params[6]),
          selection_type: String(params[7]),
        });
        return createQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO auth.guest_replica_aliases")) {
        state.guestReplicaAliases.push({
          source_guest_replica_id: String(params[0]),
          upgrade_id: String(params[1]),
          target_replica_id: String(params[2]),
        });
        return createQueryResult<Row>([]);
      }

      if (text === "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2") {
        const workspaceId = String(params[0]);
        const userId = String(params[1]);
        state.userSettings.set(userId, {
          user_id: userId,
          workspace_id: workspaceId,
        });
        return createQueryResult<Row>([]);
      }

      if (text === "UPDATE auth.guest_sessions SET revoked_at = now() WHERE session_id = $1") {
        state.guestSession = {
          ...state.guestSession,
          revoked_at: "2026-04-02T14:01:16.000Z",
        };
        return createQueryResult<Row>([]);
      }

      if (text === "DELETE FROM org.workspaces WHERE workspace_id = $1") {
        const workspaceId = String(params[0]);
        state.workspaces.delete(workspaceId);
        state.workspaceReplicas = state.workspaceReplicas.filter((replica) => replica.workspace_id !== workspaceId);
        state.workspaceMemberships = new Set(
          [...state.workspaceMemberships].filter((value) => !value.endsWith(`:${workspaceId}`)),
        );
        return createQueryResult<Row>([]);
      }

      if (text === "DELETE FROM org.user_settings WHERE user_id = $1") {
        state.userSettings.delete(String(params[0]));
        return createQueryResult<Row>([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

test("completeGuestUpgradeInExecutor reassigns guest installation ownership during merge", async () => {
  const guestToken = "guest-token-1";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-1";
  const targetSubject = "cognito-subject-1";

  const state: MutableState = {
    currentUserId: null,
    currentWorkspaceId: null,
    guestSession: {
      session_id: "guest-session-1",
      session_secret_hash: hashGuestToken(guestToken),
      user_id: guestUserId,
      revoked_at: null,
    },
    identityMappings: new Map<string, string>([[targetSubject, targetUserId]]),
    userSettings: new Map<string, UserSettingsState>([
      [guestUserId, { user_id: guestUserId, workspace_id: guestWorkspaceId }],
      [targetUserId, { user_id: targetUserId, workspace_id: targetWorkspaceId }],
    ]),
    workspaces: new Map<string, WorkspaceState>([
      [guestWorkspaceId, {
        workspace_id: guestWorkspaceId,
        name: "Guest workspace",
        created_at: "2026-04-02T14:00:00.000Z",
        fsrs_algorithm: "fsrs-6",
        fsrs_desired_retention: 0.9,
        fsrs_learning_steps_minutes: [1, 10],
        fsrs_relearning_steps_minutes: [10],
        fsrs_maximum_interval_days: 36500,
        fsrs_enable_fuzz: true,
        fsrs_client_updated_at: "2026-04-02T14:00:00.000Z",
        fsrs_last_modified_by_replica_id: guestReplicaId,
        fsrs_last_operation_id: "guest-op",
        fsrs_updated_at: "2026-04-02T14:00:00.000Z",
      }],
      [targetWorkspaceId, {
        workspace_id: targetWorkspaceId,
        name: "Target workspace",
        created_at: "2026-04-02T13:00:00.000Z",
        fsrs_algorithm: "fsrs-6",
        fsrs_desired_retention: 0.9,
        fsrs_learning_steps_minutes: [1, 10],
        fsrs_relearning_steps_minutes: [10],
        fsrs_maximum_interval_days: 36500,
        fsrs_enable_fuzz: true,
        fsrs_client_updated_at: "2026-04-02T14:05:00.000Z",
        fsrs_last_modified_by_replica_id: "target-replica-existing",
        fsrs_last_operation_id: "target-op",
        fsrs_updated_at: "2026-04-02T14:05:00.000Z",
      }],
    ]),
    workspaceMemberships: new Set<string>([
      membershipKey(guestUserId, guestWorkspaceId),
      membershipKey(targetUserId, targetWorkspaceId),
    ]),
    workspaceReplicas: [{
      replica_id: guestReplicaId,
      workspace_id: guestWorkspaceId,
      user_id: guestUserId,
      actor_kind: "client_installation",
      installation_id: installationId,
      actor_key: null,
      platform: "ios",
      app_version: "1.2.3",
      created_at: "2026-04-02T14:00:01.000Z",
      last_seen_at: "2026-04-02T14:01:09.591Z",
    }],
    installations: new Map<string, InstallationState>([[
      installationId,
      {
        installation_id: installationId,
        user_id: guestUserId,
        platform: "ios",
        app_version: "1.2.3",
      },
    ]]),
    guestUpgradeHistory: [],
    guestReplicaAliases: [],
  };

  const executor = createGuestUpgradeExecutor(state);
  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
  );

  assert.equal(result.workspace.workspaceId, targetWorkspaceId);
  assert.equal(state.installations.get(installationId)?.user_id, targetUserId);
  assert.equal(state.userSettings.get(targetUserId)?.workspace_id, targetWorkspaceId);
  assert.equal(state.userSettings.has(guestUserId), false);
  assert.equal(state.workspaces.has(guestWorkspaceId), false);
  assert.equal(state.guestSession.revoked_at, "2026-04-02T14:01:16.000Z");
  assert.equal(state.guestUpgradeHistory.length, 1);
  assert.equal(state.guestReplicaAliases.length, 1);
  assert.equal(state.guestReplicaAliases[0]?.source_guest_replica_id, guestReplicaId);

  const targetReplica = state.workspaceReplicas.find((replica) => (
    replica.workspace_id === targetWorkspaceId
    && replica.installation_id === installationId
  ));
  assert.ok(targetReplica);
  assert.equal(targetReplica?.user_id, targetUserId);
});
