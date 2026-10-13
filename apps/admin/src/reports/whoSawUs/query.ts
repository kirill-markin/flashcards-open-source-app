import { runAdminQuery, type AdminQueryResultSet, type AdminQueryValue } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildExcludedActorSqlLines } from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import {
  buildHashedSiteRowSqlLines,
  buildHashedVisitorDayRangeSqlLines,
  buildHashedVisitorDaySql,
} from "../funnels/funnelAudienceSql";
import {
  assertIsString,
  assertValidDateRange,
  buildRequestedDateRange,
  toInteger,
} from "../reportValues";
import { buildSiteFactSql } from "../siteEntryFunnel/query";

const reportLabel = "Who saw us report";

// Our app in each store's reports. Store accounts can hold other apps, and the Play reports bucket
// belongs to the whole developer account, so every store read pins one of these.
const ourAppleAppIdentifier = "6760538964";
const ourPlayPackageName = "com.flashcardsopensourceapp.app";

// In stack order, bottom first. Two more series are planned and not built yet: MCP OpenAI and MCP
// Anthropic, the daily connected ChatGPT and Claude MCP clients.
export const whoSawUsSeriesKeys = ["web", "app-store", "google-play"] as const;

export type WhoSawUsSeriesKey = (typeof whoSawUsSeriesKeys)[number];

export type WhoSawUsDay = Readonly<{
  date: string;
  /** NULL where the source has no row for the day, which is absence rather than a reported zero. */
  visitorsBySeries: Readonly<Record<WhoSawUsSeriesKey, number | null>>;
}>;

export type WhoSawUsReport = Readonly<{
  generatedAtUtc: string;
  from: string;
  to: string;
  /** Every day of the range, oldest first. */
  days: ReadonlyArray<WhoSawUsDay>;
}>;

function assertSeriesKey(value: AdminQueryValue, fieldName: string): WhoSawUsSeriesKey {
  const seriesKey = assertIsString(value, reportLabel, fieldName);
  const knownSeriesKey = whoSawUsSeriesKeys.find((candidate) => candidate === seriesKey);
  if (knownSeriesKey === undefined) {
    throw new Error(`${reportLabel} field "${fieldName}" must be a known series. Got "${seriesKey}".`);
  }

  return knownSeriesKey;
}

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
function buildAppleProductPageViewRowSqlLines(
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

export async function loadWhoSawUsAvailableRange(config: AdminAppConfig): Promise<AnalyticsDateRange> {
  const response = await runAdminQuery(config, buildWhoSawUsAvailableRangeSql());
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
 * One row per series and day that has data, each an approximate count of unique visitors.
 *
 * `web` is the marketing site: distinct identified visitors per UTC day of `occurred_at`, through the
 * shared actor exclusion rule, which also drops every actor with an automated collector row, plus
 * distinct cookieless visitors per UTC day of the hash's salt, keyed as the funnels key them in
 * `../funnels/funnelAudienceSql.ts`. The two cohorts can hold one human on the same day, before and
 * after consent, and are added anyway.
 *
 * `app-store` is our app's product page views of the Discovery and Engagement report, by unique count, plus
 * the browser views of the apps.apple.com page from the Web Preview report, which has no unique
 * count. `google-play` is our package's store listing visitors of the per-country performance file. Both are
 * sums over the store's breakdown rows, so a visitor seen in two of them counts twice. Apple's value
 * strings are matched case-insensitively because no imported file has confirmed their exact case.
 */
export function buildWhoSawUsSql(dateRange: AnalyticsDateRange): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const fromSql = `${escapeSqlStringLiteral(range.from)}::date`;
  const toSql = `${escapeSqlStringLiteral(range.to)}::date`;
  const hashedVisitorDaySql = buildHashedVisitorDaySql("hashed_view");

  return [
    "WITH identified_site_visitors AS (",
    "  SELECT",
    "    (site_view.occurred_at AT TIME ZONE 'UTC')::date AS visit_date,",
    "    COUNT(DISTINCT site_view.actor_id) AS visitor_count",
    "  FROM analytics.product_events_resolved AS site_view",
    `  WHERE ${buildSiteFactSql("site_view", "site_page_viewed")}`,
    "    AND site_view.anonymous_id IS NOT NULL",
    "    AND site_view.actor_id IS NOT NULL",
    // On the raw column, so the (event_name, occurred_at) index stays usable.
    `    AND site_view.occurred_at >= (${fromSql})::timestamp AT TIME ZONE 'UTC'`,
    `    AND site_view.occurred_at < (${toSql} + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    ...buildExcludedActorSqlLines("site_view.actor_id::text"),
    "  GROUP BY (site_view.occurred_at AT TIME ZONE 'UTC')::date",
    "), hashed_site_visitors AS (",
    "  SELECT",
    `    ${hashedVisitorDaySql} AS visit_date,`,
    "    COUNT(DISTINCT hashed_view.daily_visitor_hash) AS visitor_count",
    "  FROM analytics.product_events_resolved AS hashed_view",
    `  WHERE ${buildHashedSiteRowSqlLines("hashed_view", "site_page_viewed").join("\n    AND ")}`,
    `    AND ${buildHashedVisitorDayRangeSqlLines("hashed_view", range.from, range.to).join("\n    AND ")}`,
    `  GROUP BY ${hashedVisitorDaySql}`,
    "), site_visitors AS (",
    "  SELECT identified.visit_date, identified.visitor_count FROM identified_site_visitors AS identified",
    "  UNION ALL",
    "  SELECT hashed.visit_date, hashed.visitor_count FROM hashed_site_visitors AS hashed",
    "), apple_visitors AS (",
    "  SELECT engagement.report_date AS visit_date, engagement.unique_counts AS visitor_count",
    "  FROM store_analytics.apple_discovery_engagement AS engagement",
    `  WHERE ${buildAppleProductPageViewRowSqlLines("engagement", "unique_counts").join("\n    AND ")}`,
    `    AND engagement.report_date >= ${fromSql}`,
    `    AND engagement.report_date <= ${toSql}`,
    "  UNION ALL",
    "  SELECT preview.report_date AS visit_date, preview.counts AS visitor_count",
    "  FROM store_analytics.apple_web_preview_engagement AS preview",
    `  WHERE ${buildAppleProductPageViewRowSqlLines("preview", "counts").join("\n    AND ")}`,
    `    AND preview.report_date >= ${fromSql}`,
    `    AND preview.report_date <= ${toSql}`,
    "), play_visitors AS (",
    "  SELECT performance.report_date AS visit_date, performance.store_listing_visitors AS visitor_count",
    "  FROM store_analytics.play_store_performance_country AS performance",
    `  WHERE ${buildPlayListingVisitorRowSqlLines("performance").join("\n    AND ")}`,
    `    AND performance.report_date >= ${fromSql}`,
    `    AND performance.report_date <= ${toSql}`,
    ")",
    "SELECT",
    "  'web' AS series,",
    "  to_char(site_visitors.visit_date, 'YYYY-MM-DD') AS visit_date,",
    "  SUM(site_visitors.visitor_count)::bigint AS visitor_count",
    "FROM site_visitors",
    "GROUP BY site_visitors.visit_date",
    "UNION ALL",
    "SELECT",
    "  'app-store' AS series,",
    "  to_char(apple_visitors.visit_date, 'YYYY-MM-DD') AS visit_date,",
    "  ROUND(SUM(apple_visitors.visitor_count))::bigint AS visitor_count",
    "FROM apple_visitors",
    "GROUP BY apple_visitors.visit_date",
    "UNION ALL",
    "SELECT",
    "  'google-play' AS series,",
    "  to_char(play_visitors.visit_date, 'YYYY-MM-DD') AS visit_date,",
    "  ROUND(SUM(play_visitors.visitor_count))::bigint AS visitor_count",
    "FROM play_visitors",
    "GROUP BY play_visitors.visit_date",
    "ORDER BY series, visit_date",
  ].join("\n");
}

function buildWhoSawUsDays(
  resultSet: AdminQueryResultSet,
  dates: ReadonlyArray<string>,
): ReadonlyArray<WhoSawUsDay> {
  const visitorsBySeriesDate = new Map<string, number>();
  for (const row of resultSet.rows) {
    const seriesKey = assertSeriesKey(row.series ?? null, "series");
    const date = assertIsString(row.visit_date ?? null, reportLabel, "visit_date");
    visitorsBySeriesDate.set(
      `${seriesKey}:${date}`,
      toInteger(row.visitor_count ?? null, reportLabel, "visitor_count"),
    );
  }

  return dates.map((date) => ({
    date,
    visitorsBySeries: {
      web: visitorsBySeriesDate.get(`web:${date}`) ?? null,
      "app-store": visitorsBySeriesDate.get(`app-store:${date}`) ?? null,
      "google-play": visitorsBySeriesDate.get(`google-play:${date}`) ?? null,
    },
  }));
}

export async function loadWhoSawUsReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
): Promise<WhoSawUsReport> {
  const response = await runAdminQuery(config, buildWhoSawUsSql(dateRange));
  const resultSet = getSingleResultSet(response.resultSets, reportLabel);

  return {
    generatedAtUtc: response.executedAtUtc,
    from: dateRange.from,
    to: dateRange.to,
    days: buildWhoSawUsDays(resultSet, buildRequestedDateRange(dateRange.from, dateRange.to, reportLabel)),
  };
}
