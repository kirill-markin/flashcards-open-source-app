import { deleteCognitoUser } from "./cognitoUsers";
import { transactionWithUserScope, type DatabaseExecutor } from "./db";
import { isDeletedSubject, markDeletedSubjectInExecutor } from "./deletedSubjects";
import { isConfiguredDemoEmail } from "./demoEmailAccess";
import { HttpError } from "./errors";

export const deleteAccountConfirmationText: string = "delete my account";

type AccountDeletionInput = Readonly<{
  appUserId: string;
  authSubjectUserId: string;
  email: string | null;
  cognitoUsername: string | null;
  confirmationText: string;
}>;

type AccountDeletionDependencies = Readonly<{
  transactionWithUserScope: typeof transactionWithUserScope;
  deleteCognitoUser: (cognitoUsername: string) => Promise<void>;
  isDeletedSubject: (userId: string) => Promise<boolean>;
  isConfiguredDemoEmail: (email: string | null) => boolean;
}>;

type WorkspaceIdRow = Readonly<{
  workspace_id: string;
}>;

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
  user_id: string;
}>;

type UserSettingsEmailRow = Readonly<{
  email: string | null;
}>;

const defaultAccountDeletionDependencies: AccountDeletionDependencies = {
  transactionWithUserScope,
  deleteCognitoUser,
  isDeletedSubject,
  isConfiguredDemoEmail,
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
  appUserId: string,
): Promise<void> {
  const userSettingsResult = await executor.query<UserSettingsEmailRow>(
    "SELECT email FROM org.user_settings WHERE user_id = $1 FOR UPDATE",
    [appUserId],
  );
  const workspaceRows = await executor.query<WorkspaceIdRow>(
    "SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1 FOR UPDATE",
    [appUserId],
  );
  const workspaceIds = workspaceRows.rows.map((row) => row.workspace_id);
  const email = userSettingsResult.rows[0]?.email ?? null;
  const soleMemberWorkspaceIds: Array<string> = [];

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
      if (memberCount === 1) {
        soleMemberWorkspaceIds.push(workspaceId);
      }
    }

    if (soleMemberWorkspaceIds.length > 0) {
      await executor.query(
        "DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])",
        [soleMemberWorkspaceIds],
      );
    }
  }

  await executor.query(
    "SELECT auth.delete_user_auth_artifacts($1, $2)",
    [appUserId, email],
  );
  await executor.query("DELETE FROM org.user_settings WHERE user_id = $1", [appUserId]);
}

/**
 * Fully deletes one real account, including the stale-token tombstone that
 * blocks the removed Cognito identity from reprovisioning.
 *
 * This path is not used for the insecure review accounts configured via
 * `DEMO_EMAIL_DOSTIP`. Those `@example.com` review accounts keep their Cognito
 * identity so they can be reused after their app data is cleared.
 */
async function deleteRealAccountDataInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
  authSubjectUserId: string,
): Promise<void> {
  await deleteAccountDataInExecutor(executor, appUserId);
  await markDeletedSubjectInExecutor(executor, authSubjectUserId);
}

/**
 * Clears app data for one configured insecure review account while
 * preserving the Cognito identity for reuse.
 *
 * This path exists only for the explicit `DEMO_EMAIL_DOSTIP` allowlist inside
 * the `@example.com` domain. Real user accounts must not use it.
 */
async function deleteDemoAccountDataInExecutor(
  executor: DatabaseExecutor,
  appUserId: string,
): Promise<void> {
  await deleteAccountDataInExecutor(executor, appUserId);
}

async function deleteCognitoIdentity(
  cognitoUsername: string,
  dependencies: AccountDeletionDependencies,
): Promise<void> {
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

export async function deleteAccountForAuthenticatedUser(
  input: AccountDeletionInput,
  dependencies: AccountDeletionDependencies = defaultAccountDeletionDependencies,
): Promise<void> {
  assertValidConfirmationText(input.confirmationText);
  const isDemoAccount = dependencies.isConfiguredDemoEmail(input.email);

  if (await dependencies.isDeletedSubject(input.authSubjectUserId)) {
    if (isDemoAccount) {
      return;
    }

    const cognitoUsername = assertCognitoUsername(input.cognitoUsername);
    await deleteCognitoIdentity(cognitoUsername, dependencies);
    return;
  }

  await dependencies.transactionWithUserScope({ userId: input.appUserId }, async (executor) => {
    if (isDemoAccount) {
      await deleteDemoAccountDataInExecutor(executor, input.appUserId);
      return;
    }

    await deleteRealAccountDataInExecutor(executor, input.appUserId, input.authSubjectUserId);
  });

  if (isDemoAccount) {
    return;
  }

  const cognitoUsername = assertCognitoUsername(input.cognitoUsername);
  await deleteCognitoIdentity(cognitoUsername, dependencies);
}
