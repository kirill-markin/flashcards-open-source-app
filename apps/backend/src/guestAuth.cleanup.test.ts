import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./errors";
import {
  deleteGuestSessionInExecutor,
  prepareGuestUpgradeInExecutor,
} from "./guestAuth";
import { cleanupGuestSessionSourceInExecutor } from "./guestAuth/delete";
import {
  addWorkspaceMembership,
  createGuestUpgradeExecutor,
  createMergeState,
  membershipKey,
} from "./guestAuth.testHarness";

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
