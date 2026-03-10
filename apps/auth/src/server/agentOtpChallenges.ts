import { query, transaction } from "../db.js";
import { createCrockfordToken, hashOpaqueToken, normalizeCrockfordToken } from "./crockford.js";

const AGENT_OTP_HANDLE_LENGTH = 20;
export const AGENT_OTP_HANDLE_TTL_MS = 180_000;

type AgentOtpChallengeRow = Readonly<{
  challenge_id_hash: string;
  email: string;
  cognito_session: string;
  created_at: Date | string;
  expires_at: Date | string;
  used_at: Date | string | null;
}>;

export type AgentOtpChallengeLookup =
  | Readonly<{ status: "active"; email: string; cognitoSession: string }>
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "expired"; email: string }>
  | Readonly<{ status: "used"; email: string }>;

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Persists a short opaque handle for a live Cognito OTP session. The client
 * sees the handle once, while the server keeps only the hash plus Cognito
 * state needed for RespondToAuthChallenge.
 */
export async function createAgentOtpChallenge(
  email: string,
  cognitoSession: string,
  nowMs: number,
): Promise<string> {
  const handle = createCrockfordToken(AGENT_OTP_HANDLE_LENGTH);
  const handleHash = hashOpaqueToken(handle);
  await query(
    [
      "INSERT INTO auth.agent_otp_challenges",
      "(challenge_id_hash, email, cognito_session, created_at, expires_at)",
      "VALUES ($1, $2, $3, $4, $5)",
    ].join(" "),
    [handleHash, email, cognitoSession, new Date(nowMs), new Date(nowMs + AGENT_OTP_HANDLE_TTL_MS)],
  );

  return handle;
}

/**
 * Creates a new opaque handle for the newest still-valid Cognito session when
 * resend throttling suppresses another email. The server never needs to
 * recover the original plaintext handle from storage.
 */
export async function reissueLatestAgentOtpChallenge(
  email: string,
  nowMs: number,
): Promise<string | null> {
  return transaction(async (executor) => {
    const result = await executor.query<AgentOtpChallengeRow>(
      [
        "SELECT challenge_id_hash, email, cognito_session, created_at, expires_at, used_at",
        "FROM auth.agent_otp_challenges",
        "WHERE email = $1",
        "AND used_at IS NULL",
        "AND expires_at > $2",
        "ORDER BY created_at DESC, challenge_id_hash DESC",
        "LIMIT 1",
      ].join(" "),
      [email, new Date(nowMs)],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }

    const handle = createCrockfordToken(AGENT_OTP_HANDLE_LENGTH);
    await executor.query(
      [
        "INSERT INTO auth.agent_otp_challenges",
        "(challenge_id_hash, email, cognito_session, created_at, expires_at)",
        "VALUES ($1, $2, $3, $4, $5)",
      ].join(" "),
      [hashOpaqueToken(handle), email, row.cognito_session, new Date(nowMs), row.expires_at],
    );

    return handle;
  });
}

/**
 * Loads the live state behind a short opaque OTP handle so routes can return a
 * clear restart message for invalid, expired, and already-used challenges.
 */
export async function lookupAgentOtpChallenge(
  otpSessionToken: string,
  nowMs: number,
): Promise<AgentOtpChallengeLookup> {
  let normalized: string;
  try {
    normalized = normalizeCrockfordToken(otpSessionToken, "otpSessionToken");
  } catch {
    return { status: "invalid" };
  }

  const result = await query<AgentOtpChallengeRow>(
    [
      "SELECT challenge_id_hash, email, cognito_session, created_at, expires_at, used_at",
      "FROM auth.agent_otp_challenges",
      "WHERE challenge_id_hash = $1",
      "LIMIT 1",
    ].join(" "),
    [hashOpaqueToken(normalized)],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return { status: "invalid" };
  }

  if (row.used_at !== null) {
    return { status: "used", email: row.email };
  }

  if (asDate(row.expires_at).getTime() <= nowMs) {
    return { status: "expired", email: row.email };
  }

  return {
    status: "active",
    email: row.email,
    cognitoSession: row.cognito_session,
  };
}

/**
 * Marks all active aliases of the same Cognito challenge as used once one OTP
 * verification succeeds.
 */
export async function markAgentOtpChallengeUsed(
  email: string,
  cognitoSession: string,
  nowMs: number,
): Promise<void> {
  await query(
    [
      "UPDATE auth.agent_otp_challenges",
      "SET used_at = $3",
      "WHERE email = $1",
      "AND cognito_session = $2",
      "AND used_at IS NULL",
    ].join(" "),
    [email, cognitoSession, new Date(nowMs)],
  );
}
