import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import { assertValidDateRange, parseActivityCount, parseActivityDate } from "../reportValues";

/**
 * The CTEs one daily chart counts, by name. `activityCte` holds one `(actor_id, activity_date)` row
 * per resolved person and UTC day after the shared exclusions, `firstUseCte` each person's
 * `first_use_date` over all retained history, and `coverageCte` one `history_from` row: the
 * source's first retained day, before which no day is measured.
 */
export type DailyActivitySource = Readonly<{
  ctesSql: string;
  activityCte: string;
  firstUseCte: string;
  coverageCte: string;
}>;

export type DailyNewReturningDay = Readonly<{
  date: string;
  newUsers: number | null;
  returningUsers: number | null;
}>;

export type DailyNewReturningReport = Readonly<{
  generatedAtUtc: string;
  historyFrom: string | null;
  today: string;
  days: ReadonlyArray<DailyNewReturningDay>;
}>;

// New on the person's first-ever activity day, returning on every later one, so each person active
// on a day is in exactly one bucket.
export function buildDailyNewReturningSql(
  source: DailyActivitySource,
  dateRange: AnalyticsDateRange,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  return `WITH ${source.ctesSql}, days AS (
  SELECT day::date AS report_date
  FROM generate_series(${escapeSqlStringLiteral(range.from)}::timestamp,
    ${escapeSqlStringLiteral(range.to)}::timestamp, INTERVAL '1 day') AS day
), daily_users AS (
  SELECT days.report_date,
    COUNT(DISTINCT activity.actor_id) FILTER (WHERE first_use.first_use_date = days.report_date) AS new_users,
    COUNT(DISTINCT activity.actor_id) FILTER (WHERE first_use.first_use_date < days.report_date) AS returning_users
  FROM days
  LEFT JOIN ${source.activityCte} AS activity ON activity.activity_date = days.report_date
  LEFT JOIN ${source.firstUseCte} AS first_use USING (actor_id)
  GROUP BY days.report_date
)
SELECT to_char(daily_users.report_date, 'YYYY-MM-DD') AS report_date,
  to_char(coverage.history_from, 'YYYY-MM-DD') AS history_from,
  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,
  CASE WHEN daily_users.report_date >= coverage.history_from THEN daily_users.new_users END AS new_users,
  CASE WHEN daily_users.report_date >= coverage.history_from THEN daily_users.returning_users END AS returning_users
FROM daily_users
CROSS JOIN ${source.coverageCte} AS coverage
ORDER BY daily_users.report_date`;
}

export async function loadDailyNewReturningReport(
  config: AdminAppConfig,
  source: DailyActivitySource,
  dateRange: AnalyticsDateRange,
  reportLabel: string,
): Promise<DailyNewReturningReport> {
  const response = await runAdminQuery(config, buildDailyNewReturningSql(source, dateRange, reportLabel));
  const result = response.resultSets[0];
  const firstRow = result?.rows[0];
  if (response.resultSets.length !== 1 || result === undefined || firstRow === undefined) {
    throw new Error(`${reportLabel} must return one result set with at least one day.`);
  }
  return {
    generatedAtUtc: response.executedAtUtc,
    historyFrom: firstRow.history_from === null ? null : parseActivityDate(firstRow.history_from ?? null, reportLabel, "history_from"),
    today: parseActivityDate(firstRow.today ?? null, reportLabel, "today"),
    days: result.rows.map((row) => {
      const newUsers = parseActivityCount(row.new_users ?? null, reportLabel, "new_users");
      const returningUsers = parseActivityCount(row.returning_users ?? null, reportLabel, "returning_users");
      if ((newUsers === null) !== (returningUsers === null)) {
        throw new Error(`${reportLabel} must report both daily buckets together.`);
      }
      return { date: parseActivityDate(row.report_date ?? null, reportLabel, "report_date"), newUsers, returningUsers };
    }),
  };
}
