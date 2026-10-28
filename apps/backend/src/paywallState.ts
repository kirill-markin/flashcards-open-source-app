import {
  applyUserDatabaseScopeInExecutor,
  queryWithUserScopeReadOnly,
  transactionWithUserScope,
  type DatabaseExecutor,
} from "./database";
import { formatDateAsTimeZoneLocalDate, validateIanaTimeZone } from "./progress/timeZone";
import { expectNonEmptyString, expectUuidString } from "./server/requestParsing";
import { HttpError } from "./shared/errors";

/** Shared GET/POST response. Instants are UTC ISO8601 with milliseconds; dates are YYYY-MM-DD.
 * The intro fields are all null or one coherent earliest appearance, and follow-up is earliest
 * day3 appearance. lastShownAt is the latest appearance from every entry point; periodicShownAt is
 * the latest weekly appearance, the cooldown clock of the periodic review paywall. */
export type PaywallState = Readonly<{
  introShownAt: string | null;
  introLocalDate: string | null;
  introTimeZone: string | null;
  followUpShownAt: string | null;
  lastShownAt: string | null;
  periodicShownAt: string | null;
}>;

export type PaywallShownInput = Readonly<{
  presentationId: string;
  shownAt: string;
  localDate: string;
  timeZone: string;
  // day3 is the paywall-second prompt and weekly is paywall-periodic in
  // apps/backend/src/reviewPrompts/reviewPromptConfig.ts; released apps still send these names.
  reviewTrigger: "initial" | "day3" | "weekly" | null;
}>;

type PaywallStateRow = Readonly<{
  paywall_intro_shown_at: Date | string | null;
  paywall_intro_local_date: string | null;
  paywall_intro_time_zone: string | null;
  paywall_follow_up_shown_at: Date | string | null;
  paywall_last_shown_at: Date | string | null;
  paywall_periodic_shown_at: Date | string | null;
}>;

const paywallStateColumns = [
  "paywall_intro_shown_at",
  "paywall_intro_local_date::TEXT",
  "paywall_intro_time_zone",
  "paywall_follow_up_shown_at",
  "paywall_last_shown_at",
  "paywall_periodic_shown_at",
].join(", ");

function normalizeInstant(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapPaywallState(row: PaywallStateRow | undefined): PaywallState {
  if (row === undefined) {
    throw new Error("Cannot load paywall state: the user settings row is missing.");
  }
  return {
    introShownAt: normalizeInstant(row.paywall_intro_shown_at),
    introLocalDate: row.paywall_intro_local_date,
    introTimeZone: row.paywall_intro_time_zone,
    followUpShownAt: normalizeInstant(row.paywall_follow_up_shown_at),
    lastShownAt: normalizeInstant(row.paywall_last_shown_at),
    periodicShownAt: normalizeInstant(row.paywall_periodic_shown_at),
  };
}

export function parsePaywallShownInput(body: Record<string, unknown>): PaywallShownInput {
  const presentationId = expectUuidString(body.presentationId, "presentationId");
  const shownAt = expectNonEmptyString(body.shownAt, "shownAt");
  const instantPattern = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  const instant = new Date(shownAt);
  const calendarDate = shownAt.slice(0, 10);
  const calendarInstant = new Date(`${calendarDate}T00:00:00.000Z`);
  if (!instantPattern.test(shownAt) || !Number.isFinite(instant.getTime())
      || instant.getUTCFullYear() < 1 || instant.getUTCFullYear() > 9999
      || calendarDate.startsWith("0000")
      || !Number.isFinite(calendarInstant.getTime())
      || calendarInstant.toISOString().slice(0, 10) !== calendarDate) {
    throw new HttpError(400, "shownAt must be a valid RFC3339 instant", "PAYWALL_SHOWN_AT_INVALID");
  }
  const localDate = expectNonEmptyString(body.localDate, "localDate");
  const timeZoneInput = expectNonEmptyString(body.timeZone, "timeZone");
  const timeZone = validateIanaTimeZone(timeZoneInput);
  if (!timeZone.ok || /^[+-]/.test(timeZoneInput)) {
    throw new HttpError(400, "timeZone must be a valid IANA timezone", "PAYWALL_TIME_ZONE_INVALID");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)
      || formatDateAsTimeZoneLocalDate(instant, timeZone.canonicalTimeZone) !== localDate) {
    throw new HttpError(400, "localDate must be the YYYY-MM-DD date of shownAt in timeZone", "PAYWALL_LOCAL_DATE_INVALID");
  }
  const reviewTrigger = body.reviewTrigger;
  if (reviewTrigger !== null && reviewTrigger !== "initial"
      && reviewTrigger !== "day3" && reviewTrigger !== "weekly") {
    throw new HttpError(400, "reviewTrigger must be null, initial, day3, or weekly", "PAYWALL_REVIEW_TRIGGER_INVALID");
  }
  return {
    presentationId,
    shownAt: instant.toISOString(),
    localDate,
    timeZone: timeZone.canonicalTimeZone,
    reviewTrigger,
  };
}

export async function loadPaywallState(userId: string): Promise<PaywallState> {
  const result = await queryWithUserScopeReadOnly<PaywallStateRow>(
    { userId },
    `SELECT ${paywallStateColumns} FROM org.user_settings WHERE user_id = $1`,
    [userId],
  );
  return mapPaywallState(result.rows[0]);
}

async function foldPaywallStateInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  incoming: PaywallState,
): Promise<PaywallState> {
  // Keep the date and timezone from the earliest introduction together. Equal instants use a
  // deterministic tuple order so retries and identity folds converge regardless of arrival order.
  const incomingIntroWins = [
    "$2::TIMESTAMPTZ IS NOT NULL AND (paywall_intro_shown_at IS NULL OR",
    "ROW($2::TIMESTAMPTZ, $3::DATE, $4::TEXT COLLATE \"C\") <",
    "ROW(paywall_intro_shown_at, paywall_intro_local_date, paywall_intro_time_zone COLLATE \"C\"))",
  ].join(" ");
  const result = await executor.query<PaywallStateRow>(
    [
      "UPDATE org.user_settings SET",
      `paywall_intro_shown_at = CASE WHEN ${incomingIntroWins} THEN $2::TIMESTAMPTZ ELSE paywall_intro_shown_at END,`,
      `paywall_intro_local_date = CASE WHEN ${incomingIntroWins} THEN $3::DATE ELSE paywall_intro_local_date END,`,
      `paywall_intro_time_zone = CASE WHEN ${incomingIntroWins} THEN $4::TEXT ELSE paywall_intro_time_zone END,`,
      "paywall_follow_up_shown_at = LEAST(paywall_follow_up_shown_at, $5::TIMESTAMPTZ),",
      "paywall_last_shown_at = GREATEST(paywall_last_shown_at, $6::TIMESTAMPTZ),",
      "paywall_periodic_shown_at = GREATEST(paywall_periodic_shown_at, $7::TIMESTAMPTZ)",
      "WHERE user_id = $1",
      `RETURNING ${paywallStateColumns}`,
    ].join(" "),
    [userId, incoming.introShownAt, incoming.introLocalDate, incoming.introTimeZone,
      incoming.followUpShownAt, incoming.lastShownAt, incoming.periodicShownAt],
  );
  return mapPaywallState(result.rows[0]);
}

/** Submit only an actual appearance. Exact retries are idempotent without a presentation ledger;
 * presentationId identifies the client presentation but does not reserve or consume a stage.
 * Client review counts may still be offline, so this write never rechecks review eligibility. */
export async function recordPaywallShown(userId: string, input: PaywallShownInput): Promise<PaywallState> {
  return transactionWithUserScope({ userId }, async (executor) => foldPaywallStateInExecutor(
    executor,
    userId,
    {
      introShownAt: input.reviewTrigger === "initial" ? input.shownAt : null,
      introLocalDate: input.reviewTrigger === "initial" ? input.localDate : null,
      introTimeZone: input.reviewTrigger === "initial" ? input.timeZone : null,
      followUpShownAt: input.reviewTrigger === "day3" ? input.shownAt : null,
      lastShownAt: input.shownAt,
      periodicShownAt: input.reviewTrigger === "weekly" ? input.shownAt : null,
    },
  ));
}

export async function transferPaywallStateToUpgradedAccountInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  targetUserId: string,
): Promise<void> {
  await applyUserDatabaseScopeInExecutor(executor, { userId: guestUserId });
  const source = await executor.query<PaywallStateRow>(
    `SELECT ${paywallStateColumns} FROM org.user_settings WHERE user_id = $1`,
    [guestUserId],
  );
  const state = mapPaywallState(source.rows[0]);
  await applyUserDatabaseScopeInExecutor(executor, { userId: targetUserId });
  await foldPaywallStateInExecutor(executor, targetUserId, state);
}
