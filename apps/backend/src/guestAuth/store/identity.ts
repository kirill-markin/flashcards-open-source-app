import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";

export async function carryGuestAccentColorToAccountInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  targetUserId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  const guestResult = await executor.query<Readonly<{ accent_color: string }>>(
    "SELECT accent_color FROM org.user_settings WHERE user_id = $1",
    [guestUserId],
  );
  const guestSettings = guestResult.rows[0];
  if (guestSettings === undefined) {
    throw new Error(`Cannot transfer accent color: guest user ${guestUserId} has no settings.`);
  }

  await applyUserDatabaseScopeInExecutor(executor, { userId: targetUserId });
  const targetResult = await executor.query(
    [
      "UPDATE org.user_settings",
      "SET accent_color = CASE WHEN accent_color = '#C44B2D' THEN $2::TEXT ELSE accent_color END",
      "WHERE user_id = $1",
      "RETURNING user_id",
    ].join(" "),
    [targetUserId, guestSettings.accent_color],
  );
  if (targetResult.rows.length === 0) {
    throw new Error(`Cannot transfer accent color: target user ${targetUserId} has no settings.`);
  }
}

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
