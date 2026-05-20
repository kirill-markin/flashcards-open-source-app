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
  UserDatabaseScope,
} from "./db";

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
      appUserId,
      authSubjectUserId: "subject-1",
      email: "review@example.com",
      cognitoUsername: null,
      confirmationText: deleteAccountConfirmationText,
    },
    {
      transactionWithUserScope: async <Result>(
        _scope: UserDatabaseScope,
        callback: (transactionExecutor: DatabaseExecutor) => Promise<Result>,
      ): Promise<Result> => callback(executor),
      deleteCognitoUser: async () => {
        throw new Error("Demo account deletion must not delete Cognito identity.");
      },
      isDeletedSubject: async () => false,
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

  assert.deepEqual(
    membershipLifecycleLockIndices.map(({ query }) => query.params[0]),
    [workspaceA, workspaceB],
  );
  assert.notEqual(ownMembershipLockIndex, -1);
  assert.notEqual(allMembershipRowsLockIndex, -1);
  assert.ok(membershipLifecycleLockIndices.every(({ index }) => index < ownMembershipLockIndex));
  assert.ok(membershipLifecycleLockIndices.every(({ index }) => index < allMembershipRowsLockIndex));
});
