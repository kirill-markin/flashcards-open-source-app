import type { AdminQueryRow } from "../../adminApi";
import { formatCompactDateLabel } from "../../charts/formatting";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import { parseActivityDate } from "../reportValues";

export const reportPeriods = ["day", "week", "month"] as const;
export type ReportPeriod = (typeof reportPeriods)[number];

export const reportPeriodLabels: Readonly<Record<ReportPeriod, string>> = { day: "Days", week: "Weeks", month: "Months" };
export const reportPeriodColumnLabels: Readonly<Record<ReportPeriod, string>> = { day: "Day", week: "Week", month: "Month" };
export const reportPeriodAxisLabels: Readonly<Record<ReportPeriod, string>> = {
  day: "Day (UTC)",
  week: "Week (Monday–Sunday, UTC)",
  month: "Month (UTC)",
};

/** One bar: `key` is the bucket's first day; `from`–`to` are the selected days inside it, all a bar counts. */
export type ReportBucket = Readonly<{ key: string; from: string; to: string }>;

export function findReportPeriod(value: string): ReportPeriod | undefined {
  return reportPeriods.find((candidate) => candidate === value);
}

export function parseReportPeriod(value: string): ReportPeriod {
  const period = findReportPeriod(value);
  if (period === undefined) throw new Error(`Unsupported Level 1 report period: ${value}`);
  return period;
}

// Weeks are Monday–Sunday and months calendar months of UTC dates, exactly as Postgres `date_trunc` cuts them.
export function buildReportBucketSql(period: ReportPeriod, dateSql: string): string {
  return `date_trunc('${period}', (${dateSql})::timestamp)::date`;
}

/**
 * The `report_buckets` CTE: one row per bucket the range touches, oldest first. Edge buckets hold only
 * the selected days, so every count reads `selected_from` through `selected_to`.
 */
export function buildReportBucketsCteSql(period: ReportPeriod, range: AnalyticsDateRange): string {
  const fromSql = `${escapeSqlStringLiteral(range.from)}::date`;
  const toSql = `${escapeSqlStringLiteral(range.to)}::date`;
  return `report_buckets AS (
  SELECT bucket::date AS bucket_date,
    GREATEST(bucket::date, ${fromSql}) AS selected_from,
    LEAST((bucket + INTERVAL '1 ${period}')::date - 1, ${toSql}) AS selected_to
  FROM generate_series(${buildReportBucketSql(period, fromSql)}::timestamp,
    ${buildReportBucketSql(period, toSql)}::timestamp, INTERVAL '1 ${period}') AS bucket
)`;
}

/** The three bucket columns `parseReportBucket` reads, from a row source carrying `report_buckets` columns. */
export function buildReportBucketColumnsSql(alias: string): string {
  return `to_char(${alias}.bucket_date, 'YYYY-MM-DD') AS bucket_date,
  to_char(${alias}.selected_from, 'YYYY-MM-DD') AS selected_from,
  to_char(${alias}.selected_to, 'YYYY-MM-DD') AS selected_to`;
}

export function parseReportBucket(row: AdminQueryRow, reportLabel: string): ReportBucket {
  return {
    key: parseActivityDate(row.bucket_date ?? null, reportLabel, "bucket_date"),
    from: parseActivityDate(row.selected_from ?? null, reportLabel, "selected_from"),
    to: parseActivityDate(row.selected_to ?? null, reportLabel, "selected_to"),
  };
}

export function findInProgressBucketKey(buckets: ReadonlyArray<ReportBucket>, today: string): string | null {
  return buckets.find((bucket) => bucket.to === today)?.key ?? null;
}

export function formatReportBucketTick(period: ReportPeriod, key: string): string {
  return period === "month" ? key.slice(0, 7) : formatCompactDateLabel(key);
}

export function formatReportBucketLabel(period: ReportPeriod, key: string): string {
  switch (period) {
    case "day":
      return key;
    case "week":
      return `Week of ${key}`;
    case "month":
      return key.slice(0, 7);
  }
}

/** The bar's name, plus its selected days for a week or month, since an edge bar holds only those. */
export function formatReportBucketTitle(period: ReportPeriod, bucket: ReportBucket): string {
  const label = formatReportBucketLabel(period, bucket.key);
  return period === "day" ? label : `${label} (${bucket.from} – ${bucket.to})`;
}
