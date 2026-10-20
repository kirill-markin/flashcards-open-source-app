import { runAdminQuery, type AdminQueryRow, type AdminQueryValue } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import {
  buildReportBucketColumnsSql,
  buildReportBucketsCteSql,
  parseReportBucket,
  type ReportBucket,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { assertIsString, assertValidDateRange, parseActivityCount, parseActivityDate } from "../reportValues";
import { buildPaymentCoverageCtesSql, buildPaymentHistoryCtesSql } from "./paymentHistorySql";

const reportLabel = "Who paid us report";
export const paymentSourceProviders = {
  apple_transactions: "apple", google_orders: "google", stripe_subscriptions: "stripe",
  stripe_invoices: "stripe", stripe_payments: "stripe",
} as const;
type PaymentSource = keyof typeof paymentSourceProviders;
export const paymentProviders = ["apple", "google", "stripe"] as const;
export const paymentSeries = ["trial", "first", "recurring"] as const;
export type PaymentProvider = (typeof paymentProviders)[number];
export type PaymentSeries = (typeof paymentSeries)[number];
export const paymentProviderLabels = { apple: "Apple", google: "Google", stripe: "Stripe" } as const;
export const paymentSeriesLabels = { trial: "Trial starts", first: "First payments", recurring: "Recurring payments" } as const;

export type ProviderPaymentBucket = Readonly<{
  counts: Readonly<Record<PaymentSeries, number | null>>;
  complete: boolean;
  unclassified: number;
  nativeRepurchases: number;
}>;
export type WhoPaidUsBucket = Readonly<{
  bucket: ReportBucket;
  providers: Readonly<Record<PaymentProvider, ProviderPaymentBucket>>;
}>;
export type PaymentSourceCoverage = Readonly<{
  provider: PaymentProvider;
  source: PaymentSource;
  status: "missing" | "running" | "succeeded" | "partial" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  requestedTo: string | null;
  coveredFrom: string | null;
  coveredTo: string | null;
  failureCode: string | null;
}>;
export type WhoPaidUsReport = Readonly<{
  generatedAtUtc: string;
  period: ReportPeriod;
  today: string;
  buckets: ReadonlyArray<WhoPaidUsBucket>;
  sources: ReadonlyArray<PaymentSourceCoverage>;
}>;

export function buildWhoPaidUsAvailableRangeSql(): string {
  return `WITH ${buildPaymentHistoryCtesSql()}
SELECT (MIN(event_at) AT TIME ZONE 'UTC')::date AS history_from FROM payment_events`;
}

// Events summed per bucket, since they are events rather than people. A bucket is complete only when
// every latest Stripe catalog scan succeeded and covers all of its selected days.
export function buildWhoPaidUsSql(dateRange: AnalyticsDateRange, period: ReportPeriod): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  return `WITH ${buildPaymentHistoryCtesSql()}, ${buildPaymentCoverageCtesSql()}, ${buildReportBucketsCteSql(period, range)},
providers(provider) AS (VALUES ('apple'), ('google'), ('stripe')),
bucketed AS (
  SELECT buckets.bucket_date, buckets.selected_from, buckets.selected_to, providers.provider,
    COUNT(*) FILTER (WHERE event.series = 'trial') AS trial,
    COUNT(*) FILTER (WHERE event.series = 'first') AS first,
    COUNT(*) FILTER (WHERE event.series = 'recurring') AS recurring,
    COUNT(*) FILTER (WHERE event.series = 'unclassified') AS unclassified,
    COUNT(*) FILTER (WHERE event.series = 'recurring' AND event.native_purchase) AS native_repurchases
  FROM report_buckets AS buckets CROSS JOIN providers
  LEFT JOIN payment_events AS event ON event.provider = providers.provider
    AND event.event_at >= buckets.selected_from::timestamp AT TIME ZONE 'UTC'
    AND event.event_at < (buckets.selected_to + 1)::timestamp AT TIME ZONE 'UTC'
  GROUP BY buckets.bucket_date, buckets.selected_from, buckets.selected_to, providers.provider
), covered AS (
  SELECT bucketed.*,
    bucketed.provider = 'stripe' AND NOT EXISTS (
      SELECT 1 FROM latest_sources AS source WHERE source.provider = bucketed.provider
        AND (source.status IS DISTINCT FROM 'succeeded'
          OR source.covered_from > bucketed.selected_from::timestamp AT TIME ZONE 'UTC'
          OR source.covered_to < (bucketed.selected_to + 1)::timestamp AT TIME ZONE 'UTC')
    ) AS complete
  FROM bucketed
)
SELECT ${buildReportBucketColumnsSql("covered")}, provider, complete,
  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,
  CASE WHEN trial > 0 OR complete THEN trial END AS trial,
  CASE WHEN first > 0 OR (complete AND unclassified = 0) THEN first END AS first,
  CASE WHEN recurring > 0 OR (complete AND unclassified = 0) THEN recurring END AS recurring,
  unclassified, native_repurchases
FROM covered ORDER BY covered.bucket_date, provider;
WITH ${buildPaymentCoverageCtesSql()}
SELECT provider, source, COALESCE(status, 'missing') AS status,
  to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS started_at,
  to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS finished_at,
  to_char(requested_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_to,
  to_char(covered_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS covered_from,
  to_char(covered_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS covered_to,
  failure_code
FROM latest_sources ORDER BY provider, source`;
}

function parseProvider(value: AdminQueryValue): PaymentProvider {
  const provider = assertIsString(value, reportLabel, "provider");
  const matched = paymentProviders.find((entry) => entry === provider);
  if (matched === undefined) throw new Error(`${reportLabel} returned an unsupported provider.`);
  return matched;
}

function parseNullableString(row: AdminQueryRow, field: string): string | null {
  return row[field] === null ? null : assertIsString(row[field] ?? null, reportLabel, field);
}

function parseRequiredCount(row: AdminQueryRow, field: string): number {
  const value = parseActivityCount(row[field] ?? null, reportLabel, field);
  if (value === null) throw new Error(`${reportLabel} requires ${field}.`);
  return value;
}

export function getPaymentSeriesTotal(entry: WhoPaidUsBucket, series: PaymentSeries): number | null {
  const counts = paymentProviders.map((provider) => entry.providers[provider].counts[series]);
  const recorded = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  return recorded > 0 || counts.every((count) => count !== null) ? recorded : null;
}

export async function loadWhoPaidUsReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  signal: AbortSignal,
): Promise<WhoPaidUsReport> {
  const response = await runAdminQuery(config, buildWhoPaidUsSql(dateRange, period), signal);
  const bucketed = response.resultSets[0];
  const coverage = response.resultSets[1];
  const firstRow = bucketed?.rows[0];
  if (response.resultSets.length !== 2 || bucketed === undefined || coverage === undefined || firstRow === undefined
    || bucketed.rows.length % paymentProviders.length !== 0 || coverage.rows.length !== 5) {
    throw new Error(`${reportLabel} must return each bucket/provider and five source coverage rows.`);
  }
  const bucketsByKey = new Map<string, ReportBucket>();
  const rowsByKey = new Map<string, ProviderPaymentBucket>();
  for (const row of bucketed.rows) {
    const bucket = parseReportBucket(row, reportLabel);
    const provider = parseProvider(row.provider ?? null);
    if (typeof row.complete !== "boolean" || rowsByKey.has(`${bucket.key}:${provider}`)) {
      throw new Error(`${reportLabel} returned invalid bucket coverage or a duplicate bucket/provider.`);
    }
    bucketsByKey.set(bucket.key, bucket);
    rowsByKey.set(`${bucket.key}:${provider}`, {
      counts: {
        trial: parseActivityCount(row.trial ?? null, reportLabel, "trial"),
        first: parseActivityCount(row.first ?? null, reportLabel, "first"),
        recurring: parseActivityCount(row.recurring ?? null, reportLabel, "recurring"),
      },
      complete: row.complete,
      unclassified: parseRequiredCount(row, "unclassified"),
      nativeRepurchases: parseRequiredCount(row, "native_repurchases"),
    });
  }
  const getProviderBucket = (key: string, provider: PaymentProvider): ProviderPaymentBucket => {
    const entry = rowsByKey.get(`${key}:${provider}`);
    if (entry === undefined) throw new Error(`${reportLabel} is missing a bucket/provider.`);
    return entry;
  };
  const seenSources = new Set<string>();
  return {
    generatedAtUtc: response.executedAtUtc,
    period,
    today: parseActivityDate(firstRow.today ?? null, reportLabel, "today"),
    buckets: [...bucketsByKey.values()].map((bucket) => ({ bucket, providers: {
      apple: getProviderBucket(bucket.key, "apple"), google: getProviderBucket(bucket.key, "google"), stripe: getProviderBucket(bucket.key, "stripe"),
    } })),
    sources: coverage.rows.map((row) => {
      const provider = parseProvider(row.provider ?? null);
      const sourceName = assertIsString(row.source ?? null, reportLabel, "source");
      const source = (Object.keys(paymentSourceProviders) as ReadonlyArray<PaymentSource>)
        .find((entry) => entry === sourceName);
      if (source === undefined || paymentSourceProviders[source] !== provider || seenSources.has(source)) {
        throw new Error(`${reportLabel} returned an unsupported or duplicate source/provider.`);
      }
      seenSources.add(source);
      const status = assertIsString(row.status ?? null, reportLabel, "status");
      if (status !== "missing" && status !== "running" && status !== "succeeded" && status !== "partial" && status !== "failed") {
        throw new Error(`${reportLabel} returned an unsupported import status.`);
      }
      return {
        provider, source, status,
        startedAt: parseNullableString(row, "started_at"), finishedAt: parseNullableString(row, "finished_at"),
        requestedTo: parseNullableString(row, "requested_to"), coveredFrom: parseNullableString(row, "covered_from"),
        coveredTo: parseNullableString(row, "covered_to"), failureCode: parseNullableString(row, "failure_code"),
      };
    }),
  };
}
