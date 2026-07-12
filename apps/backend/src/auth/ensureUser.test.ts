import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor } from "../database";
import { HttpError } from "../shared/errors";
import {
  createGuestUpgradeExecutor,
  createMergeState,
  type GuestUpgradeExecutorParam,
} from "../guestAuthTestHarness";
import { ensureCognitoUserProfileInExecutor } from "./ensureUser";
import { hashDeletedSubject } from "./deletedSubjects";
import {
  bindCognitoIdentityMappingInExecutor,
  CognitoIdentityMappingConflictError,
  lockCognitoIdentityLifecycleInExecutor,
} from "./userIdentities";

test("ensureCognitoUserProfileInExecutor rereads the locked mapping and returns its profile", async () => {
  const subjectUserId = "cognito-subject";
  const mappedUserId = "authoritative-user";
  const state = createMergeState({
    guestToken: "guest-token-ensure-profile",
    guestSessionId: "guest-session-ensure-profile",
    guestUserId: "guest-user",
    guestWorkspaceId: "guest-workspace",
    targetSubject: subjectUserId,
    targetUserId: mappedUserId,
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica",
    installationId: "installation-ensure-profile",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
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

  const profile = await ensureCognitoUserProfileInExecutor(
    executor,
    subjectUserId,
    "authoritative@example.com",
  );

  const identityLockIndex = recordedQueries.findIndex((query) => query.text.includes("auth.cognito_identity:"));
  const mappingReadIndex = recordedQueries.findIndex((query) => (
    query.text.includes("FROM auth.user_identities")
    && query.text.includes("provider_subject = $1")
  ));
  const profileLockIndex = recordedQueries.findIndex((query) => (
    query.text.includes("FROM org.user_settings")
    && query.text.includes("FOR UPDATE")
    && query.params[0] === mappedUserId
  ));

  assert.equal(profile.userId, mappedUserId);
  assert.equal(profile.selectedWorkspaceId, "target-workspace");
  assert.equal(profile.email, "authoritative@example.com");
  assert.notEqual(identityLockIndex, -1);
  assert.notEqual(mappingReadIndex, -1);
  assert.notEqual(profileLockIndex, -1);
  assert.ok(identityLockIndex < mappingReadIndex);
  assert.ok(mappingReadIndex < profileLockIndex);
});

test("bindCognitoIdentityMappingInExecutor rejects an existing mapping to another user", async () => {
  const subjectUserId = "cognito-subject-conflict";
  const state = createMergeState({
    guestToken: "guest-token-identity-conflict",
    guestSessionId: "guest-session-identity-conflict",
    guestUserId: "guest-user",
    guestWorkspaceId: "guest-workspace",
    targetSubject: subjectUserId,
    targetUserId: "existing-user",
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica",
    installationId: "installation-identity-conflict",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  const executor = createGuestUpgradeExecutor(state);

  await lockCognitoIdentityLifecycleInExecutor(executor, subjectUserId);
  await assert.rejects(
    bindCognitoIdentityMappingInExecutor(executor, subjectUserId, "requested-user"),
    (error: unknown) => {
      assert.ok(error instanceof CognitoIdentityMappingConflictError);
      assert.equal(error.providerSubject, subjectUserId);
      assert.equal(error.requestedUserId, "requested-user");
      assert.equal(error.existingUserId, "existing-user");
      return true;
    },
  );
  assert.equal(state.identityMappings.get(subjectUserId), "existing-user");
});

test("ensureCognitoUserProfileInExecutor rejects a tombstoned subject after acquiring the identity lock", async () => {
  const subjectUserId = "deleted-cognito-subject";
  const state = createMergeState({
    guestToken: "guest-token-deleted-profile",
    guestSessionId: "guest-session-deleted-profile",
    guestUserId: "guest-user",
    guestWorkspaceId: "guest-workspace",
    targetSubject: subjectUserId,
    targetUserId: subjectUserId,
    targetWorkspaceId: "target-workspace",
    guestReplicaId: "guest-replica",
    installationId: "installation-deleted-profile",
    guestSchedulerUpdatedAt: "2026-04-02T14:00:00.000Z",
    targetSchedulerUpdatedAt: "2026-04-02T14:05:00.000Z",
  });
  state.deletedSubjectHashes.add(hashDeletedSubject(subjectUserId));
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
    ensureCognitoUserProfileInExecutor(executor, subjectUserId, "deleted@example.com"),
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
  assert.equal(recordedQueries.some((text) => text.includes("FROM auth.user_identities")), false);
  assert.equal(recordedQueries.some((text) => text.includes("INSERT INTO org.user_settings")), false);
});
