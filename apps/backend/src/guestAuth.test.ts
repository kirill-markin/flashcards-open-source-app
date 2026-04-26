import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "./db";
import {
  completeGuestUpgradeInExecutor,
  deleteGuestSessionInExecutor,
  prepareGuestUpgradeInExecutor,
  type GuestUpgradeCompleteCapabilities,
} from "./guestAuth";
import { cleanupGuestSessionSourceInExecutor } from "./guestAuth/delete";
import { HttpError } from "./errors";

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

type WorkspaceMembershipRole = "owner" | "member";

type GuestUpgradeHistoryState = Readonly<{
  upgrade_id: string;
  source_guest_user_id: string;
  source_guest_workspace_id: string;
  source_guest_session_id: string;
  source_guest_session_secret_hash: string | null;
  target_subject_user_id: string;
  target_user_id: string;
  target_workspace_id: string;
  selection_type: string;
  dropped_entities: Readonly<{
    cardIds: ReadonlyArray<string>;
    deckIds: ReadonlyArray<string>;
    reviewEventIds: ReadonlyArray<string>;
  }> | null;
}>;

type GuestReplicaAliasState = Readonly<{
  source_guest_replica_id: string;
  upgrade_id: string;
  target_replica_id: string;
}>;

type HotChangeState = Readonly<{
  change_id: number;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
}>;

type ReviewEventClientEventDedupMergeFixture = Readonly<{
  state: MutableState;
  guestToken: string;
  targetSubject: string;
  targetWorkspaceId: string;
  cardId: string;
  guestReviewEventId: string;
  targetReviewEventId: string;
}>;

const DROPPED_ENTITIES_UNSUPPORTED: GuestUpgradeCompleteCapabilities = {
  guestWorkspaceSyncedAndOutboxDrained: true,
  requiresGuestWorkspaceSyncedAndOutboxDrained: true,
  supportsDroppedEntities: false,
};

const DROPPED_ENTITIES_SUPPORTED: GuestUpgradeCompleteCapabilities = {
  guestWorkspaceSyncedAndOutboxDrained: true,
  requiresGuestWorkspaceSyncedAndOutboxDrained: true,
  supportsDroppedEntities: true,
};

const GUEST_SYNC_NOT_DRAINED: GuestUpgradeCompleteCapabilities = {
  guestWorkspaceSyncedAndOutboxDrained: false,
  requiresGuestWorkspaceSyncedAndOutboxDrained: true,
  supportsDroppedEntities: true,
};

const LEGACY_REPLAY_CAPABILITIES: GuestUpgradeCompleteCapabilities = {
  guestWorkspaceSyncedAndOutboxDrained: false,
  requiresGuestWorkspaceSyncedAndOutboxDrained: false,
  supportsDroppedEntities: false,
};

type MutableState = {
  currentUserId: string | null;
  currentWorkspaceId: string | null;
  nextHotChangeId: number;
  guestSession: GuestSessionState | null;
  identityMappings: Map<string, string>;
  userSettings: Map<string, UserSettingsState>;
  workspaces: Map<string, WorkspaceState>;
  workspaceMemberships: Set<string>;
  workspaceMembershipRoles: Map<string, WorkspaceMembershipRole>;
  workspaceReplicas: Array<WorkspaceReplicaState>;
  installations: Map<string, InstallationState>;
  cards: Array<CardState>;
  decks: Array<DeckState>;
  reviewEvents: Array<ReviewEventState>;
  guestUpgradeHistory: Array<GuestUpgradeHistoryState>;
  guestReplicaAliases: Array<GuestReplicaAliasState>;
  hotChanges: Array<HotChangeState>;
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

function addWorkspaceMembership(
  state: MutableState,
  userId: string,
  workspaceId: string,
  role: WorkspaceMembershipRole,
): void {
  const key = membershipKey(userId, workspaceId);
  state.workspaceMemberships.add(key);
  state.workspaceMembershipRoles.set(key, role);
}

function hashGuestToken(guestToken: string): string {
  return createHash("sha256").update(guestToken, "utf8").digest("hex");
}

function toUuidFromSeedForTest(seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex");
  const baseHex = digest.slice(0, 32).split("");

  baseHex[12] = "5";
  baseHex[16] = ((parseInt(baseHex[16], 16) & 0x3) | 0x8).toString(16);

  return [
    baseHex.slice(0, 8).join(""),
    baseHex.slice(8, 12).join(""),
    baseHex.slice(12, 16).join(""),
    baseHex.slice(16, 20).join(""),
    baseHex.slice(20, 32).join(""),
  ].join("-");
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
    workspaceMembershipRoles: new Map<string, WorkspaceMembershipRole>([
      [membershipKey(params.guestUserId, params.guestWorkspaceId), "owner"],
      [membershipKey(params.targetUserId, params.targetWorkspaceId), "owner"],
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
    hotChanges: [],
  };
}

function createReviewEventClientEventDedupMergeFixture(): ReviewEventClientEventDedupMergeFixture {
  const guestToken = "guest-token-review-event-dedup";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-review-event-dedup";
  const targetSubject = "cognito-subject-review-event-dedup";
  const cardId = "12121212-1212-4121-8121-121212121212";
  const guestReviewEventId = "34343434-3434-4343-8343-343434343434";
  const targetReviewEventId = "56565656-5656-4565-8565-565656565656";
  const clientEventId = "same-client-event-dedup";
  const targetReplicaId = toUuidFromSeedForTest(`${targetWorkspaceId}:${installationId}`);
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-review-event-dedup",
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

  state.workspaceReplicas.push({
    replica_id: targetReplicaId,
    workspace_id: targetWorkspaceId,
    user_id: targetUserId,
    actor_kind: "client_installation",
    installation_id: installationId,
    actor_key: null,
    platform: "ios",
    app_version: "1.2.3",
    created_at: "2026-04-02T13:50:00.000Z",
    last_seen_at: "2026-04-02T13:50:00.000Z",
  });
  state.cards.push({
    card_id: cardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest front",
    back_text: "Guest back",
    tags: ["guest"],
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
  state.cards.push({
    card_id: cardId,
    workspace_id: targetWorkspaceId,
    front_text: "Target front",
    back_text: "Target back",
    tags: ["target"],
    effort_level: "medium",
    due_at: null,
    created_at: "2026-04-02T13:50:02.000Z",
    reps: 1,
    lapses: 0,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
    client_updated_at: "2026-04-02T13:50:03.000Z",
    last_modified_by_replica_id: targetReplicaId,
    last_operation_id: "target-card-op",
    updated_at: "2026-04-02T13:50:03.000Z",
    deleted_at: null,
  });
  state.reviewEvents.push({
    review_event_id: guestReviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: cardId,
    replica_id: guestReplicaId,
    client_event_id: clientEventId,
    rating: 2,
    reviewed_at_client: "2026-04-02T14:00:04.000Z",
    reviewed_at_server: "2026-04-02T14:00:04.000Z",
  });
  state.reviewEvents.push({
    review_event_id: targetReviewEventId,
    workspace_id: targetWorkspaceId,
    card_id: cardId,
    replica_id: targetReplicaId,
    client_event_id: clientEventId,
    rating: 4,
    reviewed_at_client: "2026-04-02T13:50:04.000Z",
    reviewed_at_server: "2026-04-02T13:50:04.000Z",
  });

  return {
    state,
    guestToken,
    targetSubject,
    targetWorkspaceId,
    cardId,
    guestReviewEventId,
    targetReviewEventId,
  };
}

function createCardQueryRow(card: CardState): Readonly<Record<string, unknown>> {
  return {
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
  };
}

function createDeckQueryRow(deck: DeckState): Readonly<Record<string, unknown>> {
  return {
    deck_id: deck.deck_id,
    workspace_id: deck.workspace_id,
    name: deck.name,
    filter_definition: deck.filter_definition,
    created_at: deck.created_at,
    client_updated_at: deck.client_updated_at,
    last_modified_by_replica_id: deck.last_modified_by_replica_id,
    last_operation_id: deck.last_operation_id,
    updated_at: deck.updated_at,
    deleted_at: deck.deleted_at,
  };
}

function createReviewEventQueryRow(reviewEvent: ReviewEventState): Readonly<Record<string, unknown>> {
  return {
    review_event_id: reviewEvent.review_event_id,
    workspace_id: reviewEvent.workspace_id,
    card_id: reviewEvent.card_id,
    replica_id: reviewEvent.replica_id,
    client_event_id: reviewEvent.client_event_id,
    rating: reviewEvent.rating,
    reviewed_at_client: reviewEvent.reviewed_at_client,
    reviewed_at_server: reviewEvent.reviewed_at_server,
  };
}

function parseGuestUpgradeDroppedEntitiesState(
  serializedDroppedEntities: string | null,
): GuestUpgradeHistoryState["dropped_entities"] {
  if (serializedDroppedEntities === null) {
    return null;
  }

  const parsed = JSON.parse(serializedDroppedEntities) as GuestUpgradeHistoryState["dropped_entities"];
  return parsed;
}

function countWorkspaceMembers(state: MutableState, workspaceId: string): number {
  return [...state.workspaceMemberships]
    .filter((membership) => membership.endsWith(`:${workspaceId}`))
    .length;
}

function findSyncConflictWorkspaceId(
  state: MutableState,
  entityType: string,
  entityId: string,
): string | null {
  if (entityType === "card") {
    return state.cards.find((card) => card.card_id === entityId)?.workspace_id ?? null;
  }

  if (entityType === "deck") {
    return state.decks.find((deck) => deck.deck_id === entityId)?.workspace_id ?? null;
  }

  if (entityType === "review_event") {
    return state.reviewEvents.find((reviewEvent) => reviewEvent.review_event_id === entityId)?.workspace_id ?? null;
  }

  throw new Error(`Unexpected sync conflict entity type: ${entityType}`);
}

function deleteWorkspaceFromState(state: MutableState, workspaceId: string): void {
  state.workspaces.delete(workspaceId);
  state.workspaceReplicas = state.workspaceReplicas.filter((replica) => replica.workspace_id !== workspaceId);
  state.workspaceMemberships = new Set(
    [...state.workspaceMemberships].filter((value) => !value.endsWith(`:${workspaceId}`)),
  );
  state.workspaceMembershipRoles = new Map(
    [...state.workspaceMembershipRoles].filter(([key]) => !key.endsWith(`:${workspaceId}`)),
  );
  state.cards = state.cards.filter((card) => card.workspace_id !== workspaceId);
  state.decks = state.decks.filter((deck) => deck.workspace_id !== workspaceId);
  state.reviewEvents = state.reviewEvents.filter((reviewEvent) => reviewEvent.workspace_id !== workspaceId);
}

type GuestUpgradeExecutorParam = string | number | boolean | Date | null | ReadonlyArray<string>;

type GuestUpgradeExecutorScope = Readonly<{
  requireCurrentUserScope: (userId: string) => void;
  requireCurrentWorkspaceScope: (userId: string, workspaceId: string) => void;
}>;

function handleExecutorScopeQuery<Row extends pg.QueryResultRow>(
  state: MutableState,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  if (!text.includes("set_config('app.user_id'")) {
    return null;
  }

  state.currentUserId = typeof params[0] === "string" ? params[0] : null;
  state.currentWorkspaceId = typeof params[1] === "string" && params[1] !== "" ? params[1] : null;
  return createQueryResult<Row>([]);
}

function handleAuthExecutorQuery<Row extends pg.QueryResultRow>(
  state: MutableState,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  if (text.includes("FROM auth.guest_sessions")) {
    const requestedHash = params[0];
    const guestSession = state.guestSession;
    const rows = guestSession !== null && requestedHash === guestSession.session_secret_hash ? [{
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
      source_guest_session_id: guestUpgradeHistory.source_guest_session_id,
      target_subject_user_id: guestUpgradeHistory.target_subject_user_id,
      target_user_id: guestUpgradeHistory.target_user_id,
      target_workspace_id: guestUpgradeHistory.target_workspace_id,
      dropped_entities: guestUpgradeHistory.dropped_entities,
    } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (
    text.includes("FROM auth.guest_upgrade_history")
    && text.includes("WHERE source_guest_session_secret_hash = $1")
  ) {
    const guestSessionSecretHash = params[0];
    const guestUpgradeHistory = typeof guestSessionSecretHash === "string"
      ? state.guestUpgradeHistory.find((row) => row.source_guest_session_secret_hash === guestSessionSecretHash)
      : undefined;
    const rows = guestUpgradeHistory === undefined ? [] : [{
      source_guest_session_id: guestUpgradeHistory.source_guest_session_id,
      target_subject_user_id: guestUpgradeHistory.target_subject_user_id,
      target_user_id: guestUpgradeHistory.target_user_id,
      target_workspace_id: guestUpgradeHistory.target_workspace_id,
      dropped_entities: guestUpgradeHistory.dropped_entities,
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

  if (text.includes("INSERT INTO auth.guest_upgrade_history")) {
    state.guestUpgradeHistory.push({
      upgrade_id: String(params[0]),
      source_guest_user_id: String(params[1]),
      source_guest_workspace_id: String(params[2]),
      source_guest_session_id: String(params[3]),
      source_guest_session_secret_hash: String(params[4]),
      target_subject_user_id: String(params[5]),
      target_user_id: String(params[6]),
      target_workspace_id: String(params[7]),
      selection_type: String(params[8]),
      dropped_entities: params[9] === null
        ? null
        : parseGuestUpgradeDroppedEntitiesState(String(params[9])),
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
    if (state.guestSession === null) {
      return createQueryResult<Row>([]);
    }

    state.guestSession = {
      ...state.guestSession,
      revoked_at: "2026-04-02T14:01:16.000Z",
    };
    return createQueryResult<Row>([]);
  }

  return null;
}

function handleUserSettingsExecutorQuery<Row extends pg.QueryResultRow>(
  state: MutableState,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
  scope: GuestUpgradeExecutorScope,
): pg.QueryResult<Row> | null {
  if (text === "INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING") {
    const userId = String(params[0]);
    scope.requireCurrentUserScope(userId);
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
    scope.requireCurrentUserScope(userId);
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
    scope.requireCurrentUserScope(userId);
    const current = state.userSettings.get(userId) ?? createUserSettingsState(userId, null, null);
    state.userSettings.set(userId, {
      ...current,
      workspace_id: workspaceId,
    });
    return createQueryResult<Row>([]);
  }

  if (text === "DELETE FROM org.user_settings WHERE user_id = $1") {
    const userId = String(params[0]);
    state.userSettings.delete(userId);
    if (state.guestSession?.user_id === userId) {
      state.guestSession = null;
    }
    for (const [providerSubject, mappedUserId] of state.identityMappings) {
      if (mappedUserId === userId) {
        state.identityMappings.delete(providerSubject);
      }
    }
    return createQueryResult<Row>([]);
  }

  return null;
}

function handleWorkspaceExecutorQuery<Row extends pg.QueryResultRow>(
  state: MutableState,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
  scope: GuestUpgradeExecutorScope,
): pg.QueryResult<Row> | null {
  if (text.startsWith("SELECT") && text.includes("FROM org.workspaces AS workspaces")) {
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

    const membershipRole = state.workspaceMembershipRoles.get(membershipKey(userId, workspaceId));
    if (membershipRole === undefined) {
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
      role: membershipRole,
      member_count: memberCount,
    } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (text.startsWith("SELECT") && text.includes("FROM org.workspaces") && text.includes("fsrs_algorithm")) {
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

  if (text.startsWith("DELETE FROM org.workspaces AS workspaces")) {
    const workspaceId = String(params[0]);
    const userId = String(params[1]);
    scope.requireCurrentUserScope(userId);
    const membershipRole = state.workspaceMembershipRoles.get(membershipKey(userId, workspaceId));
    const isOwner = membershipRole === "owner";
    if (!isOwner || countWorkspaceMembers(state, workspaceId) !== 1 || !state.workspaces.has(workspaceId)) {
      return createQueryResult<Row>([]);
    }

    deleteWorkspaceFromState(state, workspaceId);
    return createQueryResult<Row>([{ workspace_id: workspaceId } as unknown as Row]);
  }

  if (text === "DELETE FROM org.workspaces WHERE workspace_id = $1") {
    const workspaceId = String(params[0]);
    deleteWorkspaceFromState(state, workspaceId);
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
    addWorkspaceMembership(state, userId, workspaceId, "owner");
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

  return null;
}

function handleSyncExecutorQuery<Row extends pg.QueryResultRow>(
  state: MutableState,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
  scope: GuestUpgradeExecutorScope,
): pg.QueryResult<Row> | null {
  if (text.startsWith("SELECT") && text.includes("FROM sync.workspace_replicas")) {
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
    text === "SELECT workspace_id FROM sync.find_conflicting_workspace_id($1, $2) LIMIT 1"
  ) {
    const entityType = String(params[0]);
    const entityId = String(params[1]);
    const conflictingWorkspaceId = findSyncConflictWorkspaceId(state, entityType, entityId);
    const rows = conflictingWorkspaceId === null
      ? []
      : [{ workspace_id: conflictingWorkspaceId } as unknown as Row];
    return createQueryResult<Row>(rows);
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
    scope.requireCurrentWorkspaceScope(replicaUserId, replicaWorkspaceId);
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
    scope.requireCurrentWorkspaceScope(userId, workspaceId);
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
    state.hotChanges.push({
      change_id: changeId,
      workspace_id: String(params[0]),
      entity_type: String(params[1]),
      entity_id: String(params[2]),
    });
    return createQueryResult<Row>([{ change_id: changeId } as unknown as Row]);
  }

  if (
    text.includes("FROM sync.hot_changes")
    && text.includes("ORDER BY change_id DESC")
  ) {
    const workspaceId = String(params[0]);
    const entityType = String(params[1]);
    const entityId = String(params[2]);
    const latestChange = state.hotChanges
      .filter((change) => (
        change.workspace_id === workspaceId
        && change.entity_type === entityType
        && change.entity_id === entityId
      ))
      .sort((left, right) => right.change_id - left.change_id)[0];
    const rows = latestChange === undefined ? [] : [{ change_id: latestChange.change_id } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  return null;
}

function handleContentExecutorQuery<Row extends pg.QueryResultRow>(
  state: MutableState,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  if (text.startsWith("SELECT") && text.includes("FROM content.cards")) {
    const workspaceId = params[0];
    if (typeof workspaceId !== "string") {
      return createQueryResult<Row>([]);
    }

    const cardId = text.includes("WHERE workspace_id = $1 AND card_id = $2")
      ? (typeof params[1] === "string" ? params[1] : null)
      : null;
    const rows = state.cards
      .filter((card) => (
        card.workspace_id === workspaceId
        && (cardId === null || card.card_id === cardId)
      ))
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.card_id.localeCompare(right.card_id))
      .map((card) => createCardQueryRow(card) as unknown as Row);
    return createQueryResult<Row>(rows);
  }

  if (text.startsWith("SELECT") && text.includes("FROM content.decks")) {
    const workspaceId = params[0];
    if (typeof workspaceId !== "string") {
      return createQueryResult<Row>([]);
    }

    const deckId = text.includes("WHERE workspace_id = $1 AND deck_id = $2")
      ? (typeof params[1] === "string" ? params[1] : null)
      : null;
    const rows = state.decks
      .filter((deck) => (
        deck.workspace_id === workspaceId
        && (deckId === null || deck.deck_id === deckId)
      ))
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.deck_id.localeCompare(right.deck_id))
      .map((deck) => createDeckQueryRow(deck) as unknown as Row);
    return createQueryResult<Row>(rows);
  }

  if (text.startsWith("SELECT") && text.includes("FROM content.review_events")) {
    const workspaceId = params[0];
    if (typeof workspaceId !== "string") {
      return createQueryResult<Row>([]);
    }

    const reviewEventId = text.includes("review_event_id = $2")
      ? (typeof params[1] === "string" ? params[1] : null)
      : null;
    const replicaId = text.includes("replica_id = $3")
      ? (typeof params[2] === "string" ? params[2] : null)
      : null;
    const clientEventId = text.includes("client_event_id = $4")
      ? (typeof params[3] === "string" ? params[3] : null)
      : null;
    const rows = state.reviewEvents
      .filter((reviewEvent) => {
        if (reviewEvent.workspace_id !== workspaceId) {
          return false;
        }

        if (reviewEventId === null && replicaId === null && clientEventId === null) {
          return true;
        }

        return reviewEvent.review_event_id === reviewEventId
          || (
            replicaId !== null
            && clientEventId !== null
            && reviewEvent.replica_id === replicaId
            && reviewEvent.client_event_id === clientEventId
          );
      })
      .sort((left, right) => left.reviewed_at_server.localeCompare(right.reviewed_at_server) || left.review_event_id.localeCompare(right.review_event_id))
      .map((reviewEvent) => createReviewEventQueryRow(reviewEvent) as unknown as Row);
    return createQueryResult<Row>(rows);
  }

  if (
    text === "DELETE FROM content.review_events WHERE workspace_id = $1"
    || text === "DELETE FROM content.decks WHERE workspace_id = $1"
    || text === "DELETE FROM content.cards WHERE workspace_id = $1"
  ) {
    const workspaceId = String(params[0]);
    if (text.includes("content.review_events")) {
      state.reviewEvents = state.reviewEvents.filter((reviewEvent) => reviewEvent.workspace_id !== workspaceId);
    } else if (text.includes("content.decks")) {
      state.decks = state.decks.filter((deck) => deck.workspace_id !== workspaceId);
    } else {
      state.cards = state.cards.filter((card) => card.workspace_id !== workspaceId);
    }
    return createQueryResult<Row>([]);
  }

  if (
    text.startsWith("INSERT INTO content.cards")
    && text.includes("ON CONFLICT DO NOTHING")
  ) {
    const cardId = String(params[0]);
    const workspaceId = String(params[1]);
    const existingCard = state.cards.find((card) => card.card_id === cardId);
    if (existingCard !== undefined) {
      return createQueryResult<Row>([]);
    }

    const insertedCard: CardState = {
      card_id: cardId,
      workspace_id: workspaceId,
      front_text: String(params[2]),
      back_text: String(params[3]),
      tags: Array.isArray(params[4]) ? params[4].map(String) : [],
      effort_level: String(params[5]),
      due_at: params[6] === null ? null : String(params[6]),
      created_at: String(params[7]),
      reps: Number(params[8]),
      lapses: Number(params[9]),
      fsrs_card_state: String(params[10]),
      fsrs_step_index: params[11] === null ? null : Number(params[11]),
      fsrs_stability: params[12] === null ? null : Number(params[12]),
      fsrs_difficulty: params[13] === null ? null : Number(params[13]),
      fsrs_last_reviewed_at: params[14] === null ? null : String(params[14]),
      fsrs_scheduled_days: params[15] === null ? null : Number(params[15]),
      client_updated_at: String(params[16]),
      last_modified_by_replica_id: String(params[17]),
      last_operation_id: String(params[18]),
      updated_at: String(params[16]),
      deleted_at: params[19] === null ? null : String(params[19]),
    };
    state.cards.push(insertedCard);
    return createQueryResult<Row>([createCardQueryRow(insertedCard) as unknown as Row]);
  }

  if (text.startsWith("UPDATE content.cards")) {
    const workspaceId = String(params[17]);
    const cardId = String(params[18]);
    const index = state.cards.findIndex((card) => card.workspace_id === workspaceId && card.card_id === cardId);
    if (index === -1) {
      return createQueryResult<Row>([]);
    }

    const current = state.cards[index];
    if (current === undefined) {
      return createQueryResult<Row>([]);
    }

    const updatedCard: CardState = {
      ...current,
      front_text: String(params[0]),
      back_text: String(params[1]),
      tags: Array.isArray(params[2]) ? params[2].map(String) : [],
      effort_level: String(params[3]),
      due_at: params[4] === null ? null : String(params[4]),
      reps: Number(params[5]),
      lapses: Number(params[6]),
      fsrs_card_state: String(params[7]),
      fsrs_step_index: params[8] === null ? null : Number(params[8]),
      fsrs_stability: params[9] === null ? null : Number(params[9]),
      fsrs_difficulty: params[10] === null ? null : Number(params[10]),
      fsrs_last_reviewed_at: params[11] === null ? null : String(params[11]),
      fsrs_scheduled_days: params[12] === null ? null : Number(params[12]),
      deleted_at: params[13] === null ? null : String(params[13]),
      client_updated_at: String(params[14]),
      last_modified_by_replica_id: String(params[15]),
      last_operation_id: String(params[16]),
      updated_at: String(params[14]),
    };
    state.cards[index] = updatedCard;
    return createQueryResult<Row>([createCardQueryRow(updatedCard) as unknown as Row]);
  }

  if (
    text.startsWith("INSERT INTO content.decks")
    && text.includes("ON CONFLICT DO NOTHING")
  ) {
    const deckId = String(params[0]);
    const workspaceId = String(params[1]);
    const existingDeck = state.decks.find((deck) => deck.deck_id === deckId);
    if (existingDeck !== undefined) {
      return createQueryResult<Row>([]);
    }

    const insertedDeck: DeckState = {
      deck_id: deckId,
      workspace_id: workspaceId,
      name: String(params[2]),
      filter_definition: JSON.parse(String(params[3])) as Readonly<Record<string, unknown>>,
      created_at: String(params[4]),
      client_updated_at: String(params[5]),
      last_modified_by_replica_id: String(params[6]),
      last_operation_id: String(params[7]),
      updated_at: String(params[5]),
      deleted_at: params[8] === null ? null : String(params[8]),
    };
    state.decks.push(insertedDeck);
    return createQueryResult<Row>([createDeckQueryRow(insertedDeck) as unknown as Row]);
  }

  if (text.startsWith("UPDATE content.decks")) {
    const workspaceId = String(params[7]);
    const deckId = String(params[8]);
    const index = state.decks.findIndex((deck) => deck.workspace_id === workspaceId && deck.deck_id === deckId);
    if (index === -1) {
      return createQueryResult<Row>([]);
    }

    const current = state.decks[index];
    if (current === undefined) {
      return createQueryResult<Row>([]);
    }

    const updatedDeck: DeckState = {
      ...current,
      name: String(params[0]),
      filter_definition: JSON.parse(String(params[1])) as Readonly<Record<string, unknown>>,
      created_at: String(params[2]),
      deleted_at: params[3] === null ? null : String(params[3]),
      client_updated_at: String(params[4]),
      last_modified_by_replica_id: String(params[5]),
      last_operation_id: String(params[6]),
      updated_at: String(params[4]),
    };
    state.decks[index] = updatedDeck;
    return createQueryResult<Row>([createDeckQueryRow(updatedDeck) as unknown as Row]);
  }

  if (
    text.startsWith("INSERT INTO content.review_events")
    && text.includes("ON CONFLICT DO NOTHING")
  ) {
    const reviewEventId = String(params[0]);
    const workspaceId = String(params[1]);
    const replicaId = String(params[3]);
    const clientEventId = String(params[4]);
    const existingReviewEvent = state.reviewEvents.find((reviewEvent) => (
      reviewEvent.review_event_id === reviewEventId
      || (
        reviewEvent.workspace_id === workspaceId
        && reviewEvent.replica_id === replicaId
        && reviewEvent.client_event_id === clientEventId
      )
    ));
    if (existingReviewEvent !== undefined) {
      return createQueryResult<Row>([]);
    }

    const insertedReviewEvent: ReviewEventState = {
      review_event_id: reviewEventId,
      workspace_id: workspaceId,
      card_id: String(params[2]),
      replica_id: replicaId,
      client_event_id: clientEventId,
      rating: Number(params[5]),
      reviewed_at_client: String(params[6]),
      reviewed_at_server: String(params[7]),
    };
    state.reviewEvents.push(insertedReviewEvent);
    return createQueryResult<Row>([createReviewEventQueryRow(insertedReviewEvent) as unknown as Row]);
  }

  return null;
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

  const scope: GuestUpgradeExecutorScope = {
    requireCurrentUserScope,
    requireCurrentWorkspaceScope,
  };

  return {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<GuestUpgradeExecutorParam>,
    ): Promise<pg.QueryResult<Row>> {
      const scopeResult = handleExecutorScopeQuery<Row>(state, text, params);
      if (scopeResult !== null) {
        return scopeResult;
      }

      const authResult = handleAuthExecutorQuery<Row>(state, text, params);
      if (authResult !== null) {
        return authResult;
      }

      const userSettingsResult = handleUserSettingsExecutorQuery<Row>(state, text, params, scope);
      if (userSettingsResult !== null) {
        return userSettingsResult;
      }

      const workspaceResult = handleWorkspaceExecutorQuery<Row>(state, text, params, scope);
      if (workspaceResult !== null) {
        return workspaceResult;
      }

      const syncResult = handleSyncExecutorQuery<Row>(state, text, params, scope);
      if (syncResult !== null) {
        return syncResult;
      }

      const contentResult = handleContentExecutorQuery<Row>(state, text, params);
      if (contentResult !== null) {
        return contentResult;
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

function isGuestUpgradeMergeOnlyExecutorQuery(text: string): boolean {
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
    DROPPED_ENTITIES_UNSUPPORTED,
  );

  assert.equal(result.workspace.workspaceId, targetWorkspaceId);
  assert.equal(state.installations.get(installationId)?.user_id, targetUserId);
  assert.equal(state.userSettings.get(targetUserId)?.workspace_id, targetWorkspaceId);
  assert.equal(state.userSettings.has(guestUserId), false);
  assert.equal(state.workspaces.has(guestWorkspaceId), false);
  assert.equal(state.guestSession, null);
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
  addWorkspaceMembership(state, targetUserId, guestWorkspaceId, "member");

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
      DROPPED_ENTITIES_UNSUPPORTED,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "GUEST_UPGRADE_TARGET_SAME_AS_SOURCE");
      return true;
    },
  );

  assert.equal(state.guestSession?.revoked_at, null);
  assert.equal(state.guestUpgradeHistory.length, 0);
  assert.equal(state.installations.get(installationId)?.user_id, guestUserId);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
});

test("completeGuestUpgradeInExecutor rejects merge_required completion before guest sync is drained", async () => {
  const guestToken = "guest-token-not-drained";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const installationId = "installation-not-drained";
  const targetSubject = "cognito-subject-not-drained";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-not-drained",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId,
    guestReplicaId: "guest-replica-not-drained",
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });

  const executor = createGuestUpgradeExecutor(state);

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      targetSubject,
      {
        type: "existing",
        workspaceId: targetWorkspaceId,
      },
      GUEST_SYNC_NOT_DRAINED,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "GUEST_UPGRADE_GUEST_SYNC_NOT_DRAINED");
      assert.match(error.message, /guest outbox is empty/);
      return true;
    },
  );

  assert.equal(state.guestUpgradeHistory.length, 0);
  assert.equal(state.guestSession?.revoked_at, null);
  assert.equal(state.installations.get(installationId)?.user_id, guestUserId);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
});

test("completeGuestUpgradeInExecutor completes same-user bound path without guest drain or merge handling", async () => {
  const guestToken = "guest-token-bound-complete";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const linkedUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const installationId = "installation-bound-complete";
  const targetSubject = "cognito-subject-bound-complete";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-bound-complete",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId: linkedUserId,
    targetWorkspaceId,
    guestReplicaId: "guest-replica-bound-complete",
    installationId,
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.identityMappings.set(targetSubject, guestUserId);

  const mergeOnlyQueries: Array<string> = [];
  const baseExecutor = createGuestUpgradeExecutor(state);
  const executor: DatabaseExecutor = {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<GuestUpgradeExecutorParam>,
    ): Promise<pg.QueryResult<Row>> => {
      if (isGuestUpgradeMergeOnlyExecutorQuery(text)) {
        mergeOnlyQueries.push(text);
      }

      return baseExecutor.query<Row>(text, params);
    },
  };

  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    GUEST_SYNC_NOT_DRAINED,
  );

  assert.equal(result.workspace.workspaceId, guestWorkspaceId);
  assert.equal(result.outcome, "fresh_completion");
  assert.equal(result.targetUserId, guestUserId);
  assert.equal(result.targetWorkspaceId, guestWorkspaceId);
  assert.equal(Object.hasOwn(result, "droppedEntities"), false);
  assert.deepEqual(mergeOnlyQueries, []);
  assert.equal(state.guestUpgradeHistory.length, 0);
  assert.equal(state.guestReplicaAliases.length, 0);
  assert.equal(state.guestSession?.revoked_at, null);
  assert.equal(state.installations.get(installationId)?.user_id, guestUserId);
  assert.equal(state.userSettings.get(guestUserId)?.workspace_id, guestWorkspaceId);
  assert.equal(state.userSettings.get(linkedUserId)?.workspace_id, targetWorkspaceId);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
});

test("completeGuestUpgradeInExecutor preserves guest entity ids when merging into a different workspace", async () => {
  const guestToken = "guest-token-preserved-ids";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-preserved-ids";
  const targetSubject = "cognito-subject-preserved-ids";
  const sourceCardId = "11111111-1111-4111-8111-111111111111";
  const sourceDeckId = "22222222-2222-4222-8222-222222222222";
  const sourceReviewEventId = "33333333-3333-4333-8333-333333333333";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-preserved-ids",
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
  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    DROPPED_ENTITIES_UNSUPPORTED,
  );

  const targetCard = state.cards.find((card) => card.workspace_id === targetWorkspaceId);
  const targetDeck = state.decks.find((deck) => deck.workspace_id === targetWorkspaceId);
  const targetReviewEvent = state.reviewEvents.find((reviewEvent) => reviewEvent.workspace_id === targetWorkspaceId);

  assert.ok(targetCard);
  assert.equal(targetCard?.card_id, sourceCardId);

  assert.ok(targetDeck);
  assert.equal(targetDeck?.deck_id, sourceDeckId);

  assert.ok(targetReviewEvent);
  assert.equal(targetReviewEvent?.review_event_id, sourceReviewEventId);
  assert.equal(targetReviewEvent?.card_id, sourceCardId);
});

test("completeGuestUpgradeInExecutor repairs legacy invalid guest card fsrs state during merge", async () => {
  const guestToken = "guest-token-invalid-guest-card";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-invalid-guest-card";
  const targetSubject = "cognito-subject-invalid-guest-card";
  const sourceCardId = "77777777-7777-4777-8777-777777777777";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-invalid-guest-card",
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
    front_text: "Legacy invalid front",
    back_text: "Legacy invalid back",
    tags: ["legacy"],
    effort_level: "fast",
    due_at: "2026-04-03T14:00:00.000Z",
    created_at: "2026-04-02T14:00:02.000Z",
    reps: 3,
    lapses: 1,
    fsrs_card_state: "new",
    fsrs_step_index: 0,
    fsrs_stability: 0.212,
    fsrs_difficulty: 6.4133,
    fsrs_last_reviewed_at: "2026-04-02T14:00:01.000Z",
    fsrs_scheduled_days: 1,
    client_updated_at: "2026-04-02T14:00:03.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-invalid-card-op",
    updated_at: "2026-04-02T14:00:03.000Z",
    deleted_at: null,
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
    DROPPED_ENTITIES_UNSUPPORTED,
  );

  const targetCard = state.cards.find((card) => (
    card.workspace_id === targetWorkspaceId
    && card.card_id === sourceCardId
  ));

  assert.ok(targetCard);
  assert.equal(targetCard?.due_at, null);
  assert.equal(targetCard?.reps, 0);
  assert.equal(targetCard?.lapses, 0);
  assert.equal(targetCard?.fsrs_card_state, "new");
  assert.equal(targetCard?.fsrs_step_index, null);
  assert.equal(targetCard?.fsrs_stability, null);
  assert.equal(targetCard?.fsrs_difficulty, null);
  assert.equal(targetCard?.fsrs_last_reviewed_at, null);
  assert.equal(targetCard?.fsrs_scheduled_days, null);
});

test("completeGuestUpgradeInExecutor resolves same-id merge conflicts with LWW cards and idempotent review events", async () => {
  const guestToken = "guest-token-same-id-conflicts";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-same-id-conflicts";
  const targetSubject = "cognito-subject-same-id-conflicts";
  const sharedCardId = "44444444-4444-4444-8444-444444444444";
  const sharedDeckId = "55555555-5555-4555-8555-555555555555";
  const sharedReviewEventId = "66666666-6666-4666-8666-666666666666";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-same-id-conflicts",
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
    card_id: sharedCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest newer front",
    back_text: "Guest newer back",
    tags: ["guest"],
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
  state.cards.push({
    card_id: sharedCardId,
    workspace_id: targetWorkspaceId,
    front_text: "Target older front",
    back_text: "Target older back",
    tags: ["target"],
    effort_level: "medium",
    due_at: null,
    created_at: "2026-04-02T13:59:59.000Z",
    reps: 1,
    lapses: 0,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
    client_updated_at: "2026-04-02T14:00:00.000Z",
    last_modified_by_replica_id: "target-replica-existing",
    last_operation_id: "target-card-op",
    updated_at: "2026-04-02T14:00:00.000Z",
    deleted_at: null,
  });
  state.decks.push({
    deck_id: sharedDeckId,
    workspace_id: guestWorkspaceId,
    name: "Guest older deck",
    filter_definition: {
      version: 2,
      effortLevels: ["fast"],
      tags: ["guest"],
    },
    created_at: "2026-04-02T14:00:04.000Z",
    client_updated_at: "2026-04-02T14:00:05.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-deck-op",
    updated_at: "2026-04-02T14:00:05.000Z",
    deleted_at: null,
  });
  state.decks.push({
    deck_id: sharedDeckId,
    workspace_id: targetWorkspaceId,
    name: "Target newer deck",
    filter_definition: {
      version: 2,
      effortLevels: ["medium"],
      tags: ["target"],
    },
    created_at: "2026-04-02T13:59:59.000Z",
    client_updated_at: "2026-04-02T14:10:00.000Z",
    last_modified_by_replica_id: "target-replica-existing",
    last_operation_id: "target-deck-op",
    updated_at: "2026-04-02T14:10:00.000Z",
    deleted_at: null,
  });
  state.reviewEvents.push({
    review_event_id: sharedReviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: sharedCardId,
    replica_id: guestReplicaId,
    client_event_id: "guest-client-event-1",
    rating: 2,
    reviewed_at_client: "2026-04-02T14:00:06.000Z",
    reviewed_at_server: "2026-04-02T14:00:06.000Z",
  });
  state.reviewEvents.push({
    review_event_id: sharedReviewEventId,
    workspace_id: targetWorkspaceId,
    card_id: sharedCardId,
    replica_id: "target-replica-existing",
    client_event_id: "target-client-event-1",
    rating: 4,
    reviewed_at_client: "2026-04-02T14:10:06.000Z",
    reviewed_at_server: "2026-04-02T14:10:06.000Z",
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
    DROPPED_ENTITIES_UNSUPPORTED,
  );

  const mergedCards = state.cards.filter((card) => card.card_id === sharedCardId);
  const mergedDecks = state.decks.filter((deck) => deck.deck_id === sharedDeckId);
  const mergedReviewEvents = state.reviewEvents.filter((reviewEvent) => reviewEvent.review_event_id === sharedReviewEventId);

  assert.equal(mergedCards.length, 1);
  assert.equal(mergedCards[0]?.workspace_id, targetWorkspaceId);
  assert.equal(mergedCards[0]?.front_text, "Guest newer front");
  assert.equal(mergedCards[0]?.back_text, "Guest newer back");

  assert.equal(mergedDecks.length, 1);
  assert.equal(mergedDecks[0]?.workspace_id, targetWorkspaceId);
  assert.equal(mergedDecks[0]?.name, "Target newer deck");

  assert.equal(mergedReviewEvents.length, 1);
  assert.equal(mergedReviewEvents[0]?.workspace_id, targetWorkspaceId);
  assert.equal(mergedReviewEvents[0]?.rating, 4);
});

test("completeGuestUpgradeInExecutor drops review events deduped to a different target id for capable clients", async () => {
  const fixture = createReviewEventClientEventDedupMergeFixture();
  const executor = createGuestUpgradeExecutor(fixture.state);
  const result = await completeGuestUpgradeInExecutor(
    executor,
    fixture.guestToken,
    fixture.targetSubject,
    {
      type: "existing",
      workspaceId: fixture.targetWorkspaceId,
    },
    DROPPED_ENTITIES_SUPPORTED,
  );

  assert.equal(result.outcome, "fresh_completion");
  assert.deepEqual(result.droppedEntities, {
    cardIds: [],
    deckIds: [],
    reviewEventIds: [fixture.guestReviewEventId],
  });
  assert.deepEqual(fixture.state.guestUpgradeHistory[0]?.dropped_entities, {
    cardIds: [],
    deckIds: [],
    reviewEventIds: [fixture.guestReviewEventId],
  });

  const targetReviewEvents = fixture.state.reviewEvents.filter((reviewEvent) => (
    reviewEvent.workspace_id === fixture.targetWorkspaceId
  ));
  assert.equal(targetReviewEvents.length, 1);
  assert.equal(targetReviewEvents[0]?.review_event_id, fixture.targetReviewEventId);
  assert.equal(
    targetReviewEvents.some((reviewEvent) => reviewEvent.review_event_id === fixture.guestReviewEventId),
    false,
  );

  const targetCard = fixture.state.cards.find((card) => (
    card.workspace_id === fixture.targetWorkspaceId
    && card.card_id === fixture.cardId
  ));
  assert.ok(targetCard);
  assert.equal(targetCard?.front_text, "Guest front");
});

test("completeGuestUpgradeInExecutor rejects review events deduped to a different target id without droppedEntities support", async () => {
  const fixture = createReviewEventClientEventDedupMergeFixture();
  const executor = createGuestUpgradeExecutor(fixture.state);

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      fixture.guestToken,
      fixture.targetSubject,
      {
        type: "existing",
        workspaceId: fixture.targetWorkspaceId,
      },
      DROPPED_ENTITIES_UNSUPPORTED,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "GUEST_UPGRADE_DROPPED_ENTITIES_UNSUPPORTED");
      assert.match(error.message, new RegExp(fixture.guestReviewEventId));
      assert.match(error.message, new RegExp(fixture.targetReviewEventId));
      return true;
    },
  );

  assert.equal(fixture.state.guestUpgradeHistory.length, 0);
  assert.equal(fixture.state.guestSession?.revoked_at, null);
  assert.equal(
    fixture.state.reviewEvents.some((reviewEvent) => (
      reviewEvent.workspace_id === fixture.targetWorkspaceId
      && reviewEvent.review_event_id === fixture.guestReviewEventId
    )),
    false,
  );
});

test("completeGuestUpgradeInExecutor drops guest entities on third-workspace global-id conflicts and continues", async () => {
  const guestToken = "guest-token-third-workspace-conflicts";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-third-workspace-conflicts";
  const targetSubject = "cognito-subject-third-workspace-conflicts";
  const thirdUserId = "third-user";
  const thirdWorkspaceId = "third-workspace";
  const conflictingCardId = "77777777-7777-4777-8777-777777777777";
  const mergedCardId = "88888888-8888-4888-8888-888888888888";
  const conflictingDeckId = "99999999-9999-4999-8999-999999999999";
  const conflictingReviewEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const skippedReviewEventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const mergedReviewEventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-third-workspace-conflicts",
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
  state.userSettings.set(
    thirdUserId,
    createUserSettingsState(thirdUserId, thirdWorkspaceId, "third@example.com"),
  );
  state.workspaces.set(
    thirdWorkspaceId,
    createWorkspaceState(
      thirdWorkspaceId,
      "Third workspace",
      "2026-04-02T13:30:00.000Z",
      "2026-04-02T13:30:00.000Z",
      "third-replica-existing",
      "third-op",
    ),
  );
  addWorkspaceMembership(state, thirdUserId, thirdWorkspaceId, "owner");
  state.cards.push({
    card_id: conflictingCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest conflicting front",
    back_text: "Guest conflicting back",
    tags: ["guest-conflict"],
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
    last_operation_id: "guest-conflicting-card-op",
    updated_at: "2026-04-02T14:00:03.000Z",
    deleted_at: null,
  });
  state.cards.push({
    card_id: mergedCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest kept front",
    back_text: "Guest kept back",
    tags: ["guest-kept"],
    effort_level: "medium",
    due_at: null,
    created_at: "2026-04-02T14:00:04.000Z",
    reps: 0,
    lapses: 0,
    fsrs_card_state: "new",
    fsrs_step_index: null,
    fsrs_stability: null,
    fsrs_difficulty: null,
    fsrs_last_reviewed_at: null,
    fsrs_scheduled_days: null,
    client_updated_at: "2026-04-02T14:00:05.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-kept-card-op",
    updated_at: "2026-04-02T14:00:05.000Z",
    deleted_at: null,
  });
  state.cards.push({
    card_id: conflictingCardId,
    workspace_id: thirdWorkspaceId,
    front_text: "Third workspace front",
    back_text: "Third workspace back",
    tags: ["third"],
    effort_level: "long",
    due_at: null,
    created_at: "2026-04-02T13:30:02.000Z",
    reps: 5,
    lapses: 1,
    fsrs_card_state: "review",
    fsrs_step_index: null,
    fsrs_stability: 3.5,
    fsrs_difficulty: 5.1,
    fsrs_last_reviewed_at: "2026-04-01T13:30:00.000Z",
    fsrs_scheduled_days: 4,
    client_updated_at: "2026-04-02T13:30:03.000Z",
    last_modified_by_replica_id: "third-replica-existing",
    last_operation_id: "third-card-op",
    updated_at: "2026-04-02T13:30:03.000Z",
    deleted_at: null,
  });
  state.decks.push({
    deck_id: conflictingDeckId,
    workspace_id: guestWorkspaceId,
    name: "Guest conflicting deck",
    filter_definition: {
      version: 2,
      effortLevels: ["fast"],
      tags: ["guest-conflict"],
    },
    created_at: "2026-04-02T14:00:06.000Z",
    client_updated_at: "2026-04-02T14:00:07.000Z",
    last_modified_by_replica_id: guestReplicaId,
    last_operation_id: "guest-conflicting-deck-op",
    updated_at: "2026-04-02T14:00:07.000Z",
    deleted_at: null,
  });
  state.decks.push({
    deck_id: conflictingDeckId,
    workspace_id: thirdWorkspaceId,
    name: "Third workspace deck",
    filter_definition: {
      version: 2,
      effortLevels: ["long"],
      tags: ["third"],
    },
    created_at: "2026-04-02T13:30:04.000Z",
    client_updated_at: "2026-04-02T13:30:05.000Z",
    last_modified_by_replica_id: "third-replica-existing",
    last_operation_id: "third-deck-op",
    updated_at: "2026-04-02T13:30:05.000Z",
    deleted_at: null,
  });
  state.reviewEvents.push({
    review_event_id: skippedReviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: conflictingCardId,
    replica_id: guestReplicaId,
    client_event_id: "guest-skipped-client-event",
    rating: 1,
    reviewed_at_client: "2026-04-02T14:00:08.000Z",
    reviewed_at_server: "2026-04-02T14:00:08.000Z",
  });
  state.reviewEvents.push({
    review_event_id: conflictingReviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: mergedCardId,
    replica_id: guestReplicaId,
    client_event_id: "guest-conflicting-review-event",
    rating: 2,
    reviewed_at_client: "2026-04-02T14:00:09.000Z",
    reviewed_at_server: "2026-04-02T14:00:09.000Z",
  });
  state.reviewEvents.push({
    review_event_id: mergedReviewEventId,
    workspace_id: guestWorkspaceId,
    card_id: mergedCardId,
    replica_id: guestReplicaId,
    client_event_id: "guest-kept-review-event",
    rating: 3,
    reviewed_at_client: "2026-04-02T14:00:10.000Z",
    reviewed_at_server: "2026-04-02T14:00:10.000Z",
  });
  state.reviewEvents.push({
    review_event_id: conflictingReviewEventId,
    workspace_id: thirdWorkspaceId,
    card_id: conflictingCardId,
    replica_id: "third-replica-existing",
    client_event_id: "third-review-event",
    rating: 4,
    reviewed_at_client: "2026-04-02T13:30:06.000Z",
    reviewed_at_server: "2026-04-02T13:30:06.000Z",
  });

  const expectedDroppedEntities = {
    cardIds: [conflictingCardId],
    deckIds: [conflictingDeckId],
    reviewEventIds: [skippedReviewEventId, conflictingReviewEventId],
  };

  const executor = createGuestUpgradeExecutor(state);
  const firstResult = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    DROPPED_ENTITIES_SUPPORTED,
  );
  const secondResult = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    DROPPED_ENTITIES_SUPPORTED,
  );

  assert.equal(firstResult.outcome, "fresh_completion");
  assert.deepEqual(firstResult.droppedEntities, expectedDroppedEntities);
  assert.equal(secondResult.outcome, "idempotent_replay");
  assert.deepEqual(secondResult.droppedEntities, expectedDroppedEntities);
  assert.deepEqual(state.guestUpgradeHistory[0]?.dropped_entities, expectedDroppedEntities);

  assert.equal(state.cards.some((card) => card.workspace_id === guestWorkspaceId), false);
  assert.equal(state.decks.some((deck) => deck.workspace_id === guestWorkspaceId), false);
  assert.equal(state.reviewEvents.some((reviewEvent) => reviewEvent.workspace_id === guestWorkspaceId), false);

  const keptTargetCard = state.cards.find((card) => (
    card.workspace_id === targetWorkspaceId
    && card.card_id === mergedCardId
  ));
  assert.ok(keptTargetCard);
  assert.equal(keptTargetCard?.front_text, "Guest kept front");
  assert.equal(keptTargetCard?.back_text, "Guest kept back");

  const conflictingCards = state.cards.filter((card) => card.card_id === conflictingCardId);
  assert.equal(conflictingCards.length, 1);
  assert.equal(conflictingCards[0]?.workspace_id, thirdWorkspaceId);

  const conflictingDecks = state.decks.filter((deck) => deck.deck_id === conflictingDeckId);
  assert.equal(conflictingDecks.length, 1);
  assert.equal(conflictingDecks[0]?.workspace_id, thirdWorkspaceId);

  assert.equal(
    state.reviewEvents.some((reviewEvent) => (
      reviewEvent.workspace_id === targetWorkspaceId
      && reviewEvent.review_event_id === skippedReviewEventId
    )),
    false,
  );

  const keptTargetReviewEvent = state.reviewEvents.find((reviewEvent) => (
    reviewEvent.workspace_id === targetWorkspaceId
    && reviewEvent.review_event_id === mergedReviewEventId
  ));
  assert.ok(keptTargetReviewEvent);
  assert.equal(keptTargetReviewEvent?.card_id, mergedCardId);
  assert.equal(keptTargetReviewEvent?.rating, 3);

  const conflictingReviewEvents = state.reviewEvents.filter((reviewEvent) => (
    reviewEvent.review_event_id === conflictingReviewEventId
  ));
  assert.equal(conflictingReviewEvents.length, 1);
  assert.equal(conflictingReviewEvents[0]?.workspace_id, thirdWorkspaceId);
});

test("completeGuestUpgradeInExecutor rejects third-workspace global-id conflicts without droppedEntities support", async () => {
  const guestToken = "guest-token-third-workspace-unsupported";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica";
  const installationId = "installation-third-workspace-unsupported";
  const targetSubject = "cognito-subject-third-workspace-unsupported";
  const thirdUserId = "third-user";
  const thirdWorkspaceId = "third-workspace";
  const conflictingCardId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-third-workspace-unsupported",
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
  state.userSettings.set(
    thirdUserId,
    createUserSettingsState(thirdUserId, thirdWorkspaceId, "third@example.com"),
  );
  state.workspaces.set(
    thirdWorkspaceId,
    createWorkspaceState(
      thirdWorkspaceId,
      "Third workspace",
      "2026-04-02T13:30:00.000Z",
      "2026-04-02T13:30:00.000Z",
      "third-replica-existing",
      "third-op",
    ),
  );
  addWorkspaceMembership(state, thirdUserId, thirdWorkspaceId, "owner");
  state.cards.push({
    card_id: conflictingCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest conflicting front",
    back_text: "Guest conflicting back",
    tags: ["guest-conflict"],
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
    last_operation_id: "guest-conflicting-card-op",
    updated_at: "2026-04-02T14:00:03.000Z",
    deleted_at: null,
  });
  state.cards.push({
    card_id: conflictingCardId,
    workspace_id: thirdWorkspaceId,
    front_text: "Third workspace front",
    back_text: "Third workspace back",
    tags: ["third"],
    effort_level: "long",
    due_at: null,
    created_at: "2026-04-02T13:30:02.000Z",
    reps: 5,
    lapses: 1,
    fsrs_card_state: "review",
    fsrs_step_index: null,
    fsrs_stability: 3.5,
    fsrs_difficulty: 5.1,
    fsrs_last_reviewed_at: "2026-04-01T13:30:00.000Z",
    fsrs_scheduled_days: 4,
    client_updated_at: "2026-04-02T13:30:03.000Z",
    last_modified_by_replica_id: "third-replica-existing",
    last_operation_id: "third-card-op",
    updated_at: "2026-04-02T13:30:03.000Z",
    deleted_at: null,
  });

  const executor = createGuestUpgradeExecutor(state);

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      targetSubject,
      {
        type: "existing",
        workspaceId: targetWorkspaceId,
      },
      DROPPED_ENTITIES_UNSUPPORTED,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "GUEST_UPGRADE_DROPPED_ENTITIES_UNSUPPORTED");
      assert.equal(error.message.includes(thirdWorkspaceId), false);
      assert.deepEqual(error.details?.syncConflict, {
        phase: "guest_upgrade_merge",
        entityType: "card",
        entityId: conflictingCardId,
        conflictingWorkspaceId: thirdWorkspaceId,
        constraint: null,
        sqlState: null,
        table: null,
        recoverable: true,
      });
      return true;
    },
  );

  assert.equal(state.guestUpgradeHistory.length, 0);
  assert.equal(state.guestSession?.revoked_at, null);
  assert.equal(
    state.cards.some((card) => (
      card.workspace_id === targetWorkspaceId
      && card.card_id === conflictingCardId
    )),
    false,
  );
});

test("completeGuestUpgradeInExecutor aborts when a conflict still points at the source guest workspace after cleanup", async () => {
  const guestToken = "guest-token-source-conflict";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const guestReplicaId = "guest-replica-source-conflict";
  const installationId = "installation-source-conflict";
  const targetSubject = "cognito-subject-source-conflict";
  const conflictingCardId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-source-conflict",
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
    card_id: conflictingCardId,
    workspace_id: guestWorkspaceId,
    front_text: "Guest source front",
    back_text: "Guest source back",
    tags: ["guest-source"],
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
    last_operation_id: "guest-source-card-op",
    updated_at: "2026-04-02T14:00:03.000Z",
    deleted_at: null,
  });

  const baseExecutor = createGuestUpgradeExecutor(state);
  const executor: DatabaseExecutor = {
    query: async (text, params) => {
      if (text === "DELETE FROM content.cards WHERE workspace_id = $1") {
        return createQueryResult([]);
      }

      return baseExecutor.query(text, params);
    },
  };

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      targetSubject,
      {
        type: "existing",
        workspaceId: targetWorkspaceId,
      },
      DROPPED_ENTITIES_UNSUPPORTED,
    ),
    (error: unknown) => (
      error instanceof Error
      && error.message
        === "Guest merge cleanup invariant failed for card dddddddd-dddd-4ddd-8ddd-dddddddddddd: "
          + "source workspace guest-workspace still owns the conflicting id after cleanup"
    ),
  );

  assert.equal(
    state.cards.some((card) => (
      card.workspace_id === targetWorkspaceId
      && card.card_id === conflictingCardId
    )),
    false,
  );
  assert.equal(state.cards.filter((card) => card.card_id === conflictingCardId).length, 1);
  assert.equal(state.cards[0]?.workspace_id, guestWorkspaceId);
  assert.equal(state.guestSession?.revoked_at, null);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
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

  assert.equal(state.guestSession, null);
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

  assert.equal(state.guestSession, null);
  assert.equal(state.userSettings.has(guestUserId), false);
  assert.equal(state.workspaces.has(guestWorkspaceId), false);
});

test("deleteGuestSessionInExecutor rejects guest cleanup when the guest user is not the workspace owner", async () => {
  const guestToken = "guest-token-delete-non-owner";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-delete-non-owner",
    guestUserId,
    guestWorkspaceId,
    targetSubject: "cognito-subject-delete-non-owner",
    targetUserId: "linked-user",
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica-delete-non-owner",
    installationId: "installation-delete-non-owner",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.workspaceMembershipRoles.set(membershipKey(guestUserId, guestWorkspaceId), "member");

  const executor = createGuestUpgradeExecutor(state);

  await assert.rejects(
    deleteGuestSessionInExecutor(executor, guestToken),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, "WORKSPACE_OWNER_REQUIRED");
      return true;
    },
  );

  assert.equal(state.guestSession?.revoked_at, null);
  assert.equal(state.userSettings.has(guestUserId), true);
  assert.equal(state.workspaces.has(guestWorkspaceId), true);
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
  addWorkspaceMembership(state, "shared-user", guestWorkspaceId, "member");

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

  assert.equal(state.guestSession?.revoked_at, null);
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

  assert.equal(state.guestSession?.revoked_at, null);
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
    DROPPED_ENTITIES_UNSUPPORTED,
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
    DROPPED_ENTITIES_UNSUPPORTED,
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
    DROPPED_ENTITIES_UNSUPPORTED,
  );

  const targetWorkspace = state.workspaces.get(targetWorkspaceId);
  assert.equal(targetWorkspace?.fsrs_client_updated_at, "2026-04-02T14:05:00.000Z");
  assert.equal(targetWorkspace?.fsrs_last_modified_by_replica_id, "target-replica-existing");
});

test("completeGuestUpgradeInExecutor replays committed history after guest session cleanup", async () => {
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
    DROPPED_ENTITIES_UNSUPPORTED,
  );
  assert.equal(firstResult.outcome, "fresh_completion");
  assert.equal(state.guestSession, null);

  const secondResult = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    DROPPED_ENTITIES_UNSUPPORTED,
  );

  assert.equal(secondResult.outcome, "idempotent_replay");
  assert.equal(secondResult.workspace.workspaceId, targetWorkspaceId);
  assert.equal(secondResult.targetUserId, targetUserId);
  assert.equal(state.guestUpgradeHistory.length, 1);
  assert.equal(state.guestUpgradeHistory[0]?.source_guest_session_secret_hash, hashGuestToken(guestToken));
  assert.notEqual(state.guestUpgradeHistory[0]?.source_guest_session_secret_hash, guestToken);
});

test("completeGuestUpgradeInExecutor replays deleted-session history without guest drain when no entities were dropped", async () => {
  const guestToken = "guest-token-legacy-replay";
  const guestUserId = "guest-user";
  const guestWorkspaceId = "guest-workspace";
  const targetUserId = "linked-user";
  const targetWorkspaceId = "target-workspace";
  const targetSubject = "cognito-subject-legacy-replay";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-legacy-replay",
    guestUserId,
    guestWorkspaceId,
    targetSubject,
    targetUserId,
    targetWorkspaceId,
    guestReplicaId: "guest-replica-legacy-replay",
    installationId: "installation-legacy-replay",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
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
    DROPPED_ENTITIES_UNSUPPORTED,
  );
  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubject,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
    LEGACY_REPLAY_CAPABILITIES,
  );

  assert.equal(result.outcome, "idempotent_replay");
  assert.equal(result.workspace.workspaceId, targetWorkspaceId);
  assert.equal(result.targetUserId, targetUserId);
  assert.equal(Object.hasOwn(result, "droppedEntities"), false);
  assert.equal(state.guestUpgradeHistory.length, 1);
});

test("completeGuestUpgradeInExecutor rejects missing guest session without replay history", async () => {
  const guestToken = "guest-token-missing-no-history";
  const targetWorkspaceId = "target-workspace";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-missing-no-history",
    guestUserId: "guest-user",
    guestWorkspaceId: "guest-workspace",
    targetSubject: "cognito-subject-missing-no-history",
    targetUserId: "linked-user",
    targetWorkspaceId,
    guestReplicaId: "guest-replica-missing-no-history",
    installationId: "installation-missing-no-history",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.guestSession = null;

  const executor = createGuestUpgradeExecutor(state);

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      "cognito-subject-missing-no-history",
      {
        type: "existing",
        workspaceId: targetWorkspaceId,
      },
      DROPPED_ENTITIES_UNSUPPORTED,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "GUEST_AUTH_INVALID");
      return true;
    },
  );
});

test("completeGuestUpgradeInExecutor rejects deleted-session replay with dropped entities for legacy clients", async () => {
  const fixture = createReviewEventClientEventDedupMergeFixture();
  const executor = createGuestUpgradeExecutor(fixture.state);
  await completeGuestUpgradeInExecutor(
    executor,
    fixture.guestToken,
    fixture.targetSubject,
    {
      type: "existing",
      workspaceId: fixture.targetWorkspaceId,
    },
    DROPPED_ENTITIES_SUPPORTED,
  );

  await assert.rejects(
    completeGuestUpgradeInExecutor(
      executor,
      fixture.guestToken,
      fixture.targetSubject,
      {
        type: "existing",
        workspaceId: fixture.targetWorkspaceId,
      },
      LEGACY_REPLAY_CAPABILITIES,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "GUEST_UPGRADE_DROPPED_ENTITIES_UNSUPPORTED");
      return true;
    },
  );

  assert.deepEqual(fixture.state.guestUpgradeHistory[0]?.dropped_entities, {
    cardIds: [],
    deckIds: [],
    reviewEventIds: [fixture.guestReviewEventId],
  });
  assert.equal(fixture.state.guestSession, null);
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
    workspaceMembershipRoles: new Map<string, WorkspaceMembershipRole>([
      [membershipKey("linked-user", targetWorkspaceId), "owner"],
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
      source_guest_session_secret_hash: hashGuestToken(guestToken),
      target_subject_user_id: "original-subject",
      target_user_id: "linked-user",
      target_workspace_id: targetWorkspaceId,
      selection_type: "existing",
      dropped_entities: null,
    }],
    guestReplicaAliases: [],
    hotChanges: [],
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
      DROPPED_ENTITIES_UNSUPPORTED,
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
    workspaceMembershipRoles: new Map<string, WorkspaceMembershipRole>(),
    workspaceReplicas: [],
    installations: new Map<string, InstallationState>(),
    cards: [],
    decks: [],
    reviewEvents: [],
    guestUpgradeHistory: [],
    guestReplicaAliases: [],
    hotChanges: [],
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
      DROPPED_ENTITIES_UNSUPPORTED,
    ),
    (error: unknown) => (
      error instanceof HttpError
      && error.statusCode === 401
      && error.code === "GUEST_AUTH_INVALID"
    ),
  );
});
