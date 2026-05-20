import { applyUserDatabaseScopeInExecutor, type DatabaseExecutor } from "../db";
import { HttpError } from "../errors";

type AgentApiKeySelectionRow = Readonly<{
  connection_id: string;
}>;

type UserSettingsLockRow = Readonly<{
  user_id: string;
}>;

export class UserSettingsRowNotFoundError extends Error {
  readonly userId: string;

  constructor(userId: string) {
    super("User settings row not found while locking workspace lifecycle.");
    this.name = "UserSettingsRowNotFoundError";
    this.userId = userId;
  }
}

export async function lockUserSettingsForWorkspaceLifecycleInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  const result = await executor.query<UserSettingsLockRow>(
    "SELECT user_id FROM org.user_settings WHERE user_id = $1 FOR UPDATE",
    [userId],
  );

  if (result.rows.length === 0) {
    throw new UserSettingsRowNotFoundError(userId);
  }
}

export async function persistSelectedWorkspaceForUserInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  await executor.query(
    "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
    [workspaceId, userId],
  );
}

export async function persistSelectedWorkspaceForApiKeyConnectionInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  connectionId: string,
  selectedWorkspaceId: string | null,
): Promise<void> {
  const result = await executor.query<AgentApiKeySelectionRow>(
    [
      "UPDATE auth.agent_api_keys",
      "SET selected_workspace_id = $1",
      "WHERE user_id = $2 AND connection_id = $3 AND revoked_at IS NULL",
      "RETURNING connection_id",
    ].join(" "),
    [selectedWorkspaceId, userId, connectionId],
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, "Agent connection not found", "AGENT_API_KEY_NOT_FOUND");
  }
}
