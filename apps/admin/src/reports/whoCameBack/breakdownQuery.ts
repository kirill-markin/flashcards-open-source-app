import * as d3 from "d3";
import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildActorConnectionCountrySql } from "../../filters/filterSql";
import { buildBreakdownValueSql, buildSeriesRankCtesSql, listSeriesValues } from "../levelOneMetrics/breakdownQuery";
import { buildActorFirstUsePlatformCteSql } from "../levelOneMetrics/meaningfulActivitySql";
import {
  buildReportBucketColumnsSql,
  parseReportBucket,
  type ReportBucket,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { assertIsString, assertValidDateRange, parseActivityCount, parseActivityDate, toInteger } from "../reportValues";
import { buildRetentionMatureSql, buildWhoCameBackMemberCtesSql, type RetentionWindow } from "./query";

export type WhoCameBackBreakdownDimension = "platform" | "country";

export type RetentionValueCounts = Readonly<{ cohortUsers: number; returned: number }>;

export type WhoCameBackBreakdownBucket = Readonly<{
  bucket: ReportBucket;
  /** Per value with anyone in the cohort; null while the window is unavailable for this cohort. */
  countsByWindow: Readonly<Record<RetentionWindow, ReadonlyMap<string, RetentionValueCounts> | null>>;
}>;

export type WhoCameBackBreakdownReport = Readonly<{
  generatedAtUtc: string;
  period: ReportPeriod;
  historyFrom: string | null;
  latestCompleteDate: string;
  /** Every value in rank order, Other last. */
  values: ReadonlyArray<string>;
  buckets: ReadonlyArray<WhoCameBackBreakdownBucket>;
}>;

type BreakdownRow = Readonly<{
  bucket: ReportBucket;
  mature: Readonly<Record<RetentionWindow, boolean>>;
  /** Null on a cohort with nobody in it. */
  series: Readonly<{
    value: string;
    rank: number;
    cohortUsers: number;
    returned: Readonly<Record<RetentionWindow, number>>;
  }> | null;
}>;

/**
 * The extra CTEs and the join that place each `member_returns AS returns` row under one value, NULL or
 * empty when unknown. Country is the one `buildActorConnectionCountrySql` places the person in over
 * the whole range, as the Who opened the app country breakdown reads it.
 */
function buildDimensionSql(
  dimension: WhoCameBackBreakdownDimension,
  range: AnalyticsDateRange,
): Readonly<{ ctesSql: string; valueSql: string; joinSql: string }> {
  switch (dimension) {
    case "platform":
      return {
        ctesSql: `, ${buildActorFirstUsePlatformCteSql(range)}`,
        valueSql: "first_use_platform.platform",
        joinSql: "LEFT JOIN actor_first_use_platform AS first_use_platform ON first_use_platform.actor_id = returns.actor_id",
      };
    case "country":
      // Materialized: joined as an inline subquery, the lookup runs past the statement timeout.
      return {
        ctesSql: `, actor_connection_country AS MATERIALIZED (
${buildActorConnectionCountrySql(range, null)}
)`,
        valueSql: "actor_country.country",
        joinSql: "LEFT JOIN actor_connection_country AS actor_country ON actor_country.actor_id::text = returns.actor_id",
      };
  }
}

// The Who came back cohorts split by one value per person, values ranked by cohort people over the
// selected first-use dates.
export function buildWhoCameBackBreakdownSql(
  dimension: WhoCameBackBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const dimensionSql = buildDimensionSql(dimension, range);
  return `WITH ${buildWhoCameBackMemberCtesSql(range, period)}${dimensionSql.ctesSql}, member_values AS (
  SELECT returns.bucket_date, returns.w1_returned, returns.w4_returned,
    ${buildBreakdownValueSql(dimensionSql.valueSql)} AS dimension_value
  FROM member_returns AS returns
  ${dimensionSql.joinSql}
), ${buildSeriesRankCtesSql("member_values", "COUNT(*)", "series_members")}, series_counts AS (
  SELECT bucket_date, series_value, series_rank, COUNT(*) AS cohort_users,
    COUNT(*) FILTER (WHERE w1_returned) AS w1_returned,
    COUNT(*) FILTER (WHERE w4_returned) AS w4_returned
  FROM series_members
  GROUP BY bucket_date, series_value, series_rank
)
SELECT ${buildReportBucketColumnsSql("buckets")},
  to_char(coverage.history_from, 'YYYY-MM-DD') AS history_from,
  to_char(clock.latest_complete_date, 'YYYY-MM-DD') AS latest_complete_date,
  COALESCE(${buildRetentionMatureSql("buckets", "w1")}, false) AS w1_mature,
  COALESCE(${buildRetentionMatureSql("buckets", "w4")}, false) AS w4_mature,
  series.series_value,
  series.series_rank,
  series.cohort_users,
  series.w1_returned,
  series.w4_returned
FROM report_buckets AS buckets
CROSS JOIN activity_coverage AS coverage
CROSS JOIN activity_clock AS clock
LEFT JOIN series_counts AS series ON series.bucket_date = buckets.bucket_date
ORDER BY buckets.bucket_date, series.series_rank`;
}

function parseBoolean(row: AdminQueryRow, field: string, reportLabel: string): boolean {
  const value = row[field] ?? null;
  if (typeof value !== "boolean") throw new Error(`${reportLabel} field "${field}" must be a boolean.`);
  return value;
}

function parseRequiredCount(row: AdminQueryRow, field: string, reportLabel: string): number {
  const count = parseActivityCount(row[field] ?? null, reportLabel, field);
  if (count === null) throw new Error(`${reportLabel} field "${field}" must be counted on every value row.`);
  return count;
}

function parseBreakdownRow(row: AdminQueryRow, reportLabel: string): BreakdownRow {
  const bucket = parseReportBucket(row, reportLabel);
  const mature = { w1: parseBoolean(row, "w1_mature", reportLabel), w4: parseBoolean(row, "w4_mature", reportLabel) };
  if ((row.series_value ?? null) === null) return { bucket, mature, series: null };
  const series = {
    value: assertIsString(row.series_value ?? null, reportLabel, "series_value"),
    rank: toInteger(row.series_rank ?? null, reportLabel, "series_rank"),
    cohortUsers: parseRequiredCount(row, "cohort_users", reportLabel),
    returned: {
      w1: parseRequiredCount(row, "w1_returned", reportLabel),
      w4: parseRequiredCount(row, "w4_returned", reportLabel),
    },
  };
  if (series.cohortUsers === 0 || series.returned.w1 > series.cohortUsers || series.returned.w4 > series.cohortUsers) {
    throw new Error(`${reportLabel} returned users of ${series.value} in bucket ${bucket.key} cannot exceed its non-empty cohort.`);
  }
  return { bucket, mature, series };
}

function buildWindowCounts(
  rows: ReadonlyArray<BreakdownRow>,
  window: RetentionWindow,
): ReadonlyMap<string, RetentionValueCounts> {
  return new Map(rows.flatMap((row) => (row.series === null ? [] : [[row.series.value, {
    cohortUsers: row.series.cohortUsers,
    returned: row.series.returned[window],
  }] as const])));
}

export async function loadWhoCameBackBreakdownReport(
  config: AdminAppConfig,
  dimension: WhoCameBackBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
  signal: AbortSignal,
): Promise<WhoCameBackBreakdownReport> {
  const response = await runAdminQuery(config, buildWhoCameBackBreakdownSql(dimension, dateRange, period, reportLabel), signal);
  const result = response.resultSets[0];
  const firstRow = result?.rows[0];
  if (response.resultSets.length !== 1 || result === undefined || firstRow === undefined) {
    throw new Error(`${reportLabel} must return one result set with at least one cohort.`);
  }
  const rows = result.rows.map((row) => parseBreakdownRow(row, reportLabel));
  return {
    generatedAtUtc: response.executedAtUtc,
    period,
    historyFrom: firstRow.history_from === null ? null : parseActivityDate(firstRow.history_from ?? null, reportLabel, "history_from"),
    latestCompleteDate: parseActivityDate(firstRow.latest_complete_date ?? null, reportLabel, "latest_complete_date"),
    values: listSeriesValues(rows.flatMap((row) => (row.series === null ? [] : [row.series])), reportLabel),
    buckets: [...d3.group(rows, (row) => row.bucket.key).values()].map((bucketRows) => {
      const [first] = bucketRows;
      if (first === undefined) throw new Error(`${reportLabel} grouped an empty cohort.`);
      return {
        bucket: first.bucket,
        countsByWindow: {
          w1: first.mature.w1 ? buildWindowCounts(bucketRows, "w1") : null,
          w4: first.mature.w4 ? buildWindowCounts(bucketRows, "w4") : null,
        },
      };
    }),
  };
}
