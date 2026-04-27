import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type pg from "pg";
import type { DatabaseExecutor } from "./db";
import type { GuestUpgradeCompleteCapabilities } from "./guestAuth";

export type GuestSessionState = Readonly<{
  session_id: string;
  session_secret_hash: string;
  user_id: string;
  revoked_at: string | null;
}>;

export type UserSettingsState = Readonly<{
  user_id: string;
  workspace_id: string | null;
  email: string | null;
}>;

export type WorkspaceState = Readonly<{
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

export type WorkspaceReplicaState = Readonly<{
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

export type InstallationState = Readonly<{
  installation_id: string;
  user_id: string;
  platform: "ios" | "android" | "web";
  app_version: string | null;
}>;

export type CardState = Readonly<{
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

export type DeckState = Readonly<{
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

export type ReviewEventState = Readonly<{
  review_event_id: string;
  workspace_id: string;
  card_id: string;
  replica_id: string;
  client_event_id: string;
  rating: number;
  reviewed_at_client: string;
  reviewed_at_server: string;
}>;

export type WorkspaceMembershipRole = "owner" | "member";

export type GuestUpgradeHistoryState = Readonly<{
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

export type GuestReplicaAliasState = Readonly<{
  source_guest_replica_id: string;
  upgrade_id: string;
  target_replica_id: string;
}>;

export type HotChangeState = Readonly<{
  change_id: number;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
}>;

export type ReviewEventClientEventDedupMergeFixture = Readonly<{
  state: MutableState;
  guestToken: string;
  targetSubject: string;
  targetWorkspaceId: string;
  cardId: string;
  guestReviewEventId: string;
  targetReviewEventId: string;
}>;

export const DROPPED_ENTITIES_UNSUPPORTED: GuestUpgradeCompleteCapabilities = {
  guestWorkspaceSyncedAndOutboxDrained: true,
  requiresGuestWorkspaceSyncedAndOutboxDrained: true,
  supportsDroppedEntities: false,
};

export const DROPPED_ENTITIES_SUPPORTED: GuestUpgradeCompleteCapabilities = {
  guestWorkspaceSyncedAndOutboxDrained: true,
  requiresGuestWorkspaceSyncedAndOutboxDrained: true,
  supportsDroppedEntities: true,
};

export const GUEST_SYNC_NOT_DRAINED: GuestUpgradeCompleteCapabilities = {
  guestWorkspaceSyncedAndOutboxDrained: false,
  requiresGuestWorkspaceSyncedAndOutboxDrained: true,
  supportsDroppedEntities: true,
};

export const LEGACY_REPLAY_CAPABILITIES: GuestUpgradeCompleteCapabilities = {
  guestWorkspaceSyncedAndOutboxDrained: false,
  requiresGuestWorkspaceSyncedAndOutboxDrained: false,
  supportsDroppedEntities: false,
};

export type MutableState = {
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

export function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

export function membershipKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}

export function addWorkspaceMembership(
  state: MutableState,
  userId: string,
  workspaceId: string,
  role: WorkspaceMembershipRole,
): void {
  const key = membershipKey(userId, workspaceId);
  state.workspaceMemberships.add(key);
  state.workspaceMembershipRoles.set(key, role);
}

export function hashGuestToken(guestToken: string): string {
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

export function createUserSettingsState(userId: string, workspaceId: string | null, email: string | null): UserSettingsState {
  return {
    user_id: userId,
    workspace_id: workspaceId,
    email,
  };
}

export function createWorkspaceState(
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

export function createMergeState(params: Readonly<{
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

export function createReviewEventClientEventDedupMergeFixture(): ReviewEventClientEventDedupMergeFixture {
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

export type GuestUpgradeExecutorParam = string | number | boolean | Date | null | ReadonlyArray<string>;

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
