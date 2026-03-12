import { deleteCognitoUser } from "./cognitoUsers";
import { transaction, type DatabaseExecutor } from "./db";
import { isDeletedSubject, markDeletedSubjectInExecutor } from "./deletedSubjects";
import { HttpError } from "./errors";

export const deleteAccountConfirmationText: string = "delete my account";

type AccountDeletionInput = Readonly<{
  userId: string;
  cognitoUsername: string | null;
  confirmationText: string;
}>;

type AccountDeletionDependencies = Readonly<{
  transaction: typeof transaction;
  deleteCognitoUser: (cognitoUsername: string) => Promise<void>;
  isDeletedSubject: (userId: string) => Promise<boolean>;
}>;

type WorkspaceIdRow = Readonly<{
  workspace_id: string;
}>;

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
  user_id: string;
}>;

const defaultAccountDeletionDependencies: AccountDeletionDependencies = {
  transaction,
  deleteCognitoUser,
  isDeletedSubject,
};

function assertValidConfirmationText(confirmationText: string): void {
  if (confirmationText !== deleteAccountConfirmationText) {
    throw new HttpError(
      400,
      `Type "${deleteAccountConfirmationText}" exactly to confirm account deletion.`,
      "ACCOUNT_DELETE_CONFIRMATION_INVALID",
    );
  }
}

function assertCognitoUsername(cognitoUsername: string | null): string {
  if (cognitoUsername === null || cognitoUsername.trim() === "") {
    throw new HttpError(
      500,
      "Account deletion could not resolve the Cognito username for this user.",
      "ACCOUNT_DELETE_IDENTITY_DELETE_FAILED",
    );
  }

  return cognitoUsername;
}

async function deleteAccountDataInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<void> {
  const workspaceRows = await executor.query<WorkspaceIdRow>(
    "SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1 FOR UPDATE",
    [userId],
  );
  const workspaceIds = workspaceRows.rows.map((row) => row.workspace_id);

  if (workspaceIds.length > 0) {
    const workspaceMembershipRows = await executor.query<WorkspaceMembershipRow>(
      [
        "SELECT workspace_id, user_id",
        "FROM org.workspace_memberships",
        "WHERE workspace_id = ANY($1::uuid[])",
        "FOR UPDATE",
      ].join(" "),
      [workspaceIds],
    );
    const membershipCounts = new Map<string, number>();

    for (const row of workspaceMembershipRows.rows) {
      const currentCount = membershipCounts.get(row.workspace_id) ?? 0;
      membershipCounts.set(row.workspace_id, currentCount + 1);
    }

    for (const workspaceId of workspaceIds) {
      const memberCount = membershipCounts.get(workspaceId) ?? 0;
      if (memberCount > 1) {
        throw new HttpError(
          409,
          "This account still belongs to a shared workspace. Remove other members or transfer ownership before deleting the account.",
          "ACCOUNT_DELETE_SHARED_WORKSPACE",
        );
      }
    }

    await executor.query(
      "DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])",
      [workspaceIds],
    );
  }

  await executor.query("DELETE FROM org.user_settings WHERE user_id = $1", [userId]);
  await markDeletedSubjectInExecutor(executor, userId);
}

export async function deleteAccountForAuthenticatedUser(
  input: AccountDeletionInput,
  dependencies: AccountDeletionDependencies = defaultAccountDeletionDependencies,
): Promise<void> {
  assertValidConfirmationText(input.confirmationText);
  const cognitoUsername = assertCognitoUsername(input.cognitoUsername);

  if (await dependencies.isDeletedSubject(input.userId)) {
    try {
      await dependencies.deleteCognitoUser(cognitoUsername);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpError(
        503,
        `Account deletion could not finish the Cognito cleanup step. Retry the delete request. (${message})`,
        "ACCOUNT_DELETE_IDENTITY_DELETE_FAILED",
      );
    }
  }

  await dependencies.transaction(async (executor) => {
    await deleteAccountDataInExecutor(executor, input.userId);
  });

  try {
    await dependencies.deleteCognitoUser(cognitoUsername);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(
      503,
      `Account deletion could not finish the Cognito cleanup step. Retry the delete request. (${message})`,
      "ACCOUNT_DELETE_IDENTITY_DELETE_FAILED",
    );
  }
}
