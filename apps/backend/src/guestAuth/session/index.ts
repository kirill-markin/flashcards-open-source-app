import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import type { AnalyticsConsentChoice } from "../../auth/ensureUser";
import { hasCognitoIdentityMappingForUserInExecutor } from "../../auth/userIdentities";
import type { DatabaseExecutor } from "../../database";
import { applyUserDatabaseScopeInExecutor } from "../../database";
import { unsafeQuery } from "../../database/unsafe";
import { HttpError } from "../../shared/errors";
import {
  AUTO_CREATED_WORKSPACE_NAME,
} from "../../workspaces/types";
import { createWorkspaceInExecutor } from "../../workspaces/create";
import {
  lockUserSettingsForWorkspaceLifecycleInExecutor,
  UserSettingsRowNotFoundError,
} from "../../workspaces/state";
import { guestSessionAnalyticsConsentColumnExistsInExecutor } from "../analyticsConsentColumn";
import { guestSessionPlatformColumnExistsInExecutor } from "../platformColumn";
import { guestSessionBindingExpiredSql, hashGuestToken } from "../shared";
import { loadGuestWorkspaceIdInExecutor } from "../store/index";
import type { GuestSessionPlatform, GuestSessionPurpose, GuestSessionSnapshot } from "../types";

type GuestSessionRow = Readonly<{
  session_id: string;
  user_id: string;
  platform: GuestSessionPlatform | null;
  purpose: GuestSessionPurpose;
  bound_to_account: boolean;
  analytics_consent: AnalyticsConsentChoice | null;
  product_analytics_enabled: boolean | null;
  revoked_at: Date | string | null;
  bound_past_grace_period: boolean;
}>;

type PreAnalyticsConsentGuestSessionRow = Readonly<{
  session_id: string;
  user_id: string;
  platform: GuestSessionPlatform | null;
  revoked_at: Date | string | null;
  bound_past_grace_period: boolean;
}>;

type LegacyGuestSessionRow = Readonly<{
  session_id: string;
  user_id: string;
  revoked_at: Date | string | null;
  bound_past_grace_period: boolean;
}>;

function toUndecidedGuestSessionRow(row: PreAnalyticsConsentGuestSessionRow): GuestSessionRow {
  return {
    ...row,
    purpose: "legacy",
    bound_to_account: false,
    analytics_consent: null,
    product_analytics_enabled: null,
  };
}

function toUnboundGuestSessionRow(row: LegacyGuestSessionRow): GuestSessionRow {
  return {
    ...row,
    platform: null,
    purpose: "legacy",
    bound_to_account: false,
    analytics_consent: null,
    product_analytics_enabled: null,
  };
}

const unsafeGuestSessionExecutor: DatabaseExecutor = {
  query: unsafeQuery,
};

async function loadGuestSessionRow(guestToken: string): Promise<GuestSessionRow | null> {
  const sessionSecretHash = hashGuestToken(guestToken);
  if (await guestSessionPlatformColumnExistsInExecutor(unsafeGuestSessionExecutor)) {
    // Each added column answers for itself: the platform probe above is cached true in production
    // and says nothing about the column migration 0147 has yet to add in this same release.
    if (await guestSessionAnalyticsConsentColumnExistsInExecutor(unsafeGuestSessionExecutor)) {
      // product_analytics_enabled gets no probe of its own. The probes above exist because those
      // migrations could land after the Lambda code that reads their column; migration 0149 cannot,
      // because infra/aws/lib/stack.ts binds the backend Lambda to the migration gate
      // (addDatabaseMigrationDependency), so CloudFormation applies it before this code serves a
      // request. A probe here would also have to fail open, and a false answer would report a
      // stored opt-out as unanswered, which reads as collection allowed - the one wrong answer this
      // column must never give.
      const result = await unsafeQuery<GuestSessionRow>(
        [
          "SELECT session_id, user_id, platform, purpose, analytics_consent, product_analytics_enabled,",
          "revoked_at,",
          "(auth.canonical_account_id(user_id) <> user_id OR EXISTS (",
          "SELECT 1 FROM auth.user_identities WHERE provider_type = 'cognito'",
          "AND (original_client_user_id = guest_sessions.user_id OR user_id = guest_sessions.user_id)",
          ")) AS bound_to_account,",
          `${guestSessionBindingExpiredSql} AS bound_past_grace_period`,
          "FROM auth.guest_sessions",
          "WHERE session_secret_hash = $1",
          "LIMIT 1",
        ].join(" "),
        [sessionSecretHash],
      );
      return result.rows[0] ?? null;
    }

    const preAnalyticsConsentResult = await unsafeQuery<PreAnalyticsConsentGuestSessionRow>(
      [
        "SELECT session_id, user_id, platform, revoked_at,",
        `${guestSessionBindingExpiredSql} AS bound_past_grace_period`,
        "FROM auth.guest_sessions",
        "WHERE session_secret_hash = $1",
        "LIMIT 1",
      ].join(" "),
      [sessionSecretHash],
    );
    const preAnalyticsConsentRow = preAnalyticsConsentResult.rows[0];
    return preAnalyticsConsentRow === undefined
      ? null
      : toUndecidedGuestSessionRow(preAnalyticsConsentRow);
  }

  // During the single-release rollout, new Lambda code can run before
  // migration 0055 has added auth.guest_sessions.platform. Treat those
  // sessions as legacy unbound sessions until the migration lands.
  const result = await unsafeQuery<LegacyGuestSessionRow>(
    [
      "SELECT session_id, user_id, revoked_at,",
      `${guestSessionBindingExpiredSql} AS bound_past_grace_period`,
      "FROM auth.guest_sessions",
      "WHERE session_secret_hash = $1",
      "LIMIT 1",
    ].join(" "),
    [sessionSecretHash],
  );
  const row = result.rows[0];
  return row === undefined ? null : toUnboundGuestSessionRow(row);
}

export async function authenticateGuestSession(guestToken: string): Promise<Readonly<{
  sessionId: string;
  userId: string;
  platform: GuestSessionPlatform | null;
  purpose: GuestSessionPurpose;
  analyticsConsent: AnalyticsConsentChoice | null;
  productAnalyticsEnabled: boolean | null;
}>> {
  const row = await loadGuestSessionRow(guestToken);
  if (row === null || row.revoked_at !== null || row.bound_past_grace_period) {
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  if (row.purpose === "browser_product" && row.bound_to_account) {
    throw new HttpError(409, "Finish browser guest conversion using the registered session.", "GUEST_BROWSER_UPGRADE_REQUIRED");
  }

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    platform: row.platform,
    purpose: row.purpose,
    // A guest has no account to keep an analytics decision on, so both decisions ride in with the
    // credential that was read anyway rather than costing a second query per request. The
    // product-analytics switch is read on every guest request because analytics ingest has to
    // refuse an opted-out batch, and that is the one surface a web guest credential may reach.
    analyticsConsent: row.analytics_consent,
    productAnalyticsEnabled: row.product_analytics_enabled,
  };
}

type BindGuestSessionPlatformRow = Readonly<{
  platform: GuestSessionPlatform | null;
  revoked_at: Date | string | null;
}>;

type BindGuestSessionPlatformUpdateRow = Readonly<{
  platform: GuestSessionPlatform;
}>;

type LegacyBindGuestSessionPlatformRow = Readonly<{
  revoked_at: Date | string | null;
}>;

function createGuestSessionInvalidError(): HttpError {
  return new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
}

async function assertLegacySchemaGuestSessionIsValid(guestSessionId: string): Promise<void> {
  const result = await unsafeQuery<LegacyBindGuestSessionPlatformRow>(
    [
      "SELECT revoked_at",
      "FROM auth.guest_sessions",
      "WHERE session_id = $1",
      "LIMIT 1",
    ].join(" "),
    [guestSessionId],
  );
  const row = result.rows[0];
  if (row === undefined || row.revoked_at !== null) {
    throw createGuestSessionInvalidError();
  }
}

export async function bindGuestSessionPlatform(
  guestSessionId: string,
  platform: GuestSessionPlatform,
): Promise<void> {
  if (!await guestSessionPlatformColumnExistsInExecutor(unsafeGuestSessionExecutor)) {
    await assertLegacySchemaGuestSessionIsValid(guestSessionId);
    return;
  }

  let updateResult: pg.QueryResult<BindGuestSessionPlatformUpdateRow>;
  updateResult = await unsafeQuery<BindGuestSessionPlatformUpdateRow>(
    [
      "UPDATE auth.guest_sessions",
      "SET platform = $2",
      "WHERE session_id = $1 AND revoked_at IS NULL AND platform IS NULL",
      "RETURNING platform",
    ].join(" "),
    [guestSessionId, platform],
  );

  if (updateResult.rows[0]?.platform === platform) {
    return;
  }

  let selectResult: pg.QueryResult<BindGuestSessionPlatformRow>;
  selectResult = await unsafeQuery<BindGuestSessionPlatformRow>(
    [
      "SELECT platform, revoked_at",
      "FROM auth.guest_sessions",
      "WHERE session_id = $1",
      "LIMIT 1",
    ].join(" "),
    [guestSessionId],
  );
  const row = selectResult.rows[0];
  if (row === undefined || row.revoked_at !== null) {
    throw createGuestSessionInvalidError();
  }

  if (row.platform === platform) {
    return;
  }

  throw new HttpError(
    403,
    "Guest session platform does not match this sync request. Create a new guest session for this device.",
    "GUEST_SESSION_PLATFORM_MISMATCH",
  );
}

async function insertGuestSessionInExecutor(
  executor: DatabaseExecutor,
  sessionId: string,
  guestToken: string,
  userId: string,
  platform: GuestSessionPlatform | null,
  creationIdempotencyKey: string | null,
  purpose: GuestSessionPurpose,
): Promise<GuestSessionPlatform | null> {
  if (await guestSessionPlatformColumnExistsInExecutor(executor)) {
    await executor.query(
      [
        "INSERT INTO auth.guest_sessions",
        "(session_id, session_secret_hash, user_id, platform, creation_idempotency_key, purpose)",
        "VALUES ($1, $2, $3, $4, $5, $6)",
      ].join(" "),
      [sessionId, hashGuestToken(guestToken), userId, platform, creationIdempotencyKey, purpose],
    );
    return platform;
  }

  // The pre-0055 schema this branch exists for is also pre-0117, and a non-null key already read
  // creation_idempotency_key before reaching here, so such a schema fails there rather than dropping
  // the key silently on this insert.
  await executor.query(
    [
      "INSERT INTO auth.guest_sessions",
      "(session_id, session_secret_hash, user_id)",
      "VALUES ($1, $2, $3)",
    ].join(" "),
    [sessionId, hashGuestToken(guestToken), userId],
  );
  return null;
}

type RotatedGuestSessionRow = Readonly<{
  purpose: GuestSessionPurpose;
  session_id: string;
  user_id: string;
  platform: GuestSessionPlatform | null;
}>;

const liveGuestSessionForCreationIdempotencyKeySql = [
  "SELECT session_id, user_id, platform, purpose",
  "FROM auth.guest_sessions",
  "WHERE creation_idempotency_key = $1 AND revoked_at IS NULL",
].join(" ");

async function loadLiveGuestSessionForCreationIdempotencyKeyInExecutor(
  executor: DatabaseExecutor,
  creationIdempotencyKey: string,
  lockForUpdate: boolean,
): Promise<RotatedGuestSessionRow | null> {
  const result = await executor.query<RotatedGuestSessionRow>(
    lockForUpdate
      ? `${liveGuestSessionForCreationIdempotencyKeySql} FOR UPDATE`
      : liveGuestSessionForCreationIdempotencyKeySql,
    [creationIdempotencyKey],
  );

  return result.rows[0] ?? null;
}

/**
 * Serializes every creation attempt carrying the same idempotency key.
 *
 * The guest user, its workspace and the org.user_settings selection are all written before the
 * session row exists, so a unique violation on the session insert would arrive far too late: both
 * concurrent attempts would already own a guest identity and one of them would be unreachable
 * forever. This is the first lock the creation path takes, ahead of the user-settings, guest-session
 * and workspace lifecycle locks below it, and the path never takes the Cognito identity lock. No
 * other transaction ever waits for this lock while holding one of those, because the only caller
 * takes it before them, so it cannot sit in a lock cycle.
 */
async function lockGuestSessionCreationIdempotencyInExecutor(
  executor: DatabaseExecutor,
  creationIdempotencyKey: string,
): Promise<void> {
  await executor.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('auth.guest_session_creation:' || $1::text, 2::bigint))",
    [creationIdempotencyKey],
  );
}

// The creation-key lock precedes user-settings then session-row locks. Re-read after the user
// lock so a concurrent upgrade cannot rotate an account credential through a creation retry.
async function rotateGuestSessionForCreationIdempotencyKeyInExecutor(
  executor: DatabaseExecutor,
  creationIdempotencyKey: string,
  guestToken: string,
  purpose: GuestSessionPurpose,
): Promise<GuestSessionSnapshot | null> {
  const unlockedRow = await loadLiveGuestSessionForCreationIdempotencyKeyInExecutor(
    executor,
    creationIdempotencyKey,
    false,
  );
  if (unlockedRow === null) {
    return null;
  }
  if (unlockedRow.purpose !== purpose) {
    throw new HttpError(409, "This creation attempt belongs to another credential type. Start a new creation attempt.", "GUEST_SESSION_PURPOSE_MISMATCH");
  }

  try {
    await lockUserSettingsForWorkspaceLifecycleInExecutor(executor, unlockedRow.user_id);
  } catch (error) {
    if (error instanceof UserSettingsRowNotFoundError) {
      // auth.guest_sessions.user_id cascades from org.user_settings, so the row read above is gone
      // too. Create a fresh guest rather than rotating a credential whose user no longer exists.
      return null;
    }

    throw error;
  }

  const row = await loadLiveGuestSessionForCreationIdempotencyKeyInExecutor(
    executor,
    creationIdempotencyKey,
    true,
  );
  if (
    row === null
    || row.session_id !== unlockedRow.session_id
    || row.user_id !== unlockedRow.user_id
  ) {
    return null;
  }

  if (await hasCognitoIdentityMappingForUserInExecutor(executor, row.user_id)) {
    await executor.query(
      "UPDATE auth.guest_sessions SET creation_idempotency_key = NULL WHERE session_id = $1",
      [row.session_id],
    );
    return null;
  }

  await executor.query(
    "UPDATE auth.guest_sessions SET session_secret_hash = $2 WHERE session_id = $1",
    [row.session_id, hashGuestToken(guestToken)],
  );

  return {
    guestToken,
    purpose: row.purpose,
    userId: row.user_id,
    workspaceId: await loadGuestWorkspaceIdInExecutor(executor, row.user_id),
    platform: row.platform,
  };
}

async function createGuestSessionForPurposeInExecutor(
  executor: DatabaseExecutor,
  platform: GuestSessionPlatform | null,
  creationIdempotencyKey: string | null,
  purpose: GuestSessionPurpose,
): Promise<GuestSessionSnapshot> {
  const guestToken = randomBytes(32).toString("hex");
  if (creationIdempotencyKey !== null) {
    await lockGuestSessionCreationIdempotencyInExecutor(executor, creationIdempotencyKey);
    const rotatedSession = await rotateGuestSessionForCreationIdempotencyKeyInExecutor(
      executor,
      creationIdempotencyKey,
      guestToken,
      purpose,
    );
    if (rotatedSession !== null) {
      return rotatedSession;
    }
  }

  const userId = randomUUID().toLowerCase();
  const sessionId = randomUUID().toLowerCase();

  await applyUserDatabaseScopeInExecutor(executor, { userId });
  const workspaceId = await createWorkspaceInExecutor(executor, userId, {
    name: AUTO_CREATED_WORKSPACE_NAME,
    cause: "automatic_starter",
  });
  await executor.query(
    "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
    [workspaceId, userId],
  );
  const storedPlatform = await insertGuestSessionInExecutor(
    executor,
    sessionId,
    guestToken,
    userId,
    platform,
    creationIdempotencyKey,
    purpose,
  );

  return {
    guestToken,
    purpose,
    userId,
    workspaceId,
    platform: storedPlatform,
  };
}

export function createGuestSessionInExecutor(
  executor: DatabaseExecutor,
  platform: GuestSessionPlatform | null,
  creationIdempotencyKey: string | null,
): Promise<GuestSessionSnapshot> {
  return createGuestSessionForPurposeInExecutor(executor, platform, creationIdempotencyKey, "legacy");
}

export function createBrowserGuestSessionInExecutor(
  executor: DatabaseExecutor,
  creationIdempotencyKey: string,
): Promise<GuestSessionSnapshot> {
  return createGuestSessionForPurposeInExecutor(executor, "web", creationIdempotencyKey, "browser_product");
}
