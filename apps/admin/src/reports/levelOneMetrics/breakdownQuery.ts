import * as d3 from "d3";
import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
import { breakdownOtherValue, breakdownUnknownValue } from "../../charts/stackedBreakdownChart";
import type { AdminAppConfig } from "../../config";
import { escapeSqlStringLiteral } from "../../sql";
import { assertIsString, parseActivityCount, parseActivityDate, toInteger } from "../reportValues";
import type { BreakdownBucket, BreakdownReport } from "./breakdownReport";
import {
  buildReportBucketColumnsSql,
  parseReportBucket,
  type ReportBucket,
  type ReportPeriod,
} from "./reportPeriod";

const keptValueCount = 5;

type BreakdownRow = Readonly<{
  bucket: ReportBucket;
  measured: boolean;
  /** Null on a bar that counted nothing, and on an unavailable bar. */
  series: Readonly<{ value: string; rank: number; count: number }> | null;
}>;

/** A breakdown value read through `valueSql`, Unknown when it is NULL or empty. */
export function buildBreakdownValueSql(valueSql: string): string {
  return `COALESCE(NULLIF(${valueSql}, ''), ${escapeSqlStringLiteral(breakdownUnknownValue)})`;
}

/**
 * The statement `loadBreakdownReport` reads, over the caller's CTEs: `report_buckets`,
 * `measured_buckets(bucket_date)`, the available bars, and `measured_values(bucket_date,
 * dimension_value, value_count)`, what an available bar counts under a value. The top values rank by
 * count summed over the range, ties by value; every other value is summed into Other, ranked last. A
 * value or Other that rounds to zero in a bar draws nothing there.
 */
export function buildBreakdownSql(ctesSql: string): string {
  return `WITH ${ctesSql}, value_ranks AS (
  SELECT dimension_value, ROW_NUMBER() OVER (ORDER BY SUM(value_count) DESC, dimension_value) AS value_rank
  FROM measured_values
  GROUP BY dimension_value
  HAVING SUM(value_count) > 0
), series_counts AS (
  SELECT measured_values.bucket_date,
    CASE WHEN value_ranks.value_rank <= ${keptValueCount} THEN measured_values.dimension_value
      ELSE ${escapeSqlStringLiteral(breakdownOtherValue)} END AS series_value,
    LEAST(value_ranks.value_rank, ${keptValueCount + 1}) AS series_rank,
    measured_values.value_count
  FROM measured_values
  JOIN value_ranks USING (dimension_value)
), bucket_series AS (
  SELECT bucket_date, series_value, series_rank, ROUND(SUM(value_count))::bigint AS series_count
  FROM series_counts
  GROUP BY bucket_date, series_value, series_rank
  HAVING ROUND(SUM(value_count)) > 0
)
SELECT ${buildReportBucketColumnsSql("buckets")},
  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,
  measured_buckets.bucket_date IS NOT NULL AS measured,
  bucket_series.series_value,
  bucket_series.series_rank,
  bucket_series.series_count
FROM report_buckets AS buckets
LEFT JOIN measured_buckets ON measured_buckets.bucket_date = buckets.bucket_date
LEFT JOIN bucket_series ON bucket_series.bucket_date = buckets.bucket_date
ORDER BY buckets.bucket_date, bucket_series.series_rank`;
}

function parseBreakdownRow(row: AdminQueryRow, reportLabel: string): BreakdownRow {
  const measured = row.measured ?? null;
  if (typeof measured !== "boolean") throw new Error(`${reportLabel} field "measured" must be a boolean.`);
  const bucket = parseReportBucket(row, reportLabel);
  if ((row.series_value ?? null) === null) return { bucket, measured, series: null };
  const value = assertIsString(row.series_value ?? null, reportLabel, "series_value");
  if (!measured) throw new Error(`${reportLabel} must not count anything on unavailable bucket ${bucket.key}.`);
  const count = parseActivityCount(row.series_count ?? null, reportLabel, "series_count");
  if (count === null) throw new Error(`${reportLabel} must count value ${value} in bucket ${bucket.key}.`);
  return {
    bucket,
    measured,
    series: { value, rank: toInteger(row.series_rank ?? null, reportLabel, "series_rank"), count },
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

/** Runs a `buildBreakdownSql` statement. */
export async function loadBreakdownReport(
  config: AdminAppConfig,
  sql: string,
  period: ReportPeriod,
  reportLabel: string,
): Promise<BreakdownReport> {
  const response = await runAdminQuery(config, sql);
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
        ? new Map(bucketRows.flatMap((row) => (row.series === null ? [] : [[row.series.value, row.series.count] as const])))
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
