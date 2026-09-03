import { reviewEventCohorts, reviewEventPlatforms, runAdminQuery } from "../../adminApi";
import type {
  AdminQueryResultSet,
  AdminQueryValue,
  DailyActiveUsersCohortTotal,
  DailyActiveUsersPlatformTotal,
  DailyActiveUsersReport,
  DailyActiveUsersRow,
  DailyActiveUsersUser,
  ReviewEventCohort,
  ReviewEventPlatform,
} from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { escapeSqlStringLiteral } from "../../sql";
import {
  assertIsString,
  assertPlatform,
  assertValidDateRange,
  buildRequestedDateRange,
} from "../reportValues";

const reportLabel = "Daily active users report";

type DailyActiveUsersQueryRow = Readonly<{
  active_date: string;
  user_id: string;
  email: string;
  platform: ReviewEventPlatform;
  user_first_active_date: string;
}>;

export type DailyActiveUsersFilterState = Readonly<{
  selectedUserIds: ReadonlyArray<string>;
  selectedCohorts: ReadonlyArray<ReviewEventCohort>;
  selectedPlatforms: ReadonlyArray<ReviewEventPlatform>;
}>;

type DailyActiveUsersAggregateFields = Readonly<Pick<
  DailyActiveUsersReport,
  "users" | "dailyCohortTotals" | "platformActiveUserTotals"
>>;

function toDailyActiveUsersQueryRow(
  resultSetRow: Readonly<Record<string, AdminQueryValue>>,
): DailyActiveUsersQueryRow {
  return {
    active_date: assertIsString(resultSetRow.active_date ?? null, reportLabel, "active_date"),
    user_id: assertIsString(resultSetRow.user_id ?? null, reportLabel, "user_id"),
    email: assertIsString(resultSetRow.email ?? null, reportLabel, "email"),
    platform: assertPlatform(resultSetRow.platform ?? null, reportLabel, "platform"),
    user_first_active_date: assertIsString(
      resultSetRow.user_first_active_date ?? null,
      reportLabel,
      "user_first_active_date",
    ),
  };
}

/** Active days per person, counted once per calendar day however many platforms carried that day. */
function buildDailyActiveUsersUsers(
  rows: ReadonlyArray<DailyActiveUsersRow>,
): ReadonlyArray<DailyActiveUsersUser> {
  const emailByUserId = new Map<string, string>();
  const activeDatesByUserId = new Map<string, Set<string>>();

  for (const row of rows) {
    if (emailByUserId.has(row.userId) === false) {
      emailByUserId.set(row.userId, row.email);
    }

    const activeDates = activeDatesByUserId.get(row.userId) ?? new Set<string>();
    activeDates.add(row.date);
    activeDatesByUserId.set(row.userId, activeDates);
  }

  return Array.from(activeDatesByUserId.entries())
    .map(([userId, activeDates]) => ({
      userId,
      email: emailByUserId.get(userId) ?? "(no email)",
      activeDayCount: activeDates.size,
    }))
    .sort((left, right) => {
      if (right.activeDayCount !== left.activeDayCount) {
        return right.activeDayCount - left.activeDayCount;
      }

      const leftLabel = left.email === "(no email)" ? left.userId : left.email;
      const rightLabel = right.email === "(no email)" ? right.userId : right.email;
      return leftLabel.localeCompare(rightLabel);
    });
}

/**
 * Built from the loaded rows and then carried through filtering unchanged: the first active day is a
 * fact about the person rather than about the current filter selection, and another section reads it
 * to apply the same cohort split.
 */
function buildFirstActiveDateByUserId(
  rows: ReadonlyArray<DailyActiveUsersRow>,
): ReadonlyMap<string, string> {
  return new Map(rows.map((row) => [row.userId, row.firstActiveDate]));
}

// A person active on two platforms in one day is one active person, so every count here is over a
// set of actors and never over the rows the query returned.
function buildDailyCohortTotals(
  rows: ReadonlyArray<DailyActiveUsersRow>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<DailyActiveUsersCohortTotal> {
  const newUsersByDate = new Map<string, Set<string>>();
  const returningUsersByDate = new Map<string, Set<string>>();

  for (const row of rows) {
    const isNew = row.firstActiveDate === row.date;
    const usersByDate = isNew ? newUsersByDate : returningUsersByDate;
    const users = usersByDate.get(row.date) ?? new Set<string>();
    users.add(row.userId);
    usersByDate.set(row.date, users);
  }

  return dates.map((date) => ({
    date,
    newActiveUsers: newUsersByDate.get(date)?.size ?? 0,
    returningActiveUsers: returningUsersByDate.get(date)?.size ?? 0,
  }));
}

function buildPlatformActiveUserTotals(
  rows: ReadonlyArray<DailyActiveUsersRow>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<DailyActiveUsersPlatformTotal> {
  const usersByDatePlatform = new Map<string, Set<string>>();

  for (const row of rows) {
    const key = `${row.date}:${row.platform}`;
    const users = usersByDatePlatform.get(key) ?? new Set<string>();
    users.add(row.userId);
    usersByDatePlatform.set(key, users);
  }

  return dates.flatMap((date) => reviewEventPlatforms.map((platform) => ({
    date,
    platform,
    activeUserCount: usersByDatePlatform.get(`${date}:${platform}`)?.size ?? 0,
  })));
}

function buildDailyActiveUsersAggregateFields(
  rows: ReadonlyArray<DailyActiveUsersRow>,
  dates: ReadonlyArray<string>,
): DailyActiveUsersAggregateFields {
  return {
    users: buildDailyActiveUsersUsers(rows),
    dailyCohortTotals: buildDailyCohortTotals(rows, dates),
    platformActiveUserTotals: buildPlatformActiveUserTotals(rows, dates),
  };
}

function buildDailyActiveUsersReport(
  resultSet: AdminQueryResultSet,
  executedAtUtc: string,
  from: string,
  to: string,
): DailyActiveUsersReport {
  const rows = resultSet.rows
    .map(toDailyActiveUsersQueryRow)
    .map((row) => ({
      date: row.active_date,
      userId: row.user_id,
      email: row.email,
      platform: row.platform,
      firstActiveDate: row.user_first_active_date,
    }))
    .sort((left, right) => {
      if (left.date !== right.date) {
        return left.date.localeCompare(right.date);
      }

      if (left.userId !== right.userId) {
        return left.userId.localeCompare(right.userId);
      }

      return left.platform.localeCompare(right.platform);
    });
  const dates = buildRequestedDateRange(from, to, reportLabel);

  return {
    generatedAtUtc: executedAtUtc,
    from,
    to,
    firstActiveDateByUserId: buildFirstActiveDateByUserId(rows),
    ...buildDailyActiveUsersAggregateFields(rows, dates),
    rows,
  };
}

function getDailyActiveUsersRowCohort(row: DailyActiveUsersRow): ReviewEventCohort {
  return row.firstActiveDate === row.date ? "new" : "returning";
}

function isUnfilteredDailyActiveUsersReport(filters: DailyActiveUsersFilterState): boolean {
  return filters.selectedUserIds.length === 0
    && filters.selectedCohorts.length === reviewEventCohorts.length
    && filters.selectedPlatforms.length === reviewEventPlatforms.length;
}

function shouldIncludeDailyActiveUsersRow(
  row: DailyActiveUsersRow,
  selectedUserIdSet: ReadonlySet<string>,
  selectedCohortSet: ReadonlySet<ReviewEventCohort>,
  selectedPlatformSet: ReadonlySet<ReviewEventPlatform>,
): boolean {
  if (selectedUserIdSet.size > 0 && selectedUserIdSet.has(row.userId) === false) {
    return false;
  }

  if (selectedCohortSet.has(getDailyActiveUsersRowCohort(row)) === false) {
    return false;
  }

  return selectedPlatformSet.has(row.platform);
}

export function filterDailyActiveUsersReport(
  report: DailyActiveUsersReport,
  filters: DailyActiveUsersFilterState,
): DailyActiveUsersReport {
  if (isUnfilteredDailyActiveUsersReport(filters)) {
    return report;
  }

  const selectedUserIdSet = new Set(filters.selectedUserIds);
  const selectedCohortSet = new Set(filters.selectedCohorts);
  const selectedPlatformSet = new Set(filters.selectedPlatforms);
  const rows = report.rows.filter((row) => shouldIncludeDailyActiveUsersRow(
    row,
    selectedUserIdSet,
    selectedCohortSet,
    selectedPlatformSet,
  ));
  const dates = buildRequestedDateRange(report.from, report.to, reportLabel);

  return {
    ...report,
    rows,
    ...buildDailyActiveUsersAggregateFields(rows, dates),
  };
}

// Per-actor active days for the admin "Daily active users" section.
//
// WHY THIS EXISTS BESIDE THE REVIEW REPORT. The review charts count the people who answered a card,
// which on a sampled production day was 51% of the people who were actually in the app. This reads
// `app_opened` instead, so the section answers "how many people were here" rather than "how many
// people studied".
//
// The shape below deliberately mirrors `buildReviewEventsByDateSql`: one CTE bounded above by the
// range end so the cohort CTE can see all of history, the `org.user_settings` email join folded with
// `pg_catalog.lower` because `actor_id` renders canonical lowercase hex while `org.user_settings
// .user_id` is an unconstrained TEXT primary key, the `%@example.com` exclusion restated inline
// because this package cannot import `exampleComEmailExclusionSqlFragments` from
// `apps/backend/src/globalMetrics/reporting.ts`, and grouping by `actor_id` so a guest and the
// account that guest became are one person. Every note on that function about deleted accounts, the
// case fold and the identity rules applies here unchanged; only the event name and the meaning of a
// row differ.
//
// ONE ROW PER (DAY, ACTOR, PLATFORM), AND THE ROWS ARE NEVER SUMMED. A person can open the phone and
// the browser on the same day and is then two rows on that day. Every "unique users" number in this
// section is therefore a distinct count of actors, computed client-side over a set, and the platform
// series is grouped rather than stacked. See `db/migrations/0121_backfill_synthetic_app_opened_days
// .sql` for why the `agent` bucket in particular must stay its own visible series: an
// `agent_connection` replica is the machine API, and a scheduled MCP client files an active day for
// its owner on every calendar day it runs, so that series is an upper bound on human agent use.
//
// HISTORY BEFORE THE CLIENTS COULD REPORT IT IS RECONSTRUCTED by that same migration, at roughly 85%
// coverage of the people who really opened the app on a sampled day. Reconstructed and live rows are
// deliberately not distinguished here or anywhere in the UI.
export function buildDailyActiveUsersSql(from: string, to: string): string {
  assertValidDateRange({ from, to }, reportLabel);

  return [
    // Bounded above only: `actor_first_active_date` needs each actor's first active day over all of
    // history, and the range filter is applied once, below, against the same materialized rows. The
    // predicate is on the raw `occurred_at` column rather than on its UTC date so
    // `idx_product_events_event_name_occurred_at` stays usable as an (event_name, occurred_at) range
    // scan.
    "WITH app_opens AS (",
    "  SELECT",
    "    resolved.actor_id::text AS actor_id,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date AS active_date,",
    "    CASE",
    "      WHEN resolved.platform IN ('web', 'android', 'ios', 'agent') THEN resolved.platform",
    "      ELSE 'unattributed'",
    "    END AS platform,",
    "    COALESCE(NULLIF(btrim(user_settings.email), ''), '(no email)') AS email",
    "  FROM analytics.product_events_resolved AS resolved",
    "  LEFT JOIN org.user_settings AS user_settings",
    "    ON pg_catalog.lower(user_settings.user_id) = resolved.actor_id::text",
    "  WHERE resolved.event_name = 'app_opened'",
    "    AND resolved.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND (",
    "      user_settings.email IS NULL",
    "      OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'",
    "    )",
    "),",
    "actor_first_active_date AS (",
    "  SELECT",
    "    app_opens.actor_id,",
    "    MIN(app_opens.active_date) AS first_active_date",
    "  FROM app_opens",
    "  GROUP BY app_opens.actor_id",
    ")",
    "SELECT",
    "  to_char(app_opens.active_date, 'YYYY-MM-DD') AS active_date,",
    // Emitted under the name the SPA row shape already uses. The value is the resolved actor.
    "  app_opens.actor_id AS user_id,",
    "  app_opens.email,",
    "  app_opens.platform,",
    "  to_char(actor_first_active_date.first_active_date, 'YYYY-MM-DD') AS user_first_active_date",
    "FROM app_opens",
    "INNER JOIN actor_first_active_date",
    "  ON actor_first_active_date.actor_id = app_opens.actor_id",
    `WHERE app_opens.active_date >= ${escapeSqlStringLiteral(from)}::date`,
    `  AND app_opens.active_date <= ${escapeSqlStringLiteral(to)}::date`,
    "GROUP BY",
    "  app_opens.active_date,",
    "  app_opens.actor_id,",
    "  app_opens.email,",
    "  app_opens.platform,",
    "  actor_first_active_date.first_active_date",
    "ORDER BY",
    "  app_opens.active_date ASC,",
    "  app_opens.actor_id ASC,",
    "  app_opens.platform ASC",
  ].join("\n");
}

export async function loadDailyActiveUsersReport(
  config: AdminAppConfig,
  from: string,
  to: string,
): Promise<DailyActiveUsersReport> {
  const response = await runAdminQuery(config, buildDailyActiveUsersSql(from, to));
  if (response.resultSets.length !== 1) {
    throw new Error(`Daily active users report must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  const resultSet = response.resultSets[0];
  if (resultSet === undefined) {
    throw new Error("Daily active users report result set is missing.");
  }

  return buildDailyActiveUsersReport(resultSet, response.executedAtUtc, from, to);
}
