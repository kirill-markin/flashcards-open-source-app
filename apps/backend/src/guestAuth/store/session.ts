import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import { HttpError } from "../../shared/errors";
import {
  lockUserSettingsForWorkspaceLifecycleInExecutor,
  UserSettingsRowNotFoundError,
} from "../../workspaces/state";
import { hashGuestToken } from "../shared";

type GuestSessionRow = Readonly<{
  session_id: string;
  user_id: string;
  revoked_at: Date | string | null;
}>;

export type GuestSessionRecord = Readonly<{
  sessionId: string;
  userId: string;
  revokedAt: Date | string | null;
}>;

function createGuestSessionInvalidError(): HttpError {
  return new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
}

function mapGuestSessionRecord(row: GuestSessionRow): GuestSessionRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    revokedAt: row.revoked_at,
  };
}

export async function loadGuestSessionRecordInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  lockForUpdate: boolean,
): Promise<GuestSessionRecord | null> {
  const result = await executor.query<GuestSessionRow>(
    [
      "SELECT session_id, user_id, revoked_at",
      "FROM auth.guest_sessions",
      "WHERE session_secret_hash = $1",
      lockForUpdate ? "FOR UPDATE" : "",
    ].join(" "),
    [hashGuestToken(guestToken)],
  );

  const row = result.rows[0];
  return row === undefined ? null : mapGuestSessionRecord(row);
}

export async function loadGuestSessionRecordWithUserSettingsLockInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
): Promise<GuestSessionRecord | null> {
  const unlockedSession = await loadGuestSessionRecordInExecutor(executor, guestToken, false);
  if (unlockedSession === null) {
    return null;
  }

  try {
    await lockUserSettingsForWorkspaceLifecycleInExecutor(executor, unlockedSession.userId);
  } catch (error) {
    if (error instanceof UserSettingsRowNotFoundError) {
      return null;
    }

    throw error;
  }

  const lockedSession = await loadGuestSessionRecordInExecutor(executor, guestToken, true);
  if (
    lockedSession === null
    || lockedSession.sessionId !== unlockedSession.sessionId
    || lockedSession.userId !== unlockedSession.userId
  ) {
    return null;
  }

  return lockedSession;
}

export async function loadGuestSessionInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  lockForUpdate: boolean,
): Promise<GuestSessionRecord> {
  const session = await loadGuestSessionRecordInExecutor(executor, guestToken, lockForUpdate);
  if (session === null || session.revokedAt !== null) {
    throw createGuestSessionInvalidError();
  }

  return session;
}

export async function loadGuestSessionWithUserSettingsLockInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
): Promise<GuestSessionRecord> {
  const session = await loadGuestSessionRecordWithUserSettingsLockInExecutor(executor, guestToken);
  if (session === null || session.revokedAt !== null) {
    throw createGuestSessionInvalidError();
  }

  return session;
}

export async function revokeGuestSessionInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestSessionId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  await executor.query(
    "UPDATE auth.guest_sessions SET revoked_at = now() WHERE session_id = $1",
    [guestSessionId],
  );
}
