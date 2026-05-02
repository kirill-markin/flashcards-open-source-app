import assert from "node:assert/strict";
import test from "node:test";
import { prepareGuestUpgradeInExecutor } from "../../guestAuth";
import {
  createGuestUpgradeExecutor,
  createMergeState,
} from "../../guestAuthTestHarness";

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
