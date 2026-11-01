import { reviewEventPlatforms, runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange, AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import type { DailyActivitySource } from "../dailyNewReturning/query";
import { buildActorFirstUsePlatformCteSql, reviewActivitySource } from "../levelOneMetrics/meaningfulActivitySql";
import { assertValidDateRange, parseActivityCount, parseActivityDate, toInteger } from "../reportValues";
import { appOpenActivitySource, buildAppOpenFirstUsePlatformCteSql } from "../whoOpenedTheApp/appOpenActivitySql";

export const retentionCurveLastDay = 30;

/** Day N of the curve; `active` is null when nobody in the cohort has a complete day N yet. */
export type RetentionCurveDay = Readonly<{
  dayNumber: number;
  eligibleUsers: number;
  activeUsers: number | null;
}>;

/** The filters that pick the cohort by each person's first use; activity on day N counts whatever they say. */
export type RetentionCurveCohortFilters = Pick<AnalyticsFilterState, "eventPlatforms" | "connectionCountries" | "appUiLanguages">;

/** A daily activity source with the CTE naming the platform of each person's first use in a range. */
type RetentionCurveSource = Readonly<{
  activity: DailyActivitySource;
  firstUsePlatformCte: string;
  /** Composed after `activity.ctesSql`; defines `firstUsePlatformCte` as `actor_id, platform`. */
  buildFirstUsePlatformCteSql: (range: AnalyticsDateRange) => string;
}>;

const studiedRetentionCurveSource: RetentionCurveSource = {
  activity: reviewActivitySource,
  firstUsePlatformCte: "actor_first_use_platform",
  buildFirstUsePlatformCteSql: buildActorFirstUsePlatformCteSql,
};

const appOpenRetentionCurveSource: RetentionCurveSource = {
  activity: appOpenActivitySource,
  firstUsePlatformCte: "app_open_first_use_platform",
  buildFirstUsePlatformCteSql: buildAppOpenFirstUsePlatformCteSql,
};

export type RetentionCurveReport = Readonly<{
  generatedAtUtc: string;
  historyFrom: string | null;
  latestCompleteDate: string;
  cohortUsers: number;
  days: ReadonlyArray<RetentionCurveDay>;
}>;

// Classic bounded retention: the cohort is everyone whose day 0 is a covered, complete UTC day of the
// range; day N counts only members whose day N is complete (right-censored), and a member is active
// when the source holds an activity row on exactly that day. The cohort filters narrow only the
// cohort: the platform is that of the event that is the person's day 0, and the country and language
// keep a person as the funnel filters do over the same range.
function buildRetentionCurveSql(
  source: RetentionCurveSource,
  dateRange: AnalyticsDateRange,
  cohortFilters: RetentionCurveCohortFilters,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const { activity } = source;
  // The platform domain is closed, so every platform selected keeps everyone and skips the extra pass.
  const isPlatformNarrowed = cohortFilters.eventPlatforms.length !== reviewEventPlatforms.length;
  return `WITH ${activity.ctesSql}${isPlatformNarrowed ? `, ${source.buildFirstUsePlatformCteSql(range)}` : ""}, retention_clock AS (
  SELECT (now() AT TIME ZONE 'UTC')::date - 1 AS latest_complete_date
), retention_cohort AS MATERIALIZED (
  SELECT first_use.actor_id, first_use.first_use_date
  FROM ${activity.firstUseCte} AS first_use
  CROSS JOIN ${activity.coverageCte} AS coverage
  CROSS JOIN retention_clock AS clock${isPlatformNarrowed ? `
  JOIN ${source.firstUsePlatformCte} AS first_use_platform ON first_use_platform.actor_id = first_use.actor_id` : ""}
  WHERE first_use.first_use_date BETWEEN ${escapeSqlStringLiteral(range.from)}::date AND ${escapeSqlStringLiteral(range.to)}::date
    AND first_use.first_use_date >= coverage.history_from
    AND first_use.first_use_date <= clock.latest_complete_date${isPlatformNarrowed ? `
    AND ${buildEventPlatformsFilterSql("COALESCE(first_use_platform.platform, 'unattributed')", cohortFilters.eventPlatforms)}` : ""}
    AND ${buildConnectionCountriesFilterSql("first_use.actor_id", cohortFilters.connectionCountries, range)}
    AND ${buildAppUiLanguagesFilterSql("first_use.actor_id", cohortFilters.appUiLanguages, range)}
), retention_days AS (
  SELECT generate_series(0, ${retentionCurveLastDay}) AS day_number
), retention_counts AS (
  SELECT days.day_number,
    COUNT(cohort.actor_id) AS eligible_users,
    COUNT(activity.actor_id) AS active_users
  FROM retention_days AS days
  CROSS JOIN retention_clock AS clock
  LEFT JOIN retention_cohort AS cohort
    ON cohort.first_use_date + days.day_number <= clock.latest_complete_date
  LEFT JOIN ${activity.activityCte} AS activity
    ON activity.actor_id = cohort.actor_id
    AND activity.activity_date = cohort.first_use_date + days.day_number
  GROUP BY days.day_number
)
SELECT counts.day_number, counts.eligible_users, counts.active_users,
  (SELECT COUNT(*) FROM retention_cohort) AS cohort_users,
  to_char(coverage.history_from, 'YYYY-MM-DD') AS history_from,
  to_char(clock.latest_complete_date, 'YYYY-MM-DD') AS latest_complete_date
FROM retention_counts AS counts
CROSS JOIN ${activity.coverageCte} AS coverage
CROSS JOIN retention_clock AS clock
ORDER BY counts.day_number`;
}

/** Day 0 is the first-ever answered review, any rating; active on day N means an answered review that day. */
export function buildStudiedRetentionCurveSql(
  dateRange: AnalyticsDateRange,
  cohortFilters: RetentionCurveCohortFilters,
  reportLabel: string,
): string {
  return buildRetentionCurveSql(studiedRetentionCurveSource, dateRange, cohortFilters, reportLabel);
}

/** Day 0 is the first `app_opened`; active on day N means an `app_opened` that day. */
export function buildAppOpenRetentionCurveSql(
  dateRange: AnalyticsDateRange,
  cohortFilters: RetentionCurveCohortFilters,
  reportLabel: string,
): string {
  return buildRetentionCurveSql(appOpenRetentionCurveSource, dateRange, cohortFilters, reportLabel);
}

export async function loadRetentionCurveReport(
  config: AdminAppConfig,
  sql: string,
  reportLabel: string,
  signal: AbortSignal,
): Promise<RetentionCurveReport> {
  const response = await runAdminQuery(config, sql, signal);
  const result = response.resultSets[0];
  const firstRow = result?.rows[0];
  if (response.resultSets.length !== 1 || result === undefined || firstRow === undefined || result.rows.length !== retentionCurveLastDay + 1) {
    throw new Error(`${reportLabel} must return one result set with one row per day 0 to ${retentionCurveLastDay}, got ${result?.rows.length ?? 0} rows in ${response.resultSets.length} result sets.`);
  }
  const cohortUsers = parseActivityCount(firstRow.cohort_users ?? null, reportLabel, "cohort_users");
  if (cohortUsers === null) throw new Error(`${reportLabel} field "cohort_users" must not be null.`);
  const days = result.rows.map((row, index): RetentionCurveDay => {
    const dayNumber = toInteger(row.day_number ?? null, reportLabel, "day_number");
    const eligibleUsers = parseActivityCount(row.eligible_users ?? null, reportLabel, "eligible_users");
    const activeUsers = parseActivityCount(row.active_users ?? null, reportLabel, "active_users");
    if (dayNumber !== index) throw new Error(`${reportLabel} row ${index} is day ${dayNumber}; days must run 0 to ${retentionCurveLastDay} in order.`);
    if (eligibleUsers === null || activeUsers === null) throw new Error(`${reportLabel} day ${dayNumber} must report eligible and active users.`);
    if (activeUsers > eligibleUsers) throw new Error(`${reportLabel} day ${dayNumber} has ${activeUsers} active users but only ${eligibleUsers} eligible.`);
    return { dayNumber, eligibleUsers, activeUsers: eligibleUsers === 0 ? null : activeUsers };
  });
  days.forEach((day, index) => {
    const previous = days[index - 1];
    if (previous !== undefined && day.eligibleUsers > previous.eligibleUsers) {
      throw new Error(`${reportLabel} eligible users grow from ${previous.eligibleUsers} on day ${previous.dayNumber} to ${day.eligibleUsers} on day ${day.dayNumber}.`);
    }
  });
  const dayZero = days[0];
  if (dayZero === undefined || dayZero.eligibleUsers !== cohortUsers || (cohortUsers > 0 && dayZero.activeUsers !== cohortUsers)) {
    throw new Error(`${reportLabel} day 0 must have every one of the ${cohortUsers} cohort users eligible and active.`);
  }
  return {
    generatedAtUtc: response.executedAtUtc,
    historyFrom: firstRow.history_from === null ? null : parseActivityDate(firstRow.history_from ?? null, reportLabel, "history_from"),
    latestCompleteDate: parseActivityDate(firstRow.latest_complete_date ?? null, reportLabel, "latest_complete_date"),
    cohortUsers,
    days,
  };
}
