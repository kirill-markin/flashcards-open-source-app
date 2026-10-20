import { runAdminQuery } from "../../adminApi";
import { breakdownOtherValue } from "../../charts/stackedBreakdownChart";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildHashedVisitorDaySql } from "../funnels/funnelAudienceSql";
import { buildBreakdownValueSql } from "../levelOneMetrics/breakdownQuery";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { assertIsString, assertValidDateRange, toInteger } from "../reportValues";
import {
  buildSiteCountrySql,
  buildSiteEngagedVisitorKeysCtesSql,
  buildSiteFirstViewsCtesSql,
  buildSitePageKindSql,
} from "./breakdownQuery";

export type EngagedShareDimension = "country" | "landing-page-type";

export const engagedShareKeptValueCount = 15;

export type EngagedShareRow = Readonly<{
  value: string;
  webVisitors: number;
  engagedVisitors: number;
}>;

export type EngagedShareTable = Readonly<{
  generatedAtUtc: string;
  /** The top values by Web visitors, most first, then Other when any value is left over. */
  rows: ReadonlyArray<EngagedShareRow>;
  total: Readonly<{ webVisitors: number; engagedVisitors: number }>;
}>;

function buildDimensionValueSql(dimension: EngagedShareDimension, rowAlias: string): string {
  switch (dimension) {
    case "country":
      return buildSiteCountrySql(rowAlias);
    case "landing-page-type":
      return buildSitePageKindSql(rowAlias);
  }
}

/**
 * Per value, the visitors of the `web` series' breakdown by `dimension` and of its engaged breakdown,
 * each summed over the selection's bars. One pass: every first view is marked with whether its
 * visitor is engaged in that bar, which picks the same first view the engaged breakdown reads.
 */
function buildEngagedShareTableSql(dimension: EngagedShareDimension, range: AnalyticsDateRange, period: ReportPeriod): string {
  const columnsSqlOf = (rowAlias: string): string => `${buildBreakdownValueSql(buildDimensionValueSql(dimension, rowAlias))} AS dimension_value,
    ${rowAlias}.actor_id,
    ${rowAlias}.daily_visitor_hash,
    ${buildHashedVisitorDaySql(rowAlias)} AS visit_date`;
  return `WITH ${buildSiteEngagedVisitorKeysCtesSql(range, period)}, ${buildSiteFirstViewsCtesSql(columnsSqlOf, range, period, "all")}, share_views AS (
  SELECT dimension_value,
    (bucket_date, actor_id) IN (SELECT bucket_date, actor_id FROM engaged_identified_visitors) AS is_engaged
  FROM identified_first_views
  UNION ALL
  SELECT dimension_value,
    (daily_visitor_hash, visit_date) IN (SELECT daily_visitor_hash, visit_date FROM engaged_hashed_visitors) AS is_engaged
  FROM hashed_first_views
)
SELECT dimension_value,
  COUNT(*) AS web_visitors,
  COUNT(*) FILTER (WHERE is_engaged) AS engaged_visitors
FROM share_views
GROUP BY dimension_value
ORDER BY COUNT(*) DESC, dimension_value`;
}

function sumEngagedShareRows(rows: ReadonlyArray<EngagedShareRow>): Readonly<{ webVisitors: number; engagedVisitors: number }> {
  return rows.reduce(
    (totals, row) => ({ webVisitors: totals.webVisitors + row.webVisitors, engagedVisitors: totals.engagedVisitors + row.engagedVisitors }),
    { webVisitors: 0, engagedVisitors: 0 },
  );
}

/** Rows ranked by Web visitors: the top values keep their own row, every other value folds into Other. */
function foldEngagedShareRows(rankedRows: ReadonlyArray<EngagedShareRow>): ReadonlyArray<EngagedShareRow> {
  const otherRows = rankedRows.slice(engagedShareKeptValueCount);
  const keptRows = rankedRows.slice(0, engagedShareKeptValueCount);
  return otherRows.length === 0 ? keptRows : [...keptRows, { value: breakdownOtherValue, ...sumEngagedShareRows(otherRows) }];
}

export async function loadEngagedShareTable(
  config: AdminAppConfig,
  dimension: EngagedShareDimension,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  reportLabel: string,
): Promise<EngagedShareTable> {
  const range = assertValidDateRange(dateRange, reportLabel);
  const response = await runAdminQuery(config, buildEngagedShareTableSql(dimension, range, period));
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  const rankedRows = result.rows.map((row): EngagedShareRow => {
    const value = assertIsString(row.dimension_value ?? null, reportLabel, "dimension_value");
    const webVisitors = toInteger(row.web_visitors ?? null, reportLabel, "web_visitors");
    const engagedVisitors = toInteger(row.engaged_visitors ?? null, reportLabel, "engaged_visitors");
    if (engagedVisitors > webVisitors) {
      throw new Error(`${reportLabel} counts more engaged than Web visitors for ${value}: ${engagedVisitors} > ${webVisitors}.`);
    }
    return { value, webVisitors, engagedVisitors };
  });

  return {
    generatedAtUtc: response.executedAtUtc,
    rows: foldEngagedShareRows(rankedRows),
    total: sumEngagedShareRows(rankedRows),
  };
}
