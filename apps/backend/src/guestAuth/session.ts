import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseExecutor } from "../db";
import { applyUserDatabaseScopeInExecutor } from "../db";
import { unsafeQuery } from "../dbUnsafe";
import { HttpError } from "../errors";
import {
  AUTO_CREATED_WORKSPACE_NAME,
  createWorkspaceInExecutor,
} from "../workspaces";
import { hashGuestToken } from "./shared";
import type { GuestSessionSnapshot } from "./types";

type GuestSessionRow = Readonly<{
  session_id: string;
  user_id: string;
  revoked_at: Date | string | null;
}>;

export async function authenticateGuestSession(guestToken: string): Promise<Readonly<{
  userId: string;
}>> {
  const result = await unsafeQuery<GuestSessionRow>(
    [
      "SELECT session_id, user_id, revoked_at",
      "FROM auth.guest_sessions",
      "WHERE session_secret_hash = $1",
      "LIMIT 1",
    ].join(" "),
    [hashGuestToken(guestToken)],
  );

  const row = result.rows[0];
  if (row === undefined || row.revoked_at !== null) {
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  return {
    userId: row.user_id,
  };
}

export async function createGuestSessionInExecutor(
  executor: DatabaseExecutor,
): Promise<GuestSessionSnapshot> {
  // Guest session creation is intentionally always a fresh server-side
  // identity. Clients clear stored guest sessions and regenerate their local
  // installation identity on logout/account deletion before they can call
  // this again, which keeps future guest-to-linked merges scoped to the
  // current post-reset guest account only.
  const userId = randomUUID().toLowerCase();
  const guestToken = randomBytes(32).toString("hex");

  await applyUserDatabaseScopeInExecutor(executor, { userId });
  const workspaceId = await createWorkspaceInExecutor(executor, userId, AUTO_CREATED_WORKSPACE_NAME);
  await executor.query(
    "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
    [workspaceId, userId],
  );
  await executor.query(
    [
      "INSERT INTO auth.guest_sessions",
      "(session_id, session_secret_hash, user_id)",
      "VALUES ($1, $2, $3)",
    ].join(" "),
    [randomUUID().toLowerCase(), hashGuestToken(guestToken), userId],
  );

  return {
    guestToken,
    userId,
    workspaceId,
  };
}
