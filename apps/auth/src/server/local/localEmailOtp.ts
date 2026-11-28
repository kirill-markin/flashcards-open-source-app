import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { query, transaction } from "../../db.js";
import { keyedDigestHex } from "../crypto.js";
import { log } from "../logger.js";
import {
  getLocalIdentityConfig,
  isEmailAllowedToRegister,
  localIdTokenTtlSeconds,
  localSessionAbsoluteTtlSeconds,
  localSessionIdleTtlSeconds,
} from "./localConfig.js";
import { signLocalIdToken } from "./localTokens.js";
import { sendLocalSignInCode } from "./smtpMailer.js";

/**
 * Email codes and sessions of AUTH_IDENTITY_PROVIDER=local, behind the same contract the routes use
 * for Cognito: initiate returns an opaque session, verify returns tokens. The rejection messages are
 * the ones the routes' Cognito failure classifiers already map to OTP_* codes.
 */
const otpTtlSeconds = 180;
const maxFailedAttempts = 5;
const purgeBatchSize = 200;
const opaqueTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export type LocalSessionTokens = Readonly<{ idToken: string; refreshToken: string; expiresIn: number }>;
export type LocalRefreshedTokens = Readonly<{ idToken: string; refreshToken: null; expiresIn: number }>;

export class LocalEmailOtpRejectedError extends Error {
  constructor(message: "Invalid session for the user" | "Session can only be used once" | "Session expired" | "Invalid code") {
    super(message);
    this.name = "LocalEmailOtpRejectedError";
  }
}

export class LocalRefreshRejectedError extends Error {
  constructor() {
    super("Local refresh token is unknown, revoked or expired");
    this.name = "LocalRefreshRejectedError";
  }
}

const sessionDigest = (session: string): string => keyedDigestHex("local-otp-session", session);
const codeDigest = (sessionHmac: string, code: string): string => keyedDigestHex("local-otp-code", `${sessionHmac}:${code}`);
const refreshTokenDigest = (refreshToken: string): string => createHash("sha256").update(refreshToken).digest("hex");

function sameHex(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/** Old challenges after a day and finished sessions after 30 days; bounded per call. */
async function purgeFinishedLocalRows(): Promise<void> {
  await query(
    `DELETE FROM auth.local_email_otp_challenges WHERE session_hmac IN (
       SELECT session_hmac FROM auth.local_email_otp_challenges
       WHERE expires_at < clock_timestamp() - INTERVAL '1 day' LIMIT $1)`,
    [purgeBatchSize],
  );
  await query(
    `DELETE FROM auth.local_sessions WHERE session_id IN (
       SELECT session_id FROM auth.local_sessions
       WHERE LEAST(idle_expires_at, absolute_expires_at, COALESCE(revoked_at, 'infinity'))
         < clock_timestamp() - INTERVAL '30 days' LIMIT $1)`,
    [purgeBatchSize],
  );
}

/**
 * Every address gets the same response and a stored challenge; only one that may sign in gets mail,
 * and that mail is not awaited, so neither timing nor status reveals the allowlist.
 */
export async function initiateLocalEmailOtp(email: string): Promise<Readonly<{ session: string }>> {
  const config = getLocalIdentityConfig();
  const existing = await query<Readonly<{ disabled: boolean }>>(
    "SELECT disabled_at IS NOT NULL AS disabled FROM auth.local_identities WHERE email = $1", [email],
  );
  const identity = existing.rows[0];
  const maySignIn = identity === undefined ? isEmailAllowedToRegister(config, email) : !identity.disabled;
  const session = randomBytes(32).toString("base64url");
  const sessionHmac = sessionDigest(session);
  const code = randomInt(0, 100_000_000).toString().padStart(8, "0");
  await query(
    `INSERT INTO auth.local_email_otp_challenges (session_hmac, email, code_hmac, may_sign_in, expires_at)
     VALUES ($1, $2, $3, $4, clock_timestamp() + make_interval(secs => $5))`,
    [sessionHmac, email, codeDigest(sessionHmac, code), maySignIn, otpTtlSeconds],
  );
  if (maySignIn) {
    void sendLocalSignInCode(email, code).catch((error: unknown) => {
      log({ domain: "auth", action: "send_code_error", reasonCategory: "local_smtp_delivery_failed", email,
        error: error instanceof Error ? error.message : String(error) });
    });
  } else {
    log({ domain: "auth", action: "send_code", reasonCategory: "local_identity_not_allowed", email });
  }
  await purgeFinishedLocalRows();
  return { session };
}

type VerifyOutcome =
  | Readonly<{ status: "verified"; subject: string; sessionId: string; refreshToken: string }>
  | Readonly<{ status: "rejected"; error: LocalEmailOtpRejectedError }>;

export async function verifyLocalEmailOtp(email: string, code: string, session: string): Promise<LocalSessionTokens> {
  if (!opaqueTokenPattern.test(session)) throw new LocalEmailOtpRejectedError("Invalid session for the user");
  const sessionHmac = sessionDigest(session);
  const authTime = Math.floor(Date.now() / 1_000);

  // A rejection returns instead of throwing, so its failed-attempt count commits.
  const outcome = await transaction<VerifyOutcome>(async (executor) => {
    const found = await executor.query<Readonly<{
      email: string; code_hmac: string; may_sign_in: boolean; failed_attempts: number; expired: boolean; consumed: boolean;
    }>>(
      `SELECT email, code_hmac, may_sign_in, failed_attempts, expires_at <= clock_timestamp() AS expired,
              consumed_at IS NOT NULL AS consumed
       FROM auth.local_email_otp_challenges WHERE session_hmac = $1 FOR UPDATE`,
      [sessionHmac],
    );
    const challenge = found.rows[0];
    if (challenge === undefined || challenge.email !== email) {
      return { status: "rejected", error: new LocalEmailOtpRejectedError("Invalid session for the user") };
    }
    if (challenge.consumed || challenge.failed_attempts >= maxFailedAttempts) {
      return { status: "rejected", error: new LocalEmailOtpRejectedError("Session can only be used once") };
    }
    if (challenge.expired) return { status: "rejected", error: new LocalEmailOtpRejectedError("Session expired") };
    if (!challenge.may_sign_in || !sameHex(challenge.code_hmac, codeDigest(sessionHmac, code))) {
      await executor.query(
        `UPDATE auth.local_email_otp_challenges SET failed_attempts = failed_attempts + 1,
           consumed_at = CASE WHEN failed_attempts + 1 >= $2 THEN clock_timestamp() ELSE NULL END
         WHERE session_hmac = $1`,
        [sessionHmac, maxFailedAttempts],
      );
      return { status: "rejected", error: new LocalEmailOtpRejectedError("Invalid code") };
    }

    await executor.query(
      "UPDATE auth.local_email_otp_challenges SET consumed_at = clock_timestamp() WHERE session_hmac = $1", [sessionHmac],
    );
    await executor.query(
      "INSERT INTO auth.local_identities (subject, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING", [randomUUID(), email],
    );
    const identities = await executor.query<Readonly<{ subject: string; disabled: boolean }>>(
      "SELECT subject, disabled_at IS NOT NULL AS disabled FROM auth.local_identities WHERE email = $1", [email],
    );
    const identity = identities.rows[0];
    if (identity === undefined) throw new Error("Local identity was not stored for a verified email code");
    if (identity.disabled) return { status: "rejected", error: new LocalEmailOtpRejectedError("Invalid code") };

    const sessionId = randomUUID();
    const refreshToken = randomBytes(32).toString("base64url");
    await executor.query(
      `INSERT INTO auth.local_sessions
         (session_id, subject, refresh_token_sha256, auth_time, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, clock_timestamp() + make_interval(secs => $5), clock_timestamp() + make_interval(secs => $6))`,
      [sessionId, identity.subject, refreshTokenDigest(refreshToken), authTime, localSessionIdleTtlSeconds, localSessionAbsoluteTtlSeconds],
    );
    return { status: "verified", subject: identity.subject, sessionId, refreshToken };
  });

  if (outcome.status === "rejected") throw outcome.error;
  log({ domain: "auth", action: "verify_code", email });
  return {
    idToken: signLocalIdToken({ subject: outcome.subject, email, sessionId: outcome.sessionId, authTime }, authTime),
    refreshToken: outcome.refreshToken,
    expiresIn: localIdTokenTtlSeconds,
  };
}

/** The refresh token does not rotate: a watch shares its phone's token, so the caller keeps it. */
export async function refreshLocalTokens(refreshToken: string): Promise<LocalRefreshedTokens> {
  if (!opaqueTokenPattern.test(refreshToken)) throw new LocalRefreshRejectedError();
  const result = await query<Readonly<{ session_id: string; subject: string; auth_time: string; email: string }>>(
    `UPDATE auth.local_sessions AS sessions
     SET last_used_at = clock_timestamp(),
         idle_expires_at = LEAST(sessions.absolute_expires_at, clock_timestamp() + make_interval(secs => $2))
     FROM auth.local_identities AS identities
     WHERE sessions.refresh_token_sha256 = $1 AND identities.subject = sessions.subject
       AND sessions.revoked_at IS NULL AND identities.disabled_at IS NULL
       AND sessions.idle_expires_at > clock_timestamp() AND sessions.absolute_expires_at > clock_timestamp()
     RETURNING sessions.session_id, sessions.subject, sessions.auth_time, identities.email`,
    [refreshTokenDigest(refreshToken), localSessionIdleTtlSeconds],
  );
  const session = result.rows[0];
  if (session === undefined) throw new LocalRefreshRejectedError();
  log({ domain: "auth", action: "refresh_token" });
  return {
    idToken: signLocalIdToken({
      subject: session.subject, email: session.email, sessionId: session.session_id, authTime: Number(session.auth_time),
    }, Math.floor(Date.now() / 1_000)),
    refreshToken: null,
    expiresIn: localIdTokenTtlSeconds,
  };
}

/** Ends the session, which also stops its unexpired ID tokens (`sid`). */
export async function revokeLocalToken(refreshToken: string): Promise<void> {
  await query(
    "UPDATE auth.local_sessions SET revoked_at = clock_timestamp() WHERE refresh_token_sha256 = $1 AND revoked_at IS NULL",
    [refreshTokenDigest(refreshToken)],
  );
  log({ domain: "auth", action: "revoke_token" });
}
