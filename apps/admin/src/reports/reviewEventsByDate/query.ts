import {
  runAdminQuery,
} from "../../adminApi";
import type {
  AdminQueryResultSet,
  AdminQueryValue,
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
  review_event_count: string | number;
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

function toReviewEventsByDateQueryRow(resultSetRow: Readonly<Record<string, AdminQueryValue>>): ReviewEventsByDateQueryRow {
  return {
    review_date: assertIsString(resultSetRow.review_date ?? null, "review_date"),
    user_id: assertIsString(resultSetRow.user_id ?? null, "user_id"),
    email: assertIsString(resultSetRow.email ?? null, "email"),
    review_event_count: toInteger(resultSetRow.review_event_count ?? null, "review_event_count"),
  };
}

function buildReviewEventsByDateUsers(rows: ReadonlyArray<ReviewEventsByDateRow>): ReadonlyArray<ReviewEventsByDateUser> {
  const totalsByUserId = new Map<string, ReviewEventsByDateUser>();

  for (const row of rows) {
    const existingEntry = totalsByUserId.get(row.userId);
    const nextTotal = (existingEntry?.totalReviewEvents ?? 0) + row.reviewEventCount;
    totalsByUserId.set(row.userId, {
      userId: row.userId,
      email: row.email,
      label: row.email === "(no email)" ? row.userId : row.email,
      totalReviewEvents: nextTotal,
    });
  }

  return Array.from(totalsByUserId.values()).sort((left, right) => {
    if (right.totalReviewEvents !== left.totalReviewEvents) {
      return right.totalReviewEvents - left.totalReviewEvents;
    }

    return left.label.localeCompare(right.label);
  });
}

function buildReviewEventsByDateTotals(
  rows: ReadonlyArray<ReviewEventsByDateRow>,
  from: string,
  to: string,
): ReadonlyArray<ReviewEventsByDateTotal> {
  const totalsByDate = new Map<string, number>();

  for (const row of rows) {
    totalsByDate.set(row.date, (totalsByDate.get(row.date) ?? 0) + row.reviewEventCount);
  }

  return buildRequestedDateRange(from, to).map((date) => ({
    date,
    totalReviewEvents: totalsByDate.get(date) ?? 0,
  }));
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
      reviewEventCount: toInteger(row.review_event_count, "review_event_count"),
    }))
    .sort((left, right) => {
      if (left.date !== right.date) {
        return left.date.localeCompare(right.date);
      }

      if (right.reviewEventCount !== left.reviewEventCount) {
        return right.reviewEventCount - left.reviewEventCount;
      }

      return left.userId.localeCompare(right.userId);
    });

  const dateTotals = buildReviewEventsByDateTotals(rows, from, to);
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
    rows,
  };
}

export function buildReviewEventsByDateSql(timezone: string, from: string, to: string): string {
  return [
    "SELECT",
    "  to_char(timezone(",
    `    ${escapeSqlStringLiteral(timezone)},`,
    "    review_events.reviewed_at_server",
    "  )::date, 'YYYY-MM-DD') AS review_date,",
    "  workspace_replicas.user_id,",
    "  COALESCE(NULLIF(btrim(user_settings.email), ''), '(no email)') AS email,",
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
    "GROUP BY",
    `  timezone(${escapeSqlStringLiteral(timezone)}, review_events.reviewed_at_server)::date,`,
    "  workspace_replicas.user_id,",
    "  COALESCE(NULLIF(btrim(user_settings.email), ''), '(no email)')",
    "ORDER BY",
    "  review_date ASC,",
    "  review_event_count DESC,",
    "  workspace_replicas.user_id ASC",
  ].join("\n");
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
