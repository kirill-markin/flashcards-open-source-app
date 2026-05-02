import assert from "node:assert/strict";
import test from "node:test";
import { completeGuestUpgradeInExecutor } from "../../guestAuth";
import {
  createGuestUpgradeExecutor,
  createMergeState,
  DROPPED_ENTITIES_UNSUPPORTED,
} from "../../guestAuthTestHarness";

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
