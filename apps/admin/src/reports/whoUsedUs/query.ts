import { runAdminQuery, type AdminQueryValue } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import { buildMeaningfulActivityCtesSql } from "../levelOneMetrics/meaningfulActivitySql";
import { assertIsString, assertValidDateRange, parseCalendarDate, toInteger } from "../reportValues";

const reportLabel = "Who used us report";

export type WhoUsedUsDay = Readonly<{
  date: string;
  newUsers: number | null;
  returningUsers: number | null;
}>;

export type WhoUsedUsReport = Readonly<{
  generatedAtUtc: string;
  historyFrom: string | null;
  latestCompleteDate: string;
  days: ReadonlyArray<WhoUsedUsDay>;
}>;

export function parseActivityDate(value: AdminQueryValue, label: string, field: string): string {
  const date = assertIsString(value, label, field);
  parseCalendarDate(date, label);
  return date;
}

export function parseActivityCount(value: AdminQueryValue, label: string, field: string): number | null {
  if (value === null) return null;
  const count = toInteger(value, label, field);
  if (count < 0 || !Number.isSafeInteger(count)) {
    throw new Error(`${label} field "${field}" must be a non-negative safe integer.`);
  }
  return count;
}

export function buildWhoUsedUsSql(dateRange: AnalyticsDateRange): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  return `WITH ${buildMeaningfulActivityCtesSql()}, days AS (
  SELECT day::date AS report_date
  FROM generate_series(${escapeSqlStringLiteral(range.from)}::timestamp,
    ${escapeSqlStringLiteral(range.to)}::timestamp, INTERVAL '1 day') AS day
), rolling_users AS (
  SELECT days.report_date,
    COUNT(DISTINCT activity.actor_id) FILTER (WHERE first_use.first_use_date >= days.report_date - 6) AS new_users,
    COUNT(DISTINCT activity.actor_id) FILTER (WHERE first_use.first_use_date < days.report_date - 6) AS returning_users
  FROM days
  LEFT JOIN meaningful_activity AS activity
    ON activity.activity_date BETWEEN days.report_date - 6 AND days.report_date
  LEFT JOIN actor_first_use AS first_use USING (actor_id)
  GROUP BY days.report_date
)
SELECT to_char(rolling_users.report_date, 'YYYY-MM-DD') AS report_date,
  to_char(coverage.history_from, 'YYYY-MM-DD') AS history_from,
  to_char(clock.latest_complete_date, 'YYYY-MM-DD') AS latest_complete_date,
  CASE WHEN rolling_users.report_date - 6 >= coverage.history_from
    AND rolling_users.report_date <= clock.latest_complete_date THEN rolling_users.new_users END AS new_users,
  CASE WHEN rolling_users.report_date - 6 >= coverage.history_from
    AND rolling_users.report_date <= clock.latest_complete_date THEN rolling_users.returning_users END AS returning_users
FROM rolling_users
CROSS JOIN activity_coverage AS coverage
CROSS JOIN activity_clock AS clock
ORDER BY rolling_users.report_date`;
}

export async function loadWhoUsedUsReport(config: AdminAppConfig, dateRange: AnalyticsDateRange): Promise<WhoUsedUsReport> {
  const response = await runAdminQuery(config, buildWhoUsedUsSql(dateRange));
  const result = response.resultSets[0];
  const firstRow = result?.rows[0];
  if (response.resultSets.length !== 1 || result === undefined || firstRow === undefined) {
    throw new Error(`${reportLabel} must return one result set with at least one day.`);
  }
  return {
    generatedAtUtc: response.executedAtUtc,
    historyFrom: firstRow.history_from === null ? null : parseActivityDate(firstRow.history_from ?? null, reportLabel, "history_from"),
    latestCompleteDate: parseActivityDate(firstRow.latest_complete_date ?? null, reportLabel, "latest_complete_date"),
    days: result.rows.map((row) => {
      const newUsers = parseActivityCount(row.new_users ?? null, reportLabel, "new_users");
      const returningUsers = parseActivityCount(row.returning_users ?? null, reportLabel, "returning_users");
      if ((newUsers === null) !== (returningUsers === null)) {
        throw new Error(`${reportLabel} must report both rolling buckets together.`);
      }
      return { date: parseActivityDate(row.report_date ?? null, reportLabel, "report_date"), newUsers, returningUsers };
    }),
  };
}
