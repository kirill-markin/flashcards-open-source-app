import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
  buildExcludedActorSqlLines,
  buildTrustedActorRowsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { buildPaywallAttributionCtes } from "../paywallFunnel/attributionQuery";
import { assertValidDateRange } from "../reportValues";
import {
  hardReminderAnswerCount,
  hardReminderHardLimit,
  reviewPromptGoneWindowDays,
  reviewPrompts,
  type ReviewPromptId,
} from "./reviewPromptDefinitions";

const reportLabel = "Review prompt showings";

export const paywallPromptIdsByReviewTrigger = {
  initial: "paywall-initial",
  day3: "paywall-day3",
  weekly: "paywall-weekly",
} as const satisfies Readonly<Record<string, ReviewPromptId>>;

export const promptIdsByScreen = {
  notifications_pre_prompt: "notifications-pre-prompt",
  review_hard_reminder: "hard-reminder",
  mobile_app_prompt: "web-mobile-app-promo",
  signin_after_review_prompt: "guest-sign-in",
} as const satisfies Readonly<Record<string, ReviewPromptId>>;

function buildPromptIdSql(promptId: ReviewPromptId): string {
  return escapeSqlStringLiteral(promptId);
}

export function buildValueListSql(values: ReadonlyArray<string>): string {
  return values.map(escapeSqlStringLiteral).join(", ");
}

export function buildPromptIdCaseSql(keySqlExpression: string, promptIdsByKey: Readonly<Record<string, ReviewPromptId>>): string {
  const branches = Object.entries(promptIdsByKey)
    .map(([key, promptId]) => `WHEN ${escapeSqlStringLiteral(key)} THEN ${escapeSqlStringLiteral(promptId)}`);
  return `CASE ${keySqlExpression} ${branches.join(" ")} END`;
}

/** A showing counts only on a platform its prompt runs on. */
function buildPromptPlatformsSql(alias: string): string {
  return reviewPrompts.map((prompt) => (
    `(${alias}.prompt_id = ${escapeSqlStringLiteral(prompt.id)} AND ${alias}.platform IN (${buildValueListSql(prompt.platforms)}))`
  )).join("\n      OR ");
}

/**
 * Each guest user id with the account its upgrade moved it to. A feedback row keeps the guest's user
 * id until the upgrade moves it, so it resolves to the account the way the analytics view resolves a
 * guest's events.
 */
export const guestUpgradesCteBodySql = `SELECT DISTINCT ON (identity_links.anonymous_id)
    identity_links.anonymous_id AS guest_user_id,
    identity_links.user_id AS account_user_id
  FROM analytics.identity_links AS identity_links
  WHERE identity_links.source = 'server_derived'
  ORDER BY identity_links.anonymous_id, identity_links.linked_at, identity_links.link_id`;

/** The end of a showing's acted window, NULL for a prompt whose answer nobody reports. */
function buildActedWindowEndsAtSql(alias: string): string {
  const branches = reviewPrompts.flatMap((prompt) => (prompt.acted.kind === "rule"
    ? [`WHEN ${escapeSqlStringLiteral(prompt.id)} THEN ${alias}.shown_at + INTERVAL '${prompt.acted.window.amount} ${prompt.acted.window.unit}s'`]
    : []));
  return `CASE ${alias}.prompt_id ${branches.join(" ")} END`;
}

/**
 * One row per showing of a prompt that can appear after a review, as the CTE chain ending in
 * `showings`; a caller appends its own `SELECT ... FROM showings`. Columns: `prompt_id`,
 * `showing_id`, `shown_at`, `actor_id` (text), `platform`, `app_version`, `trust_level` (NULL for
 * feedback), `acted` (NULL where nothing is reported), `acted_settles_at` (when `acted` is final)
 * and `gone_state` (`stayed`, `gone` or `maturing`).
 *
 * A showing is one paywall presentation, one prompt `screen_viewed`, one `store_review_requested` or
 * one automatic feedback prompt row, placed in the range by its own UTC day. The platform filter
 * reads the showing; the country and language filters and the exclusion rule judge its person.
 * Gone is no `app_opened` and no `review_answered` by that person in the 7 days after it, and stays
 * `maturing` while those days are not over.
 *
 * Every acted window here fits inside the 7-day follow-up the rows are fetched for, except the
 * paywall's, whose trial or first payment the attribution CTEs fetch and credit per presentation.
 */
export function buildReviewPromptShowingsCtes(filters: AnalyticsFilterState): string {
  const { from, to } = assertValidDateRange(filters.dateRange, reportLabel);
  const rangeStart = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEnd = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;
  const followUpEnd = `${rangeEnd} + INTERVAL '${reviewPromptGoneWindowDays} days'`;
  const paywallTriggers = buildValueListSql(Object.keys(paywallPromptIdsByReviewTrigger));
  const promptScreens = buildValueListSql(Object.keys(promptIdsByScreen));

  return `${buildPaywallAttributionCtes(filters)}, prompt_event_rows AS MATERIALIZED (
  SELECT event.event_id, event.actor_id::text AS actor_id, event.event_name, event.occurred_at,
    event.platform, event.app_version, event.trust_level, event.screen,
    event.event_properties ->> 'permission' AS permission,
    event.event_properties ->> 'prompt' AS prompt,
    event.event_properties ->> 'outcome' AS outcome
  FROM analytics.product_events_resolved AS event
  WHERE event.actor_id IS NOT NULL
    AND ${buildTrustedActorRowsFilterSql("event.trust_level")}
    AND event.event_name IN ('screen_viewed', 'store_review_requested', 'permission_prompt_answered',
      'prompt_answered', 'guest_upgrade_completed')
    AND (event.event_name <> 'screen_viewed' OR event.screen IN (${promptScreens}))
    AND event.occurred_at >= ${rangeStart}
    AND event.occurred_at < ${followUpEnd}
    AND event.occurred_at <= now()
), guest_upgrades AS (
  ${guestUpgradesCteBodySql}
), automatic_feedback_submissions AS MATERIALIZED (
  SELECT COALESCE(guest_upgrade.account_user_id::text, pg_catalog.lower(submission.user_id)) AS actor_id,
    submission.created_at_server AS submitted_at
  FROM support.feedback_submissions AS submission
  LEFT JOIN guest_upgrades AS guest_upgrade
    ON guest_upgrade.guest_user_id::text = pg_catalog.lower(submission.user_id)
  WHERE submission.trigger = 'automatic'
    AND submission.created_at_server >= ${rangeStart}
    AND submission.created_at_server < ${followUpEnd}
), showing_candidates AS (
  SELECT ${buildPromptIdCaseSql("paywall.review_stage", paywallPromptIdsByReviewTrigger)} AS prompt_id,
    paywall.event_id AS showing_id, paywall.actor_id::text AS actor_id, paywall.shown_at,
    paywall.platform, paywall.app_version, paywall.trust_level
  FROM impressions AS paywall
  WHERE paywall.entry_point = 'review'
    AND paywall.review_stage IN (${paywallTriggers})
    AND paywall.shown_at >= ${rangeStart} AND paywall.shown_at < ${rangeEnd}
  UNION ALL
  SELECT CASE WHEN prompt_event.event_name = 'store_review_requested' THEN ${buildPromptIdSql("rating-request")}
      ELSE ${buildPromptIdCaseSql("prompt_event.screen", promptIdsByScreen)} END AS prompt_id,
    prompt_event.event_id AS showing_id, prompt_event.actor_id, prompt_event.occurred_at AS shown_at,
    prompt_event.platform, prompt_event.app_version, prompt_event.trust_level
  FROM prompt_event_rows AS prompt_event
  WHERE prompt_event.event_name IN ('screen_viewed', 'store_review_requested')
    AND prompt_event.occurred_at >= ${rangeStart} AND prompt_event.occurred_at < ${rangeEnd}
  UNION ALL
  SELECT ${buildPromptIdSql("automatic-feedback")} AS prompt_id,
    prompt_shown.feedback_prompt_event_id AS showing_id,
    COALESCE(guest_upgrade.account_user_id::text, pg_catalog.lower(prompt_shown.user_id)) AS actor_id,
    prompt_shown.created_at_server AS shown_at,
    prompt_shown.platform, prompt_shown.app_version, NULL::text AS trust_level
  FROM support.feedback_prompt_events AS prompt_shown
  LEFT JOIN guest_upgrades AS guest_upgrade
    ON guest_upgrade.guest_user_id::text = pg_catalog.lower(prompt_shown.user_id)
  WHERE prompt_shown.event_type = 'automatic_prompt_shown'
    AND prompt_shown.created_at_server >= ${rangeStart} AND prompt_shown.created_at_server < ${rangeEnd}
), showings_base AS MATERIALIZED (
  SELECT candidate.*, ${buildActedWindowEndsAtSql("candidate")} AS acted_window_ends_at
  FROM showing_candidates AS candidate
  WHERE (
      ${buildPromptPlatformsSql("candidate")}
    )
    AND ${buildEventPlatformsFilterSql("COALESCE(candidate.platform, 'unattributed')", filters.eventPlatforms)}
    AND ${buildConnectionCountriesFilterSql("candidate.actor_id", filters.connectionCountries, filters.dateRange)}
    AND ${buildAppUiLanguagesFilterSql("candidate.actor_id", filters.appUiLanguages, filters.dateRange)}
    ${buildExcludedActorSqlLines("candidate.actor_id").join("\n")}
), activity_rows AS MATERIALIZED (
  SELECT event.event_id, event.actor_id::text AS actor_id, event.event_name, event.occurred_at,
    event.event_properties ->> 'rating' AS rating
  FROM analytics.product_events_resolved AS event
  WHERE event.event_name IN ('app_opened', 'review_answered')
    AND event.actor_id IS NOT NULL
    AND ${buildTrustedActorRowsFilterSql("event.trust_level")}
    AND event.occurred_at >= ${rangeStart}
    AND event.occurred_at < ${followUpEnd}
    AND event.occurred_at <= now()
    AND event.actor_id::text = ANY (ARRAY(SELECT DISTINCT showing.actor_id FROM showings_base AS showing))
), returned_showings AS (
  SELECT DISTINCT showing.showing_id
  FROM showings_base AS showing
  JOIN activity_rows AS activity ON activity.actor_id = showing.actor_id
    AND activity.occurred_at > showing.shown_at
    AND activity.occurred_at <= showing.shown_at + INTERVAL '${reviewPromptGoneWindowDays} days'
), hard_reminder_answers AS (
  SELECT showing.showing_id, activity.rating, activity.occurred_at,
    row_number() OVER (
      PARTITION BY showing.showing_id ORDER BY activity.occurred_at, activity.event_id
    ) AS answer_rank
  FROM showings_base AS showing
  JOIN activity_rows AS activity ON activity.actor_id = showing.actor_id
    AND activity.event_name = 'review_answered'
    AND activity.occurred_at > showing.shown_at
    AND activity.occurred_at <= showing.acted_window_ends_at
  WHERE showing.prompt_id = ${buildPromptIdSql("hard-reminder")}
), acted_showings AS (
  SELECT showing.showing_id
  FROM showings_base AS showing
  JOIN billing_outcomes AS billing ON billing.shown_event_id = showing.showing_id
  WHERE showing.prompt_id IN (${buildValueListSql(Object.values(paywallPromptIdsByReviewTrigger))})
    AND (billing.trial OR billing.paid)
  UNION
  SELECT showing.showing_id
  FROM showings_base AS showing
  JOIN prompt_event_rows AS answer ON answer.actor_id = showing.actor_id
    AND answer.occurred_at >= showing.shown_at
    AND answer.occurred_at <= showing.acted_window_ends_at
  WHERE (showing.prompt_id = ${buildPromptIdSql("notifications-pre-prompt")}
      AND answer.event_name = 'permission_prompt_answered'
      AND answer.permission = 'notifications' AND answer.outcome = 'granted')
    OR (showing.prompt_id = ${buildPromptIdSql("web-mobile-app-promo")}
      AND answer.event_name = 'prompt_answered'
      AND answer.prompt = 'mobile_app_prompt' AND answer.outcome = 'accepted')
    OR (showing.prompt_id = ${buildPromptIdSql("guest-sign-in")}
      AND answer.event_name = 'guest_upgrade_completed')
  UNION
  SELECT answer.showing_id
  FROM hard_reminder_answers AS answer
  WHERE answer.answer_rank <= ${hardReminderAnswerCount}
  GROUP BY answer.showing_id
  HAVING COUNT(*) = ${hardReminderAnswerCount}
    AND COUNT(*) FILTER (WHERE answer.rating = 'hard') < ${hardReminderHardLimit}
  UNION
  SELECT showing.showing_id
  FROM showings_base AS showing
  JOIN automatic_feedback_submissions AS submission ON submission.actor_id = showing.actor_id
    AND submission.submitted_at >= showing.shown_at
    AND submission.submitted_at <= showing.acted_window_ends_at
  WHERE showing.prompt_id = ${buildPromptIdSql("automatic-feedback")}
), showings AS (
  SELECT showing.prompt_id, showing.showing_id, showing.shown_at, showing.actor_id,
    showing.platform, showing.app_version, showing.trust_level,
    CASE WHEN showing.acted_window_ends_at IS NULL THEN NULL
      ELSE acted.showing_id IS NOT NULL END AS acted,
    -- The hard reminder's Acted is final at its last counted answer if that comes first.
    LEAST(showing.acted_window_ends_at, last_counted_answer.occurred_at) AS acted_settles_at,
    CASE WHEN returned.showing_id IS NOT NULL THEN 'stayed'
      WHEN showing.shown_at + INTERVAL '${reviewPromptGoneWindowDays} days' > now() THEN 'maturing'
      ELSE 'gone' END AS gone_state
  FROM showings_base AS showing
  LEFT JOIN acted_showings AS acted ON acted.showing_id = showing.showing_id
  LEFT JOIN returned_showings AS returned ON returned.showing_id = showing.showing_id
  LEFT JOIN hard_reminder_answers AS last_counted_answer ON last_counted_answer.showing_id = showing.showing_id
    AND last_counted_answer.answer_rank = ${hardReminderAnswerCount}
)`;
}
