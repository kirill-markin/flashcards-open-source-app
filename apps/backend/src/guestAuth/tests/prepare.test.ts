import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "../../database";
import { hashDeletedSubject } from "../../auth/deletedSubjects";
import { HttpError } from "../../shared/errors";
import { prepareGuestUpgradeInExecutor } from "..";
import {
  createGuestUpgradeExecutor,
  createMergeState,
  type GuestUpgradeExecutorParam,
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

test("prepareGuestUpgradeInExecutor self-binds an existing fallback profile and preserves the guest", async () => {
  const guestToken = "guest-token-prepare-fallback";
  const guestUserId = "guest-user";
  const cognitoSubject = "cognito-subject-fallback";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-prepare-fallback",
    guestUserId,
    guestWorkspaceId: "guest-workspace",
    targetSubject: cognitoSubject,
    targetUserId: cognitoSubject,
    targetWorkspaceId: "fallback-workspace",
    guestReplicaId: "guest-replica",
    installationId: "installation-prepare-fallback",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.identityMappings.clear();

  const result = await prepareGuestUpgradeInExecutor(
    createGuestUpgradeExecutor(state),
    guestToken,
    cognitoSubject,
    "fallback@example.com",
  );

  assert.equal(result.mode, "merge_required");
  assert.equal(state.identityMappings.get(cognitoSubject), cognitoSubject);
  assert.equal(state.guestSession?.user_id, guestUserId);
  assert.equal(state.userSettings.get(guestUserId)?.email, null);
  assert.equal(state.userSettings.has(guestUserId), true);
  assert.equal(state.workspaces.has("guest-workspace"), true);
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
  assert.equal(state.identityMappings.get("cognito-subject-prepare-merge"), "linked-user");
  assert.equal(state.guestSession?.user_id, "guest-user");
  assert.equal(state.userSettings.get("guest-user")?.email, null);
});

test("prepareGuestUpgradeInExecutor takes the identity lock before user and guest-session locks", async () => {
  const guestToken = "guest-token-prepare-lock-order";
  const cognitoSubject = "cognito-subject-prepare-lock-order";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-prepare-lock-order",
    guestUserId: "guest-user",
    guestWorkspaceId: "guest-workspace",
    targetSubject: cognitoSubject,
    targetUserId: "linked-user",
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica",
    installationId: "installation-prepare-lock-order",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.identityMappings.clear();
  const recordedQueries: Array<Readonly<{
    text: string;
    params: ReadonlyArray<GuestUpgradeExecutorParam>;
  }>> = [];
  const baseExecutor = createGuestUpgradeExecutor(state);
  const executor: DatabaseExecutor = {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<GuestUpgradeExecutorParam>,
    ): Promise<pg.QueryResult<Row>> => {
      recordedQueries.push({ text, params: [...params] });
      return baseExecutor.query<Row>(text, params);
    },
  };

  await prepareGuestUpgradeInExecutor(executor, guestToken, cognitoSubject, null);

  const identityLockIndex = recordedQueries.findIndex((query) => (
    query.text.includes("auth.cognito_identity:")
  ));
  const userSettingsLockIndex = recordedQueries.findIndex((query) => (
    query.text === "SELECT user_id FROM org.user_settings WHERE user_id = $1 FOR UPDATE"
  ));
  const guestSessionLockIndex = recordedQueries.findIndex((query) => (
    query.text.includes("FROM auth.guest_sessions") && query.text.includes("FOR UPDATE")
  ));

  assert.notEqual(identityLockIndex, -1);
  assert.notEqual(userSettingsLockIndex, -1);
  assert.notEqual(guestSessionLockIndex, -1);
  assert.ok(identityLockIndex < userSettingsLockIndex);
  assert.ok(identityLockIndex < guestSessionLockIndex);
  assert.ok(userSettingsLockIndex < guestSessionLockIndex);
});

test("prepareGuestUpgradeInExecutor rejects a tombstoned subject before locking the guest", async () => {
  const guestToken = "guest-token-prepare-deleted";
  const cognitoSubject = "cognito-subject-prepare-deleted";
  const state = createMergeState({
    guestToken,
    guestSessionId: "guest-session-prepare-deleted",
    guestUserId: "guest-user",
    guestWorkspaceId: "guest-workspace",
    targetSubject: cognitoSubject,
    targetUserId: "linked-user",
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica",
    installationId: "installation-prepare-deleted",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.identityMappings.clear();
  state.deletedSubjectHashes.add(hashDeletedSubject(cognitoSubject));
  const recordedQueries: Array<string> = [];
  const baseExecutor = createGuestUpgradeExecutor(state);
  const executor: DatabaseExecutor = {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<GuestUpgradeExecutorParam>,
    ): Promise<pg.QueryResult<Row>> => {
      recordedQueries.push(text);
      return baseExecutor.query<Row>(text, params);
    },
  };

  await assert.rejects(
    prepareGuestUpgradeInExecutor(executor, guestToken, cognitoSubject, null),
    (error: unknown) => (
      error instanceof HttpError
      && error.statusCode === 410
      && error.code === "ACCOUNT_DELETED"
    ),
  );

  const identityLockIndex = recordedQueries.findIndex((text) => text.includes("auth.cognito_identity:"));
  const tombstoneReadIndex = recordedQueries.findIndex((text) => text.includes("FROM auth.deleted_subjects"));
  assert.notEqual(identityLockIndex, -1);
  assert.notEqual(tombstoneReadIndex, -1);
  assert.ok(identityLockIndex < tombstoneReadIndex);
  assert.equal(recordedQueries.some((text) => text.includes("FROM auth.guest_sessions")), false);
  assert.equal(state.identityMappings.has(cognitoSubject), false);
  assert.equal(state.guestSession?.revoked_at, null);
});
