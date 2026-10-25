import {
  automationInstallationActorIdsSqlLines,
  excludedAdminActorIdsSqlLines,
  excludedTestEmailActorIdsSqlLines,
  sandboxBillingActorIdsSqlLines,
  testDistributionInstallationActorIdsSqlLines,
} from "../../../../backend/src/reviewMetricsSql";
import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildHashedVisitorDaySql } from "../funnels/funnelAudienceSql";
import {
  buildReportBucketColumnsSql,
  buildReportBucketSql,
  buildReportBucketsCteSql,
  parseReportBucket,
  type ReportBucket,
  type ReportPeriod,
} from "../levelOneMetrics/reportPeriod";
import { assertValidDateRange, parseActivityCount, parseActivityDate } from "../reportValues";
import { buildIdentifiedVisitorDaySql, buildSiteVisitorDaysCtesSql } from "./engagedVisitorsQuery";
import { buildHashedSiteViewRowsSql, buildIdentifiedSiteViewRowsSql } from "./siteFactSql";

const reportLabel = "Engaged vs all web traffic report";

// In stack order, bottom first, which is also the order a visitor is tested in.
export const webTrafficCategoryKeys = ["engaged", "not-engaged", "own-and-test", "bots"] as const;

export type WebTrafficCategoryKey = (typeof webTrafficCategoryKeys)[number];

export type WebTrafficCategoriesBucket = Readonly<{
  bucket: ReportBucket;
  /** NULL exactly where the bucket has no site visitor at all. */
  visitorsByCategory: Readonly<Record<WebTrafficCategoryKey, number>> | null;
}>;

export type WebTrafficCategoriesReport = Readonly<{
  generatedAtUtc: string;
  period: ReportPeriod;
  today: string;
  /** Every bucket of the range, oldest first. */
  buckets: ReadonlyArray<WebTrafficCategoriesBucket>;
}>;

const manualListedActorIdsSqlLines: ReadonlyArray<string> = [
  "SELECT excluded_actors.actor_id",
  "FROM analytics.excluded_actors AS excluded_actors",
  "WHERE excluded_actors.source = 'manual'",
  "  AND excluded_actors.restored_at IS NULL",
];

/** The arms of the shared actor exclusion rule that name our own and test people rather than bots. */
const ownAndTestActorIdArms: ReadonlyArray<ReadonlyArray<string>> = [
  excludedTestEmailActorIdsSqlLines,
  excludedAdminActorIdsSqlLines,
  automationInstallationActorIdsSqlLines,
  testDistributionInstallationActorIdsSqlLines,
  sandboxBillingActorIdsSqlLines,
  manualListedActorIdsSqlLines,
];

/**
 * One row per bucket of the range: every site visitor with a page view, keyed as the `web` series
 * keys them but before any cleanup, each in exactly one category.
 *
 * The series' own `buildSiteVisitorDaysCtesSql` decides the first two, so `engaged` is the series'
 * bar: a visitor-day the series keeps is `engaged` or `not-engaged` by its `is_engaged`, an
 * identified visitor engaged on any day of the bucket. Every visitor-day it drops is a dropped
 * visitor: an identified actor the shared exclusion rule drops is `own-and-test` in one of
 * `ownAndTestActorIdArms`, otherwise `bots`, and a cookieless visitor-day is `bots`, since only its
 * automated rows or a scraper-fleet hash can drop it.
 */
export function buildWebTrafficCategoriesSql(dateRange: AnalyticsDateRange, period: ReportPeriod): string {
  const range = assertValidDateRange(dateRange, reportLabel);
  const identifiedBucketSql = buildReportBucketSql(period, "all_identified.visit_date");
  const hashedBucketSql = buildReportBucketSql(period, "all_hashed.visit_date");
  const identifiedDaySql = buildIdentifiedVisitorDaySql("site_view");
  const hashedDaySql = buildHashedVisitorDaySql("hashed_view");

  return [
    `WITH ${buildReportBucketsCteSql(period, range)}, ${buildSiteVisitorDaysCtesSql(range)}, own_and_test_actors(actor_id) AS (`,
    ownAndTestActorIdArms.map((arm) => arm.map((line) => `  ${line}`).join("\n")).join("\n  UNION ALL\n"),
    "), all_identified_visitor_days AS (",
    `  SELECT DISTINCT site_view.actor_id, ${identifiedDaySql} AS visit_date`,
    "  FROM analytics.product_events_resolved AS site_view",
    `  WHERE ${buildIdentifiedSiteViewRowsSql("site_view", range)}`,
    "), all_hashed_visitor_days AS (",
    `  SELECT DISTINCT hashed_view.daily_visitor_hash, ${hashedDaySql} AS visit_date`,
    "  FROM analytics.product_events_resolved AS hashed_view",
    `  WHERE ${buildHashedSiteViewRowsSql("hashed_view", range)}`,
    "), categorized_visitors AS (",
    "  SELECT",
    `    ${identifiedBucketSql} AS bucket_date,`,
    "    CASE",
    "      WHEN bool_or(identified.is_engaged) THEN 'engaged'",
    "      WHEN bool_or(identified.actor_id IS NOT NULL) THEN 'not-engaged'",
    "      WHEN all_identified.actor_id::text IN (SELECT own_and_test_actors.actor_id FROM own_and_test_actors) THEN 'own-and-test'",
    "      ELSE 'bots'",
    "    END AS category",
    "  FROM all_identified_visitor_days AS all_identified",
    "  LEFT JOIN identified_visitor_days AS identified",
    "    ON identified.actor_id = all_identified.actor_id AND identified.visit_date = all_identified.visit_date",
    `  GROUP BY ${identifiedBucketSql}, all_identified.actor_id`,
    "  UNION ALL",
    "  SELECT",
    `    ${hashedBucketSql} AS bucket_date,`,
    "    CASE",
    "      WHEN hashed.is_engaged THEN 'engaged'",
    "      WHEN hashed.daily_visitor_hash IS NOT NULL THEN 'not-engaged'",
    "      ELSE 'bots'",
    "    END AS category",
    "  FROM all_hashed_visitor_days AS all_hashed",
    "  LEFT JOIN hashed_visitor_days AS hashed",
    "    ON hashed.daily_visitor_hash = all_hashed.daily_visitor_hash AND hashed.visit_date = all_hashed.visit_date",
    "), category_buckets AS (",
    "  SELECT",
    "    categorized_visitors.bucket_date,",
    "    COUNT(*) FILTER (WHERE categorized_visitors.category = 'engaged') AS engaged_visitors,",
    "    COUNT(*) FILTER (WHERE categorized_visitors.category = 'not-engaged') AS not_engaged_visitors,",
    "    COUNT(*) FILTER (WHERE categorized_visitors.category = 'own-and-test') AS own_and_test_visitors,",
    "    COUNT(*) FILTER (WHERE categorized_visitors.category = 'bots') AS bot_visitors",
    "  FROM categorized_visitors",
    "  GROUP BY categorized_visitors.bucket_date",
    ")",
    "SELECT",
    `  ${buildReportBucketColumnsSql("buckets")},`,
    "  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,",
    "  categories.engaged_visitors,",
    "  categories.not_engaged_visitors,",
    "  categories.own_and_test_visitors,",
    "  categories.bot_visitors",
    "FROM report_buckets AS buckets",
    "LEFT JOIN category_buckets AS categories ON categories.bucket_date = buckets.bucket_date",
    "ORDER BY buckets.bucket_date",
  ].join("\n");
}

function parseWebTrafficCategoriesBucket(row: AdminQueryRow): WebTrafficCategoriesBucket {
  const bucket = parseReportBucket(row, reportLabel);
  const engaged = parseActivityCount(row.engaged_visitors ?? null, reportLabel, "engaged_visitors");
  const notEngaged = parseActivityCount(row.not_engaged_visitors ?? null, reportLabel, "not_engaged_visitors");
  const ownAndTest = parseActivityCount(row.own_and_test_visitors ?? null, reportLabel, "own_and_test_visitors");
  const bots = parseActivityCount(row.bot_visitors ?? null, reportLabel, "bot_visitors");
  if (engaged === null && notEngaged === null && ownAndTest === null && bots === null) {
    return { bucket, visitorsByCategory: null };
  }
  if (engaged === null || notEngaged === null || ownAndTest === null || bots === null) {
    throw new Error(`${reportLabel} must count every category or none in bucket ${bucket.key}.`);
  }

  return {
    bucket,
    visitorsByCategory: { engaged, "not-engaged": notEngaged, "own-and-test": ownAndTest, bots },
  };
}

export async function loadWebTrafficCategoriesReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  signal: AbortSignal,
): Promise<WebTrafficCategoriesReport> {
  const response = await runAdminQuery(config, buildWebTrafficCategoriesSql(dateRange, period), signal);
  const resultSet = response.resultSets[0];
  const firstRow = resultSet?.rows[0];
  if (response.resultSets.length !== 1 || resultSet === undefined || firstRow === undefined) {
    throw new Error(`${reportLabel} must return one result set with at least one bucket.`);
  }

  return {
    generatedAtUtc: response.executedAtUtc,
    period,
    today: parseActivityDate(firstRow.today ?? null, reportLabel, "today"),
    buckets: resultSet.rows.map(parseWebTrafficCategoriesBucket),
  };
}
