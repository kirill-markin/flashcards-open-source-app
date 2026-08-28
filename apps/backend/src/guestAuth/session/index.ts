import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
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
import { guestSessionPlatformColumnExistsInExecutor } from "../platformColumn";
import { hashGuestToken } from "../shared";
import { loadGuestWorkspaceIdInExecutor } from "../store/index";
import type { GuestSessionPlatform, GuestSessionSnapshot } from "../types";

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

function toUnboundGuestSessionRow(row: LegacyGuestSessionRow): GuestSessionRow {
  return {
    ...row,
    platform: null,
  };
}

const unsafeGuestSessionExecutor: DatabaseExecutor = {
  query: unsafeQuery,
};

async function loadGuestSessionRow(guestToken: string): Promise<GuestSessionRow | null> {
  const sessionSecretHash = hashGuestToken(guestToken);
  if (await guestSessionPlatformColumnExistsInExecutor(unsafeGuestSessionExecutor)) {
    const result = await unsafeQuery<GuestSessionRow>(
      [
        "SELECT session_id, user_id, platform, revoked_at",
        "FROM auth.guest_sessions",
        "WHERE session_secret_hash = $1",
        "LIMIT 1",
      ].join(" "),
      [sessionSecretHash],
    );
    return result.rows[0] ?? null;
  }

  // During the single-release rollout, new Lambda code can run before
  // migration 0055 has added auth.guest_sessions.platform. Treat those
  // sessions as legacy unbound sessions until the migration lands.
  const result = await unsafeQuery<LegacyGuestSessionRow>(
    [
      "SELECT session_id, user_id, revoked_at",
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
}>> {
  const row = await loadGuestSessionRow(guestToken);
  if (row === null || row.revoked_at !== null) {
    throw new HttpError(401, "Guest session is invalid.", "GUEST_AUTH_INVALID");
  }

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    platform: row.platform,
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
): Promise<GuestSessionPlatform | null> {
  if (await guestSessionPlatformColumnExistsInExecutor(executor)) {
    await executor.query(
      [
        "INSERT INTO auth.guest_sessions",
        "(session_id, session_secret_hash, user_id, platform, creation_idempotency_key)",
        "VALUES ($1, $2, $3, $4, $5)",
      ].join(" "),
      [sessionId, hashGuestToken(guestToken), userId, platform, creationIdempotencyKey],
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
  session_id: string;
  user_id: string;
  platform: GuestSessionPlatform | null;
}>;

const liveGuestSessionForCreationIdempotencyKeySql = [
  "SELECT session_id, user_id, platform",
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

/**
 * Hands a retry back the guest identity its lost response already created, behind a new token.
 *
 * Only the hash of a per-attempt token is stored, so the token the lost response carried cannot be
 * read back and cannot be returned a second time. Rotating the secret costs nothing: no client ever
 * received the token being invalidated.
 *
 * Two kinds of session are deliberately never handed back, and both end in a fresh guest, so this
 * function keeps the server's own guarantee that creating a guest session never returns an identity
 * that belongs to a real account. That guarantee must not rest on clients that have yet to be
 * written, which is why the second case is enforced here rather than left as a client obligation.
 *
 * A revoked session is not matched at all. Upgrade and deletion retire a guest credential on
 * purpose, so a key that now names one is treated as absent.
 *
 * A live session whose user has since been bound to a real account is matched and disarmed: its key
 * is cleared and this call falls through to creation. The bound branch of
 * `/guest-auth/upgrade/complete` deliberately never revokes the guest session it converts, so after
 * a bound upgrade that row stays live with its key intact while its `user_id` is the account's own
 * id. Rotating it would answer a caller holding nothing but the key with a valid guest token for
 * that account, plus whatever workspace the account currently has selected, and a key is only ever
 * meant to buy back a guest identity, never an account's credential. The route's key format bounds
 * the shape of a key, not who can present one, and even a key generated randomly per attempt would
 * not make presenting one legitimate here. Treating the row as absent without clearing the key is
 * not enough either: the row is still live, so it still occupies
 * `idx_guest_sessions_active_creation_idempotency_key` and the insert below would violate it.
 * Clearing only the key leaves that account's live credential
 * untouched and retires a marker that stopped meaning "one guest creation attempt" the moment the
 * session stopped being a guest. `deleteGuestSessionInExecutor` and
 * `linkGuestAnalyticsIdentityInExecutor` guard the same state with the same
 * `hasCognitoIdentityMappingForUserInExecutor` probe: on none of the three paths may a guest session
 * whose user is already a real account be treated as an ordinary guest. Each path answers it
 * differently only because their safe answers differ — here a fresh guest, there a refusal.
 *
 * The check belongs here, next to the lookup, rather than at the call site: any future lookup that
 * resolves a session by something other than the token hash faces the same question.
 *
 * The two row locks are taken in the order every other guest path takes them: the guest's
 * `org.user_settings` row first, then the `auth.guest_sessions` row. That is why the key is read
 * once unlocked purely to learn which user to lock, exactly as
 * `loadGuestSessionRecordWithUserSettingsLockInExecutor` and
 * `lockGuestSessionAfterUserSettingsInExecutor` do, and re-read under `FOR UPDATE` afterwards. The
 * advisory key lock does not make the locked re-read redundant: it only serializes other creation
 * attempts for this key, while an upgrade, link or delete call for this same guest takes none of it
 * and could otherwise bind or retire the user between the two reads. A row that changed identity or
 * stopped being live in between is treated as absent and falls through to a fresh guest.
 */
async function rotateGuestSessionForCreationIdempotencyKeyInExecutor(
  executor: DatabaseExecutor,
  creationIdempotencyKey: string,
  guestToken: string,
): Promise<GuestSessionSnapshot | null> {
  const unlockedRow = await loadLiveGuestSessionForCreationIdempotencyKeyInExecutor(
    executor,
    creationIdempotencyKey,
    false,
  );
  if (unlockedRow === null) {
    return null;
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
    userId: row.user_id,
    workspaceId: await loadGuestWorkspaceIdInExecutor(executor, row.user_id),
    platform: row.platform,
  };
}

export async function createGuestSessionInExecutor(
  executor: DatabaseExecutor,
  platform: GuestSessionPlatform | null,
  creationIdempotencyKey: string | null,
): Promise<GuestSessionSnapshot> {
  // Guest session creation is intentionally always a fresh server-side
  // identity. Clients clear stored guest sessions and regenerate their local
  // installation identity on logout/account deletion before they can call
  // this again, which keeps future guest-to-linked merges scoped to the
  // current post-reset guest account only. An idempotency key narrows that to
  // one fresh identity per key, so only a retry of the very same attempt is
  // folded back onto the identity that attempt already created, and never onto
  // an identity that has since been bound to a real account.
  const guestToken = randomBytes(32).toString("hex");
  if (creationIdempotencyKey !== null) {
    await lockGuestSessionCreationIdempotencyInExecutor(executor, creationIdempotencyKey);
    const rotatedSession = await rotateGuestSessionForCreationIdempotencyKeyInExecutor(
      executor,
      creationIdempotencyKey,
      guestToken,
    );
    if (rotatedSession !== null) {
      return rotatedSession;
    }
  }

  const userId = randomUUID().toLowerCase();
  const sessionId = randomUUID().toLowerCase();

  await applyUserDatabaseScopeInExecutor(executor, { userId });
  const workspaceId = await createWorkspaceInExecutor(executor, userId, AUTO_CREATED_WORKSPACE_NAME);
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
  );

  return {
    guestToken,
    userId,
    workspaceId,
    platform: storedPlatform,
  };
}
