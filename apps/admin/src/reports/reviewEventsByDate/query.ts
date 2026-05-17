import {
  reviewEventCohorts,
  reviewEventPlatforms,
  runAdminQuery,
} from "../../adminApi";
import type {
  AdminQueryResultSet,
  AdminQueryValue,
  ReviewEventCohort,
  ReviewEventPlatform,
  ReviewEventsByDatePlatformActiveUserTotal,
  ReviewEventsByDatePlatformReviewEventTotal,
  ReviewEventsByDateReport,
  ReviewEventsByDateRow,
  ReviewEventsByDateTotal,
  ReviewEventsByDateUniqueUserCohort,
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
  user_first_review_date: string;
}>;

export type ReviewEventsByDateRange = Readonly<{
  from: string;
  to: string;
}>;

export type ReviewEventsByDateFilterState = Readonly<{
  selectedUserIds: ReadonlyArray<string>;
  selectedCohorts: ReadonlyArray<ReviewEventCohort>;
  selectedPlatforms: ReadonlyArray<ReviewEventPlatform>;
}>;

type ReviewEventsByDateDefaultRangeQueryRow = Readonly<{
  from_date: string;
  to_date: string;
}>;

type ReviewEventsByDateAggregateFields = Readonly<Pick<
  ReviewEventsByDateReport,
  | "totalReviewEvents"
  | "users"
  | "dateTotals"
  | "dailyUniqueUserCohorts"
  | "platformActiveUserTotals"
  | "platformReviewEventTotals"
>>;

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
    user_first_review_date: assertIsString(resultSetRow.user_first_review_date ?? null, "user_first_review_date"),
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

function buildDailyUniqueUserCohorts(
  rows: ReadonlyArray<ReviewEventsByDateRow>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<ReviewEventsByDateUniqueUserCohort> {
  const newUsersByDate = new Map<string, Set<string>>();
  const returningUsersByDate = new Map<string, Set<string>>();

  for (const row of rows) {
    const isNew = row.firstReviewDate === row.date;
    const usersByDate = isNew ? newUsersByDate : returningUsersByDate;
    const users = usersByDate.get(row.date) ?? new Set<string>();
    users.add(row.userId);
    usersByDate.set(row.date, users);
  }

  return dates.map((date) => ({
    date,
    newReviewingUsers: newUsersByDate.get(date)?.size ?? 0,
    returningReviewingUsers: returningUsersByDate.get(date)?.size ?? 0,
  }));
}

function buildReviewEventsByDateAggregateFields(
  rows: ReadonlyArray<ReviewEventsByDateRow>,
  dates: ReadonlyArray<string>,
): ReviewEventsByDateAggregateFields {
  return {
    totalReviewEvents: rows.reduce((sum, row) => sum + row.reviewEventCount, 0),
    users: buildReviewEventsByDateUsers(rows),
    dateTotals: buildReviewEventsByDateTotals(rows, dates),
    dailyUniqueUserCohorts: buildDailyUniqueUserCohorts(rows, dates),
    platformActiveUserTotals: buildPlatformActiveUserTotals(rows, dates),
    platformReviewEventTotals: buildPlatformReviewEventTotals(rows, dates),
  };
}

function buildReviewEventsByDateReport(
  resultSet: AdminQueryResultSet,
  executedAtUtc: string,
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
      firstReviewDate: row.user_first_review_date,
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
  const aggregateFields = buildReviewEventsByDateAggregateFields(rows, dates);

  return {
    generatedAtUtc: executedAtUtc,
    from,
    to,
    ...aggregateFields,
    rows,
  };
}

function getReviewEventsByDateRowCohort(row: ReviewEventsByDateRow): ReviewEventCohort {
  return row.firstReviewDate === row.date ? "new" : "returning";
}

function isUnfilteredReviewEventsByDateReport(filters: ReviewEventsByDateFilterState): boolean {
  return filters.selectedUserIds.length === 0
    && filters.selectedCohorts.length === reviewEventCohorts.length
    && filters.selectedPlatforms.length === reviewEventPlatforms.length;
}

function shouldIncludeReviewEventsByDateRow(
  row: ReviewEventsByDateRow,
  selectedUserIdSet: ReadonlySet<string>,
  selectedCohortSet: ReadonlySet<ReviewEventCohort>,
  selectedPlatformSet: ReadonlySet<ReviewEventPlatform>,
): boolean {
  if (selectedUserIdSet.size > 0 && selectedUserIdSet.has(row.userId) === false) {
    return false;
  }

  if (selectedCohortSet.has(getReviewEventsByDateRowCohort(row)) === false) {
    return false;
  }

  return selectedPlatformSet.has(row.platform);
}

export function filterReviewEventsByDateReport(
  report: ReviewEventsByDateReport,
  filters: ReviewEventsByDateFilterState,
): ReviewEventsByDateReport {
  if (isUnfilteredReviewEventsByDateReport(filters)) {
    return report;
  }

  const selectedUserIdSet = new Set(filters.selectedUserIds);
  const selectedCohortSet = new Set(filters.selectedCohorts);
  const selectedPlatformSet = new Set(filters.selectedPlatforms);
  const rows = report.rows.filter((row) => shouldIncludeReviewEventsByDateRow(
    row,
    selectedUserIdSet,
    selectedCohortSet,
    selectedPlatformSet,
  ));
  const dates = buildRequestedDateRange(report.from, report.to);
  const aggregateFields = buildReviewEventsByDateAggregateFields(rows, dates);

  return {
    ...report,
    rows,
    ...aggregateFields,
  };
}

export function buildReviewEventsByDateDefaultRangeSql(): string {
  return [
    "SELECT",
    "  COALESCE(",
    "    to_char(MIN((review_events.reviewed_at_server AT TIME ZONE 'UTC')::date), 'YYYY-MM-DD'),",
    "    to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')",
    "  ) AS from_date,",
    "  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS to_date",
    "FROM content.review_events AS review_events",
  ].join("\n");
}

// Per-user breakdown for the admin "Review events by date" report (chart + table).
// The user-identity filters here (the `actor_kind` / `platform` allowlist and the
// `@example.com` email exclusion) are the same rules encoded in
// `clientInstallationActivityWhereSqlFragments` and `exampleComEmailExclusionSqlFragments`
// in `apps/backend/src/globalMetrics/reporting.ts`, which back the public
// `/v1/global/snapshot` endpoint and the scheduled snapshot Lambda. The
// `user_first_review_date` CTE below mirrors the equivalent CTE in the public snapshot
// days SQL so that the new/returning cohort split shown in the admin dashboard matches
// the `newReviewingUsers` / `returningReviewingUsers` series exposed in the snapshot.
// This admin query lives in a separate package, so the rules are intentionally restated
// here. If any rule changes, update both files.
export function buildReviewEventsByDateSql(from: string, to: string): string {
  assertValidDateRange({ from, to }, "report");

  return [
    "WITH user_first_review_date AS (",
    "  SELECT",
    "    workspace_replicas.user_id,",
    "    MIN((review_events.reviewed_at_server AT TIME ZONE 'UTC')::date) AS first_review_date",
    "  FROM content.review_events AS review_events",
    "  INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "    ON workspace_replicas.replica_id = review_events.replica_id",
    "  LEFT JOIN org.user_settings AS user_settings",
    "    ON user_settings.user_id = workspace_replicas.user_id",
    "  WHERE review_events.reviewed_at_server < (",
    `    (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "    AND workspace_replicas.actor_kind = 'client_installation'",
    "    AND workspace_replicas.platform IN ('web', 'android', 'ios')",
    "    AND (",
    "      user_settings.email IS NULL",
    "      OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'",
    "    )",
    "  GROUP BY workspace_replicas.user_id",
    ")",
    "SELECT",
    "  to_char((review_events.reviewed_at_server AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS review_date,",
    "  workspace_replicas.user_id,",
    "  COALESCE(NULLIF(btrim(user_settings.email), ''), '(no email)') AS email,",
    "  workspace_replicas.platform,",
    "  COUNT(*)::int AS review_event_count,",
    "  to_char(user_first_review_date.first_review_date, 'YYYY-MM-DD') AS user_first_review_date",
    "FROM content.review_events AS review_events",
    "INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "  ON workspace_replicas.replica_id = review_events.replica_id",
    "LEFT JOIN org.user_settings AS user_settings",
    "  ON user_settings.user_id = workspace_replicas.user_id",
    "INNER JOIN user_first_review_date",
    "  ON user_first_review_date.user_id = workspace_replicas.user_id",
    "WHERE review_events.reviewed_at_server >= (",
    `  ${escapeSqlStringLiteral(from)}::date::timestamp AT TIME ZONE 'UTC'`,
    ")",
    "  AND review_events.reviewed_at_server < (",
    `    (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "  AND workspace_replicas.actor_kind = 'client_installation'",
    "  AND workspace_replicas.platform IN ('web', 'android', 'ios')",
    "  AND (",
    "    user_settings.email IS NULL",
    "    OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'",
    "  )",
    "GROUP BY",
    "  (review_events.reviewed_at_server AT TIME ZONE 'UTC')::date,",
    "  workspace_replicas.user_id,",
    "  COALESCE(NULLIF(btrim(user_settings.email), ''), '(no email)'),",
    "  workspace_replicas.platform,",
    "  user_first_review_date.first_review_date",
    "ORDER BY",
    "  review_date ASC,",
    "  review_event_count DESC,",
    "  workspace_replicas.user_id ASC,",
    "  workspace_replicas.platform ASC",
  ].join("\n");
}

export async function loadReviewEventsByDateDefaultRange(
  config: AdminAppConfig,
): Promise<ReviewEventsByDateRange> {
  const response = await runAdminQuery(config, buildReviewEventsByDateDefaultRangeSql());
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
  from: string,
  to: string,
): Promise<ReviewEventsByDateReport> {
  const response = await runAdminQuery(config, buildReviewEventsByDateSql(from, to));
  if (response.resultSets.length !== 1) {
    throw new Error("Review events report must return exactly one result set.");
  }

  const resultSet = response.resultSets[0];
  if (resultSet === undefined) {
    throw new Error("Review events report result set is missing.");
  }

  return buildReviewEventsByDateReport(resultSet, response.executedAtUtc, from, to);
}
