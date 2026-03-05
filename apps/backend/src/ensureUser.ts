/**
 * Auto-provision user settings and workspace on first authenticated request.
 *
 * - INSERT INTO user_settings ON CONFLICT DO NOTHING
 * - Check workspace_members for existing workspace
 * - If none: create workspace + workspace_members row with role='owner'
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
    "INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );

  // Check for existing workspace membership
  const existing = await query(
    "SELECT workspace_id FROM workspace_members WHERE user_id = $1 LIMIT 1",
    [userId],
  );

  if (existing.rows.length > 0) {
    return { userId, workspaceId: existing.rows[0].workspace_id as string };
  }

  // Create new workspace + membership
  const workspaceId = randomUUID();
  const workspaceName = "My Flashcards";

  await query(
    "INSERT INTO workspaces (workspace_id, name) VALUES ($1, $2)",
    [workspaceId, workspaceName],
  );

  await query(
    "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
    [workspaceId, userId],
  );

  return { userId, workspaceId };
}
