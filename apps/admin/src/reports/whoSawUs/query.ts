import { runAdminQuery, type AdminQueryResultSet, type AdminQueryValue } from "../../adminApi";
import type { ChartNote } from "../../charts/chartNotes";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { escapeSqlStringLiteral } from "../../sql";
import {
  buildReportBucketColumnsSql,
  buildReportBucketSql,
  buildReportBucketsCteSql,
  parseReportBucket,
  type ReportBucket,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { assertIsString, assertValidDateRange, parseActivityCount, parseActivityDate } from "../reportValues";
import { buildSiteVisitorDaysCtesSql } from "./engagedVisitorsQuery";

const reportLabel = "Who saw us report";
const storeDeliveryLabel = "Who saw us store delivery";

// Our app in each store's reports. Store accounts can hold other apps, and the Play reports bucket
// belongs to the whole developer account, so every store read pins one of these.
const ourAppleAppIdentifier = "6760538964";
const ourPlayPackageName = "com.flashcardsopensourceapp.app";

// In stack order, bottom first. Two more series are planned and not built yet: MCP OpenAI and MCP
// Anthropic, the daily connected ChatGPT and Claude MCP clients.
export const whoSawUsSeriesKeys = ["web", "app-store", "google-play"] as const;

export type WhoSawUsSeriesKey = (typeof whoSawUsSeriesKeys)[number];

export const whoSawUsStoreSeriesKeys = ["app-store", "google-play"] as const;

export type WhoSawUsStoreSeriesKey = (typeof whoSawUsStoreSeriesKeys)[number];

/** Today in UTC and each store's newest delivered day, as the database reads them. */
export type StoreDelivery = Readonly<{
  today: string;
  /**
   * The latest `report_date` among exactly the rows the store's series reads, over all retained
   * history rather than the selected range; null before the store's first row.
   */
  newestDeliveredDateByStore: Readonly<Record<WhoSawUsStoreSeriesKey, string | null>>;
}>;

export type WhoSawUsBucket = Readonly<{
  bucket: ReportBucket;
  /** NULL where the source has no row for any day of the bucket, which is absence rather than a reported zero. */
  visitorsBySeries: Readonly<Record<WhoSawUsSeriesKey, number | null>>;
}>;

export type WhoSawUsReport = Readonly<{
  generatedAtUtc: string;
  period: ReportPeriod;
  from: string;
  to: string;
  /** Every bucket of the range, oldest first. */
  buckets: ReadonlyArray<WhoSawUsBucket>;
  storeDelivery: StoreDelivery;
}>;

function getSingleResultSet(
  resultSets: ReadonlyArray<AdminQueryResultSet>,
  queryLabel: string,
): AdminQueryResultSet {
  const resultSet = resultSets[0];
  if (resultSets.length !== 1 || resultSet === undefined) {
    throw new Error(`${queryLabel} must return exactly one result set. Got ${resultSets.length}.`);
  }

  return resultSet;
}

/**
 * The App Store rows the `app-store` series reads, as `AND` lines: our app's daily standard product
 * page views that carry the count it sums.
 */
export function buildAppleProductPageViewRowSqlLines(
  rowAlias: string,
  countColumn: "unique_counts" | "counts",
): ReadonlyArray<string> {
  return [
    `${rowAlias}.app_apple_identifier = ${escapeSqlStringLiteral(ourAppleAppIdentifier)}`,
    `${rowAlias}.granularity = 'DAILY'`,
    `${rowAlias}.detail_level = 'standard'`,
    `pg_catalog.lower(${rowAlias}.event) = 'page view'`,
    `pg_catalog.lower(${rowAlias}.page_type) = 'product page'`,
    `${rowAlias}.${countColumn} IS NOT NULL`,
  ];
}

/** The Google Play rows the `google-play` series reads, as `AND` lines. */
function buildPlayListingVisitorRowSqlLines(rowAlias: string): ReadonlyArray<string> {
  return [
    `${rowAlias}.package_name = ${escapeSqlStringLiteral(ourPlayPackageName)}`,
    `${rowAlias}.store_listing_visitors IS NOT NULL`,
  ];
}

/** A store row's `report_date` inside the range, as `AND` lines. */
export function buildStoreReportDateRangeSqlLines(rowAlias: string, range: AnalyticsDateRange): ReadonlyArray<string> {
  return [
    `${rowAlias}.report_date >= ${escapeSqlStringLiteral(range.from)}::date`,
    `${rowAlias}.report_date <= ${escapeSqlStringLiteral(range.to)}::date`,
  ];
}

export const webDataStartChartNote: ChartNote = {
  // Approximate: production's first `site_page_viewed` is 2026-09-22 15:43:57 UTC, read on 2026-10-20.
  at: "2026-09-22T15:44:00Z",
  shortText: "Web data starts",
  longText: "We started collecting website visits in our analytics around 15:44 UTC on 2026-09-22. That day is partial, and there is no web data before it.",
};

/**
 * Every day either the website or a store series has data on, through today: the union the area's
 * `All time` reaches. Store history can start long before the website's first page view. Each store
 * probe reads exactly the rows its series reads, so `All time` never opens on days no bar can have.
 */
export function buildWhoSawUsAvailableRangeSql(): string {
  return [
    "SELECT",
    "  to_char(",
    "    LEAST(",
    "      (",
    "        SELECT (MIN(site_view.occurred_at) AT TIME ZONE 'UTC')::date",
    "        FROM analytics.product_events_resolved AS site_view",
    "        WHERE site_view.event_name = 'site_page_viewed'",
    "      ),",
    "      (",
    "        SELECT MIN(engagement.report_date)",
    "        FROM store_analytics.apple_discovery_engagement AS engagement",
    `        WHERE ${buildAppleProductPageViewRowSqlLines("engagement", "unique_counts").join("\n          AND ")}`,
    "      ),",
    "      (",
    "        SELECT MIN(preview.report_date)",
    "        FROM store_analytics.apple_web_preview_engagement AS preview",
    `        WHERE ${buildAppleProductPageViewRowSqlLines("preview", "counts").join("\n          AND ")}`,
    "      ),",
    "      (",
    "        SELECT MIN(performance.report_date)",
    "        FROM store_analytics.play_store_performance_country AS performance",
    `        WHERE ${buildPlayListingVisitorRowSqlLines("performance").join("\n          AND ")}`,
    "      ),",
    // `LEAST` skips NULLs, so this is also the answer while every source is still empty.
    "      (now() AT TIME ZONE 'UTC')::date",
    "    ),",
    "    'YYYY-MM-DD'",
    "  ) AS from_date,",
    "  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS to_date",
  ].join("\n");
}

function buildStoreDeliverySql(): string {
  return [
    "SELECT",
    "  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,",
    "  to_char(",
    // `GREATEST` skips NULLs, so one Apple table without rows does not hide the other.
    "    GREATEST(",
    "      (",
    "        SELECT MAX(engagement.report_date)",
    "        FROM store_analytics.apple_discovery_engagement AS engagement",
    `        WHERE ${buildAppleProductPageViewRowSqlLines("engagement", "unique_counts").join("\n          AND ")}`,
    "      ),",
    "      (",
    "        SELECT MAX(preview.report_date)",
    "        FROM store_analytics.apple_web_preview_engagement AS preview",
    `        WHERE ${buildAppleProductPageViewRowSqlLines("preview", "counts").join("\n          AND ")}`,
    "      )",
    "    ),",
    "    'YYYY-MM-DD'",
    "  ) AS app_store_newest_date,",
    "  to_char(",
    "    (",
    "      SELECT MAX(performance.report_date)",
    "      FROM store_analytics.play_store_performance_country AS performance",
    `      WHERE ${buildPlayListingVisitorRowSqlLines("performance").join("\n        AND ")}`,
    "    ),",
    "    'YYYY-MM-DD'",
    "  ) AS google_play_newest_date",
  ].join("\n");
}

function parseNewestDeliveredDate(value: AdminQueryValue, field: string): string | null {
  return value === null ? null : parseActivityDate(value, storeDeliveryLabel, field);
}

export async function loadStoreDelivery(config: AdminAppConfig, signal: AbortSignal): Promise<StoreDelivery> {
  const response = await runAdminQuery(config, buildStoreDeliverySql(), signal);
  const resultSet = getSingleResultSet(response.resultSets, storeDeliveryLabel);
  const row = resultSet.rows[0];
  if (resultSet.rows.length !== 1 || row === undefined) {
    throw new Error(`${storeDeliveryLabel} must return exactly one row. Got ${resultSet.rows.length}.`);
  }

  return {
    today: parseActivityDate(row.today ?? null, storeDeliveryLabel, "today"),
    newestDeliveredDateByStore: {
      "app-store": parseNewestDeliveredDate(row.app_store_newest_date ?? null, "app_store_newest_date"),
      "google-play": parseNewestDeliveredDate(row.google_play_newest_date ?? null, "google_play_newest_date"),
    },
  };
}

export async function loadWhoSawUsAvailableRange(config: AdminAppConfig, signal: AbortSignal): Promise<AnalyticsDateRange> {
  const response = await runAdminQuery(config, buildWhoSawUsAvailableRangeSql(), signal);
  const resultSet = getSingleResultSet(response.resultSets, `${reportLabel} available range`);
  const row = resultSet.rows[0];
  if (resultSet.rows.length !== 1 || row === undefined) {
    throw new Error(`${reportLabel} available range must return exactly one row. Got ${resultSet.rows.length}.`);
  }

  return assertValidDateRange({
    from: assertIsString(row.from_date ?? null, reportLabel, "from_date"),
    to: assertIsString(row.to_date ?? null, reportLabel, "to_date"),
  }, reportLabel);
}

/**
 * One row per bucket of the range, each series an approximate count of unique visitors or NULL.
 *
 * `web` is the marketing site's engaged visitors over `buildSiteVisitorDaysCtesSql`: distinct identified
 * visitors engaged on any day of the bucket, through the shared actor exclusion rule, which also drops
 * every actor with an automated collector row, plus engaged cookieless visitor-days, keyed as the
 * funnels key them in `../funnels/funnelAudienceSql.ts`. The two cohorts can hold one human on the
 * same day, before and after consent, and are added anyway. The salt rotates daily and no hash links
 * two days, so the cookieless daily counts are summed into the bucket, as are the stores' daily
 * values, which carry no visitor id at all. `web` is NULL only where the bucket has no site
 * visitor-day, so a bucket with visitors but no engaged one is 0.
 *
 * `app-store` is our app's product page views of the Discovery and Engagement report, by unique count, plus
 * the browser views of the apps.apple.com page from the Web Preview report, which has no unique
 * count. `google-play` is our package's store listing visitors of the per-country performance file. Both are
 * sums over the store's breakdown rows, so a visitor seen in two of them counts twice. Apple's value
 * strings are matched case-insensitively because no imported file has confirmed their exact case.
 *
 * TODO: someone who reaches the store page from our website, by a store badge or the site's QR code,
 * can count in both `web` and `app-store` or `google-play`. Removing that overlap is a known later task.
 */
export function buildWhoSawUsSql(dateRange: AnalyticsDateRange, period: ReportPeriod): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const identifiedBucketSql = buildReportBucketSql(period, "identified.visit_date");
  const hashedBucketSql = buildReportBucketSql(period, "hashed.visit_date");
  const appleBucketSql = buildReportBucketSql(period, "apple_visitors.visit_date");
  const playBucketSql = buildReportBucketSql(period, "play_visitors.visit_date");

  return [
    `WITH ${buildReportBucketsCteSql(period, range)}, ${buildSiteVisitorDaysCtesSql(range)}, site_visitors AS (`,
    "  SELECT",
    `    ${identifiedBucketSql} AS bucket_date,`,
    "    COUNT(DISTINCT identified.actor_id) FILTER (WHERE identified.is_engaged) AS visitor_count",
    "  FROM identified_visitor_days AS identified",
    `  GROUP BY ${identifiedBucketSql}`,
    "  UNION ALL",
    "  SELECT",
    `    ${hashedBucketSql} AS bucket_date,`,
    "    COUNT(*) FILTER (WHERE hashed.is_engaged) AS visitor_count",
    "  FROM hashed_visitor_days AS hashed",
    `  GROUP BY ${hashedBucketSql}`,
    "), apple_visitors AS (",
    "  SELECT engagement.report_date AS visit_date, engagement.unique_counts AS visitor_count",
    "  FROM store_analytics.apple_discovery_engagement AS engagement",
    `  WHERE ${buildAppleProductPageViewRowSqlLines("engagement", "unique_counts").join("\n    AND ")}`,
    `    AND ${buildStoreReportDateRangeSqlLines("engagement", range).join("\n    AND ")}`,
    "  UNION ALL",
    "  SELECT preview.report_date AS visit_date, preview.counts AS visitor_count",
    "  FROM store_analytics.apple_web_preview_engagement AS preview",
    `  WHERE ${buildAppleProductPageViewRowSqlLines("preview", "counts").join("\n    AND ")}`,
    `    AND ${buildStoreReportDateRangeSqlLines("preview", range).join("\n    AND ")}`,
    "), play_visitors AS (",
    "  SELECT performance.report_date AS visit_date, performance.store_listing_visitors AS visitor_count",
    "  FROM store_analytics.play_store_performance_country AS performance",
    `  WHERE ${buildPlayListingVisitorRowSqlLines("performance").join("\n    AND ")}`,
    `    AND ${buildStoreReportDateRangeSqlLines("performance", range).join("\n    AND ")}`,
    "), web_buckets AS (",
    "  SELECT site_visitors.bucket_date, SUM(site_visitors.visitor_count)::bigint AS visitor_count",
    "  FROM site_visitors",
    "  GROUP BY site_visitors.bucket_date",
    "), apple_buckets AS (",
    `  SELECT ${appleBucketSql} AS bucket_date, ROUND(SUM(apple_visitors.visitor_count))::bigint AS visitor_count`,
    "  FROM apple_visitors",
    `  GROUP BY ${appleBucketSql}`,
    "), play_buckets AS (",
    `  SELECT ${playBucketSql} AS bucket_date, ROUND(SUM(play_visitors.visitor_count))::bigint AS visitor_count`,
    "  FROM play_visitors",
    `  GROUP BY ${playBucketSql}`,
    ")",
    "SELECT",
    `  ${buildReportBucketColumnsSql("buckets")},`,
    "  web.visitor_count AS web_visitors,",
    "  apple.visitor_count AS app_store_visitors,",
    "  play.visitor_count AS google_play_visitors",
    "FROM report_buckets AS buckets",
    "LEFT JOIN web_buckets AS web ON web.bucket_date = buckets.bucket_date",
    "LEFT JOIN apple_buckets AS apple ON apple.bucket_date = buckets.bucket_date",
    "LEFT JOIN play_buckets AS play ON play.bucket_date = buckets.bucket_date",
    "ORDER BY buckets.bucket_date",
  ].join("\n");
}

function buildWhoSawUsBuckets(resultSet: AdminQueryResultSet): ReadonlyArray<WhoSawUsBucket> {
  return resultSet.rows.map((row) => ({
    bucket: parseReportBucket(row, reportLabel),
    visitorsBySeries: {
      web: parseActivityCount(row.web_visitors ?? null, reportLabel, "web_visitors"),
      "app-store": parseActivityCount(row.app_store_visitors ?? null, reportLabel, "app_store_visitors"),
      "google-play": parseActivityCount(row.google_play_visitors ?? null, reportLabel, "google_play_visitors"),
    },
  }));
}

export async function loadWhoSawUsReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  signal: AbortSignal,
): Promise<WhoSawUsReport> {
  const [response, storeDelivery] = await Promise.all([
    runAdminQuery(config, buildWhoSawUsSql(dateRange, period), signal),
    loadStoreDelivery(config, signal),
  ]);
  const resultSet = getSingleResultSet(response.resultSets, reportLabel);

  return {
    generatedAtUtc: response.executedAtUtc,
    period,
    from: dateRange.from,
    to: dateRange.to,
    buckets: buildWhoSawUsBuckets(resultSet),
    storeDelivery,
  };
}
