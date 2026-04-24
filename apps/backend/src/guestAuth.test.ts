import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "./db";
import {
  completeGuestUpgradeInExecutor,
  deleteGuestSessionInExecutor,
  prepareGuestUpgradeInExecutor,
} from "./guestAuth";
import { cleanupGuestSessionSourceInExecutor } from "./guestAuth/delete";
import { HttpError } from "./errors";
import {
  forkCardIdForWorkspace,
  forkDeckIdForWorkspace,
  forkReviewEventIdForWorkspace,
} from "./sync/fork";

type GuestSessionState = Readonly<{
  session_id: string;
  session_secret_hash: string;
  user_id: string;
  revoked_at: string | null;
}>;

type UserSettingsState = Readonly<{
  user_id: string;
  workspace_id: string | null;
  email: string | null;
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
  actor_kind: "client_installation" | "workspace_seed" | "workspace_reset" | "agent_connection" | "ai_chat";
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

type CardState = Readonly<{
  card_id: string;
  workspace_id: string;
  front_text: string;
  back_text: string;
  tags: ReadonlyArray<string>;
  effort_level: string;
  due_at: string | null;
  created_at: string;
  reps: number;
  lapses: number;
  fsrs_card_state: string;
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: string | null;
  fsrs_scheduled_days: number | null;
  client_updated_at: string;
  last_modified_by_replica_id: string;
  last_operation_id: string;
  updated_at: string;
  deleted_at: string | null;
}>;

type DeckState = Readonly<{
  deck_id: string;
  workspace_id: string;
  name: string;
  filter_definition: Readonly<Record<string, unknown>>;
  created_at: string;
  client_updated_at: string;
  last_modified_by_replica_id: string;
  last_operation_id: string;
  updated_at: string;
  deleted_at: string | null;
}>;

type ReviewEventState = Readonly<{
  review_event_id: string;
  workspace_id: string;
  card_id: string;
  replica_id: string;
  client_event_id: string;
  rating: number;
  reviewed_at_client: string;
  reviewed_at_server: string;
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
  nextHotChangeId: number;
  guestSession: GuestSessionState;
  identityMappings: Map<string, string>;
  userSettings: Map<string, UserSettingsState>;
  workspaces: Map<string, WorkspaceState>;
  workspaceMemberships: Set<string>;
  workspaceReplicas: Array<WorkspaceReplicaState>;
  installations: Map<string, InstallationState>;
  cards: Array<CardState>;
  decks: Array<DeckState>;
  reviewEvents: Array<ReviewEventState>;
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

function createUserSettingsState(userId: string, workspaceId: string | null, email: string | null): UserSettingsState {
  return {
    user_id: userId,
    workspace_id: workspaceId,
    email,
  };
}

function createWorkspaceState(
  workspaceId: string,
  name: string,
  createdAt: string,
  clientUpdatedAt: string,
  lastModifiedByReplicaId: string,
  lastOperationId: string,
): WorkspaceState {
  return {
    workspace_id: workspaceId,
    name,
    created_at: createdAt,
    fsrs_algorithm: "fsrs-6",
    fsrs_desired_retention: 0.9,
    fsrs_learning_steps_minutes: [1, 10],
    fsrs_relearning_steps_minutes: [10],
    fsrs_maximum_interval_days: 36500,
    fsrs_enable_fuzz: true,
    fsrs_client_updated_at: clientUpdatedAt,
    fsrs_last_modified_by_replica_id: lastModifiedByReplicaId,
    fsrs_last_operation_id: lastOperationId,
    fsrs_updated_at: clientUpdatedAt,
  };
}

function createMergeState(params: Readonly<{
  guestToken: string;
  guestSessionId: string;
  guestUserId: string;
  guestWorkspaceId: string;
  targetSubject: string;
  targetUserId: string;
  targetWorkspaceId: string;
  guestReplicaId: string;
  installationId: string;
  guestSchedulerUpdatedAt: string;
  targetSchedulerUpdatedAt: string;
}>): MutableState {
  return {
    currentUserId: null,
    currentWorkspaceId: null,
    nextHotChangeId: 1,
    guestSession: {
      session_id: params.guestSessionId,
      session_secret_hash: hashGuestToken(params.guestToken),
      user_id: params.guestUserId,
      revoked_at: null,
    },
    identityMappings: new Map<string, string>([[params.targetSubject, params.targetUserId]]),
    userSettings: new Map<string, UserSettingsState>([
      [params.guestUserId, createUserSettingsState(params.guestUserId, params.guestWorkspaceId, null)],
      [params.targetUserId, createUserSettingsState(params.targetUserId, params.targetWorkspaceId, null)],
    ]),
    workspaces: new Map<string, WorkspaceState>([
      [params.guestWorkspaceId, createWorkspaceState(
        params.guestWorkspaceId,
        "Guest workspace",
        "2026-04-02T14:00:00.000Z",
        params.guestSchedulerUpdatedAt,
        params.guestReplicaId,
        "guest-op",
      )],
      [params.targetWorkspaceId, createWorkspaceState(
        params.targetWorkspaceId,
        "Target workspace",
        "2026-04-02T13:00:00.000Z",
        params.targetSchedulerUpdatedAt,
        "target-replica-existing",
        "target-op",
      )],
    ]),
    workspaceMemberships: new Set<string>([
      membershipKey(params.guestUserId, params.guestWorkspaceId),
      membershipKey(params.targetUserId, params.targetWorkspaceId),
    ]),
    workspaceReplicas: [{
      replica_id: params.guestReplicaId,
      workspace_id: params.guestWorkspaceId,
      user_id: params.guestUserId,
      actor_kind: "client_installation",
      installation_id: params.installationId,
      actor_key: null,
      platform: "ios",
      app_version: "1.2.3",
      created_at: "2026-04-02T14:00:01.000Z",
      last_seen_at: "2026-04-02T14:01:09.591Z",
    }],
    installations: new Map<string, InstallationState>([[
      params.installationId,
      {
        installation_id: params.installationId,
        user_id: params.guestUserId,
        platform: "ios",
        app_version: "1.2.3",
      },
    ]]),
    cards: [],
    decks: [],
    reviewEvents: [],
    guestUpgradeHistory: [],
    guestReplicaAliases: [],
  };
}

function createGuestUpgradeExecutor(state: MutableState): DatabaseExecutor {
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

      if (
        text.includes("FROM auth.guest_upgrade_history")
        && text.includes("WHERE source_guest_session_id = $1")
      ) {
        const guestSessionId = params[0];
        const guestUpgradeHistory = typeof guestSessionId === "string"
          ? state.guestUpgradeHistory.find((row) => row.source_guest_session_id === guestSessionId)
          : undefined;
        const rows = guestUpgradeHistory === undefined ? [] : [{
          target_subject_user_id: guestUpgradeHistory.target_subject_user_id,
          target_user_id: guestUpgradeHistory.target_user_id,
          target_workspace_id: guestUpgradeHistory.target_workspace_id,
        } as unknown as Row];
        return createQueryResult<Row>(rows);
      }

      if (text.includes("FROM auth.user_identities") && text.includes("provider_subject = $1")) {
        const providerSubject = params[0];
        const mappedUserId = typeof providerSubject === "string"
          ? state.identityMappings.get(providerSubject) ?? null
          : null;
        const rows = mappedUserId === null ? [] : [{ user_id: mappedUserId } as unknown as Row];
        return createQueryResult<Row>(rows);
      }

      if (text.includes("FROM auth.user_identities") && text.includes("user_id = $1")) {
        const userId = params[0];
        const hasMapping = typeof userId === "string"
          ? [...state.identityMappings.values()].some((mappedUserId) => mappedUserId === userId)
          : false;
        const rows = hasMapping ? [{ user_id: String(userId) } as unknown as Row] : [];
        return createQueryResult<Row>(rows);
      }

      if (text.includes("INSERT INTO auth.user_identities")) {
        const providerSubject = String(params[0]);
        const userId = String(params[1]);
        if (!state.identityMappings.has(providerSubject)) {
          state.identityMappings.set(providerSubject, userId);
        }
        return createQueryResult<Row>([]);
      }

      if (text === "INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING") {
        const userId = String(params[0]);
        requireCurrentUserScope(userId);
        if (!state.userSettings.has(userId)) {
          state.userSettings.set(userId, createUserSettingsState(userId, null, null));
        }
        return createQueryResult<Row>([]);
      }

      if (text === "SELECT workspace_id FROM org.user_settings WHERE user_id = $1 FOR UPDATE") {
        const userId = params[0];
        const row = typeof userId === "string" ? state.userSettings.get(userId) ?? null : null;
        const rows = row === null ? [] : [{ workspace_id: row.workspace_id } as unknown as Row];
        return createQueryResult<Row>(rows);
      }

      if (text === "UPDATE org.user_settings SET email = $1 WHERE user_id = $2") {
        const email = params[0] === null ? null : String(params[0]);
        const userId = String(params[1]);
        requireCurrentUserScope(userId);
        const current = state.userSettings.get(userId);
        if (current === undefined) {
          throw new Error(`Missing user_settings row for ${userId}`);
        }
        state.userSettings.set(userId, {
          ...current,
          email,
        });
        return createQueryResult<Row>([]);
      }

      if (text === "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2") {
        const workspaceId = String(params[0]);
        const userId = String(params[1]);
        requireCurrentUserScope(userId);
        const current = state.userSettings.get(userId) ?? createUserSettingsState(userId, null, null);
        state.userSettings.set(userId, {
          ...current,
          workspace_id: workspaceId,
        });
        return createQueryResult<Row>([]);
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

      if (
        text.includes("FROM org.workspace_memberships memberships")
        && text.includes("memberships.role")
        && text.includes("AS member_count")
      ) {
        const userId = params[0];
        const workspaceId = params[1];
        if (typeof userId !== "string" || typeof workspaceId !== "string") {
          return createQueryResult<Row>([]);
        }

        if (state.currentUserId !== userId) {
          return createQueryResult<Row>([]);
        }

        if (!state.workspaceMemberships.has(membershipKey(userId, workspaceId))) {
          return createQueryResult<Row>([]);
        }

        const workspace = state.workspaces.get(workspaceId);
        const memberCount = [...state.workspaceMemberships]
          .filter((membership) => membership.endsWith(`:${workspaceId}`))
          .length;
        const rows = workspace === undefined ? [] : [{
          workspace_id: workspace.workspace_id,
          name: workspace.name,
          created_at: workspace.created_at,
          role: "owner",
          member_count: memberCount,
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

      if (text.includes("FROM content.cards")) {
        const workspaceId = params[0];
        const rows = typeof workspaceId !== "string"
          ? []
          : state.cards
            .filter((card) => card.workspace_id === workspaceId)
            .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.card_id.localeCompare(right.card_id))
            .map((card) => ({
              card_id: card.card_id,
              front_text: card.front_text,
              back_text: card.back_text,
              tags: card.tags,
              effort_level: card.effort_level,
              due_at: card.due_at,
              created_at: card.created_at,
              reps: card.reps,
              lapses: card.lapses,
              fsrs_card_state: card.fsrs_card_state,
              fsrs_step_index: card.fsrs_step_index,
              fsrs_stability: card.fsrs_stability,
              fsrs_difficulty: card.fsrs_difficulty,
              fsrs_last_reviewed_at: card.fsrs_last_reviewed_at,
              fsrs_scheduled_days: card.fsrs_scheduled_days,
              client_updated_at: card.client_updated_at,
              last_modified_by_replica_id: card.last_modified_by_replica_id,
              last_operation_id: card.last_operation_id,
              updated_at: card.updated_at,
              deleted_at: card.deleted_at,
            } as unknown as Row));
        return createQueryResult<Row>(rows);
      }

      if (text.includes("FROM content.decks")) {
        const workspaceId = params[0];
        const rows = typeof workspaceId !== "string"
          ? []
          : state.decks
            .filter((deck) => deck.workspace_id === workspaceId)
            .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.deck_id.localeCompare(right.deck_id))
            .map((deck) => ({
              deck_id: deck.deck_id,
              name: deck.name,
              filter_definition: deck.filter_definition,
              created_at: deck.created_at,
              client_updated_at: deck.client_updated_at,
              last_modified_by_replica_id: deck.last_modified_by_replica_id,
              last_operation_id: deck.last_operation_id,
              updated_at: deck.updated_at,
              deleted_at: deck.deleted_at,
            } as unknown as Row));
        return createQueryResult<Row>(rows);
      }

      if (text.includes("FROM content.review_events")) {
        const workspaceId = params[0];
        const rows = typeof workspaceId !== "string"
          ? []
          : state.reviewEvents
            .filter((reviewEvent) => reviewEvent.workspace_id === workspaceId)
            .sort((left, right) => left.reviewed_at_server.localeCompare(right.reviewed_at_server) || left.review_event_id.localeCompare(right.review_event_id))
            .map((reviewEvent) => ({
              review_event_id: reviewEvent.review_event_id,
              card_id: reviewEvent.card_id,
              replica_id: reviewEvent.replica_id,
              client_event_id: reviewEvent.client_event_id,
              rating: reviewEvent.rating,
              reviewed_at_client: reviewEvent.reviewed_at_client,
              reviewed_at_server: reviewEvent.reviewed_at_server,
            } as unknown as Row));
        return createQueryResult<Row>(rows);
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
        const workspaceId = String(params[0]);
        if (text.includes("content.decks")) {
          state.decks = state.decks.filter((deck) => deck.workspace_id !== workspaceId);
        } else {
          state.cards = state.cards.filter((card) => card.workspace_id !== workspaceId);
        }
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
        const replicaWorkspaceId = String(params[1]);
        const replicaUserId = String(params[2]);
        requireCurrentWorkspaceScope(replicaUserId, replicaWorkspaceId);
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
        const replicaId = String(params[0]);
        const workspaceId = String(params[1]);
        const userId = String(params[2]);
        requireCurrentWorkspaceScope(userId, workspaceId);
        const actorKind = String(params[3]);
        const installationId = params[4] === null ? null : String(params[4]);
        const actorKey = params[5] === null ? null : String(params[5]);
        const platform = String(params[6]);
        const appVersion = params[7] === null ? null : String(params[7]);
        const index = state.workspaceReplicas.findIndex((replica) => (
          replica.replica_id === replicaId
          && replica.workspace_id === workspaceId
          && replica.actor_kind === actorKind
          && replica.installation_id === installationId
          && replica.actor_key === actorKey
          && replica.platform === platform
        ));
        if (index === -1) {
          return createQueryResult<Row>([]);
        }

        const current = state.workspaceReplicas[index];
        if (current === undefined) {
          return createQueryResult<Row>([]);
        }

        state.workspaceReplicas[index] = {
          ...current,
          user_id: userId,
          app_version: appVersion,
          last_seen_at: "2026-04-02T14:01:16.000Z",
        };
        return createQueryResult<Row>([{
          replica_id: replicaId,
          platform,
        } as unknown as Row]);
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
        state.cards = state.cards.filter((card) => card.workspace_id !== workspaceId);
        state.decks = state.decks.filter((deck) => deck.workspace_id !== workspaceId);
        state.reviewEvents = state.reviewEvents.filter((reviewEvent) => reviewEvent.workspace_id !== workspaceId);
        return createQueryResult<Row>([]);
      }

      if (text === "DELETE FROM org.user_settings WHERE user_id = $1") {
        state.userSettings.delete(String(params[0]));
        return createQueryResult<Row>([]);
      }

      if (
        text
          === "INSERT INTO org.workspaces ( workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id ) VALUES ($1, $2, $3, $4, $5)"
      ) {
        const workspaceId = String(params[0]);
        const name = String(params[1]);
        const bootstrapTimestamp = String(params[2]);
        const bootstrapReplicaId = String(params[3]);
        const bootstrapOperationId = String(params[4]);
        state.workspaces.set(workspaceId, {
          workspace_id: workspaceId,
          name,
          created_at: bootstrapTimestamp,
          fsrs_algorithm: "fsrs-6",
          fsrs_desired_retention: 0.9,
          fsrs_learning_steps_minutes: [1, 10],
          fsrs_relearning_steps_minutes: [10],
          fsrs_maximum_interval_days: 36500,
          fsrs_enable_fuzz: true,
          fsrs_client_updated_at: bootstrapTimestamp,
          fsrs_last_modified_by_replica_id: bootstrapReplicaId,
          fsrs_last_operation_id: bootstrapOperationId,
          fsrs_updated_at: bootstrapTimestamp,
        });
        return createQueryResult<Row>([]);
      }

      if (text === "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')") {
        const workspaceId = String(params[0]);
        const userId = String(params[1]);
        state.workspaceMemberships.add(membershipKey(userId, workspaceId));
        return createQueryResult<Row>([]);
      }

      if (
        text
          === "INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at) VALUES ($1, 0, now()) ON CONFLICT (workspace_id) DO NOTHING"
      ) {
        return createQueryResult<Row>([]);
      }

      if (
        text
          === "INSERT INTO sync.hot_changes ( workspace_id, entity_type, entity_id, action, replica_id, operation_id, client_updated_at ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING change_id"
      ) {
        const changeId = state.nextHotChangeId;
        state.nextHotChangeId += 1;
        return createQueryResult<Row>([{ change_id: changeId } as unknown as Row]);
      }

      if (text.startsWith("INSERT INTO content.cards")) {
        state.cards.push({
          card_id: String(params[0]),
          workspace_id: String(params[1]),
          front_text: String(params[2]),
          back_text: String(params[3]),
          tags: Array.isArray(params[4]) ? params[4].map(String) : [],
          effort_level: String(params[5]),
          due_at: params[6] === null ? null : String(params[6]),
          reps: Number(params[7]),
          lapses: Number(params[8]),
          updated_at: String(params[9]),
          deleted_at: params[10] === null ? null : String(params[10]),
          fsrs_card_state: String(params[11]),
          fsrs_step_index: params[12] === null ? null : Number(params[12]),
          fsrs_stability: params[13] === null ? null : Number(params[13]),
          fsrs_difficulty: params[14] === null ? null : Number(params[14]),
          fsrs_last_reviewed_at: params[15] === null ? null : String(params[15]),
          fsrs_scheduled_days: params[16] === null ? null : Number(params[16]),
          client_updated_at: String(params[17]),
          last_modified_by_replica_id: String(params[18]),
          last_operation_id: String(params[19]),
          created_at: String(params[20]),
        });
        return createQueryResult<Row>([]);
      }

      if (text.startsWith("INSERT INTO content.decks")) {
        state.decks.push({
          deck_id: String(params[0]),
          workspace_id: String(params[1]),
          name: String(params[2]),
          filter_definition: JSON.parse(String(params[3])) as Readonly<Record<string, unknown>>,
          created_at: String(params[4]),
          updated_at: String(params[5]),
          deleted_at: params[6] === null ? null : String(params[6]),
          client_updated_at: String(params[7]),
          last_modified_by_replica_id: String(params[8]),
          last_operation_id: String(params[9]),
        });
        return createQueryResult<Row>([]);
      }

      if (text.startsWith("INSERT INTO content.review_events")) {
        state.reviewEvents.push({
          review_event_id: String(params[0]),
          workspace_id: String(params[1]),
          card_id: String(params[2]),
          replica_id: String(params[3]),
          client_event_id: String(params[4]),
          rating: Number(params[5]),
          reviewed_at_client: String(params[6]),
          reviewed_at_server: String(params[7]),
        });
        return createQueryResult<Row>([]);
      }

      if (text.startsWith("UPDATE org.workspaces SET")) {
        const workspaceId = String(params[10]);
        const current = state.workspaces.get(workspaceId);
        if (current === undefined) {
          throw new Error(`Missing workspace ${workspaceId}`);
        }

        state.workspaces.set(workspaceId, {
          ...current,
          fsrs_algorithm: String(params[0]),
          fsrs_desired_retention: Number(params[1]),
          fsrs_learning_steps_minutes: JSON.parse(String(params[2])) as ReadonlyArray<number>,
          fsrs_relearning_steps_minutes: JSON.parse(String(params[3])) as ReadonlyArray<number>,
          fsrs_maximum_interval_days: Number(params[4]),
          fsrs_enable_fuzz: Boolean(params[5]),
          fsrs_client_updated_at: String(params[6]),
          fsrs_last_modified_by_replica_id: String(params[7]),
          fsrs_last_operation_id: String(params[8]),
          fsrs_updated_at: String(params[9]),
        });
        return createQueryResult<Row>([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

test("prepareGuestUpgradeInExecutor binds a new cognito subject to the guest user and updates email", async () => {
  const guestToken = "guest-token-prepare-bound";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const cognitoSubject = "cognito-subject-bound";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-prepare-bound",
    guestUserId,
    guestWorkspaceId,
    targetSubject: "different-target-subject",
    targetUserId: "linked-user",
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica",
    installationId: "installation-prepare-bound",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.identityMappings.clear();

  const executor = createGuestUpgradeExecutor(state);
  const result = await prepareGuestUpgradeInExecutor(
    executor,
    guestToken,
    cognitoSubject,
    "guest@example.com",
  );

  assert.equal(result.mode, "bound");
  assert.equal(state.identityMappings.get(cognitoSubject), guestUserId);
  assert.equal(state.userSettings.get(guestUserId)?.email, "guest@example.com");
});

test("prepareGuestUpgradeInExecutor returns merge_required for a different linked user", async () => {
  const guestToken = "guest-token-prepare-merge";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-prepare-merge",
    guestUserId: "guest-user",
    guestWorkspaceId: "guest-workspace",
    targetSubject: "cognito-subject-prepare-merge",
    targetUserId: "linked-user",
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica",
    installationId: "installation-prepare-merge",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);
  const result = await prepareGuestUpgradeInExecutor(
    executor,
    guestToken,
    "cognito-subject-prepare-merge",
    "linked@example.com",
  );

  assert.equal(result.mode, "merge_required");
  assert.equal(state.userSettings.get("guest-user")?.email, null);
});

test("completeGuestUpgradeInExecutor reassigns guest installation ownership during merge", async () => {
  const guestToken = "guest-token-1";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-1";
  const targetSubject = "cognito-subject-1";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-1",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId,
    guestReplicaId,
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

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
  assert.equal(result.outcome, "fresh_completion");
  assert.equal(result.targetWorkspaceId, targetWorkspaceId);

  const targetReplica = state.workspaceReplicas.find((replica) => (
    replica.workspace_id === targetWorkspaceId
    && replica.installation_id === installationId
  ));
  assert.ok(targetReplica);
  assert.equal(targetReplica?.user_id, targetUserId);
});

test("completeGuestUpgradeInExecutor rejects selecting the guest workspace as the merge target", async () => {
  const guestToken = "guest-token-same-workspace";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const installationId = "installation-same-workspace";
  const targetSubject = "cognito-subject-same-workspace";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-same-workspace",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica-same-workspace",
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.workspaceMemberships.add(membershipKey(targetUserId, guestWorkspaceId));

  const executor = createGuestUpgradeExecutor(state);

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      targetSubject,
      {
        type: "existing",
        workspaceId: guestWorkspaceId,
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "GUEST_UPGRADE_TARGET_SAME_AS_SOURCE");
      return true;
    },
  );

  assert.equal(state.guestSession.revoked_at, null);
  assert.equal(state.guestUpgradeHistory.length, 0);
  assert.equal(state.installations.get(installationId)?.user_id, guestUserId);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
});

test("completeGuestUpgradeInExecutor deterministically forks copied ids into a different workspace", async () => {
  const guestToken = "guest-token-forked-copy";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-forked-copy";
  const targetSubject = "cognito-subject-forked-copy";
  const sourceCardId = "11111111-1111-4111-8111-111111111111";
  const sourceDeckId = "22222222-2222-4222-8222-222222222222";
  const sourceReviewEventId = "33333333-3333-4333-8333-333333333333";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-forked-copy",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId,
    guestReplicaId,
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.cards.push({
    card_id: sourceCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Front",
    back_text: "Back",
    tags: ["tag"],
    effort_level: "fast",
    due_at: null,
    created_at: "2026-04-02T14:00:02.000Z",
    reps: 0,
    lapses: 0,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
    client_updated_at: "2026-04-02T14:00:03.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-card-op",
    updated_at: "2026-04-02T14:00:03.000Z",
    deleted_at: null,
  });
  state.decks.push({
    deck_id: sourceDeckId,
    workspace_id: guestWorkspaceId,
    name: "Deck",
    filter_definition: {
      version: 2,
      effortLevels: ["fast"],
      tags: ["tag"],
    },
    created_at: "2026-04-02T14:00:04.000Z",
    client_updated_at: "2026-04-02T14:00:05.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-deck-op",
    updated_at: "2026-04-02T14:00:05.000Z",
    deleted_at: null,
  });
  state.reviewEvents.push({
    review_event_id: sourceReviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: sourceCardId,
    replica_id: guestReplicaId,
    client_event_id: "client-event-1",
    rating: 3,
    reviewed_at_client: "2026-04-02T14:00:06.000Z",
    reviewed_at_server: "2026-04-02T14:00:06.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);
  await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
  );

  const expectedCardId = forkCardIdForWorkspace(guestWorkspaceId, targetWorkspaceId, sourceCardId);
  const expectedDeckId = forkDeckIdForWorkspace(guestWorkspaceId, targetWorkspaceId, sourceDeckId);
  const expectedReviewEventId = forkReviewEventIdForWorkspace(
    guestWorkspaceId,
    targetWorkspaceId,
    sourceReviewEventId,
  );

  const targetCard = state.cards.find((card) => card.workspace_id === targetWorkspaceId);
  const targetDeck = state.decks.find((deck) => deck.workspace_id === targetWorkspaceId);
  const targetReviewEvent = state.reviewEvents.find((reviewEvent) => reviewEvent.workspace_id === targetWorkspaceId);

  assert.ok(targetCard);
  assert.equal(targetCard?.card_id, expectedCardId);
  assert.notEqual(targetCard?.card_id, sourceCardId);

  assert.ok(targetDeck);
  assert.equal(targetDeck?.deck_id, expectedDeckId);
  assert.notEqual(targetDeck?.deck_id, sourceDeckId);

  assert.ok(targetReviewEvent);
  assert.equal(targetReviewEvent?.review_event_id, expectedReviewEventId);
  assert.equal(targetReviewEvent?.card_id, expectedCardId);
  assert.notEqual(targetReviewEvent?.review_event_id, sourceReviewEventId);
});

test("deleteGuestSessionInExecutor revokes and removes guest server state", async () => {
  const guestToken = "guest-token-delete";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-delete",
    guestUserId,
    guestWorkspaceId,
    targetSubject: "cognito-subject-delete",
    targetUserId: "linked-user",
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica-delete",
    installationId: "installation-delete",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);
  await deleteGuestSessionInExecutor(executor, guestToken);

  assert.equal(state.guestSession.revoked_at, "2026-04-02T14:01:16.000Z");
  assert.equal(state.userSettings.has(guestUserId), false);
  assert.equal(state.workspaces.has(guestWorkspaceId), false);
  assert.equal(
    state.workspaceReplicas.some((replica) => replica.workspace_id === guestWorkspaceId),
    false,
  );
});

test("cleanupGuestSessionSourceInExecutor re-scopes to the guest user before checking cleanup invariants", async () => {
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const state = createMergeState({
    guestToken: "guest-token-cleanup-rescope",
    guestSessionId: "guest-session-cleanup-rescope",
    guestUserId,
    guestWorkspaceId,
    targetSubject: "cognito-subject-cleanup-rescope",
    targetUserId,
    targetWorkspaceId,
    guestReplicaId: "guest-replica-cleanup-rescope",
    installationId: "installation-cleanup-rescope",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.currentUserId = targetUserId;
  state.currentWorkspaceId = targetWorkspaceId;

  const executor = createGuestUpgradeExecutor(state);
  await cleanupGuestSessionSourceInExecutor(
    executor,
    guestUserId,
    "guest-session-cleanup-rescope",
    guestWorkspaceId,
  );

  assert.equal(state.guestSession.revoked_at, "2026-04-02T14:01:16.000Z");
  assert.equal(state.userSettings.has(guestUserId), false);
  assert.equal(state.workspaces.has(guestWorkspaceId), false);
});

test("deleteGuestSessionInExecutor rejects guest cleanup for a shared workspace", async () => {
  const guestToken = "guest-token-delete-shared";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-delete-shared",
    guestUserId,
    guestWorkspaceId,
    targetSubject: "cognito-subject-delete-shared",
    targetUserId: "linked-user",
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica-delete-shared",
    installationId: "installation-delete-shared",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.workspaceMemberships.add(membershipKey("shared-user", guestWorkspaceId));

  const executor = createGuestUpgradeExecutor(state);

  await assert.rejects(
    deleteGuestSessionInExecutor(executor, guestToken),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "WORKSPACE_DELETE_SHARED");
      return true;
    },
  );

  assert.equal(state.guestSession.revoked_at, null);
  assert.equal(state.userSettings.has(guestUserId), true);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
  assert.equal(
    state.workspaceReplicas.some((replica) => replica.workspace_id === guestWorkspaceId),
    true,
  );
});

test("deleteGuestSessionInExecutor rejects an already-revoked guest session", async () => {
  const guestToken = "guest-token-delete-replay";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-delete-replay",
    guestUserId: "guest-user",
    guestWorkspaceId: "guest-workspace",
    targetSubject: "cognito-subject-delete-replay",
    targetUserId: "linked-user",
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica-delete-replay",
    installationId: "installation-delete-replay",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);
  await deleteGuestSessionInExecutor(executor, guestToken);

  await assert.rejects(
    async () => deleteGuestSessionInExecutor(executor, guestToken),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "GUEST_AUTH_INVALID");
      return true;
    },
  );
});

test("deleteGuestSessionInExecutor rejects cleanup after a bound guest upgrade", async () => {
  const guestToken = "guest-token-delete-bound";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const cognitoSubject = "cognito-subject-delete-bound";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-delete-bound",
    guestUserId,
    guestWorkspaceId,
    targetSubject: "different-target-subject",
    targetUserId: "linked-user",
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica-delete-bound",
    installationId: "installation-delete-bound",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.identityMappings.clear();

  const executor = createGuestUpgradeExecutor(state);
  const preparation = await prepareGuestUpgradeInExecutor(
    executor,
    guestToken,
    cognitoSubject,
    "bound@example.com",
  );

  assert.equal(preparation.mode, "bound");

  await assert.rejects(
    async () => deleteGuestSessionInExecutor(executor, guestToken),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "GUEST_SESSION_DELETE_LINKED_ACCOUNT");
      return true;
    },
  );

  assert.equal(state.guestSession.revoked_at, null);
  assert.equal(state.userSettings.has(guestUserId), true);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
  assert.equal(state.identityMappings.get(cognitoSubject), guestUserId);
});

test("completeGuestUpgradeInExecutor with create_new creates and selects a new target workspace", async () => {
  const guestToken = "guest-token-create-new";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-create-new";
  const targetSubject = "cognito-subject-create-new";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-create-new",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId,
    guestReplicaId,
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:10:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);
  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "create_new",
    },
  );

  assert.equal(result.outcome, "fresh_completion");
  assert.notEqual(result.targetWorkspaceId, targetWorkspaceId);
  assert.equal(result.workspace.workspaceId, result.targetWorkspaceId);
  assert.equal(state.userSettings.get(targetUserId)?.workspace_id, result.targetWorkspaceId);
  assert.equal(state.workspaces.get(result.targetWorkspaceId)?.name, "Guest workspace");
  assert.ok(state.workspaceMemberships.has(membershipKey(targetUserId, result.targetWorkspaceId)));
});

test("completeGuestUpgradeInExecutor applies guest scheduler settings when guest metadata wins", async () => {
  const guestToken = "guest-token-scheduler-win";
  const targetWorkspaceId = "target-workspace";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-scheduler-win",
    guestUserId: "guest-user",
    guestWorkspaceId: "guest-workspace",
    targetSubject: "cognito-subject-scheduler-win",
    targetUserId: "linked-user",
    targetWorkspaceId,
    guestReplicaId: "guest-replica",
    installationId: "installation-scheduler-win",
    guestSchedulerUpdatedAt: "2026-04-02T14:10:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);
  await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    "cognito-subject-scheduler-win",
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
  );

  const targetWorkspace = state.workspaces.get(targetWorkspaceId);
  assert.equal(targetWorkspace?.fsrs_client_updated_at, "2026-04-02T14:10:00.000Z");
  assert.notEqual(targetWorkspace?.fsrs_last_modified_by_replica_id, "target-replica-existing");
});

test("completeGuestUpgradeInExecutor leaves target scheduler settings when target metadata wins", async () => {
  const guestToken = "guest-token-scheduler-lose";
  const targetWorkspaceId = "target-workspace";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-scheduler-lose",
    guestUserId: "guest-user",
    guestWorkspaceId: "guest-workspace",
    targetSubject: "cognito-subject-scheduler-lose",
    targetUserId: "linked-user",
    targetWorkspaceId,
    guestReplicaId: "guest-replica",
    installationId: "installation-scheduler-lose",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);
  await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    "cognito-subject-scheduler-lose",
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
  );

  const targetWorkspace = state.workspaces.get(targetWorkspaceId);
  assert.equal(targetWorkspace?.fsrs_client_updated_at, "2026-04-02T14:05:00.000Z");
  assert.equal(targetWorkspace?.fsrs_last_modified_by_replica_id, "target-replica-existing");
});

test("completeGuestUpgradeInExecutor replays a revoked guest upgrade for the same subject", async () => {
  const guestToken = "guest-token-2";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-2";
  const targetSubject = "cognito-subject-2";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-2",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId,
    guestReplicaId,
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);
  const firstResult = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
  );
  const secondResult = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
  );

  assert.equal(firstResult.outcome, "fresh_completion");
  assert.equal(secondResult.outcome, "idempotent_replay");
  assert.equal(secondResult.workspace.workspaceId, targetWorkspaceId);
  assert.equal(secondResult.targetUserId, targetUserId);
  assert.equal(state.guestUpgradeHistory.length, 1);
});

test("completeGuestUpgradeInExecutor rejects a replay from a different subject", async () => {
  const guestToken = "guest-token-3";
  const guestSessionId = "guest-session-3";
  const guestUserId = "guest-user";
  const targetWorkspaceId = "target-workspace";

  const state: MutableState = {
    currentUserId: null,
    currentWorkspaceId: null,
    nextHotChangeId: 1,
    guestSession: {
      session_id: guestSessionId,
      session_secret_hash: hashGuestToken(guestToken),
      user_id: guestUserId,
      revoked_at: "2026-04-02T14:01:16.000Z",
    },
    identityMappings: new Map<string, string>([["different-subject", "linked-user"]]),
    userSettings: new Map<string, UserSettingsState>([
      ["linked-user", createUserSettingsState("linked-user", targetWorkspaceId, null)],
    ]),
    workspaces: new Map<string, WorkspaceState>([
      [targetWorkspaceId, createWorkspaceState(
        targetWorkspaceId,
        "Target workspace",
        "2026-04-02T13:00:00.000Z",
        "2026-04-02T14:05:00.000Z",
        "target-replica-existing",
        "target-op",
      )],
    ]),
    workspaceMemberships: new Set<string>([
      membershipKey("linked-user", targetWorkspaceId),
    ]),
    workspaceReplicas: [],
    installations: new Map<string, InstallationState>(),
    cards: [],
    decks: [],
    reviewEvents: [],
    guestUpgradeHistory: [{
      upgrade_id: "upgrade-1",
      source_guest_user_id: guestUserId,
      source_guest_workspace_id: "guest-workspace",
      source_guest_session_id: guestSessionId,
      target_subject_user_id: "original-subject",
      target_user_id: "linked-user",
      target_workspace_id: targetWorkspaceId,
      selection_type: "existing",
    }],
    guestReplicaAliases: [],
  };

  const executor = createGuestUpgradeExecutor(state);

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      "different-subject",
      {
        type: "existing",
        workspaceId: targetWorkspaceId,
      },
    ),
    (error: unknown) => (
      error instanceof HttpError
      && error.statusCode === 401
      && error.code === "GUEST_AUTH_INVALID"
    ),
  );
});

test("completeGuestUpgradeInExecutor rejects a revoked guest session without replay history", async () => {
  const guestToken = "guest-token-4";
  const guestSessionId = "guest-session-4";
  const guestUserId = "guest-user";

  const state: MutableState = {
    currentUserId: null,
    currentWorkspaceId: null,
    nextHotChangeId: 1,
    guestSession: {
      session_id: guestSessionId,
      session_secret_hash: hashGuestToken(guestToken),
      user_id: guestUserId,
      revoked_at: "2026-04-02T14:01:16.000Z",
    },
    identityMappings: new Map<string, string>([["target-subject", "linked-user"]]),
    userSettings: new Map<string, UserSettingsState>(),
    workspaces: new Map<string, WorkspaceState>(),
    workspaceMemberships: new Set<string>(),
    workspaceReplicas: [],
    installations: new Map<string, InstallationState>(),
    cards: [],
    decks: [],
    reviewEvents: [],
    guestUpgradeHistory: [],
    guestReplicaAliases: [],
  };

  const executor = createGuestUpgradeExecutor(state);

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      "target-subject",
      {
        type: "create_new",
      },
    ),
    (error: unknown) => (
      error instanceof HttpError
      && error.statusCode === 401
      && error.code === "GUEST_AUTH_INVALID"
    ),
  );
});
