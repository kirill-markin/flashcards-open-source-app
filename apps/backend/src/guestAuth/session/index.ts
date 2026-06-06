import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import type { DatabaseExecutor } from "../../database";
import { applyUserDatabaseScopeInExecutor } from "../../database";
import { unsafeQuery } from "../../database/unsafe";
import { HttpError } from "../../shared/errors";
import {
  AUTO_CREATED_WORKSPACE_NAME,
  createWorkspaceInExecutor,
} from "../../workspaces";
import { guestSessionPlatformColumnExistsInExecutor } from "../platformColumn";
import { hashGuestToken } from "../shared";
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
): Promise<GuestSessionPlatform | null> {
  if (await guestSessionPlatformColumnExistsInExecutor(executor)) {
    await executor.query(
      [
        "INSERT INTO auth.guest_sessions",
        "(session_id, session_secret_hash, user_id, platform)",
        "VALUES ($1, $2, $3, $4)",
      ].join(" "),
      [sessionId, hashGuestToken(guestToken), userId, platform],
    );
    return platform;
  }

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

export async function createGuestSessionInExecutor(
  executor: DatabaseExecutor,
  platform: GuestSessionPlatform | null,
): Promise<GuestSessionSnapshot> {
  // Guest session creation is intentionally always a fresh server-side
  // identity. Clients clear stored guest sessions and regenerate their local
  // installation identity on logout/account deletion before they can call
  // this again, which keeps future guest-to-linked merges scoped to the
  // current post-reset guest account only.
  const userId = randomUUID().toLowerCase();
  const guestToken = randomBytes(32).toString("hex");
  const sessionId = randomUUID().toLowerCase();

  await applyUserDatabaseScopeInExecutor(executor, { userId });
  const workspaceId = await createWorkspaceInExecutor(executor, userId, AUTO_CREATED_WORKSPACE_NAME);
  await executor.query(
    "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2",
    [workspaceId, userId],
  );
  const storedPlatform = await insertGuestSessionInExecutor(executor, sessionId, guestToken, userId, platform);

  return {
    guestToken,
    userId,
    workspaceId,
    platform: storedPlatform,
  };
}
