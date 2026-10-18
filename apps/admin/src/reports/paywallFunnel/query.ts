import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { buildEventPlatformsFilterSql } from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import {
  platformFunnelGroupByDimensionId,
  unresolvedFunnelGroupKey,
  type FunnelGroupByDimension,
} from "../funnels/funnelGroupBy";
import { assertIsString, assertValidDateRange, toInteger } from "../reportValues";
import {
  buildPaywallActorFiltersSql,
  buildPaywallAttributionCtes,
} from "./attributionQuery";

export { paywallFunnelStartDate } from "./attributionQuery";

export const paywallFunnelReportLabel = "Paywall funnel";

export type PaywallFunnelCounts = Readonly<{
  paywallShownCount: number;
  premiumCount: number;
  purchaseStartedCount: number;
  convertedCount: number;
  trialCount: number;
  paidCount: number;
  freeCount: number;
  dismissedCount: number;
  unknownChoiceCount: number;
  maturingCount: number;
}>;

export type PaywallFunnelGroup = PaywallFunnelCounts & Readonly<{ key: string }>;

export type PaywallFunnelReport = Readonly<{
  generatedAtUtc: string;
  groups: ReadonlyArray<PaywallFunnelGroup>;
}>;

const ungroupedPaywallGroupKey = "all";

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

export function buildPaywallFunnelSql(
  filters: AnalyticsFilterState,
  groupByDimension: FunnelGroupByDimension | null,
): string {
  const { from, to } = assertValidDateRange(filters.dateRange, paywallFunnelReportLabel);
  const rangeStart = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEnd = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;
  const groupKeySql = groupByDimension === null
    ? `${escapeSqlStringLiteral(ungroupedPaywallGroupKey)}::text`
    : `COALESCE(${groupByDimension.buildGroupKeySql(filters)}, ${escapeSqlStringLiteral(unresolvedFunnelGroupKey)})::text`;

  return `${buildPaywallAttributionCtes(filters)}, first_paywalls AS MATERIALIZED (
  SELECT DISTINCT ON (shown.actor_id) shown.*
  FROM impressions AS shown
  WHERE shown.shown_at >= ${rangeStart} AND shown.shown_at < ${rangeEnd}
  ORDER BY shown.actor_id, shown.shown_at, shown.event_id
), cohort AS MATERIALIZED (
  SELECT candidate.*
  FROM first_paywalls AS candidate
  WHERE ${buildEventPlatformsFilterSql("COALESCE(candidate.platform, 'unattributed')", filters.eventPlatforms)}
    ${buildPaywallActorFiltersSql(filters, "candidate")}
), premium_choices AS MATERIALIZED (
  SELECT choice.shown_event_id, MIN(choice.occurred_at) AS premium_at
  FROM linked_flow AS choice
  JOIN cohort ON cohort.event_id = choice.shown_event_id
  WHERE choice.event_name = 'paywall_choice' AND choice.outcome = 'premium'
  GROUP BY choice.shown_event_id
), purchase_starts AS MATERIALIZED (
  SELECT started.event_id, started.shown_event_id
  FROM linked_flow AS started
  JOIN premium_choices AS choice ON choice.shown_event_id = started.shown_event_id
    AND started.occurred_at >= choice.premium_at
  WHERE started.event_name = 'purchase_started'
), conversions AS (
  SELECT fact.shown_event_id,
    bool_or(fact.event_name = 'trial_started') AS trial,
    bool_or(fact.event_name = 'purchase_completed') AS paid
  FROM credited_billing AS fact
  JOIN purchase_starts AS started ON started.event_id = fact.started_event_id
  GROUP BY fact.shown_event_id
), checkout_presentations AS (
  SELECT DISTINCT shown_event_id FROM purchase_starts
)
SELECT ${groupKeySql} AS group_key,
  COUNT(*)::int AS paywall_shown_count,
  COUNT(choice.premium_at)::int AS premium_count,
  COUNT(started.shown_event_id)::int AS purchase_started_count,
  (COUNT(*) FILTER (WHERE converted.trial OR converted.paid))::int AS converted_count,
  (COUNT(*) FILTER (WHERE converted.trial))::int AS trial_count,
  (COUNT(*) FILTER (WHERE converted.paid))::int AS paid_count,
  (COUNT(*) FILTER (WHERE flow.chose_free))::int AS free_count,
  (COUNT(*) FILTER (WHERE flow.dismissed))::int AS dismissed_count,
  (COUNT(*) FILTER (WHERE NOT COALESCE(flow.has_choice, false)))::int AS unknown_choice_count,
  (COUNT(*) FILTER (WHERE cohort.shown_at + INTERVAL '7 days' > now()))::int AS maturing_count
FROM cohort
LEFT JOIN premium_choices AS choice ON choice.shown_event_id = cohort.event_id
LEFT JOIN checkout_presentations AS started ON started.shown_event_id = cohort.event_id
LEFT JOIN conversions AS converted ON converted.shown_event_id = cohort.event_id
LEFT JOIN flow_outcomes AS flow ON flow.shown_event_id = cohort.event_id
GROUP BY group_key`;
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
        premiumCount: count("premium_count"),
        purchaseStartedCount: count("purchase_started_count"),
        convertedCount: count("converted_count"),
        trialCount: count("trial_count"),
        paidCount: count("paid_count"),
        freeCount: count("free_count"),
        dismissedCount: count("dismissed_count"),
        unknownChoiceCount: count("unknown_choice_count"),
        maturingCount: count("maturing_count"),
      };
    }),
  };
}
