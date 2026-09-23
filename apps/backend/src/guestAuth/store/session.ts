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

/** The write below sets a non-null value, so what it returns cannot be NULL. */
type StoredGuestSessionProductAnalyticsEnabledRow = Readonly<{
  product_analytics_enabled: boolean;
}>;

/**
 * What a request may ask to store on the guest session. Null is a field the request left out, not
 * an erasure: neither column is ever written back to NULL.
 */
export type GuestSessionAnalyticsPreferencesUpdate = Readonly<{
  analyticsConsent: AnalyticsConsentChoice | null;
  productAnalyticsEnabled: boolean | null;
}>;

/** Only the columns this call wrote. A field the update left out comes back null and untouched. */
export type StoredGuestSessionAnalyticsPreferences = Readonly<{
  analyticsConsent: AnalyticsConsentChoice | null;
  productAnalyticsEnabled: boolean | null;
}>;

/**
 * Records on the guest session what a person with no account answered about analytics collection.
 *
 * Called only for a request that carries an answer, so it always writes one; nothing ever writes
 * NULL back, and a withdrawal is `declined`. Telling a client its withdrawal was stored when the
 * column is not there yet is the one outcome that must be impossible, so a pre-0147 schema raises
 * instead of reporting a success the database did not take.
 */
async function setGuestSessionAnalyticsConsentInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestSessionId: string,
  analyticsConsent: AnalyticsConsentChoice,
): Promise<AnalyticsConsentChoice> {
  if (!await guestSessionAnalyticsConsentColumnExistsInExecutor(executor)) {
    throw new Error(
      `Cannot store guest analytics consent "${analyticsConsent}": column`
      + " auth.guest_sessions.analytics_consent does not exist yet, because migration"
      + " 0147_guest_session_analytics_consent has not been applied in this environment.",
    );
  }

  const result = await executor.query<StoredGuestSessionAnalyticsConsentRow>(
    [
      "UPDATE auth.guest_sessions",
      "SET analytics_consent = $3::TEXT",
      "WHERE session_id = $1 AND user_id = $2 AND revoked_at IS NULL",
      "RETURNING analytics_consent",
    ].join(" "),
    [guestSessionId, guestUserId, analyticsConsent],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw createGuestSessionInvalidError();
  }

  return row.analytics_consent;
}

/**
 * Records on the guest session whether a person with no account allows product analytics.
 *
 * No column probe, unlike the consent write above: infra/aws/lib/stack.ts binds the backend Lambda
 * to the migration gate, so migration 0149 is applied before this code serves a request. A probe
 * would also have to answer for a read path that must never report a stored opt-out as unanswered.
 */
async function setGuestSessionProductAnalyticsEnabledInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestSessionId: string,
  productAnalyticsEnabled: boolean,
): Promise<boolean> {
  const result = await executor.query<StoredGuestSessionProductAnalyticsEnabledRow>(
    [
      "UPDATE auth.guest_sessions",
      "SET product_analytics_enabled = $3::BOOLEAN",
      "WHERE session_id = $1 AND user_id = $2 AND revoked_at IS NULL",
      "RETURNING product_analytics_enabled",
    ].join(" "),
    [guestSessionId, guestUserId, productAnalyticsEnabled],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw createGuestSessionInvalidError();
  }

  return row.product_analytics_enabled;
}

/**
 * Stores every analytics answer a guest request carries, in one transaction.
 *
 * One transaction rather than a write per column because either write can fail - a revoked session,
 * and a pre-0147 schema for the consent column - and a request carrying both answers must land
 * both or neither. Two transactions would let a 500 still leave one answer stored, with no way for
 * the client to tell which. A field the request left out is not written at all, so a request that
 * touches neither column never reaches this function.
 */
export async function updateGuestSessionAnalyticsPreferences(
  guestUserId: string,
  guestSessionId: string,
  update: GuestSessionAnalyticsPreferencesUpdate,
): Promise<StoredGuestSessionAnalyticsPreferences> {
  return transactionWithUserScope(
    { userId: guestUserId },
    async (executor) => {
      const analyticsConsent = update.analyticsConsent === null
        ? null
        : await setGuestSessionAnalyticsConsentInExecutor(
          executor,
          guestUserId,
          guestSessionId,
          update.analyticsConsent,
        );
      const productAnalyticsEnabled = update.productAnalyticsEnabled === null
        ? null
        : await setGuestSessionProductAnalyticsEnabledInExecutor(
          executor,
          guestUserId,
          guestSessionId,
          update.productAnalyticsEnabled,
        );

      return { analyticsConsent, productAnalyticsEnabled };
    },
  );
}

/**
 * Carries a guest's recorded analytics answer onto the account that guest becomes at upgrade.
 *
 * NULL on org.user_settings.analytics_consent reads as collection allowed, so an upgrade that left
 * the account column NULL would turn a withdrawal back into a consent. An account that answered for
 * itself keeps its own answer, which is why the copy lands only on a target row still holding NULL.
 *
 * Runs in both upgrade shapes and therefore before the merge shape deletes the guest row. On the
 * pre-0147 schema there is nothing to carry, because no guest session can hold an answer yet.
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

type GuestSessionProductAnalyticsEnabledRow = Readonly<{
  product_analytics_enabled: boolean | null;
}>;

/**
 * Carries a guest's recorded product-analytics switch onto the account that guest becomes at
 * upgrade, on the same terms as the consent carry above.
 *
 * NULL on org.user_settings.product_analytics_enabled reads as collection allowed, so an upgrade
 * that left the account column NULL would turn an opt-out back into collection at sign-in. An
 * account that answered for itself keeps its own answer, which is why the copy lands only on a
 * target row still holding NULL.
 *
 * Unlike a consent value, the restrictive answer here is `false`, so "the account's own answer
 * wins" resolves toward more collection rather than less: a guest holding `false` who signs into an
 * account already holding `true` loses the opt-out, and collection continues under the account.
 * That is deliberate and matches 0147 - the account answer is that person's own later decision,
 * made on the account they chose to sign into - and the switch stays theirs to set again.
 *
 * Runs in both upgrade shapes and therefore before the merge shape deletes the guest row. No column
 * probe: the migration gate applies 0149 before this code runs, as for the write path.
 */
export async function carryGuestProductAnalyticsEnabledToAccountInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestSessionId: string,
  targetUserId: string,
): Promise<void> {
  const guestResult = await executor.query<GuestSessionProductAnalyticsEnabledRow>(
    [
      "SELECT product_analytics_enabled",
      "FROM auth.guest_sessions",
      "WHERE session_id = $1 AND user_id = $2",
      "LIMIT 1",
    ].join(" "),
    [guestSessionId, guestUserId],
  );
  const productAnalyticsEnabled = guestResult.rows[0]?.product_analytics_enabled ?? null;
  if (productAnalyticsEnabled === null) {
    return;
  }

  await applyUserDatabaseScopeInExecutor(executor, { userId: targetUserId });
  await executor.query(
    "UPDATE org.user_settings SET product_analytics_enabled = $2"
    + " WHERE user_id = $1 AND product_analytics_enabled IS NULL",
    [targetUserId, productAnalyticsEnabled],
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
