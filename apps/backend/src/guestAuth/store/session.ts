import type pg from "pg";
import {
  applyUserDatabaseScopeInExecutor,
  transactionWithUserScope,
  type DatabaseExecutor,
} from "../../database";
import type { AnalyticsConsentChoice } from "../../auth/ensureUser";
import { HttpError } from "../../shared/errors";
import {
  lockUserSettingsForWorkspaceLifecycleInExecutor,
  UserSettingsRowNotFoundError,
} from "../../workspaces/state";
import { guestSessionAnalyticsConsentColumnExistsInExecutor } from "../analyticsConsentColumn";
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

type GuestSessionAnalyticsConsentRow = Readonly<{
  analytics_consent: AnalyticsConsentChoice | null;
}>;

/** The write below sets a non-null value, so what it returns cannot be NULL. */
type StoredGuestSessionAnalyticsConsentRow = Readonly<{
  analytics_consent: AnalyticsConsentChoice;
}>;

/**
 * Records on the guest session what a person with no account answered about analytics collection.
 *
 * Called only for a request that carries an answer, so it always writes one; nothing ever writes
 * NULL back, and a withdrawal is `declined`. Telling a client its withdrawal was stored when the
 * column is not there yet is the one outcome that must be impossible, so a pre-0146 schema raises
 * instead of reporting a success the database did not take.
 */
export async function updateGuestSessionAnalyticsConsent(
  guestUserId: string,
  guestSessionId: string,
  analyticsConsent: AnalyticsConsentChoice,
): Promise<AnalyticsConsentChoice> {
  const result = await transactionWithUserScope(
    { userId: guestUserId },
    async (executor) => {
      if (!await guestSessionAnalyticsConsentColumnExistsInExecutor(executor)) {
        throw new Error(
          `Cannot store guest analytics consent "${analyticsConsent}": column`
          + " auth.guest_sessions.analytics_consent does not exist yet, because migration"
          + " 0146_guest_session_analytics_consent has not been applied in this environment.",
        );
      }

      return executor.query<StoredGuestSessionAnalyticsConsentRow>(
        [
          "UPDATE auth.guest_sessions",
          "SET analytics_consent = $3::TEXT",
          "WHERE session_id = $1 AND user_id = $2 AND revoked_at IS NULL",
          "RETURNING analytics_consent",
        ].join(" "),
        [guestSessionId, guestUserId, analyticsConsent],
      );
    },
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw createGuestSessionInvalidError();
  }

  return row.analytics_consent;
}

/**
 * Carries a guest's recorded analytics answer onto the account that guest becomes at upgrade.
 *
 * NULL on org.user_settings.analytics_consent reads as collection allowed, so an upgrade that left
 * the account column NULL would turn a withdrawal back into a consent. An account that answered for
 * itself keeps its own answer, which is why the copy lands only on a target row still holding NULL.
 *
 * Runs in both upgrade shapes and therefore before the merge shape deletes the guest row. On the
 * pre-0146 schema there is nothing to carry, because no guest session can hold an answer yet.
 */
export async function carryGuestAnalyticsConsentToAccountInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestSessionId: string,
  targetUserId: string,
): Promise<void> {
  if (!await guestSessionAnalyticsConsentColumnExistsInExecutor(executor)) {
    return;
  }

  const guestResult = await executor.query<GuestSessionAnalyticsConsentRow>(
    [
      "SELECT analytics_consent",
      "FROM auth.guest_sessions",
      "WHERE session_id = $1 AND user_id = $2",
      "LIMIT 1",
    ].join(" "),
    [guestSessionId, guestUserId],
  );
  const analyticsConsent = guestResult.rows[0]?.analytics_consent ?? null;
  if (analyticsConsent === null) {
    return;
  }

  await applyUserDatabaseScopeInExecutor(executor, { userId: targetUserId });
  await executor.query(
    "UPDATE org.user_settings SET analytics_consent = $2 WHERE user_id = $1 AND analytics_consent IS NULL",
    [targetUserId, analyticsConsent],
  );
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
