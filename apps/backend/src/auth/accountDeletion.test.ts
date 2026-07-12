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

test("deleteAccountForAuthenticatedUser rereads the mapping under the identity lock and deletes the authoritative user", async () => {
  const subjectUserId = "subject-authoritative";
  const authoritativeUserId = "mapped-user";
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
      ) {
        return createQueryResult<Row>([]);
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

  assert.equal(scopeQuery?.params[0], authoritativeUserId);
  assert.equal(deleteUserQuery?.params[0], authoritativeUserId);
  assert.equal(tombstoneQuery?.params[0], hashDeletedSubject(subjectUserId));
  assert.equal(deletedCognitoUsername, "cognito-username");
  assert.ok(identityLockIndex < userSettingsLockIndex);
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
