import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../errors";
import { completeGuestUpgradeInExecutor } from "../../guestAuth";
import {
  createGuestUpgradeExecutor,
  createMergeState,
  createReviewEventClientEventDedupMergeFixture,
  createUserSettingsState,
  createWorkspaceState,
  DROPPED_ENTITIES_SUPPORTED,
  DROPPED_ENTITIES_UNSUPPORTED,
  hashGuestToken,
  LEGACY_REPLAY_CAPABILITIES,
  membershipKey,
  type InstallationState,
  type MutableState,
  type UserSettingsState,
  type WorkspaceMembershipRole,
  type WorkspaceState,
} from "../../guestAuthTestHarness";

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
