/**
 * Auto-provision user settings and workspace on first authenticated request.
 *
 * - Upsert org.user_settings row
 * - If workspace_id is NULL: create workspace and bind it to the user
 * - Return workspaceId
 */
import { randomUUID } from "node:crypto";
import { transaction } from "./db";

export type UserWorkspace = Readonly<{
  userId: string;
  workspaceId: string;
  email: string | null;
  locale: string;
}>;

type UserSettingsRow = Readonly<{
  workspace_id: string | null;
  email: string | null;
  locale: string;
}>;

export async function ensureUserAndWorkspace(userId: string): Promise<UserWorkspace> {
  return transaction(async (executor) => {
    await executor.query(
      "INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [userId],
    );

    const existing = await executor.query<UserSettingsRow>(
      "SELECT workspace_id, email, locale FROM org.user_settings WHERE user_id = $1 FOR UPDATE",
      [userId],
    );

    if (existing.rows.length === 0) {
      throw new Error("Failed to load user settings after upsert");
    }

    const settings = existing.rows[0];
    if (settings.workspace_id !== null) {
      return {
        userId,
        workspaceId: settings.workspace_id,
        email: settings.email,
        locale: settings.locale,
      };
    }

    const workspaceId = randomUUID();
    const bootstrapDeviceId = randomUUID();
    const bootstrapTimestamp = new Date().toISOString();
    const bootstrapOperationId = `bootstrap-workspace-${workspaceId}`;

    await executor.query(
      [
        "INSERT INTO org.workspaces",
        "(",
        "workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_device_id, fsrs_last_operation_id",
        ")",
        "VALUES ($1, $2, $3, $4, $5)",
      ].join(" "),
      [workspaceId, "My Flashcards", bootstrapTimestamp, bootstrapDeviceId, bootstrapOperationId],
    );

    await executor.query(
      [
        "INSERT INTO sync.devices",
        "(device_id, workspace_id, user_id, platform, app_version, last_seen_at)",
        "VALUES ($1, $2, $3, 'ios', $4, now())",
      ].join(" "),
      [bootstrapDeviceId, workspaceId, userId, "server-bootstrap"],
    );

    await executor.query(
      "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
      [workspaceId, userId],
    );

    return {
      userId,
      workspaceId,
      email: settings.email,
      locale: settings.locale,
    };
  });
}
