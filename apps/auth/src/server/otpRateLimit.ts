import { randomUUID } from "node:crypto";
import { query } from "../db.js";

const EMAIL_COOLDOWN_WINDOW_MS = 60_000;
const EMAIL_SHORT_WINDOW_MS = 15 * 60_000;
const EMAIL_DAY_WINDOW_MS = 24 * 60 * 60_000;
const IP_SHORT_WINDOW_MS = 15 * 60_000;
const IP_HOUR_WINDOW_MS = 60 * 60_000;
const IP_DAY_WINDOW_MS = 24 * 60 * 60_000;
const EMAIL_COOLDOWN_LIMIT = 3;
const EMAIL_SHORT_LIMIT = 5;
const EMAIL_DAY_LIMIT = 10;
const IP_SHORT_LIMIT = 10;
const IP_HOUR_LIMIT = 30;
const IP_DAY_LIMIT = 100;
const IP_DISTINCT_HOUR_LIMIT = 5;
const IP_DISTINCT_DAY_LIMIT = 20;
const OTP_SESSION_TTL_MS = 180_000;
const QUOTA_DECISIONS: ReadonlyArray<"sent" | "suppressed_email_limit" | "blocked_ip_limit"> = ["sent"];

type CountRow = Readonly<{
  count: string;
}>;

type DistinctEmailCountRow = Readonly<{
  count: string;
}>;

type TokenRow = Readonly<{
  otp_session_token: string | null;
  created_at: Date | string;
}>;

export type OtpRateLimitDecision =
  | Readonly<{ kind: "send" }>
  | Readonly<{ kind: "suppress_email_limit" }>
  | Readonly<{ kind: "block_ip_limit" }>;

type OtpRateLimitCounts = Readonly<{
  emailCooldownCount: number;
  emailShortCount: number;
  emailDayCount: number;
  ipShortCount: number;
  ipHourCount: number;
  ipDayCount: number;
  ipDistinctHourCount: number;
  ipDistinctDayCount: number;
}>;

function asCount(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }

  return Number.parseInt(value, 10);
}

async function countEvents(
  filterColumn: "email" | "ip_address",
  filterValue: string,
  decisions: ReadonlyArray<"sent" | "suppressed_email_limit" | "blocked_ip_limit">,
  windowMs: number,
): Promise<number> {
  const result = await query<CountRow>(
    [
      "SELECT COUNT(*)::text AS count",
      "FROM auth.otp_send_events",
      "WHERE",
      `${filterColumn} = $1`,
      "AND decision = ANY($2)",
      "AND created_at >= $3",
    ].join(" "),
    [filterValue, decisions as unknown as string[], new Date(Date.now() - windowMs)],
  );

  return asCount(result.rows[0]?.count);
}

async function countDistinctEmailsForIp(ipAddress: string, windowMs: number): Promise<number> {
  const result = await query<DistinctEmailCountRow>(
    [
      "SELECT COUNT(DISTINCT email)::text AS count",
      "FROM auth.otp_send_events",
      "WHERE ip_address = $1",
      "AND created_at >= $2",
      "AND decision = ANY($3)",
    ].join(" "),
    [ipAddress, new Date(Date.now() - windowMs), QUOTA_DECISIONS],
  );

  return asCount(result.rows[0]?.count);
}

export function decideOtpRateLimitFromCounts(counts: OtpRateLimitCounts): OtpRateLimitDecision {
  if (
    counts.ipShortCount >= IP_SHORT_LIMIT
    || counts.ipHourCount >= IP_HOUR_LIMIT
    || counts.ipDayCount >= IP_DAY_LIMIT
    || counts.ipDistinctHourCount >= IP_DISTINCT_HOUR_LIMIT
    || counts.ipDistinctDayCount >= IP_DISTINCT_DAY_LIMIT
  ) {
    return { kind: "block_ip_limit" };
  }

  if (
    counts.emailCooldownCount >= EMAIL_COOLDOWN_LIMIT
    || counts.emailShortCount >= EMAIL_SHORT_LIMIT
    || counts.emailDayCount >= EMAIL_DAY_LIMIT
  ) {
    return { kind: "suppress_email_limit" };
  }

  return { kind: "send" };
}

/**
 * Applies conservative anti-spam limits before sending OTP emails. Email
 * throttles suppress sends while IP-based abuse returns a hard block across
 * browser and agent flows.
 */
export async function decideOtpRateLimit(
  email: string,
  ipAddress: string,
): Promise<OtpRateLimitDecision> {
  const [
    emailCooldownCount,
    emailShortCount,
    emailDayCount,
    ipShortCount,
    ipHourCount,
    ipDayCount,
    ipDistinctHourCount,
    ipDistinctDayCount,
  ] = await Promise.all([
    countEvents("email", email, QUOTA_DECISIONS, EMAIL_COOLDOWN_WINDOW_MS),
    countEvents("email", email, QUOTA_DECISIONS, EMAIL_SHORT_WINDOW_MS),
    countEvents("email", email, QUOTA_DECISIONS, EMAIL_DAY_WINDOW_MS),
    countEvents("ip_address", ipAddress, QUOTA_DECISIONS, IP_SHORT_WINDOW_MS),
    countEvents("ip_address", ipAddress, QUOTA_DECISIONS, IP_HOUR_WINDOW_MS),
    countEvents("ip_address", ipAddress, QUOTA_DECISIONS, IP_DAY_WINDOW_MS),
    countDistinctEmailsForIp(ipAddress, IP_HOUR_WINDOW_MS),
    countDistinctEmailsForIp(ipAddress, IP_DAY_WINDOW_MS),
  ]);

  return decideOtpRateLimitFromCounts({
    emailCooldownCount,
    emailShortCount,
    emailDayCount,
    ipShortCount,
    ipHourCount,
    ipDayCount,
    ipDistinctHourCount,
    ipDistinctDayCount,
  });
}

export async function recordOtpSendDecision(
  email: string,
  ipAddress: string,
  decision: "sent" | "suppressed_email_limit" | "blocked_ip_limit",
  otpSessionToken: string | null,
): Promise<void> {
  await query(
    [
      "INSERT INTO auth.otp_send_events",
      "(event_id, email, ip_address, otp_session_token, decision)",
      "VALUES ($1, $2, $3, $4, $5)",
    ].join(" "),
    [randomUUID(), email, ipAddress, otpSessionToken, decision],
  );
}

/**
 * Returns the newest still-valid signed OTP session token so browser retries
 * can continue the last challenge without sending another email.
 */
export async function loadLatestSentOtpSessionToken(email: string, nowMs: number): Promise<string | null> {
  const result = await query<TokenRow>(
    [
      "SELECT otp_session_token, created_at",
      "FROM auth.otp_send_events",
      "WHERE email = $1 AND decision = 'sent' AND otp_session_token IS NOT NULL",
      "ORDER BY created_at DESC, event_id DESC",
      "LIMIT 1",
    ].join(" "),
    [email],
  );

  const row = result.rows[0];
  if (row === undefined || row.otp_session_token === null) {
    return null;
  }

  const createdAtMs = new Date(row.created_at).getTime();
  if (Number.isNaN(createdAtMs) || nowMs - createdAtMs > OTP_SESSION_TTL_MS) {
    return null;
  }

  return row.otp_session_token;
}
