import { createHash } from "node:crypto";
import { query, transaction, type DatabaseExecutor } from "../db.js";

export const MAX_OTP_VERIFY_ATTEMPTS = 5;

type OtpVerifyAttemptRow = Readonly<{
  challenge_key_hash: string;
  email: string;
  failed_attempt_count: number;
  locked_at: Date | string | null;
  expires_at: Date | string;
  created_at: Date | string;
  last_failed_at: Date | string | null;
}>;

export type OtpVerifyAttemptState =
  | Readonly<{ status: "expired_or_missing" }>
  | Readonly<{
    status: "active";
    failedAttemptCount: number;
    expiresAt: string;
  }>
  | Readonly<{
    status: "locked";
    failedAttemptCount: number;
    expiresAt: string;
    lockedAt: string;
  }>;

export type OtpVerifyFailureRecordResult = Readonly<{
  failedAttemptCount: number;
  locked: boolean;
}>;

type OtpVerifyAttemptSnapshot = Readonly<{
  failedAttemptCount: number;
  lockedAt: string | null;
  expiresAt: string;
}>;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function createChallengeKey(email: string, cognitoSession: string): string {
  return `${email}\u0000${cognitoSession}`;
}

export function hashOtpChallengeKey(email: string, cognitoSession: string): string {
  return createHash("sha256")
    .update(createChallengeKey(email, cognitoSession))
    .digest("hex");
}

export function deriveOtpVerifyAttemptState(
  snapshot: OtpVerifyAttemptSnapshot | null,
  nowMs: number,
): OtpVerifyAttemptState {
  if (snapshot === null) {
    return { status: "expired_or_missing" };
  }

  const expiresAtMs = new Date(snapshot.expiresAt).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs) {
    return { status: "expired_or_missing" };
  }

  if (snapshot.lockedAt !== null) {
    return {
      status: "locked",
      failedAttemptCount: snapshot.failedAttemptCount,
      expiresAt: snapshot.expiresAt,
      lockedAt: snapshot.lockedAt,
    };
  }

  return {
    status: "active",
    failedAttemptCount: snapshot.failedAttemptCount,
    expiresAt: snapshot.expiresAt,
  };
}

export function deriveOtpVerifyFailureResult(
  previousFailedAttemptCount: number,
  alreadyLocked: boolean,
  maxAttempts: number,
): OtpVerifyFailureRecordResult {
  const failedAttemptCount = previousFailedAttemptCount + 1;
  return {
    failedAttemptCount,
    locked: alreadyLocked || failedAttemptCount >= maxAttempts,
  };
}

async function loadAttemptRow(
  executor: DatabaseExecutor,
  email: string,
  cognitoSession: string,
): Promise<OtpVerifyAttemptRow | null> {
  const result = await executor.query<OtpVerifyAttemptRow>(
    [
      "SELECT challenge_key_hash, email, failed_attempt_count, locked_at, expires_at, created_at, last_failed_at",
      "FROM auth.otp_verify_attempts",
      "WHERE challenge_key_hash = $1",
      "LIMIT 1",
    ].join(" "),
    [hashOtpChallengeKey(email, cognitoSession)],
  );

  return result.rows[0] ?? null;
}

export async function getOtpVerifyAttemptState(
  email: string,
  cognitoSession: string,
  nowMs: number,
): Promise<OtpVerifyAttemptState> {
  const row = await loadAttemptRow(
    {
      query: (text, params) => query(text, params),
    },
    email,
    cognitoSession,
  );

  return deriveOtpVerifyAttemptState(
    row === null
      ? null
      : {
        failedAttemptCount: row.failed_attempt_count,
        lockedAt: row.locked_at === null ? null : toIsoString(row.locked_at),
        expiresAt: toIsoString(row.expires_at),
      },
    nowMs,
  );
}

export async function recordOtpVerifyFailure(
  email: string,
  cognitoSession: string,
  expiresAt: string,
  nowMs: number,
  maxAttempts: number,
): Promise<OtpVerifyFailureRecordResult> {
  const challengeKeyHash = hashOtpChallengeKey(email, cognitoSession);
  const now = new Date(nowMs);

  return transaction(async (executor) => {
    const existing = await executor.query<OtpVerifyAttemptRow>(
      [
        "SELECT challenge_key_hash, email, failed_attempt_count, locked_at, expires_at, created_at, last_failed_at",
        "FROM auth.otp_verify_attempts",
        "WHERE challenge_key_hash = $1",
        "FOR UPDATE",
      ].join(" "),
      [challengeKeyHash],
    );

    const row = existing.rows[0];
    if (row === undefined) {
      const result = deriveOtpVerifyFailureResult(0, false, maxAttempts);
      await executor.query(
        [
          "INSERT INTO auth.otp_verify_attempts",
          "(",
          "challenge_key_hash, email, failed_attempt_count, locked_at, expires_at, last_failed_at",
          ")",
          "VALUES ($1, $2, $3, $4, $5, $6)",
        ].join(" "),
        [challengeKeyHash, email, result.failedAttemptCount, result.locked ? now : null, new Date(expiresAt), now],
      );

      return result;
    }

    const result = deriveOtpVerifyFailureResult(row.failed_attempt_count, row.locked_at !== null, maxAttempts);
    await executor.query(
      [
        "UPDATE auth.otp_verify_attempts",
        "SET failed_attempt_count = $2,",
        "locked_at = CASE WHEN locked_at IS NOT NULL THEN locked_at WHEN $3 THEN $4 ELSE NULL END,",
        "expires_at = $5,",
        "last_failed_at = $4",
        "WHERE challenge_key_hash = $1",
      ].join(" "),
      [challengeKeyHash, result.failedAttemptCount, result.locked, now, new Date(expiresAt)],
    );

    return result;
  });
}
