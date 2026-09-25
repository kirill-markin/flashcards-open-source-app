import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import {
  deleteAccountConfirmationText,
  deleteAccountForAuthenticatedUser,
} from "./accountDeletion";
import type {
  DatabaseExecutor,
  SqlValue,
} from "../database";
import { hashDeletedSubject } from "./deletedSubjects";

type RecordedQuery = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
}>;

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

test("deleteAccountForAuthenticatedUser locks shared workspace membership lifecycles before membership rows", async () => {
  const appUserId = "user-1";
  const workspaceA = "11111111-1111-4111-8111-111111111111";
  const workspaceB = "22222222-2222-4222-8222-222222222222";
  const recordedQueries: Array<RecordedQuery> = [];
  const executor: DatabaseExecutor = {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      recordedQueries.push({
        text,
        params: [...params],
      });

      if (
        text
          === "SELECT pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || $1::text, 2::bigint))"
      ) {
        return createQueryResult<Row>([]);
      }

      if (text.includes("FROM auth.deleted_subjects")) {
        return createQueryResult<Row>([]);
      }

      if (text.includes("FROM auth.user_identities") && text.includes("provider_subject = $1")) {
        return createQueryResult<Row>([{
          provider_subject: "subject-1",
          user_id: appUserId,
        } as unknown as Row]);
      }

      if (text.includes("set_config('app.user_id'")) {
        return createQueryResult<Row>([]);
      }

      if (text === "SELECT email FROM org.user_settings WHERE user_id = $1 FOR UPDATE") {
        return createQueryResult<Row>([{ email: "review@example.com" } as unknown as Row]);
      }

      if (text === "SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1") {
        return createQueryResult<Row>([
          { workspace_id: workspaceB } as unknown as Row,
          { workspace_id: workspaceA } as unknown as Row,
        ]);
      }

      if (
        text === "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1::bigint))"
        || text === "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0::bigint))"
      ) {
        return createQueryResult<Row>([]);
      }

      if (text === "SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1 FOR UPDATE") {
        return createQueryResult<Row>([]);
      }

      if (text.includes("FROM org.workspace_memberships") && text.includes("FOR UPDATE")) {
        return createQueryResult<Row>([
          { workspace_id: workspaceA, user_id: appUserId } as unknown as Row,
          { workspace_id: workspaceB, user_id: appUserId } as unknown as Row,
        ]);
      }

      if (
        text === "DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])"
        || text === "SELECT auth.delete_user_auth_artifacts($1, $2)"
        || text === "DELETE FROM org.user_settings WHERE user_id = $1"
        || text === "INSERT INTO org.user_settings (user_id) VALUES ($1)"
        || text.includes("INSERT INTO auth.user_identities")
        || text.includes("FROM auth.guest_upgrade_history")
        || text.includes("UPDATE analytics.product_events")
        || text.includes("DELETE FROM analytics.identity_links")
        || text.includes("DELETE FROM analytics.installation_profiles")
      ) {
        return createQueryResult<Row>([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await deleteAccountForAuthenticatedUser(
    {
      authSubjectUserId: "subject-1",
      email: "review@example.com",
      cognitoUsername: null,
      confirmationText: deleteAccountConfirmationText,
    },
    {
      unsafeTransaction: async <Result>(
        callback: (transactionExecutor: DatabaseExecutor) => Promise<Result>,
      ): Promise<Result> => callback(executor),
      deleteCognitoUser: async () => {
        throw new Error("Demo account deletion must not delete Cognito identity.");
      },
      isConfiguredDemoEmail: () => true,
    },
  );

  const membershipLifecycleLockIndices = recordedQueries
    .map((query, index) => ({ query, index }))
    .filter(({ query }) => (
      query.text === "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1::bigint))"
    ));
  const ownMembershipLockIndex = recordedQueries.findIndex((query) => (
    query.text === "SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1 FOR UPDATE"
  ));
  const allMembershipRowsLockIndex = recordedQueries.findIndex((query) => (
    query.text.includes("FROM org.workspace_memberships")
    && query.text.includes("WHERE workspace_id = ANY($1::uuid[])")
    && query.text.includes("FOR UPDATE")
  ));
  const identityLockIndex = recordedQueries.findIndex((query) => query.text.includes("auth.cognito_identity:"));
  const tombstoneReadIndex = recordedQueries.findIndex((query) => query.text.includes("FROM auth.deleted_subjects"));
  const mappingReadIndex = recordedQueries.findIndex((query) => query.text.includes("FROM auth.user_identities"));
  const userSettingsLockIndex = recordedQueries.findIndex((query) => (
    query.text === "SELECT email FROM org.user_settings WHERE user_id = $1 FOR UPDATE"
  ));
  const exclusionEraseIndex = recordedQueries.findIndex((query) => (
    query.text.includes("DELETE FROM analytics.excluded_actors")
  ));

  const userSettingsDeleteIndex = recordedQueries.findIndex((query) => (
    query.text === "DELETE FROM org.user_settings WHERE user_id = $1"
  ));
  const userSettingsRestoreIndex = recordedQueries.findIndex((query) => (
    query.text === "INSERT INTO org.user_settings (user_id) VALUES ($1)"
  ));
  const identityRebindIndex = recordedQueries.findIndex((query) => (
    query.text.includes("INSERT INTO auth.user_identities")
  ));
  const userSettingsRestoreQuery = recordedQueries[userSettingsRestoreIndex];
  const identityRebindQuery = recordedQueries[identityRebindIndex];

  // A demo reset reuses the account id, so erasing its exclusion rows would undo a human restore.
  assert.equal(exclusionEraseIndex, -1);
  // The sweep drops the profile and cascades the subject binding with it, so both come back under
  // the same id: a fresh id would orphan the billing, AI usage and exclusion rows kept above.
  assert.notEqual(userSettingsDeleteIndex, -1);
  assert.equal(userSettingsRestoreQuery?.params[0], appUserId);
  assert.deepEqual(identityRebindQuery?.params, ["subject-1", appUserId]);
  // Both restores are order-bound, not merely present: the profile has to come back after the sweep
  // that dropped it, and the mapping after the profile, because auth.user_identities.user_id
  // references org.user_settings(user_id) (db/migrations/0031_guest_ai_identity_and_quota.sql).
  assert.ok(userSettingsDeleteIndex < userSettingsRestoreIndex);
  assert.ok(userSettingsRestoreIndex < identityRebindIndex);
  assert.notEqual(identityLockIndex, -1);
  assert.notEqual(tombstoneReadIndex, -1);
  assert.notEqual(mappingReadIndex, -1);
  assert.notEqual(userSettingsLockIndex, -1);
  assert.deepEqual(
    membershipLifecycleLockIndices.map(({ query }) => query.params[0]),
    [workspaceA, workspaceB],
  );
  assert.notEqual(ownMembershipLockIndex, -1);
  assert.notEqual(allMembershipRowsLockIndex, -1);
  assert.ok(identityLockIndex < tombstoneReadIndex);
  assert.ok(identityLockIndex < mappingReadIndex);
  assert.ok(identityLockIndex < userSettingsLockIndex);
  assert.ok(identityLockIndex < membershipLifecycleLockIndices[0]!.index);
  assert.ok(membershipLifecycleLockIndices.every(({ index }) => index < ownMembershipLockIndex));
  assert.ok(membershipLifecycleLockIndices.every(({ index }) => index < allMembershipRowsLockIndex));
});

test("deleteAccountForAuthenticatedUser restores nothing for a review subject that has no account", async () => {
  // A configured review subject that has never hit a profile-ensuring route: POST /v1/me/delete
  // only authenticates, so it arrives with no mapping and no profile, and the id the deletion
  // carries is the Cognito subject itself. Restoring here would not bring an account back, it would
  // create one under the subject (db/migrations/0159_surrogate_user_identity.sql).
  const subjectUserId = "unprovisioned-review-subject";
  const recordedQueries: Array<RecordedQuery> = [];
  const executor: DatabaseExecutor = {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      recordedQueries.push({ text, params: [...params] });

      if (
        text.includes("pg_advisory_xact_lock")
        || text.includes("set_config('app.user_id'")
        || text.includes("FROM auth.deleted_subjects")
        || text.includes("FROM auth.user_identities")
        || text.includes("FROM auth.guest_upgrade_history")
        || text === "SELECT email FROM org.user_settings WHERE user_id = $1 FOR UPDATE"
        || text === "SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1"
        || text === "SELECT auth.delete_user_auth_artifacts($1, $2)"
        || text === "DELETE FROM org.user_settings WHERE user_id = $1"
        || text.includes("DELETE FROM analytics.installation_profiles")
        || text.includes("UPDATE analytics.product_events")
        || text.includes("DELETE FROM analytics.identity_links")
      ) {
        return createQueryResult<Row>([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await deleteAccountForAuthenticatedUser(
    {
      authSubjectUserId: subjectUserId,
      email: "review@example.com",
      cognitoUsername: null,
      confirmationText: deleteAccountConfirmationText,
    },
    {
      unsafeTransaction: async <Result>(
        callback: (transactionExecutor: DatabaseExecutor) => Promise<Result>,
      ): Promise<Result> => callback(executor),
      deleteCognitoUser: async () => {
        throw new Error("Demo account deletion must not delete Cognito identity.");
      },
      isConfiguredDemoEmail: () => true,
    },
  );

  const userSettingsDeleteQuery = recordedQueries.find((query) => (
    query.text === "DELETE FROM org.user_settings WHERE user_id = $1"
  ));

  // The sweep still ran, and it ran under the subject, which is exactly why nothing may be written
  // back under that id afterwards.
  assert.equal(userSettingsDeleteQuery?.params[0], subjectUserId);
  assert.equal(
    recordedQueries.some((query) => query.text === "INSERT INTO org.user_settings (user_id) VALUES ($1)"),
    false,
  );
  assert.equal(
    recordedQueries.some((query) => query.text.includes("INSERT INTO auth.user_identities")),
    false,
  );
});

test("deleteAccountForAuthenticatedUser rereads the mapping under the identity lock and deletes the authoritative user", async () => {
  const subjectUserId = "subject-authoritative";
  const authoritativeUserId = "mapped-user";
  const mergedGuestUserId = "merged-guest-user";
  const recordedQueries: Array<RecordedQuery> = [];
  let deletedCognitoUsername: string | null = null;
  const executor: DatabaseExecutor = {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      recordedQueries.push({ text, params: [...params] });

      if (
        text.includes("pg_advisory_xact_lock")
        || text.includes("set_config('app.user_id'")
        || text === "SELECT auth.delete_user_auth_artifacts($1, $2)"
        || text === "DELETE FROM org.user_settings WHERE user_id = $1"
        || text.includes("INSERT INTO auth.deleted_subjects")
        || text.includes("UPDATE analytics.product_events")
        || text.includes("DELETE FROM analytics.identity_links")
        || text.includes("DELETE FROM analytics.installation_profiles")
        || text.includes("DELETE FROM analytics.excluded_actors")
        || text.includes("UPDATE billing.provider_events")
        || text.includes("UPDATE billing.purchases")
        || text.includes("UPDATE billing.grants")
        || text.includes("UPDATE billing.user_billing_state")
        || text.includes("DELETE FROM billing.entitlement_snapshots")
        || text.includes("UPDATE ai.usage_events")
      ) {
        return createQueryResult<Row>([]);
      }
      // The person walk: this account absorbed one guest id, so the ids the deletion carries
      // around are wider than the account id alone.
      if (text.includes("FROM auth.guest_upgrade_history")) {
        return createQueryResult<Row>([
          { user_id: authoritativeUserId } as unknown as Row,
          { user_id: mergedGuestUserId } as unknown as Row,
        ]);
      }
      if (text.includes("FROM auth.deleted_subjects")) {
        return createQueryResult<Row>([]);
      }
      if (text.includes("FROM auth.user_identities")) {
        return createQueryResult<Row>([{
          provider_subject: subjectUserId,
          user_id: authoritativeUserId,
        } as unknown as Row]);
      }
      if (text === "SELECT email FROM org.user_settings WHERE user_id = $1 FOR UPDATE") {
        return createQueryResult<Row>([{ email: "user@example.com" } as unknown as Row]);
      }
      if (text === "SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1") {
        return createQueryResult<Row>([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await deleteAccountForAuthenticatedUser(
    {
      authSubjectUserId: subjectUserId,
      email: "user@example.com",
      cognitoUsername: "cognito-username",
      confirmationText: deleteAccountConfirmationText,
    },
    {
      unsafeTransaction: async <Result>(
        callback: (transactionExecutor: DatabaseExecutor) => Promise<Result>,
      ): Promise<Result> => callback(executor),
      deleteCognitoUser: async (cognitoUsername) => {
        deletedCognitoUsername = cognitoUsername;
      },
      isConfiguredDemoEmail: () => false,
    },
  );

  const scopeQuery = recordedQueries.find((query) => query.text.includes("set_config('app.user_id'"));
  const deleteUserQuery = recordedQueries.find((query) => (
    query.text === "DELETE FROM org.user_settings WHERE user_id = $1"
  ));
  const tombstoneQuery = recordedQueries.find((query) => query.text.includes("INSERT INTO auth.deleted_subjects"));
  const identityLockIndex = recordedQueries.findIndex((query) => query.text.includes("auth.cognito_identity:"));
  const userSettingsLockIndex = recordedQueries.findIndex((query) => query.text.includes("FROM org.user_settings"));
  const userSettingsDeleteIndex = recordedQueries.findIndex((query) => (
    query.text === "DELETE FROM org.user_settings WHERE user_id = $1"
  ));
  const exclusionEraseIndex = recordedQueries.findIndex((query) => (
    query.text.includes("DELETE FROM analytics.excluded_actors")
  ));
  const exclusionEraseQuery = recordedQueries[exclusionEraseIndex];

  const analyticsRewriteQuery = recordedQueries.find((query) => (
    query.text.includes("UPDATE analytics.product_events")
  ));
  const purchaseRewriteQuery = recordedQueries.find((query) => (
    query.text.includes("UPDATE billing.purchases")
  ));
  const usageRewriteQuery = recordedQueries.find((query) => (
    query.text.includes("UPDATE ai.usage_events")
  ));
  const providerEventRewriteIndex = recordedQueries.findIndex((query) => (
    query.text.includes("UPDATE billing.provider_events")
  ));
  const purchaseRewriteIndex = recordedQueries.findIndex((query) => (
    query.text.includes("UPDATE billing.purchases")
  ));

  assert.equal(scopeQuery?.params[0], authoritativeUserId);
  assert.equal(deleteUserQuery?.params[0], authoritativeUserId);
  assert.equal(tombstoneQuery?.params[0], hashDeletedSubject(subjectUserId));
  assert.equal(deletedCognitoUsername, "cognito-username");
  assert.ok(identityLockIndex < userSettingsLockIndex);
  // The exclusion table's delete guard raises while the account row still exists, and that raise
  // would abort the whole deletion transaction.
  assert.notEqual(exclusionEraseIndex, -1);
  assert.ok(userSettingsDeleteIndex < exclusionEraseIndex);
  // The erasure key is the person, not the account: an exclusion row naming the guest id this
  // account absorbed has to go too, so the walk has to reach the erase intact.
  assert.deepEqual(exclusionEraseQuery?.params[0], [authoritativeUserId, mergedGuestUserId]);
  // One pseudonym for all three histories. Two would leave this person's analytics, their purchases and
  // their AI spend under identifiers nothing can ever rejoin, which no later support or accounting
  // question could undo.
  const anonymizedUserId = analyticsRewriteQuery?.params[0];
  assert.equal(typeof anonymizedUserId, "string");
  assert.equal(purchaseRewriteQuery?.params[0], anonymizedUserId);
  assert.equal(usageRewriteQuery?.params[0], anonymizedUserId);
  // And the same person-wide ids: a purchase or an AI call made during the guest phase is theirs.
  assert.deepEqual(purchaseRewriteQuery?.params[1], [authoritativeUserId, mergedGuestUserId]);
  assert.deepEqual(usageRewriteQuery?.params[1], [authoritativeUserId, mergedGuestUserId]);
  // The provider events are reached through the purchases as well as through their own user_id, because
  // most providers name the purchase and not the buyer, so they have to be rewritten while
  // billing.purchases still carries the real ids.
  assert.notEqual(providerEventRewriteIndex, -1);
  assert.ok(providerEventRewriteIndex < purchaseRewriteIndex);
});

test("deleteAccountForAuthenticatedUser retries Cognito deletion for an existing tombstone without touching app data", async () => {
  const subjectUserId = "already-deleted-subject";
  const recordedQueries: Array<RecordedQuery> = [];
  let deleteCognitoCalls = 0;
  const executor: DatabaseExecutor = {
    query: async <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => {
      recordedQueries.push({ text, params: [...params] });
      if (text.includes("pg_advisory_xact_lock")) {
        return createQueryResult<Row>([]);
      }
      if (text.includes("FROM auth.deleted_subjects")) {
        return createQueryResult<Row>([{
          subject_sha256: hashDeletedSubject(subjectUserId),
        } as unknown as Row]);
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await deleteAccountForAuthenticatedUser(
    {
      authSubjectUserId: subjectUserId,
      email: "user@example.com",
      cognitoUsername: "cognito-username",
      confirmationText: deleteAccountConfirmationText,
    },
    {
      unsafeTransaction: async <Result>(
        callback: (transactionExecutor: DatabaseExecutor) => Promise<Result>,
      ): Promise<Result> => callback(executor),
      deleteCognitoUser: async () => {
        deleteCognitoCalls += 1;
      },
      isConfiguredDemoEmail: () => false,
    },
  );

  assert.equal(deleteCognitoCalls, 1);
  assert.equal(recordedQueries.some((query) => query.text.includes("FROM auth.user_identities")), false);
  assert.equal(recordedQueries.some((query) => query.text.includes("FROM org.user_settings")), false);
});
