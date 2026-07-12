import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";

export async function updateUserEmailInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  email: string | null,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  await executor.query(
    "UPDATE org.user_settings SET email = $1 WHERE user_id = $2",
    [email, userId],
  );
}
