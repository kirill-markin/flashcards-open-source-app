import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { assertIsString, assertValidDateRange } from "../reportValues";
import { buildWhoSawUsAvailableRangeSql } from "../whoSawUs/query";
import { buildWhoPaidUsAvailableRangeSql } from "../whoPaidUs/query";
import { buildAppOpenActivityCtesSql } from "../whoOpenedTheApp/appOpenActivitySql";
import { buildMeaningfulActivityCtesSql } from "./meaningfulActivitySql";

export function buildLevelOneMetricsAvailableRangeSql(): string {
  return `WITH ${buildMeaningfulActivityCtesSql()}, ${buildAppOpenActivityCtesSql()}, sight_range AS (
${buildWhoSawUsAvailableRangeSql()}
), payment_range AS (
${buildWhoPaidUsAvailableRangeSql()}
)
SELECT to_char(LEAST(sight_range.from_date::date, app_open_coverage.history_from, activity_coverage.history_from,
    payment_range.history_from), 'YYYY-MM-DD') AS from_date,
  sight_range.to_date
FROM sight_range
CROSS JOIN app_open_coverage
CROSS JOIN activity_coverage
CROSS JOIN payment_range`;
}

export async function loadLevelOneMetricsAvailableRange(config: AdminAppConfig, signal: AbortSignal): Promise<AnalyticsDateRange> {
  const label = "Level 1 metrics available range";
  const response = await runAdminQuery(config, buildLevelOneMetricsAvailableRangeSql(), signal);
  const result = response.resultSets[0];
  const row = result?.rows[0];
  if (response.resultSets.length !== 1 || result === undefined || result.rows.length !== 1 || row === undefined) {
    throw new Error(`${label} must return exactly one result set with one row.`);
  }
  return assertValidDateRange({
    from: assertIsString(row.from_date ?? null, label, "from_date"),
    to: assertIsString(row.to_date ?? null, label, "to_date"),
  }, label);
}
