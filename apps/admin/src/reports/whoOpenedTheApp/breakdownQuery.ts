import * as d3 from "d3";
import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
import { breakdownOtherValue, breakdownUnknownValue } from "../../charts/stackedBreakdownChart";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildActorConnectionCountrySql } from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import type { BreakdownBucket, BreakdownReport } from "../levelOneMetrics/breakdownReport";
import {
  buildReportBucketColumnsSql,
  buildReportBucketsCteSql,
  parseReportBucket,
  type ReportBucket,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { assertIsString, assertValidDateRange, parseActivityCount, parseActivityDate, toInteger } from "../reportValues";
import { buildAppOpenActivityCtesSql, buildAppOpenLastOpensCteSql } from "./appOpenActivitySql";

export const appOpenBreakdownDimensions = ["platform", "country", "app-ui-language", "sign-in-state", "app-version"] as const;

export type AppOpenBreakdownDimension = (typeof appOpenBreakdownDimensions)[number];

const keptValueCount = 5;

type BreakdownRow = Readonly<{
  bucket: ReportBucket;
  measured: boolean;
  /** Null on a bar with nobody in it, and on an unavailable bar. */
  series: Readonly<{ value: string; rank: number; people: number }> | null;
}>;

/**
 * The dimension's value over `last_open`, a row of `app_open_last_opens`, NULL or empty when unknown.
 * Country is the exception to the last-open rule: the event's own `country` is never written, so it
 * is the one country `buildActorConnectionCountrySql` places the person in over the whole range.
 */
function buildDimensionSql(
  dimension: AppOpenBreakdownDimension,
  range: AnalyticsDateRange,
): Readonly<{ valueSql: string; joinSql: string }> {
  switch (dimension) {
    case "platform":
      return { valueSql: "last_open.platform", joinSql: "" };
    case "country":
      return {
        valueSql: "actor_country.country",
        joinSql: `LEFT JOIN (
${buildActorConnectionCountrySql(range)}
  ) AS actor_country ON actor_country.actor_id::text = last_open.actor_id`,
      };
    case "app-ui-language":
      return { valueSql: "last_open.ui_locale", joinSql: "" };
    case "sign-in-state":
      return {
        valueSql: `CASE last_open.trust_level WHEN 'guest_client' THEN 'Guest'
      WHEN 'authenticated_client' THEN 'Signed in' ELSE last_open.trust_level END`,
        joinSql: "",
      };
    case "app-version":
      return { valueSql: "last_open.app_version", joinSql: "" };
  }
}

// The people of each Who opened the app bar, each under one value, so a measured bar sums to that
// chart's new plus returning bar. The top values rank by people summed over the measured bars, ties by
// value; every other value is summed into Other, ranked last.
export function buildAppOpenBreakdownSql(
  dimension: AppOpenBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const dimensionSql = buildDimensionSql(dimension, range);
  return `WITH ${buildAppOpenActivityCtesSql()}, ${buildReportBucketsCteSql(period, range)}, ${buildAppOpenLastOpensCteSql(period, range)}, measured_values AS (
  SELECT last_open.bucket_date,
    COALESCE(NULLIF(${dimensionSql.valueSql}, ''), ${escapeSqlStringLiteral(breakdownUnknownValue)}) AS dimension_value
  FROM app_open_last_opens AS last_open
  JOIN report_buckets AS buckets USING (bucket_date)
  CROSS JOIN app_open_coverage AS coverage
  ${dimensionSql.joinSql}
  WHERE buckets.selected_from >= coverage.history_from
), value_ranks AS (
  SELECT dimension_value, ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, dimension_value) AS value_rank
  FROM measured_values
  GROUP BY dimension_value
), series_people AS (
  SELECT measured_values.bucket_date,
    CASE WHEN value_ranks.value_rank <= ${keptValueCount} THEN measured_values.dimension_value
      ELSE ${escapeSqlStringLiteral(breakdownOtherValue)} END AS series_value,
    LEAST(value_ranks.value_rank, ${keptValueCount + 1}) AS series_rank
  FROM measured_values
  JOIN value_ranks USING (dimension_value)
), bucket_series AS (
  SELECT bucket_date, series_value, series_rank, COUNT(*) AS people
  FROM series_people
  GROUP BY bucket_date, series_value, series_rank
)
SELECT ${buildReportBucketColumnsSql("buckets")},
  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,
  COALESCE(buckets.selected_from >= coverage.history_from, FALSE) AS measured,
  bucket_series.series_value,
  bucket_series.series_rank,
  bucket_series.people
FROM report_buckets AS buckets
CROSS JOIN app_open_coverage AS coverage
LEFT JOIN bucket_series USING (bucket_date)
ORDER BY buckets.bucket_date, bucket_series.series_rank`;
}

function parseBreakdownRow(row: AdminQueryRow, reportLabel: string): BreakdownRow {
  const measured = row.measured ?? null;
  if (typeof measured !== "boolean") throw new Error(`${reportLabel} field "measured" must be a boolean.`);
  const bucket = parseReportBucket(row, reportLabel);
  if ((row.series_value ?? null) === null) return { bucket, measured, series: null };
  const value = assertIsString(row.series_value ?? null, reportLabel, "series_value");
  if (!measured) throw new Error(`${reportLabel} must not count people on unavailable bucket ${bucket.key}.`);
  const people = parseActivityCount(row.people ?? null, reportLabel, "people");
  if (people === null) throw new Error(`${reportLabel} must count the people of value ${value} in bucket ${bucket.key}.`);
  return {
    bucket,
    measured,
    series: { value, rank: toInteger(row.series_rank ?? null, reportLabel, "series_rank"), people },
  };
}

/** The series values in rank order, the bottom of the stack first. */
function listSeriesValues(rows: ReadonlyArray<BreakdownRow>, reportLabel: string): ReadonlyArray<string> {
  const valuesByRank = d3.rollup(
    rows.flatMap((row) => (row.series === null ? [] : [row.series])),
    (series) => new Set(series.map((entry) => entry.value)),
    (entry) => entry.rank,
  );
  return [...valuesByRank.entries()].sort(([leftRank], [rightRank]) => leftRank - rightRank).map(([rank, values]) => {
    const [value] = [...values];
    if (values.size !== 1 || value === undefined) {
      throw new Error(`${reportLabel} must name exactly one value at rank ${rank}.`);
    }
    return value;
  });
}

export async function loadAppOpenBreakdownReport(
  config: AdminAppConfig,
  dimension: AppOpenBreakdownDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): Promise<BreakdownReport> {
  const response = await runAdminQuery(config, buildAppOpenBreakdownSql(dimension, dateRange, period, reportLabel));
  const result = response.resultSets[0];
  const firstRow = result?.rows[0];
  if (response.resultSets.length !== 1 || result === undefined || firstRow === undefined) {
    throw new Error(`${reportLabel} must return one result set with at least one bucket.`);
  }
  const rows = result.rows.map((row) => parseBreakdownRow(row, reportLabel));
  const values = listSeriesValues(rows, reportLabel);
  if (new Set(values).size !== values.length) {
    throw new Error(`${reportLabel} returned one value at two ranks: ${values.join(", ")}.`);
  }
  const buckets: ReadonlyArray<BreakdownBucket> = [...d3.group(rows, (row) => row.bucket.key).values()].map((bucketRows) => {
    const [first] = bucketRows;
    if (first === undefined) throw new Error(`${reportLabel} grouped an empty bucket.`);
    return {
      bucket: first.bucket,
      countsByValue: first.measured
        ? new Map(bucketRows.flatMap((row) => (row.series === null ? [] : [[row.series.value, row.series.people] as const])))
        : null,
    };
  });
  return {
    generatedAtUtc: response.executedAtUtc,
    period,
    today: parseActivityDate(firstRow.today ?? null, reportLabel, "today"),
    values,
    buckets,
  };
}
