import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
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
import { buildFunnelAudienceActorSqlLines } from "../funnels/funnelAudienceSql";
import { assertIsString, assertValidDateRange, toInteger } from "../reportValues";
import { paywallFunnelStartDate } from "./query";

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
  const actorFilters = (alias: string): string => [
    ...buildFunnelAudienceActorSqlLines(filters, `${alias}.actor_id::text`),
    `AND ${buildConnectionCountriesFilterSql(`${alias}.actor_id::text`, filters.connectionCountries, filters.dateRange)}`,
    `AND ${buildAppUiLanguagesFilterSql(`${alias}.actor_id::text`, filters.appUiLanguages, filters.dateRange)}`,
  ].join("\n");

  // Rank retained impressions and attribute billing before applying presentation selections.
  // Otherwise changing dates or platforms would promote an exposure or steal another one's sale.
  return `WITH event_rows AS MATERIALIZED (
  SELECT event.event_id, event.actor_id, event.event_name, event.occurred_at,
    event.origin, event.platform,
    lower(event.event_properties ->> 'presentation_id') AS presentation_id,
    event.event_properties ->> 'entry_point' AS entry_point,
    event.event_properties ->> 'review_trigger' AS review_stage,
    event.event_properties ->> 'content_version' AS content_version,
    event.event_properties ->> 'outcome' AS outcome,
    event.event_properties ->> 'offer_type' AS offer_type,
    event.event_properties ->> 'provider' AS provider
  FROM analytics.product_events_resolved AS event
  WHERE event.actor_id IS NOT NULL
    AND ${buildTrustedActorRowsFilterSql("event.trust_level")}
    ${buildExcludedActorSqlLines("event.actor_id::text").join("\n")}
    AND event.event_name IN ('paywall_shown', 'paywall_choice', 'purchase_started',
      'purchase_finished', 'trial_started', 'purchase_completed', 'review_answered', 'app_opened')
    AND event.occurred_at >= (${escapeSqlStringLiteral(paywallFunnelStartDate)}::date)::timestamp AT TIME ZONE 'UTC'
    AND event.occurred_at < ${rangeEnd} + INTERVAL '7 days'
    AND event.occurred_at <= now()
    AND (event.event_name = 'paywall_shown' OR event.occurred_at >= ${rangeStart} - INTERVAL '7 days')
), impressions AS MATERIALIZED (
  SELECT DISTINCT ON (actor_id, COALESCE(presentation_id, 'legacy:' || event_id::text))
    event_id, actor_id, occurred_at AS shown_at, presentation_id,
    platform, entry_point, review_stage, content_version
  FROM event_rows
  WHERE event_name = 'paywall_shown'
  ORDER BY actor_id, COALESCE(presentation_id, 'legacy:' || event_id::text), occurred_at, event_id
), ranked_impressions AS MATERIALIZED (
  SELECT impressions.*,
    row_number() OVER (PARTITION BY actor_id ORDER BY shown_at, event_id) AS exposure_rank
  FROM impressions
), selected_impressions AS MATERIALIZED (
  SELECT shown.*
  FROM ranked_impressions AS shown
  WHERE shown.shown_at >= ${rangeStart} AND shown.shown_at < ${rangeEnd}
    AND ${buildEventPlatformsFilterSql("COALESCE(shown.platform, 'unattributed')", filters.eventPlatforms)}
    ${actorFilters("shown")}
), linked_flow AS MATERIALIZED (
  SELECT flow.*, shown.event_id AS shown_event_id, shown.shown_at
  FROM event_rows AS flow
  JOIN impressions AS shown
    ON shown.actor_id = flow.actor_id AND shown.presentation_id = flow.presentation_id
    AND (flow.entry_point IS NULL OR flow.entry_point = shown.entry_point)
    AND flow.occurred_at >= shown.shown_at
    AND flow.occurred_at <= shown.shown_at + INTERVAL '7 days'
  WHERE flow.event_name IN ('paywall_choice', 'purchase_started', 'purchase_finished')
), credited_billing AS MATERIALIZED (
  SELECT DISTINCT ON (fact.event_id)
    fact.event_id, fact.event_name, started.shown_event_id
  FROM event_rows AS fact
  JOIN linked_flow AS started
    ON started.actor_id = fact.actor_id AND started.event_name = 'purchase_started'
    AND started.occurred_at <= fact.occurred_at
    AND fact.occurred_at <= started.shown_at + INTERVAL '7 days'
    AND fact.provider = CASE started.platform
      WHEN 'ios' THEN 'apple' WHEN 'android' THEN 'google' WHEN 'web' THEN 'stripe' END
    AND (fact.event_name <> 'trial_started' OR started.offer_type IS DISTINCT FROM 'standard')
  WHERE fact.origin = 'server' AND fact.event_name IN ('trial_started', 'purchase_completed')
  ORDER BY fact.event_id, started.occurred_at DESC, started.event_id DESC
), flow_outcomes AS (
  SELECT shown_event_id,
    bool_or(event_name = 'paywall_choice' AND outcome = 'free') AS chose_free,
    bool_or(event_name = 'paywall_choice' AND outcome = 'premium') AS chose_premium,
    bool_or(event_name = 'paywall_choice' AND outcome = 'dismissed') AS dismissed,
    bool_or(event_name = 'paywall_choice') AS has_choice,
    bool_or(event_name = 'purchase_started') AS checkout,
    bool_or(event_name = 'purchase_finished' AND outcome = 'completed') AS completed,
    bool_or(event_name = 'purchase_finished' AND outcome = 'cancelled') AS cancelled,
    bool_or(event_name = 'purchase_finished' AND outcome = 'failed') AS failed,
    bool_or(event_name = 'purchase_finished' AND outcome = 'pending') AS pending
  FROM linked_flow GROUP BY shown_event_id
), billing_outcomes AS (
  SELECT shown_event_id,
    bool_or(event_name = 'trial_started') AS trial,
    bool_or(event_name = 'purchase_completed') AS paid
  FROM credited_billing GROUP BY shown_event_id
), subsequent_activity AS (
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
    ${actorFilters("flow")}
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
