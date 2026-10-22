import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { buildActorConnectionCountrySql } from "../../filters/filterSql";
import { buildBreakdownSql, buildBreakdownValueSql } from "./breakdownQuery";

export const peopleBreakdownDimensions = ["platform", "country", "app-ui-language", "sign-in-state", "app-version"] as const;

export type PeopleBreakdownDimension = (typeof peopleBreakdownDimensions)[number];

/** Where a breakdown of a unique-people chart places each person counted in a bar. */
export type PeopleBreakdownSource = Readonly<{
  /** Every CTE the statement reads, `report_buckets` and `placementsCte` among them. */
  ctesSql: string;
  /**
   * One row per bucket and person the chart counts in it: `bucket_date`, `actor_id`, and the
   * `platform`, `ui_locale`, `trust_level` and `app_version` the person counts under, NULL or empty
   * when unknown.
   */
  placementsCte: string;
  /** The chart's coverage CTE, whose `history_from` is its first retained day. */
  coverageCte: string;
}>;

/**
 * The dimension's value over `placement`, a row of the source's `placementsCte`. Country is the
 * exception: product events carry no country, so it is the one country
 * `buildActorConnectionCountrySql` places the person in over the whole range.
 */
function buildDimensionSql(
  dimension: PeopleBreakdownDimension,
  range: AnalyticsDateRange,
): Readonly<{ valueSql: string; joinSql: string }> {
  switch (dimension) {
    case "platform":
      return { valueSql: "placement.platform", joinSql: "" };
    case "country":
      return {
        valueSql: "actor_country.country",
        joinSql: `LEFT JOIN (
${buildActorConnectionCountrySql(range, null)}
  ) AS actor_country ON actor_country.actor_id::text = placement.actor_id`,
      };
    case "app-ui-language":
      return { valueSql: "placement.ui_locale", joinSql: "" };
    case "sign-in-state":
      return {
        valueSql: `CASE placement.trust_level WHEN 'guest_client' THEN 'Guest'
      WHEN 'authenticated_client' THEN 'Signed in' ELSE placement.trust_level END`,
        joinSql: "",
      };
    case "app-version":
      return { valueSql: "placement.app_version", joinSql: "" };
  }
}

// The people of each bar of the chart, each under one value, so a measured bar sums to that chart's
// new plus returning bar. `range` must already be validated.
export function buildPeopleBreakdownSql(
  source: PeopleBreakdownSource,
  dimension: PeopleBreakdownDimension,
  range: AnalyticsDateRange,
): string {
  const dimensionSql = buildDimensionSql(dimension, range);
  return buildBreakdownSql(`${source.ctesSql}, measured_buckets AS (
  SELECT buckets.bucket_date
  FROM report_buckets AS buckets
  CROSS JOIN ${source.coverageCte} AS coverage
  WHERE buckets.selected_from >= coverage.history_from
), measured_values AS (
  SELECT placement.bucket_date,
    ${buildBreakdownValueSql(dimensionSql.valueSql)} AS dimension_value,
    1 AS value_count
  FROM ${source.placementsCte} AS placement
  JOIN measured_buckets USING (bucket_date)
  ${dimensionSql.joinSql}
)`);
}
