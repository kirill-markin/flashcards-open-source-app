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

export type ReviewEventClientEventDedupMergeFixture = Readonly<{
  state: MutableState;
  guestToken: string;
  targetSubject: string;
  targetWorkspaceId: string;
  cardId: string;
  guestReviewEventId: string;
  targetReviewEventId: string;
}>;

export type GuestUpgradeExecutorParam = string | number | boolean | Date | null | ReadonlyArray<string>;

export type GuestUpgradeExecutorScope = Readonly<{
  requireCurrentUserScope: (userId: string) => void;
  requireCurrentWorkspaceScope: (userId: string, workspaceId: string) => void;
}>;

export type GuestUpgradeHandlerContext = Readonly<{
  state: MutableState;
  scope: GuestUpgradeExecutorScope;
}>;

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
