import { runAdminQuery, type AdminQueryResultSet, type AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange, AppStoreProductPageFilterState } from "../../filters/analyticsFilters";
import { buildAppStoreProductPageFilterSqlLines } from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertIsString, assertValidDateRange, parseActivityCount, parseActivityDate } from "../reportValues";
import { ourAppleAppIdentifier } from "../whoSawUs/query";

const reportLabel = "App Store product pages report";
const listingsReportLabel = "App Store listings";

/** The Group by options of the page: Apple publishes detailed rows per week and per month. */
export const appStoreProductPagePeriods = ["week", "month"] as const satisfies ReadonlyArray<ReportPeriod>;

export type AppStoreProductPagePeriod = (typeof appStoreProductPagePeriods)[number];

const appleGranularitiesByPeriod: Readonly<Record<AppStoreProductPagePeriod, string>> = {
  week: "WEEKLY",
  month: "MONTHLY",
};

/** Apple's `page_title` of the default listing, as stored. */
export const defaultAppStoreListing = "Default product page";

/** The Level 1 period as this page shows it: one it does not offer, Days, shows as Weeks. */
export function getShownAppStoreProductPagePeriod(period: ReportPeriod): AppStoreProductPagePeriod {
  return appStoreProductPagePeriods.find((candidate) => candidate === period) ?? appStoreProductPagePeriods[0];
}

/**
 * A weekly or monthly Apple row whose whole period lies inside the range, as `AND` lines: it starts on
 * or after the range start and its last day is on or before the range end.
 */
function buildWholePeriodRowSqlLines(
  rowAlias: string,
  period: AppStoreProductPagePeriod,
  range: AnalyticsDateRange,
): ReadonlyArray<string> {
  return [
    `${rowAlias}.report_date >= ${escapeSqlStringLiteral(range.from)}::date`,
    `(${rowAlias}.report_date + INTERVAL '1 ${period}')::date - 1 <= ${escapeSqlStringLiteral(range.to)}::date`,
  ];
}

/**
 * Our app's detailed product page rows of one granularity whose whole period lies inside the range,
 * as `AND` lines, in `apple_discovery_engagement` and `apple_downloads` alike. Every detailed count
 * of the Product pages page and its filter options read this scope with the page view or first-time
 * download lines below, so an option is always a value the page can count.
 */
export function buildAppleDetailedProductPageRowSqlLines(
  rowAlias: string,
  period: AppStoreProductPagePeriod,
  range: AnalyticsDateRange,
): ReadonlyArray<string> {
  return [
    `${rowAlias}.app_apple_identifier = ${escapeSqlStringLiteral(ourAppleAppIdentifier)}`,
    `${rowAlias}.detail_level = 'detailed'`,
    `${rowAlias}.granularity = '${appleGranularitiesByPeriod[period]}'`,
    `pg_catalog.lower(${rowAlias}.page_type) = 'product page'`,
    ...buildWholePeriodRowSqlLines(rowAlias, period, range),
  ];
}

// Apple's values are matched case-insensitively, as `buildAppleProductPageViewRowSqlLines` does.
export function buildPageViewRowSqlLines(rowAlias: string): ReadonlyArray<string> {
  return [
    `pg_catalog.lower(${rowAlias}.event) = 'page view'`,
    `${rowAlias}.unique_counts IS NOT NULL`,
  ];
}

export function buildFirstTimeDownloadRowSqlLines(rowAlias: string): ReadonlyArray<string> {
  return [
    `pg_catalog.lower(${rowAlias}.download_type) = 'first-time download'`,
    `${rowAlias}.counts IS NOT NULL`,
  ];
}

function joinAndLines(lines: ReadonlyArray<string>): string {
  return lines.join("\n    AND ");
}

/**
 * The table's newest detailed report_date of the granularity for our app, over every listing, page
 * type and segment, so a filter or a listing never makes a delivered period read as undelivered.
 */
function buildNewestDetailedReportDateSql(
  rowAlias: string,
  tableSqlName: "apple_discovery_engagement" | "apple_downloads",
  period: AppStoreProductPagePeriod,
): string {
  return [
    `(SELECT MAX(${rowAlias}.report_date) FROM store_analytics.${tableSqlName} AS ${rowAlias}`,
    `WHERE ${rowAlias}.app_apple_identifier = ${escapeSqlStringLiteral(ourAppleAppIdentifier)}`,
    `AND ${rowAlias}.detail_level = 'detailed'`,
    `AND ${rowAlias}.granularity = '${appleGranularitiesByPeriod[period]}')`,
  ].join(" ");
}

/** One whole week or month of the range, and Apple's numbers for it; NULL is a number Apple did not publish. */
export type AppStoreProductPagePeriodRow = Readonly<{
  start: string;
  end: string;
  /** Unique product page views of the selected listing in the detailed rows. */
  listingViews: number | null;
  /** First-time downloads Apple attributes to the selected listing in the detailed rows. */
  listingDownloads: number | null;
  /** The same two over every listing's detailed rows, the numerators of the coverage. */
  detailedViews: number | null;
  detailedDownloads: number | null;
  /** Apple's standard product page totals, which carry no listing, the denominators of the coverage. */
  standardViews: number | null;
  standardDownloads: number | null;
  /**
   * Whether Apple has delivered this period's detailed rows of the granularity in the engagement and
   * downloads tables: the period starts on or before the table's newest detailed report_date of any
   * listing or segment. A missing detailed value of a delivered period is Apple's suppression below 5.
   */
  viewsDelivered: boolean;
  downloadsDelivered: boolean;
}>;

export type AppStoreProductPagesReport = Readonly<{
  generatedAtUtc: string;
  period: AppStoreProductPagePeriod;
  listing: string;
  /** Every whole period of the range, oldest first; empty when the range holds none. */
  periods: ReadonlyArray<AppStoreProductPagePeriodRow>;
}>;

/**
 * One row per whole week or month of the range, with the selected listing's unique product page
 * views and first-time downloads from Apple's detailed rows of that granularity, as Apple published
 * them rather than re-summed from daily rows, and the coverage of those detailed rows against Apple's
 * standard totals under the same territory, device and source filters. Standard downloads exist only
 * daily, so their total sums the period's days, and a period can hold them before Apple delivers its
 * detailed rows, hence the delivery flags. Each table is aggregated by period on its own, then
 * joined onto the generated periods, so a period without a row is NULL rather than 0.
 */
export function buildAppStoreProductPagesSql(
  dateRange: AnalyticsDateRange,
  period: AppStoreProductPagePeriod,
  listing: string,
  filters: AppStoreProductPageFilterState,
): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const fromSql = `${escapeSqlStringLiteral(range.from)}::date`;
  const toSql = `${escapeSqlStringLiteral(range.to)}::date`;
  const intervalSql = `INTERVAL '1 ${period}'`;
  const listingSql = escapeSqlStringLiteral(listing);

  return [
    "WITH periods AS (",
    `  SELECT period_start::date AS period_start, (period_start + ${intervalSql})::date - 1 AS period_end`,
    "  FROM generate_series(",
    // The first period starting on or after the range start, through the last one ending on or before its end.
    `    date_trunc('${period}', (${fromSql} - 1)::timestamp) + ${intervalSql},`,
    `    date_trunc('${period}', (${toSql} + 1)::timestamp) - ${intervalSql},`,
    `    ${intervalSql}`,
    "  ) AS period_start",
    "), detailed_views AS (",
    "  SELECT",
    "    engagement.report_date AS period_start,",
    `    ROUND(SUM(engagement.unique_counts) FILTER (WHERE engagement.page_title = ${listingSql}))::bigint AS listing_count,`,
    "    ROUND(SUM(engagement.unique_counts))::bigint AS all_listings_count",
    "  FROM store_analytics.apple_discovery_engagement AS engagement",
    `  WHERE ${joinAndLines([
      ...buildAppleDetailedProductPageRowSqlLines("engagement", period, range),
      ...buildPageViewRowSqlLines("engagement"),
      ...buildAppStoreProductPageFilterSqlLines("engagement", filters),
    ])}`,
    "  GROUP BY engagement.report_date",
    "), detailed_downloads AS (",
    "  SELECT",
    "    downloads.report_date AS period_start,",
    `    ROUND(SUM(downloads.counts) FILTER (WHERE downloads.page_title = ${listingSql}))::bigint AS listing_count,`,
    "    ROUND(SUM(downloads.counts))::bigint AS all_listings_count",
    "  FROM store_analytics.apple_downloads AS downloads",
    `  WHERE ${joinAndLines([
      ...buildAppleDetailedProductPageRowSqlLines("downloads", period, range),
      ...buildFirstTimeDownloadRowSqlLines("downloads"),
      ...buildAppStoreProductPageFilterSqlLines("downloads", filters),
    ])}`,
    "  GROUP BY downloads.report_date",
    "), standard_views AS (",
    "  SELECT engagement.report_date AS period_start, ROUND(SUM(engagement.unique_counts))::bigint AS standard_count",
    "  FROM store_analytics.apple_discovery_engagement AS engagement",
    `  WHERE ${joinAndLines([
      `engagement.app_apple_identifier = ${escapeSqlStringLiteral(ourAppleAppIdentifier)}`,
      "engagement.detail_level = 'standard'",
      `engagement.granularity = '${appleGranularitiesByPeriod[period]}'`,
      "pg_catalog.lower(engagement.page_type) = 'product page'",
      ...buildWholePeriodRowSqlLines("engagement", period, range),
      ...buildPageViewRowSqlLines("engagement"),
      ...buildAppStoreProductPageFilterSqlLines("engagement", filters),
    ])}`,
    "  GROUP BY engagement.report_date",
    "), standard_downloads AS (",
    "  SELECT periods.period_start, ROUND(SUM(downloads.counts))::bigint AS standard_count",
    "  FROM periods",
    "  JOIN store_analytics.apple_downloads AS downloads",
    "    ON downloads.report_date BETWEEN periods.period_start AND periods.period_end",
    `  WHERE ${joinAndLines([
      `downloads.app_apple_identifier = ${escapeSqlStringLiteral(ourAppleAppIdentifier)}`,
      "downloads.detail_level = 'standard'",
      "downloads.granularity = 'DAILY'",
      "pg_catalog.lower(downloads.page_type) = 'product page'",
      ...buildFirstTimeDownloadRowSqlLines("downloads"),
      ...buildAppStoreProductPageFilterSqlLines("downloads", filters),
    ])}`,
    "  GROUP BY periods.period_start",
    "), detailed_delivery AS (",
    "  SELECT",
    `    ${buildNewestDetailedReportDateSql("engagement", "apple_discovery_engagement", period)} AS newest_views_date,`,
    `    ${buildNewestDetailedReportDateSql("downloads", "apple_downloads", period)} AS newest_downloads_date`,
    ")",
    "SELECT",
    "  to_char(periods.period_start, 'YYYY-MM-DD') AS period_start,",
    "  to_char(periods.period_end, 'YYYY-MM-DD') AS period_end,",
    "  detailed_views.listing_count AS listing_views,",
    "  detailed_downloads.listing_count AS listing_downloads,",
    "  detailed_views.all_listings_count AS detailed_views,",
    "  detailed_downloads.all_listings_count AS detailed_downloads,",
    "  standard_views.standard_count AS standard_views,",
    "  standard_downloads.standard_count AS standard_downloads,",
    "  COALESCE(periods.period_start <= detailed_delivery.newest_views_date, false) AS views_delivered,",
    "  COALESCE(periods.period_start <= detailed_delivery.newest_downloads_date, false) AS downloads_delivered",
    "FROM periods",
    "CROSS JOIN detailed_delivery",
    "LEFT JOIN detailed_views ON detailed_views.period_start = periods.period_start",
    "LEFT JOIN detailed_downloads ON detailed_downloads.period_start = periods.period_start",
    "LEFT JOIN standard_views ON standard_views.period_start = periods.period_start",
    "LEFT JOIN standard_downloads ON standard_downloads.period_start = periods.period_start",
    "ORDER BY periods.period_start",
  ].join("\n");
}

function parseBoolean(row: AdminQueryRow, field: string): boolean {
  const value = row[field] ?? null;
  if (typeof value !== "boolean") throw new Error(`${reportLabel} field "${field}" must be a boolean.`);
  return value;
}

function getSingleResultSet(resultSets: ReadonlyArray<AdminQueryResultSet>, queryLabel: string): AdminQueryResultSet {
  const resultSet = resultSets[0];
  if (resultSets.length !== 1 || resultSet === undefined) {
    throw new Error(`${queryLabel} must return exactly one result set. Got ${resultSets.length}.`);
  }

  return resultSet;
}

export async function loadAppStoreProductPagesReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: AppStoreProductPagePeriod,
  listing: string,
  filters: AppStoreProductPageFilterState,
  signal: AbortSignal,
): Promise<AppStoreProductPagesReport> {
  const response = await runAdminQuery(config, buildAppStoreProductPagesSql(dateRange, period, listing, filters), signal);
  const resultSet = getSingleResultSet(response.resultSets, reportLabel);

  return {
    generatedAtUtc: response.executedAtUtc,
    period,
    listing,
    periods: resultSet.rows.map((row) => ({
      start: parseActivityDate(row.period_start ?? null, reportLabel, "period_start"),
      end: parseActivityDate(row.period_end ?? null, reportLabel, "period_end"),
      listingViews: parseActivityCount(row.listing_views ?? null, reportLabel, "listing_views"),
      listingDownloads: parseActivityCount(row.listing_downloads ?? null, reportLabel, "listing_downloads"),
      detailedViews: parseActivityCount(row.detailed_views ?? null, reportLabel, "detailed_views"),
      detailedDownloads: parseActivityCount(row.detailed_downloads ?? null, reportLabel, "detailed_downloads"),
      standardViews: parseActivityCount(row.standard_views ?? null, reportLabel, "standard_views"),
      standardDownloads: parseActivityCount(row.standard_downloads ?? null, reportLabel, "standard_downloads"),
      viewsDelivered: parseBoolean(row, "views_delivered"),
      downloadsDelivered: parseBoolean(row, "downloads_delivered"),
    })),
  };
}

/**
 * Every listing title Apple put on our app's detailed product page rows of either table, over all
 * retained history, the default listing first. A Custom Product Page appears once Apple reports it.
 */
export function buildAppStoreListingsSql(): string {
  const buildTitlesSql = (rowAlias: string, tableSqlName: string): string => [
    `  SELECT ${rowAlias}.page_title`,
    `  FROM store_analytics.${tableSqlName} AS ${rowAlias}`,
    `  WHERE ${[
      `${rowAlias}.app_apple_identifier = ${escapeSqlStringLiteral(ourAppleAppIdentifier)}`,
      `${rowAlias}.detail_level = 'detailed'`,
      `pg_catalog.lower(${rowAlias}.page_type) = 'product page'`,
      `${rowAlias}.page_title IS NOT NULL`,
    ].join("\n    AND ")}`,
  ].join("\n");

  return [
    "SELECT listings.page_title",
    "FROM (",
    buildTitlesSql("engagement", "apple_discovery_engagement"),
    "  UNION",
    buildTitlesSql("downloads", "apple_downloads"),
    ") AS listings",
    `ORDER BY listings.page_title = ${escapeSqlStringLiteral(defaultAppStoreListing)} DESC, listings.page_title`,
  ].join("\n");
}

export async function loadAppStoreListings(config: AdminAppConfig, signal: AbortSignal): Promise<ReadonlyArray<string>> {
  const response = await runAdminQuery(config, buildAppStoreListingsSql(), signal);
  const resultSet = getSingleResultSet(response.resultSets, listingsReportLabel);
  return resultSet.rows.map((row) => assertIsString(row.page_title ?? null, listingsReportLabel, "page_title"));
}
