import type pg from "pg";
import {
  applyUserDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import { HttpError } from "../../shared/errors";
import {
  lockUserSettingsForWorkspaceLifecycleInExecutor,
  UserSettingsRowNotFoundError,
} from "../../workspaces/state";
import { guestSessionPlatformColumnExistsInExecutor } from "../platformColumn";
import { hashGuestToken } from "../shared";
import type { GuestSessionPlatform } from "../types";

type GuestSessionRow = Readonly<{
  session_id: string;
  user_id: string;
  platform: GuestSessionPlatform | null;
  revoked_at: Date | string | null;
}>;

type LegacyGuestSessionRow = Readonly<{
  session_id: string;
  user_id: string;
  revoked_at: Date | string | null;
}>;

export type GuestSessionRecord = Readonly<{
  sessionId: string;
  userId: string;
  platform: GuestSessionPlatform | null;
  revokedAt: Date | string | null;
}>;

function createGuestSessionInvalidError(): HttpError {
  return new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
}

function mapGuestSessionRecord(row: GuestSessionRow): GuestSessionRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    platform: row.platform,
    revokedAt: row.revoked_at,
  };
}

function mapLegacyGuestSessionRecord(row: LegacyGuestSessionRow): GuestSessionRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    platform: null,
    revokedAt: row.revoked_at,
  };
}

export async function loadGuestSessionRecordInExecutor(
  executor: DatabaseExecutor,
  guestToken: string,
  lockForUpdate: boolean,
): Promise<GuestSessionRecord | null> {
  const sessionSecretHash = hashGuestToken(guestToken);
  let result: pg.QueryResult<GuestSessionRow>;
  if (await guestSessionPlatformColumnExistsInExecutor(executor)) {
    result = await executor.query<GuestSessionRow>(
      [
        "SELECT session_id, user_id, platform, revoked_at",
        "FROM auth.guest_sessions",
        "WHERE session_secret_hash = $1",
        lockForUpdate ? "FOR UPDATE" : "",
      ].join(" "),
      [sessionSecretHash],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapGuestSessionRecord(row);
  }

  const legacyResult = await executor.query<LegacyGuestSessionRow>(
    [
      "SELECT session_id, user_id, revoked_at",
      "FROM auth.guest_sessions",
      "WHERE session_secret_hash = $1",
      lockForUpdate ? "FOR UPDATE" : "",
    ].join(" "),
    [sessionSecretHash],
  );
  const legacyRow = legacyResult.rows[0];
  return legacyRow === undefined ? null : mapLegacyGuestSessionRecord(legacyRow);
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
