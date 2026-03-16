import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { deleteAccountConfirmationText, deleteAccountForAuthenticatedUser } from "./accountDeletion";
import { HttpError } from "./errors";

function makeQueryResult<Row extends pg.QueryResultRow>(
  rows: ReadonlyArray<pg.QueryResultRow>,
): pg.QueryResult<Row> {
  return {
    command: rows.length > 0 ? "SELECT" : "UPDATE",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows] as Array<Row>,
  };
}

test("deleteAccountForAuthenticatedUser rejects the wrong confirmation text before any side effects", async () => {
  let transactionCalled = false;
  let cognitoDeleteCalled = false;

  await assert.rejects(
    () => deleteAccountForAuthenticatedUser({
      userId: "user-1",
      cognitoUsername: "cognito-user-1",
      confirmationText: "wrong text",
    }, {
      transactionWithUserScope: async () => {
        transactionCalled = true
        throw new Error("unexpected")
      },
      deleteCognitoUser: async () => {
        cognitoDeleteCalled = true
      },
      isDeletedSubject: async () => false,
    }),
    (error: unknown) => error instanceof HttpError
      && error.statusCode == 400
      && error.code === "ACCOUNT_DELETE_CONFIRMATION_INVALID",
  );

  assert.equal(transactionCalled, false);
  assert.equal(cognitoDeleteCalled, false);
});

test("deleteAccountForAuthenticatedUser skips database work for already deleted subjects and retries Cognito cleanup", async () => {
  let transactionCalled = false;
  let cognitoDeleteCalled = false;

  await deleteAccountForAuthenticatedUser({
    userId: "user-1",
    cognitoUsername: "cognito-user-1",
    confirmationText: deleteAccountConfirmationText,
  }, {
    transactionWithUserScope: async () => {
      transactionCalled = true
      throw new Error("unexpected")
    },
    deleteCognitoUser: async (cognitoUsername: string) => {
      cognitoDeleteCalled = cognitoUsername === "cognito-user-1"
    },
    isDeletedSubject: async () => true,
  });

  assert.equal(transactionCalled, false);
  assert.equal(cognitoDeleteCalled, true);
});

test("deleteAccountForAuthenticatedUser keeps shared workspaces, deletes sole-member workspaces, and cleans auth artifacts", async () => {
  const queries: Array<string> = [];
  let cognitoDeleteCalled = false;

  await deleteAccountForAuthenticatedUser({
    userId: "user-1",
    cognitoUsername: "cognito-user-1",
    confirmationText: deleteAccountConfirmationText,
  }, {
    transactionWithUserScope: async (_scope, callback) => callback({
      query: async <Row extends pg.QueryResultRow>(text: string): Promise<pg.QueryResult<Row>> => {
        queries.push(text);

        if (text.includes("SELECT email FROM org.user_settings")) {
          return makeQueryResult<Row>([{
            email: "user@example.com",
          }]);
        }

        if (text.includes("SELECT workspace_id FROM org.workspace_memberships")) {
          return makeQueryResult<Row>([
            {
              workspace_id: "00000000-0000-4000-8000-000000000001",
            },
            {
              workspace_id: "00000000-0000-4000-8000-000000000002",
            },
          ]);
        }

        if (text.includes("SELECT workspace_id, user_id")) {
          return makeQueryResult<Row>([
            {
              workspace_id: "00000000-0000-4000-8000-000000000001",
              user_id: "user-1",
            },
            {
              workspace_id: "00000000-0000-4000-8000-000000000002",
              user_id: "user-1",
            },
            {
              workspace_id: "00000000-0000-4000-8000-000000000002",
              user_id: "user-2",
            },
          ]);
        }

        return makeQueryResult<Row>([]);
      },
    }),
    deleteCognitoUser: async (cognitoUsername: string) => {
      cognitoDeleteCalled = cognitoUsername === "cognito-user-1";
    },
    isDeletedSubject: async () => false,
  });

  assert.equal(
    queries.some((queryText) => queryText.includes("DELETE FROM org.workspaces WHERE workspace_id = ANY")),
    true,
  );
  assert.equal(
    queries.some((queryText) => queryText.includes("SELECT auth.delete_user_auth_artifacts($1, $2)")),
    true,
  );
  assert.equal(queries.some((queryText) => queryText.includes("DELETE FROM org.user_settings")), true);
  assert.equal(queries.some((queryText) => queryText.includes("INSERT INTO auth.deleted_subjects")), true);
  assert.equal(cognitoDeleteCalled, true);
});

test("deleteAccountForAuthenticatedUser deletes sole-member workspace data and then deletes the Cognito user", async () => {
  const queries: Array<string> = [];
  let cognitoDeleteCalled = false;

  await deleteAccountForAuthenticatedUser({
    userId: "user-1",
    cognitoUsername: "cognito-user-1",
    confirmationText: deleteAccountConfirmationText,
  }, {
    transactionWithUserScope: async (_scope, callback) => callback({
      query: async <Row extends pg.QueryResultRow>(text: string): Promise<pg.QueryResult<Row>> => {
        queries.push(text);

        if (text.includes("SELECT email FROM org.user_settings")) {
          return makeQueryResult<Row>([{
            email: "user@example.com",
          }]);
        }

        if (text.includes("SELECT workspace_id FROM org.workspace_memberships")) {
          return makeQueryResult<Row>([{
            workspace_id: "00000000-0000-4000-8000-000000000001",
          }]);
        }

        if (text.includes("SELECT workspace_id, user_id")) {
          return makeQueryResult<Row>([{
            workspace_id: "00000000-0000-4000-8000-000000000001",
            user_id: "user-1",
          }]);
        }

        return makeQueryResult<Row>([]);
      },
    }),
    deleteCognitoUser: async (cognitoUsername: string) => {
      cognitoDeleteCalled = cognitoUsername === "cognito-user-1";
    },
    isDeletedSubject: async () => false,
  });

  assert.equal(queries.some((queryText) => queryText.includes("DELETE FROM org.workspaces")), true);
  assert.equal(
    queries.some((queryText) => queryText.includes("SELECT auth.delete_user_auth_artifacts($1, $2)")),
    true,
  );
  assert.equal(queries.some((queryText) => queryText.includes("DELETE FROM org.user_settings")), true);
  assert.equal(queries.some((queryText) => queryText.includes("INSERT INTO auth.deleted_subjects")), true);
  assert.equal(cognitoDeleteCalled, true);
});
