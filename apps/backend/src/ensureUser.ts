/**
 * Ensure the authenticated user has a profile row, but do not auto-create a
 * workspace. Workspace creation and selection are explicit flows now.
 */
import { query } from "./db";

export type UserProfile = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  email: string | null;
  locale: string;
}>;

type UserSettingsRow = Readonly<{
  workspace_id: string | null;
  email: string | null;
  locale: string;
}>;

export async function ensureUserProfile(userId: string): Promise<UserProfile> {
  await query(
    "INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );

  const existing = await query<UserSettingsRow>(
    "SELECT workspace_id, email, locale FROM org.user_settings WHERE user_id = $1",
    [userId],
  );

  if (existing.rows.length === 0) {
    throw new Error("Failed to load user settings after upsert");
  }

  const settings = existing.rows[0];
  return {
    userId,
    selectedWorkspaceId: settings.workspace_id,
    email: settings.email,
    locale: settings.locale,
  };
}
