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
  paywallFirstPaymentWindowDays,
  paywallStepWindowDays,
} from "./attributionQuery";

export { paywallFirstPaymentWindowDays, paywallFunnelStartDate } from "./attributionQuery";

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
  firstPaymentPendingCount: number;
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
), person_flow AS MATERIALIZED (
  -- A person who buys on a repeat paywall still converted: every presentation from the first one
  -- in range counts, as long as the step falls within the step window of that first one.
  SELECT cohort.actor_id AS cohort_actor_id, flow.*
  FROM cohort
  JOIN linked_flow AS flow ON flow.actor_id = cohort.actor_id
    AND flow.shown_at >= cohort.shown_at
    AND flow.occurred_at <= cohort.shown_at + INTERVAL '${paywallStepWindowDays} days'
), premium_choices AS MATERIALIZED (
  -- Legacy clients sent no choice, and every path to their checkout request began at the Premium button.
  SELECT choice.shown_event_id, MIN(choice.occurred_at) AS premium_at
  FROM person_flow AS choice
  WHERE (choice.event_name = 'paywall_choice' AND choice.outcome = 'premium')
    OR (choice.event_name = 'purchase_started' AND choice.presentation_id IS NULL)
  GROUP BY choice.shown_event_id
), purchase_starts AS MATERIALIZED (
  SELECT started.event_id, started.cohort_actor_id
  FROM person_flow AS started
  JOIN premium_choices AS choice ON choice.shown_event_id = started.shown_event_id
    AND started.occurred_at >= choice.premium_at
  WHERE started.event_name = 'purchase_started'
), person_steps AS (
  SELECT flow.cohort_actor_id,
    bool_or(choice.shown_event_id IS NOT NULL) AS premium,
    bool_or(flow.event_name = 'paywall_choice' AND flow.outcome = 'free') AS chose_free,
    bool_or(flow.event_name = 'paywall_choice' AND flow.outcome = 'dismissed') AS dismissed
  FROM person_flow AS flow
  LEFT JOIN premium_choices AS choice ON choice.shown_event_id = flow.shown_event_id
  GROUP BY flow.cohort_actor_id
), conversions AS (
  SELECT started.cohort_actor_id,
    bool_or(fact.event_name = 'trial_started') AS trial,
    bool_or(fact.event_name = 'purchase_completed') AS paid
  FROM credited_billing AS fact
  JOIN purchase_starts AS started ON started.event_id = fact.started_event_id
  GROUP BY started.cohort_actor_id
), checkout_people AS (
  SELECT DISTINCT cohort_actor_id FROM purchase_starts
)
SELECT ${groupKeySql} AS group_key,
  COUNT(*)::int AS paywall_shown_count,
  (COUNT(*) FILTER (WHERE steps.premium))::int AS premium_count,
  COUNT(started.cohort_actor_id)::int AS purchase_started_count,
  (COUNT(*) FILTER (WHERE converted.trial OR converted.paid))::int AS converted_count,
  (COUNT(*) FILTER (WHERE converted.trial))::int AS trial_count,
  (COUNT(*) FILTER (WHERE converted.paid))::int AS paid_count,
  (COUNT(*) FILTER (WHERE steps.chose_free))::int AS free_count,
  (COUNT(*) FILTER (WHERE steps.dismissed))::int AS dismissed_count,
  (COUNT(*) FILTER (WHERE NOT COALESCE(steps.premium OR steps.chose_free OR steps.dismissed, false)))::int AS unknown_choice_count,
  (COUNT(*) FILTER (WHERE cohort.shown_at + INTERVAL '${paywallStepWindowDays} days' > now()))::int AS maturing_count,
  (COUNT(*) FILTER (WHERE cohort.shown_at + INTERVAL '${paywallFirstPaymentWindowDays} days' > now()))::int AS first_payment_pending_count
FROM cohort
LEFT JOIN person_steps AS steps ON steps.cohort_actor_id = cohort.actor_id
LEFT JOIN checkout_people AS started ON started.cohort_actor_id = cohort.actor_id
LEFT JOIN conversions AS converted ON converted.cohort_actor_id = cohort.actor_id
GROUP BY group_key`;
}

export async function loadPaywallFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  groupByDimension: FunnelGroupByDimension | null,
  signal: AbortSignal,
): Promise<PaywallFunnelReport> {
  const response = await runAdminQuery(config, buildPaywallFunnelSql(filters, groupByDimension), signal);
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
        firstPaymentPendingCount: count("first_payment_pending_count"),
      };
    }),
  };
}
