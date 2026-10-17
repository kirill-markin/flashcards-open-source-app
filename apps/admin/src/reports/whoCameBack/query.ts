import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import { buildMeaningfulActivityCtesSql } from "../levelOneMetrics/meaningfulActivitySql";
import { assertValidDateRange, parseActivityCount, parseActivityDate } from "../reportValues";

const reportLabel = "Who came back report";

export type RetentionCounts = Readonly<{ returned: number; base: number }>;
export type WhoCameBackWeek = Readonly<{
  week: string;
  selectedFrom: string;
  selectedTo: string;
  cohortUsers: number | null;
  w1: RetentionCounts | null;
  w4: RetentionCounts | null;
}>;
export type WhoCameBackReport = Readonly<{
  generatedAtUtc: string;
  historyFrom: string | null;
  latestCompleteDate: string;
  weeks: ReadonlyArray<WhoCameBackWeek>;
}>;

export function buildWhoCameBackSql(dateRange: AnalyticsDateRange): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const fromSql = `${escapeSqlStringLiteral(range.from)}::date`;
  const toSql = `${escapeSqlStringLiteral(range.to)}::date`;
  return `WITH ${buildMeaningfulActivityCtesSql()}, weeks AS (
  SELECT week::date AS cohort_week
  FROM generate_series(date_trunc('week', ${fromSql}::timestamp),
    date_trunc('week', ${toSql}::timestamp), INTERVAL '7 days') AS week
), cohort_members AS MATERIALIZED (
  SELECT actor_id, first_use_date, date_trunc('week', first_use_date::timestamp)::date AS cohort_week
  FROM actor_first_use
  WHERE first_use_date BETWEEN ${fromSql} AND ${toSql}
    AND first_use_date <= (SELECT latest_complete_date FROM activity_clock)
), member_returns AS (
  SELECT members.actor_id, members.cohort_week,
    COALESCE(bool_or(activity.activity_date BETWEEN members.first_use_date + 7 AND members.first_use_date + 13), false) AS w1_returned,
    COALESCE(bool_or(activity.activity_date BETWEEN members.first_use_date + 28 AND members.first_use_date + 34), false) AS w4_returned
  FROM cohort_members AS members
  LEFT JOIN meaningful_activity AS activity
    ON activity.actor_id = members.actor_id
    AND activity.activity_date BETWEEN members.first_use_date + 7 AND members.first_use_date + 34
  GROUP BY members.actor_id, members.cohort_week
), cohort_counts AS (
  SELECT weeks.cohort_week, COUNT(returns.actor_id) AS cohort_users,
    COUNT(returns.actor_id) FILTER (WHERE returns.w1_returned) AS w1_returned,
    COUNT(returns.actor_id) FILTER (WHERE returns.w4_returned) AS w4_returned
  FROM weeks
  LEFT JOIN member_returns AS returns USING (cohort_week)
  GROUP BY weeks.cohort_week
)
SELECT to_char(counts.cohort_week, 'YYYY-MM-DD') AS cohort_week,
  to_char(GREATEST(counts.cohort_week, ${fromSql}), 'YYYY-MM-DD') AS selected_from,
  to_char(LEAST(counts.cohort_week + 6, ${toSql}), 'YYYY-MM-DD') AS selected_to,
  to_char(coverage.history_from, 'YYYY-MM-DD') AS history_from,
  to_char(clock.latest_complete_date, 'YYYY-MM-DD') AS latest_complete_date,
  CASE WHEN GREATEST(counts.cohort_week, ${fromSql}) >= coverage.history_from
    AND GREATEST(counts.cohort_week, ${fromSql}) <= clock.latest_complete_date
    THEN counts.cohort_users END AS cohort_users,
  CASE WHEN counts.cohort_week >= coverage.history_from AND counts.cohort_week + 19 <= clock.latest_complete_date
    AND counts.cohort_users > 0 THEN counts.w1_returned END AS w1_returned,
  CASE WHEN counts.cohort_week >= coverage.history_from AND counts.cohort_week + 40 <= clock.latest_complete_date
    AND counts.cohort_users > 0 THEN counts.w4_returned END AS w4_returned
FROM cohort_counts AS counts
CROSS JOIN activity_coverage AS coverage
CROSS JOIN activity_clock AS clock
ORDER BY counts.cohort_week`;
}

export async function loadWhoCameBackReport(config: AdminAppConfig, dateRange: AnalyticsDateRange): Promise<WhoCameBackReport> {
  const response = await runAdminQuery(config, buildWhoCameBackSql(dateRange));
  const result = response.resultSets[0];
  const firstRow = result?.rows[0];
  if (response.resultSets.length !== 1 || result === undefined || firstRow === undefined) {
    throw new Error(`${reportLabel} must return one result set with at least one cohort week.`);
  }
  return {
    generatedAtUtc: response.executedAtUtc,
    historyFrom: firstRow.history_from === null ? null : parseActivityDate(firstRow.history_from ?? null, reportLabel, "history_from"),
    latestCompleteDate: parseActivityDate(firstRow.latest_complete_date ?? null, reportLabel, "latest_complete_date"),
    weeks: result.rows.map((row) => {
      const base = parseActivityCount(row.cohort_users ?? null, reportLabel, "cohort_users");
      const w1Returned = parseActivityCount(row.w1_returned ?? null, reportLabel, "w1_returned");
      const w4Returned = parseActivityCount(row.w4_returned ?? null, reportLabel, "w4_returned");
      if ((w1Returned !== null && (base === null || base === 0 || w1Returned > base))
        || (w4Returned !== null && (base === null || base === 0 || w4Returned > base))) {
        throw new Error(`${reportLabel} returned users cannot exceed the cohort size.`);
      }
      return {
        week: parseActivityDate(row.cohort_week ?? null, reportLabel, "cohort_week"),
        selectedFrom: parseActivityDate(row.selected_from ?? null, reportLabel, "selected_from"),
        selectedTo: parseActivityDate(row.selected_to ?? null, reportLabel, "selected_to"),
        cohortUsers: base,
        w1: w1Returned === null || base === null ? null : { returned: w1Returned, base },
        w4: w4Returned === null || base === null ? null : { returned: w4Returned, base },
      };
    }),
  };
}
