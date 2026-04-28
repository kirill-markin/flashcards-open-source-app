import { createHash } from "node:crypto";
import type { GuestUpgradeCompleteCapabilities } from "../guestAuth";
import {
  membershipKey,
  type CardState,
  type InstallationState,
  type MutableState,
  type ReviewEventClientEventDedupMergeFixture,
  type UserSettingsState,
  type WorkspaceMembershipRole,
  type WorkspaceReplicaState,
  type WorkspaceState,
} from "./models";

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
  } satisfies WorkspaceReplicaState);
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
  } satisfies CardState);
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
  } satisfies CardState);
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
