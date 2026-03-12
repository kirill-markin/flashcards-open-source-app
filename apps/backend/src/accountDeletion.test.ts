import assert from "node:assert/strict";
import test from "node:test";
import { deleteAccountConfirmationText, deleteAccountForAuthenticatedUser } from "./accountDeletion";
import { HttpError } from "./errors";

test("deleteAccountForAuthenticatedUser rejects the wrong confirmation text before any side effects", async () => {
  let transactionCalled = false;
  let cognitoDeleteCalled = false;

  await assert.rejects(
    () => deleteAccountForAuthenticatedUser({
      userId: "user-1",
      cognitoUsername: "cognito-user-1",
      confirmationText: "wrong text",
    }, {
      transaction: async () => {
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
    transaction: async () => {
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

test("deleteAccountForAuthenticatedUser blocks shared workspaces before deleting any data", async () => {
  const queries: Array<string> = [];

  await assert.rejects(
    () => deleteAccountForAuthenticatedUser({
      userId: "user-1",
      cognitoUsername: "cognito-user-1",
      confirmationText: deleteAccountConfirmationText,
    }, {
      transaction: async (callback) => callback({
        query: async <Row extends Record<string, unknown>>(text: string): Promise<{ rows: Array<Row> }> => {
          queries.push(text);

          if (text.includes("SELECT workspace_id FROM org.workspace_memberships")) {
            return {
              rows: [{
                workspace_id: "00000000-0000-4000-8000-000000000001",
              }] as Array<Row>,
            };
          }

          if (text.includes("SELECT workspace_id, user_id")) {
            return {
              rows: [
                {
                  workspace_id: "00000000-0000-4000-8000-000000000001",
                  user_id: "user-1",
                },
                {
                  workspace_id: "00000000-0000-4000-8000-000000000001",
                  user_id: "user-2",
                },
              ] as Array<Row>,
            };
          }

          return {
            rows: [],
          };
        },
      }),
      deleteCognitoUser: async () => {
        throw new Error("Cognito delete should not run when the workspace is shared");
      },
      isDeletedSubject: async () => false,
    }),
    (error: unknown) => error instanceof HttpError
      && error.statusCode == 409
      && error.code === "ACCOUNT_DELETE_SHARED_WORKSPACE",
  );

  assert.equal(queries.some((queryText) => queryText.includes("DELETE FROM org.workspaces")), false);
});

test("deleteAccountForAuthenticatedUser deletes sole-member workspace data and then deletes the Cognito user", async () => {
  const queries: Array<string> = [];
  let cognitoDeleteCalled = false;

  await deleteAccountForAuthenticatedUser({
    userId: "user-1",
    cognitoUsername: "cognito-user-1",
    confirmationText: deleteAccountConfirmationText,
  }, {
    transaction: async (callback) => callback({
      query: async <Row extends Record<string, unknown>>(text: string): Promise<{ rows: Array<Row> }> => {
        queries.push(text);

        if (text.includes("SELECT workspace_id FROM org.workspace_memberships")) {
          return {
            rows: [{
              workspace_id: "00000000-0000-4000-8000-000000000001",
            }] as Array<Row>,
          };
        }

        if (text.includes("SELECT workspace_id, user_id")) {
          return {
            rows: [{
              workspace_id: "00000000-0000-4000-8000-000000000001",
              user_id: "user-1",
            }] as Array<Row>,
          };
        }

        return {
          rows: [],
        };
      },
    }),
    deleteCognitoUser: async (cognitoUsername: string) => {
      cognitoDeleteCalled = cognitoUsername === "cognito-user-1";
    },
    isDeletedSubject: async () => false,
  });

  assert.equal(queries.some((queryText) => queryText.includes("DELETE FROM org.workspaces")), true);
  assert.equal(queries.some((queryText) => queryText.includes("DELETE FROM org.user_settings")), true);
  assert.equal(queries.some((queryText) => queryText.includes("INSERT INTO auth.deleted_subjects")), true);
  assert.equal(cognitoDeleteCalled, true);
});
