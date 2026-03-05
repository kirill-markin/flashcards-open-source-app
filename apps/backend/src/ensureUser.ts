/**
 * Auto-provision user settings and workspace on first authenticated request.
 *
 * - Upsert org.user_settings row
 * - If workspace_id is NULL: create workspace and bind it to the user
 * - Return workspaceId
 */
import { randomUUID } from "node:crypto";
import { query } from "./db";

export type UserWorkspace = Readonly<{
  userId: string;
  workspaceId: string;
}>;

export async function ensureUserAndWorkspace(userId: string): Promise<UserWorkspace> {
  // Ensure user_settings row exists
  await query(
    "INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );

  // Check for existing workspace
  const existing = await query(
    "SELECT workspace_id FROM org.user_settings WHERE user_id = $1",
    [userId],
  );

  const currentWorkspaceId = existing.rows[0].workspace_id as string | null;
  if (currentWorkspaceId !== null) {
    return { userId, workspaceId: currentWorkspaceId };
  }

  // Create new workspace and bind to user
  const workspaceId = randomUUID();

  await query(
    "INSERT INTO org.workspaces (workspace_id, name) VALUES ($1, $2)",
    [workspaceId, "My Flashcards"],
  );

  await query(
    "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
    [workspaceId, userId],
  );

  return { userId, workspaceId };
}
