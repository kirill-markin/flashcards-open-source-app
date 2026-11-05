import type { AccountTheme } from "../../auth/ensureUser";
import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";

/** The guest's color lands only on an account still on Default, so an account's own choice wins. */
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
      "SET accent_color = CASE WHEN accent_color = '#FF6719' THEN $2::TEXT ELSE accent_color END",
      "WHERE user_id = $1",
      "RETURNING user_id",
    ].join(" "),
    [targetUserId, guestSettings.accent_color],
  );
  if (targetResult.rows.length === 0) {
    throw new Error(`Cannot transfer accent color: target user ${targetUserId} has no settings.`);
  }
}

/** The guest's theme lands only on an account still on Dark, so an account's own choice wins. */
export async function carryGuestThemeToAccountInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  targetUserId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  const guestResult = await executor.query<Readonly<{ theme: AccountTheme }>>(
    "SELECT theme FROM org.user_settings WHERE user_id = $1",
    [guestUserId],
  );
  const guestSettings = guestResult.rows[0];
  if (guestSettings === undefined) {
    throw new Error(`Cannot transfer theme: guest user ${guestUserId} has no settings.`);
  }

  await applyUserDatabaseScopeInExecutor(executor, { userId: targetUserId });
  const targetResult = await executor.query(
    [
      "UPDATE org.user_settings",
      "SET theme = CASE WHEN theme = 'dark' THEN $2::TEXT ELSE theme END",
      "WHERE user_id = $1",
      "RETURNING user_id",
    ].join(" "),
    [targetUserId, guestSettings.theme],
  );
  if (targetResult.rows.length === 0) {
    throw new Error(`Cannot transfer theme: target user ${targetUserId} has no settings.`);
  }
}

/** A completed onboarding carries onto the account; a guest who has not completed it never resets the account's. */
export async function carryGuestFirstReviewOnboardingToAccountInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  targetUserId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  const guestResult = await executor.query<Readonly<{ first_review_onboarding_completed: boolean }>>(
    "SELECT first_review_onboarding_completed FROM org.user_settings WHERE user_id = $1",
    [guestUserId],
  );
  const guestSettings = guestResult.rows[0];
  if (guestSettings === undefined) {
    throw new Error(`Cannot transfer first-review onboarding: guest user ${guestUserId} has no settings.`);
  }

  await applyUserDatabaseScopeInExecutor(executor, { userId: targetUserId });
  const targetResult = await executor.query(
    [
      "UPDATE org.user_settings",
      "SET first_review_onboarding_completed = first_review_onboarding_completed OR $2::BOOLEAN",
      "WHERE user_id = $1",
      "RETURNING user_id",
    ].join(" "),
    [targetUserId, guestSettings.first_review_onboarding_completed],
  );
  if (targetResult.rows.length === 0) {
    throw new Error(`Cannot transfer first-review onboarding: target user ${targetUserId} has no settings.`);
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
