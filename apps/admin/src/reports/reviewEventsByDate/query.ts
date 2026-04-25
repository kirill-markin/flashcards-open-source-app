import {
  reviewEventPlatforms,
  runAdminQuery,
} from "../../adminApi";
import type {
  AdminQueryResultSet,
  AdminQueryValue,
  ReviewEventPlatform,
  ReviewEventsByDatePlatformActiveUserTotal,
  ReviewEventsByDatePlatformReviewEventTotal,
  ReviewEventsByDateReport,
  ReviewEventsByDateRow,
  ReviewEventsByDateTotal,
  ReviewEventsByDateUser,
} from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { escapeSqlStringLiteral } from "../../sql";

type ReviewEventsByDateQueryRow = Readonly<{
  review_date: string;
  user_id: string;
  email: string;
  platform: ReviewEventPlatform;
  review_event_count: string | number;
}>;

export type ReviewEventsByDateRange = Readonly<{
  from: string;
  to: string;
}>;

type ReviewEventsByDateDefaultRangeQueryRow = Readonly<{
  from_date: string;
  to_date: string;
}>;

function parseCalendarDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (match === null) {
    throw new Error(`Review events report date must use YYYY-MM-DD: ${date}`);
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const parsedDate = new Date(Date.UTC(year, monthIndex, day));

  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== monthIndex
    || parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`Review events report date is invalid: ${date}`);
  }

  return parsedDate;
}

function formatCalendarDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildRequestedDateRange(from: string, to: string): ReadonlyArray<string> {
  const startDate = parseCalendarDate(from);
  const endDate = parseCalendarDate(to);
  if (startDate.getTime() > endDate.getTime()) {
    throw new Error(`Review events report date range is invalid: ${from} > ${to}`);
  }

  const dates: Array<string> = [];
  const currentDate = new Date(startDate);
  while (currentDate.getTime() <= endDate.getTime()) {
    dates.push(formatCalendarDate(currentDate));
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return dates;
}

function assertIsString(value: AdminQueryValue, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Review events report field "${fieldName}" must be a string.`);
  }

  return value;
}

function toInteger(value: AdminQueryValue, fieldName: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/u.test(value)) {
    return Number.parseInt(value, 10);
  }

  throw new Error(`Review events report field "${fieldName}" must be an integer.`);
}

function assertPlatform(value: AdminQueryValue, fieldName: string): ReviewEventPlatform {
  const platform = assertIsString(value, fieldName);
  if (reviewEventPlatforms.includes(platform as ReviewEventPlatform) === false) {
    throw new Error(`Review events report field "${fieldName}" must be a supported platform.`);
  }

  return platform as ReviewEventPlatform;
}

function toReviewEventsByDateQueryRow(resultSetRow: Readonly<Record<string, AdminQueryValue>>): ReviewEventsByDateQueryRow {
  return {
    review_date: assertIsString(resultSetRow.review_date ?? null, "review_date"),
    user_id: assertIsString(resultSetRow.user_id ?? null, "user_id"),
    email: assertIsString(resultSetRow.email ?? null, "email"),
    platform: assertPlatform(resultSetRow.platform ?? null, "platform"),
    review_event_count: toInteger(resultSetRow.review_event_count ?? null, "review_event_count"),
  };
}

function toReviewEventsByDateDefaultRangeQueryRow(
  resultSetRow: Readonly<Record<string, AdminQueryValue>>,
): ReviewEventsByDateDefaultRangeQueryRow {
  return {
    from_date: assertIsString(resultSetRow.from_date ?? null, "from_date"),
    to_date: assertIsString(resultSetRow.to_date ?? null, "to_date"),
  };
}

function assertValidDateRange(range: ReviewEventsByDateRange, fieldName: string): ReviewEventsByDateRange {
  const fromDate = parseCalendarDate(range.from);
  const toDate = parseCalendarDate(range.to);
  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error(`Review events ${fieldName} date range is invalid: ${range.from} > ${range.to}`);
  }

  return range;
}

function buildReviewEventsByDateUsers(rows: ReadonlyArray<ReviewEventsByDateRow>): ReadonlyArray<ReviewEventsByDateUser> {
  const totalsByUserId = new Map<string, ReviewEventsByDateUser>();

  for (const row of rows) {
    const existingEntry = totalsByUserId.get(row.userId);
    totalsByUserId.set(row.userId, {
      userId: row.userId,
      email: existingEntry?.email ?? row.email,
      totalReviewEvents: (existingEntry?.totalReviewEvents ?? 0) + row.reviewEventCount,
    });
  }

  return Array.from(totalsByUserId.values()).sort((left, right) => {
    if (right.totalReviewEvents !== left.totalReviewEvents) {
      return right.totalReviewEvents - left.totalReviewEvents;
    }

    const leftLabel = left.email === "(no email)" ? left.userId : left.email;
    const rightLabel = right.email === "(no email)" ? right.userId : right.email;
    return leftLabel.localeCompare(rightLabel);
  });
}

function buildReviewEventsByDateTotals(
  rows: ReadonlyArray<ReviewEventsByDateRow>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<ReviewEventsByDateTotal> {
  const totalsByDate = new Map<string, number>();

  for (const row of rows) {
    totalsByDate.set(row.date, (totalsByDate.get(row.date) ?? 0) + row.reviewEventCount);
  }

  return dates.map((date) => ({
    date,
    totalReviewEvents: totalsByDate.get(date) ?? 0,
  }));
}

function buildPlatformActiveUserTotals(
  rows: ReadonlyArray<ReviewEventsByDateRow>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<ReviewEventsByDatePlatformActiveUserTotal> {
  const countsByDatePlatform = new Map<string, number>();

  for (const row of rows) {
    const key = `${row.date}:${row.platform}`;
    countsByDatePlatform.set(key, (countsByDatePlatform.get(key) ?? 0) + 1);
  }

  return dates.flatMap((date) => reviewEventPlatforms.map((platform) => ({
    date,
    platform,
    activeUserCount: countsByDatePlatform.get(`${date}:${platform}`) ?? 0,
  })));
}

function buildPlatformReviewEventTotals(
  rows: ReadonlyArray<ReviewEventsByDateRow>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<ReviewEventsByDatePlatformReviewEventTotal> {
  const countsByDatePlatform = new Map<string, number>();

  for (const row of rows) {
    const key = `${row.date}:${row.platform}`;
    countsByDatePlatform.set(key, (countsByDatePlatform.get(key) ?? 0) + row.reviewEventCount);
  }

  return dates.flatMap((date) => reviewEventPlatforms.map((platform) => ({
    date,
    platform,
    reviewEventCount: countsByDatePlatform.get(`${date}:${platform}`) ?? 0,
  })));
}

function buildReviewEventsByDateReport(
  resultSet: AdminQueryResultSet,
  executedAtUtc: string,
  timezone: string,
  from: string,
  to: string,
): ReviewEventsByDateReport {
  const rows = resultSet.rows
    .map(toReviewEventsByDateQueryRow)
    .map((row) => ({
      date: row.review_date,
      userId: row.user_id,
      email: row.email,
      platform: row.platform,
      reviewEventCount: toInteger(row.review_event_count, "review_event_count"),
    }))
    .sort((left, right) => {
      if (left.date !== right.date) {
        return left.date.localeCompare(right.date);
      }

      if (right.reviewEventCount !== left.reviewEventCount) {
        return right.reviewEventCount - left.reviewEventCount;
      }

      if (left.userId !== right.userId) {
        return left.userId.localeCompare(right.userId);
      }

      return left.platform.localeCompare(right.platform);
    });

  const dates = buildRequestedDateRange(from, to);
  const dateTotals = buildReviewEventsByDateTotals(rows, dates);
  const platformActiveUserTotals = buildPlatformActiveUserTotals(rows, dates);
  const platformReviewEventTotals = buildPlatformReviewEventTotals(rows, dates);
  const users = buildReviewEventsByDateUsers(rows);
  const totalReviewEvents = rows.reduce((sum, row) => sum + row.reviewEventCount, 0);

  return {
    generatedAtUtc: executedAtUtc,
    timezone,
    from,
    to,
    totalReviewEvents,
    users,
    dateTotals,
    platformActiveUserTotals,
    platformReviewEventTotals,
    rows,
  };
}

export function buildReviewEventsByDateDefaultRangeSql(timezone: string): string {
  const escapedTimezone = escapeSqlStringLiteral(timezone);

  return [
    "SELECT",
    "  COALESCE(",
    `    to_char(MIN(timezone(${escapedTimezone}, review_events.reviewed_at_server)::date), 'YYYY-MM-DD'),`,
    `    to_char(timezone(${escapedTimezone}, now())::date, 'YYYY-MM-DD')`,
    "  ) AS from_date,",
    `  to_char(timezone(${escapedTimezone}, now())::date, 'YYYY-MM-DD') AS to_date`,
    "FROM content.review_events AS review_events",
  ].join("\n");
}

export function buildReviewEventsByDateSql(timezone: string, from: string, to: string): string {
  assertValidDateRange({ from, to }, "report");

  return [
    "SELECT",
    "  to_char(timezone(",
    `    ${escapeSqlStringLiteral(timezone)},`,
    "    review_events.reviewed_at_server",
    "  )::date, 'YYYY-MM-DD') AS review_date,",
    "  workspace_replicas.user_id,",
    "  COALESCE(NULLIF(btrim(user_settings.email), ''), '(no email)') AS email,",
    "  workspace_replicas.platform,",
    "  COUNT(*)::int AS review_event_count",
    "FROM content.review_events AS review_events",
    "INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "  ON workspace_replicas.replica_id = review_events.replica_id",
    "LEFT JOIN org.user_settings AS user_settings",
    "  ON user_settings.user_id = workspace_replicas.user_id",
    "WHERE review_events.reviewed_at_server >= (",
    `  ${escapeSqlStringLiteral(from)}::date::timestamp AT TIME ZONE ${escapeSqlStringLiteral(timezone)}`,
    ")",
    "  AND review_events.reviewed_at_server < (",
    `    (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE ${escapeSqlStringLiteral(timezone)}`,
    "  )",
    "  AND workspace_replicas.actor_kind = 'client_installation'",
    "  AND workspace_replicas.platform IN ('web', 'android', 'ios')",
    "GROUP BY",
    `  timezone(${escapeSqlStringLiteral(timezone)}, review_events.reviewed_at_server)::date,`,
    "  workspace_replicas.user_id,",
    "  COALESCE(NULLIF(btrim(user_settings.email), ''), '(no email)'),",
    "  workspace_replicas.platform",
    "ORDER BY",
    "  review_date ASC,",
    "  review_event_count DESC,",
    "  workspace_replicas.user_id ASC,",
    "  workspace_replicas.platform ASC",
  ].join("\n");
}

export async function loadReviewEventsByDateDefaultRange(
  config: AdminAppConfig,
  timezone: string,
): Promise<ReviewEventsByDateRange> {
  const response = await runAdminQuery(config, buildReviewEventsByDateDefaultRangeSql(timezone));
  if (response.resultSets.length !== 1) {
    throw new Error("Review events default range query must return exactly one result set.");
  }

  const resultSet = response.resultSets[0];
  if (resultSet === undefined) {
    throw new Error("Review events default range query result set is missing.");
  }

  if (resultSet.rows.length !== 1) {
    throw new Error(`Review events default range query must return exactly one row. Got ${resultSet.rows.length}.`);
  }

  const row = resultSet.rows[0];
  if (row === undefined) {
    throw new Error("Review events default range query row is missing.");
  }

  const rangeRow = toReviewEventsByDateDefaultRangeQueryRow(row);
  return assertValidDateRange({
    from: rangeRow.from_date,
    to: rangeRow.to_date,
  }, "default");
}

export async function loadReviewEventsByDateReport(
  config: AdminAppConfig,
  timezone: string,
  from: string,
  to: string,
): Promise<ReviewEventsByDateReport> {
  const response = await runAdminQuery(config, buildReviewEventsByDateSql(timezone, from, to));
  if (response.resultSets.length !== 1) {
    throw new Error("Review events report must return exactly one result set.");
  }

  const resultSet = response.resultSets[0];
  if (resultSet === undefined) {
    throw new Error("Review events report result set is missing.");
  }

  return buildReviewEventsByDateReport(resultSet, response.executedAtUtc, timezone, from, to);
}
