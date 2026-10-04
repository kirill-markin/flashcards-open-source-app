import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
  buildExcludedActorSqlLines,
  buildTrustedActorRowsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { catalogInstallConversionWindowDays } from "../catalogInstallFunnel/query";
import { buildFunnelAudienceActorSqlLines } from "../funnels/funnelAudienceSql";
import {
  platformFunnelGroupByDimensionId,
  unresolvedFunnelGroupKey,
  type FunnelGroupByDimension,
} from "../funnels/funnelGroupBy";
import { assertIsString, assertValidDateRange, laterCalendarDate, toInteger } from "../reportValues";

export const paywallFunnelReportLabel = "Paywall funnel";

/**
 * The first UTC day paywall entries count from, whatever range is selected: 2026-10-04, the day the
 * event catalog began accepting `paywall_shown` and `purchase_started`. No client could report either
 * before it, so an earlier day would only ever show an empty funnel.
 */
export const paywallFunnelStartDate = "2026-10-04";

/** People per step, each step a subset of the one before it: one group's, or the funnel's own sum. */
export type PaywallFunnelCounts = Readonly<{
  paywallShownCount: number;
  purchaseStartedCount: number;
  convertedCount: number;
  /** Paywall entries whose seven-day window had not closed when the query ran. */
  maturingCount: number;
}>;

/**
 * One group's counts under the key the SQL produced: the dimension's own value,
 * `unresolvedFunnelGroupKey` for a person it cannot place, or `ungroupedPaywallGroupKey` while no
 * dimension is selected.
 */
export type PaywallFunnelGroup = PaywallFunnelCounts & Readonly<{ key: string }>;

/** One entry per group; a range nobody entered returns no groups at all rather than a row of zeros. */
export type PaywallFunnelReport = Readonly<{
  generatedAtUtc: string;
  groups: ReadonlyArray<PaywallFunnelGroup>;
}>;

/** The one key of the ungrouped funnel. Nothing reads it: with no dimension there is one group. */
const ungroupedPaywallGroupKey = "all";

/**
 * What this funnel offers in its `Group by` field, in picker order. Both keys are read off the
 * person's first `paywall_shown` in range, which is what the funnel is anchored on, so each person has
 * exactly one key and the groups sum back to the funnel. The billing facts carry no platform, so the
 * platform can only ever come from that row.
 */
export const paywallFunnelGroupByDimensions: ReadonlyArray<FunnelGroupByDimension> = [
  {
    id: platformFunnelGroupByDimensionId,
    label: "Platform",
    buildGroupKeySql: () => "cohort.platform",
  },
  {
    id: "entry-point",
    label: "Paywall entry point",
    buildGroupKeySql: () => "cohort.entry_point",
  },
];

/**
 * One row per person whose first trusted `paywall_shown` in the selected UTC days, from
 * `paywallFunnelStartDate` on, is on a selected platform, reduced in SQL to one row of step counts per
 * group that follow the funnel rule in `../funnels/funnelSections.ts`.
 *
 * Every later step is the same actor within seven days of that first paywall: a `purchase_started` at
 * or after it, then a `trial_started` or `purchase_completed` at or after that first start. The two
 * billing facts are the server's, keyed on the account rather than on a device, so a conversion the
 * store reports for any of the person's devices counts.
 *
 * ONE PASS OVER THE VIEW. `funnel_rows` reads the four event names over the range and its trailing
 * window with no cohort joined, and every later CTE reads only that small relation, so no step joins a
 * cohort to `analytics.product_events_resolved` by its computed `actor_id`.
 */
export function buildPaywallFunnelSql(
  filters: AnalyticsFilterState,
  groupByDimension: FunnelGroupByDimension | null,
): string {
  const { from: selectedFrom, to } = assertValidDateRange(filters.dateRange, paywallFunnelReportLabel);
  // A range ending before the start date leaves `from` after `to`, so nobody enters.
  const from = laterCalendarDate(selectedFrom, paywallFunnelStartDate);
  const rangeStartSql = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;
  const stepWindowEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`;
  const windowSql = `INTERVAL '${catalogInstallConversionWindowDays} days'`;
  const groupKeySql = groupByDimension === null
    ? `${escapeSqlStringLiteral(ungroupedPaywallGroupKey)}::text`
    : `COALESCE(${groupByDimension.buildGroupKeySql(filters)}, ${escapeSqlStringLiteral(unresolvedFunnelGroupKey)})::text`;

  return [
    "WITH funnel_rows AS MATERIALIZED (",
    "  SELECT",
    "    funnel_row.event_id,",
    "    funnel_row.actor_id,",
    "    funnel_row.event_name,",
    "    funnel_row.occurred_at,",
    "    funnel_row.platform,",
    "    funnel_row.event_properties ->> 'entry_point' AS entry_point",
    "  FROM analytics.product_events_resolved AS funnel_row",
    "  WHERE funnel_row.event_name IN ('paywall_shown', 'purchase_started', 'trial_started', 'purchase_completed')",
    "    AND funnel_row.actor_id IS NOT NULL",
    `    AND ${buildTrustedActorRowsFilterSql("funnel_row.trust_level")}`,
    `    AND funnel_row.occurred_at >= ${rangeStartSql}`,
    `    AND funnel_row.occurred_at < ${stepWindowEndSql}`,
    "), first_paywalls AS MATERIALIZED (",
    "  SELECT DISTINCT ON (shown.actor_id)",
    "    shown.actor_id,",
    "    shown.occurred_at AS shown_at,",
    "    shown.platform,",
    "    shown.entry_point",
    "  FROM funnel_rows AS shown",
    "  WHERE shown.event_name = 'paywall_shown'",
    `    AND shown.occurred_at < ${rangeEndSql}`,
    "  ORDER BY shown.actor_id, shown.occurred_at, shown.event_id",
    "), cohort AS MATERIALIZED (",
    "  SELECT candidate.actor_id, candidate.shown_at, candidate.platform, candidate.entry_point",
    "  FROM first_paywalls AS candidate",
    // A first paywall with no platform is `unattributed`, as on the deck funnel, so the default
    // selection keeps it and the platform `Group by` places it in `Unresolved`.
    `  WHERE ${buildEventPlatformsFilterSql("COALESCE(candidate.platform, 'unattributed')", filters.eventPlatforms)}`,
    ...buildExcludedActorSqlLines("candidate.actor_id::text"),
    // There are no cookieless people here - the daily visitor hash exists only on marketing-site
    // rows - so `all` counts exactly who the default counts and only `signed-in` adds a line.
    ...buildFunnelAudienceActorSqlLines(filters, "candidate.actor_id::text"),
    `    AND ${buildConnectionCountriesFilterSql("candidate.actor_id::text", filters.connectionCountries, filters.dateRange)}`,
    `    AND ${buildAppUiLanguagesFilterSql("candidate.actor_id::text", filters.appUiLanguages, filters.dateRange)}`,
    "), purchase_starts AS MATERIALIZED (",
    "  SELECT started.actor_id, MIN(started.occurred_at) AS purchase_started_at",
    "  FROM funnel_rows AS started",
    "  INNER JOIN cohort",
    "    ON cohort.actor_id = started.actor_id",
    "    AND started.occurred_at >= cohort.shown_at",
    `    AND started.occurred_at <= cohort.shown_at + ${windowSql}`,
    "  WHERE started.event_name = 'purchase_started'",
    "  GROUP BY started.actor_id",
    "), conversions AS MATERIALIZED (",
    "  SELECT converted.actor_id, MIN(converted.occurred_at) AS converted_at",
    "  FROM funnel_rows AS converted",
    "  INNER JOIN cohort ON cohort.actor_id = converted.actor_id",
    "  INNER JOIN purchase_starts AS started",
    "    ON started.actor_id = converted.actor_id",
    "    AND converted.occurred_at >= started.purchase_started_at",
    `    AND converted.occurred_at <= cohort.shown_at + ${windowSql}`,
    "  WHERE converted.event_name IN ('trial_started', 'purchase_completed')",
    "  GROUP BY converted.actor_id",
    ")",
    "SELECT",
    `  ${groupKeySql} AS group_key,`,
    "  COUNT(*)::int AS paywall_shown_count,",
    "  COUNT(started.purchase_started_at)::int AS purchase_started_count,",
    "  COUNT(converted.converted_at)::int AS converted_count,",
    `  (COUNT(*) FILTER (WHERE cohort.shown_at + ${windowSql} > now()))::int AS maturing_count`,
    "FROM cohort",
    "LEFT JOIN purchase_starts AS started ON started.actor_id = cohort.actor_id",
    "LEFT JOIN conversions AS converted ON converted.actor_id = cohort.actor_id",
    "GROUP BY group_key",
  ].join("\n");
}

export async function loadPaywallFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  groupByDimension: FunnelGroupByDimension | null,
): Promise<PaywallFunnelReport> {
  const response = await runAdminQuery(config, buildPaywallFunnelSql(filters, groupByDimension));
  if (response.resultSets.length !== 1) {
    throw new Error(
      `${paywallFunnelReportLabel} must return exactly one result set. Got ${response.resultSets.length}.`,
    );
  }

  // No row is a legal answer and means nobody entered the funnel, because every count is grouped.
  const rows = response.resultSets[0]?.rows ?? [];

  return {
    generatedAtUtc: response.executedAtUtc,
    groups: rows.map((row) => {
      const count = (fieldName: string): number => (
        toInteger(row[fieldName] ?? null, paywallFunnelReportLabel, fieldName)
      );

      return {
        key: assertIsString(row.group_key ?? null, paywallFunnelReportLabel, "group_key"),
        paywallShownCount: count("paywall_shown_count"),
        purchaseStartedCount: count("purchase_started_count"),
        convertedCount: count("converted_count"),
        maturingCount: count("maturing_count"),
      };
    }),
  };
}
