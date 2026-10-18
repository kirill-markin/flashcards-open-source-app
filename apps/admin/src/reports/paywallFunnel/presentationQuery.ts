import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { buildEventPlatformsFilterSql } from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { assertIsString, assertValidDateRange, toInteger } from "../reportValues";
import { buildPaywallActorFiltersSql, buildPaywallAttributionCtes } from "./attributionQuery";

const reportLabel = "Paywall presentations";

export type PaywallPresentationGroup = Readonly<{
  platform: string;
  entryPoint: string;
  reviewStage: string;
  exposure: string;
  contentVersion: string;
  linkage: string;
  shownCount: number;
  freeCount: number;
  premiumCount: number;
  dismissedCount: number;
  unknownChoiceCount: number;
  checkoutCount: number;
  completedCount: number;
  cancelledCount: number;
  failedCount: number;
  pendingCount: number;
  convertedCount: number;
  trialCount: number;
  paidCount: number;
  reviewedCount: number;
  returnedCount: number;
  maturingCount: number;
}>;

export type PaywallPresentationReport = Readonly<{
  groups: ReadonlyArray<PaywallPresentationGroup>;
  unlinkedFlowCount: number;
}>;

export function buildPaywallPresentationSql(filters: AnalyticsFilterState): string {
  const { from, to } = assertValidDateRange(filters.dateRange, reportLabel);
  const rangeStart = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEnd = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;
  return `${buildPaywallAttributionCtes(filters)}, subsequent_activity AS (
  SELECT shown.event_id AS shown_event_id,
    bool_or(activity.event_name = 'review_answered' AND activity.origin = 'server') AS reviewed,
    bool_or(activity.event_name = 'app_opened'
      AND activity.occurred_at >= shown.shown_at + INTERVAL '1 day') AS returned
  FROM selected_impressions AS shown
  JOIN event_rows AS activity ON activity.actor_id = shown.actor_id
    AND activity.occurred_at > shown.shown_at
    AND activity.occurred_at <= shown.shown_at + INTERVAL '7 days'
    AND activity.event_name IN ('review_answered', 'app_opened')
  GROUP BY shown.event_id
), grouped AS (
  SELECT COALESCE(shown.platform, 'unattributed') AS platform,
    COALESCE(shown.entry_point, 'unknown') AS entry_point,
    COALESCE(shown.review_stage, 'unknown') AS review_stage,
    CASE WHEN shown.exposure_rank = 1 THEN '1st'
      WHEN shown.exposure_rank = 2 THEN '2nd' ELSE '3rd+' END AS exposure,
    COALESCE(shown.content_version, 'unknown') AS content_version,
    CASE WHEN shown.presentation_id IS NULL THEN 'Legacy / unlinked' ELSE 'UUID linked' END AS linkage,
    COUNT(*)::int AS shown_count,
    (COUNT(*) FILTER (WHERE flow.chose_free))::int AS free_count,
    (COUNT(*) FILTER (WHERE flow.chose_premium))::int AS premium_count,
    (COUNT(*) FILTER (WHERE flow.dismissed))::int AS dismissed_count,
    (COUNT(*) FILTER (WHERE NOT COALESCE(flow.has_choice, false)))::int AS unknown_choice_count,
    (COUNT(*) FILTER (WHERE flow.checkout))::int AS checkout_count,
    (COUNT(*) FILTER (WHERE flow.completed))::int AS completed_count,
    (COUNT(*) FILTER (WHERE flow.cancelled))::int AS cancelled_count,
    (COUNT(*) FILTER (WHERE flow.failed))::int AS failed_count,
    (COUNT(*) FILTER (WHERE flow.pending))::int AS pending_count,
    (COUNT(*) FILTER (WHERE billing.trial OR billing.paid))::int AS converted_count,
    (COUNT(*) FILTER (WHERE billing.trial))::int AS trial_count,
    (COUNT(*) FILTER (WHERE billing.paid))::int AS paid_count,
    (COUNT(*) FILTER (WHERE activity.reviewed))::int AS reviewed_count,
    (COUNT(*) FILTER (WHERE activity.returned))::int AS returned_count,
    (COUNT(*) FILTER (WHERE shown.shown_at + INTERVAL '7 days' > now()))::int AS maturing_count
  FROM selected_impressions AS shown
  LEFT JOIN flow_outcomes AS flow ON flow.shown_event_id = shown.event_id
  LEFT JOIN billing_outcomes AS billing ON billing.shown_event_id = shown.event_id
  LEFT JOIN subsequent_activity AS activity ON activity.shown_event_id = shown.event_id
  GROUP BY 1, 2, 3, 4, 5, 6
), coverage AS (
  SELECT COUNT(*)::int AS unlinked_flow_count
  FROM event_rows AS flow
  WHERE flow.event_name IN ('paywall_choice', 'purchase_started', 'purchase_finished')
    AND flow.occurred_at >= ${rangeStart} AND flow.occurred_at < ${rangeEnd}
    AND ${buildEventPlatformsFilterSql("COALESCE(flow.platform, 'unattributed')", filters.eventPlatforms)}
    ${buildPaywallActorFiltersSql(filters, "flow")}
    AND NOT EXISTS (SELECT 1 FROM linked_flow AS linked WHERE linked.event_id = flow.event_id)
)
SELECT grouped.*, coverage.unlinked_flow_count
FROM coverage LEFT JOIN grouped ON TRUE
ORDER BY platform, entry_point, review_stage, exposure, content_version, linkage`;
}

function parseGroup(row: AdminQueryRow): PaywallPresentationGroup {
  const text = (field: string): string => assertIsString(row[field] ?? null, reportLabel, field);
  const count = (field: string): number => toInteger(row[field] ?? null, reportLabel, field);
  return {
    platform: text("platform"), entryPoint: text("entry_point"), reviewStage: text("review_stage"),
    exposure: text("exposure"), contentVersion: text("content_version"), linkage: text("linkage"),
    shownCount: count("shown_count"), freeCount: count("free_count"), premiumCount: count("premium_count"),
    dismissedCount: count("dismissed_count"), unknownChoiceCount: count("unknown_choice_count"),
    checkoutCount: count("checkout_count"), completedCount: count("completed_count"),
    cancelledCount: count("cancelled_count"), failedCount: count("failed_count"), pendingCount: count("pending_count"),
    convertedCount: count("converted_count"), trialCount: count("trial_count"), paidCount: count("paid_count"),
    reviewedCount: count("reviewed_count"), returnedCount: count("returned_count"), maturingCount: count("maturing_count"),
  };
}

export async function loadPaywallPresentationReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
): Promise<PaywallPresentationReport> {
  const response = await runAdminQuery(config, buildPaywallPresentationSql(filters));
  if (response.resultSets.length !== 1 || response.resultSets[0].rows.length === 0) {
    throw new Error(`${reportLabel} must return exactly one result set with coverage counts.`);
  }
  const rows = response.resultSets[0].rows;
  return {
    groups: rows.filter((row) => row.platform !== null).map(parseGroup),
    unlinkedFlowCount: toInteger(rows[0].unlinked_flow_count ?? null, reportLabel, "unlinked_flow_count"),
  };
}
