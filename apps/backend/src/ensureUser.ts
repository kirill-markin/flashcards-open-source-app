/**
 * Ensure the authenticated user has a profile row and an accessible selected
 * workspace. New users are auto-provisioned with a default workspace.
 */
import { transactionWithUserScope, type DatabaseExecutor } from "./db";
import { ensureUserSelectedWorkspaceInExecutor } from "./workspaces";

export type UserProfile = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  email: string | null;
  locale: string;
  createdAt: string;
}>;

type UserSettingsRow = Readonly<{
  workspace_id: string | null;
  email: string | null;
  locale: string;
  created_at: Date | string;
}>;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const upsertUserSettingsSql = [
  "INSERT INTO org.user_settings (user_id, email)",
  "VALUES ($1, $2)",
  "ON CONFLICT (user_id) DO UPDATE",
  "SET email = EXCLUDED.email",
  "WHERE org.user_settings.email IS NULL",
  "AND EXCLUDED.email IS NOT NULL",
].join(" ");

export async function ensureUserProfileInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  email: string | null,
): Promise<UserProfile> {
  await executor.query(
    upsertUserSettingsSql,
    [userId, email],
  );

  const existing = await executor.query<UserSettingsRow>(
    "SELECT workspace_id, email, locale, created_at FROM org.user_settings WHERE user_id = $1 FOR UPDATE",
    [userId],
  );

  if (existing.rows.length === 0) {
    throw new Error("Failed to load user settings after upsert");
  }

  const settings = existing.rows[0];
  const selectedWorkspaceId = await ensureUserSelectedWorkspaceInExecutor(
    executor,
    userId,
    settings.workspace_id,
  );

  return {
    userId,
    selectedWorkspaceId,
    email: settings.email,
    locale: settings.locale,
    createdAt: toIsoString(settings.created_at),
  };
}

export async function ensureUserProfile(userId: string, email: string | null): Promise<UserProfile> {
  return transactionWithUserScope({ userId }, async (executor) => ensureUserProfileInExecutor(executor, userId, email));
}
