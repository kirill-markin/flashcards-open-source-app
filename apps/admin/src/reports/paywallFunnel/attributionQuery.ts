import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
  buildExcludedActorSqlLines,
  buildTrustedActorRowsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { assertValidDateRange } from "../reportValues";

export const paywallFunnelStartDate = "2026-10-04";

// Choices and checkout requests link to a paywall within this many days of it.
export const paywallStepWindowDays = 7;

// The 7-day free trial bills its first payment on day 7, so billing needs a window past it;
// the second week covers provider billing retries.
const paywallBillingWindowDays = 14;
const billingWindowSql = `INTERVAL '${paywallBillingWindowDays} days'`;

// A paywall's first payment can arrive this long after it: checkout, then billing.
export const paywallFirstPaymentWindowDays = paywallStepWindowDays + paywallBillingWindowDays;

export function buildPaywallActorFiltersSql(filters: AnalyticsFilterState, alias: string): string {
  return [
    `AND ${buildConnectionCountriesFilterSql(`${alias}.actor_id::text`, filters.connectionCountries, filters.dateRange)}`,
    `AND ${buildAppUiLanguagesFilterSql(`${alias}.actor_id::text`, filters.appUiLanguages, filters.dateRange)}`,
  ].join("\n");
}

export function buildPaywallAttributionCtes(filters: AnalyticsFilterState): string {
  const { from, to } = assertValidDateRange(filters.dateRange, "Paywall attribution");
  const rangeStart = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEnd = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;

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
    -- Checkouts and billing need the payment window; activity only the step window.
    -- The fixed bound stays separate so the event-name index keeps an upper bound.
    AND event.occurred_at < ${rangeEnd} + INTERVAL '${paywallFirstPaymentWindowDays} days'
    AND (event.event_name NOT IN ('review_answered', 'app_opened')
      OR event.occurred_at < ${rangeEnd} + INTERVAL '${paywallStepWindowDays} days')
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
    ${buildPaywallActorFiltersSql(filters, "shown")}
), linked_flow AS MATERIALIZED (
  -- Clients before presentation UUIDs send none on either side; such a row belongs to the
  -- actor's latest preceding legacy impression on its platform, the screen it was raised from.
  SELECT DISTINCT ON (flow.event_id) flow.*, shown.event_id AS shown_event_id, shown.shown_at
  FROM event_rows AS flow
  JOIN impressions AS shown
    ON shown.actor_id = flow.actor_id
    AND (shown.presentation_id = flow.presentation_id
      OR (shown.presentation_id IS NULL AND flow.presentation_id IS NULL))
    AND flow.platform IS NOT DISTINCT FROM shown.platform
    AND (flow.entry_point IS NULL OR flow.entry_point = shown.entry_point)
    AND flow.occurred_at >= shown.shown_at
    AND flow.occurred_at <= shown.shown_at + INTERVAL '${paywallStepWindowDays} days'
  WHERE flow.event_name IN ('paywall_choice', 'purchase_started', 'purchase_finished')
  ORDER BY flow.event_id, shown.shown_at DESC, shown.event_id DESC
), billing_checkouts AS MATERIALIZED (
  -- Select before linking so an unlinked checkout cannot credit an older presentation.
  SELECT DISTINCT ON (fact.event_id)
    fact.event_id, fact.event_name, fact.occurred_at AS billing_at,
    started.event_id AS started_event_id, started.offer_type
  FROM event_rows AS fact
  JOIN event_rows AS started
    ON started.actor_id = fact.actor_id AND started.event_name = 'purchase_started'
    AND started.occurred_at <= fact.occurred_at
    AND fact.occurred_at <= started.occurred_at + ${billingWindowSql}
    AND fact.provider = CASE started.platform
      WHEN 'ios' THEN 'apple' WHEN 'android' THEN 'google' WHEN 'web' THEN 'stripe' END
  WHERE fact.origin = 'server' AND fact.event_name IN ('trial_started', 'purchase_completed')
  ORDER BY fact.event_id, started.occurred_at DESC, started.event_id DESC
), credited_billing AS MATERIALIZED (
  SELECT fact.event_id, fact.event_name, fact.started_event_id, started.shown_event_id
  FROM billing_checkouts AS fact
  JOIN linked_flow AS started ON started.event_id = fact.started_event_id
  WHERE fact.event_name <> 'trial_started' OR fact.offer_type IS DISTINCT FROM 'standard'
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
)`;
}
