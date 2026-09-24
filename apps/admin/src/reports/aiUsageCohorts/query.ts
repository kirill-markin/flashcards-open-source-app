import { runAdminQuery, type AdminQueryRow, type AdminQueryValue } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildExcludedActorSqlLines,
  buildTrustedActorRowsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { buildSignedInActorSql } from "../funnels/funnelAudienceSql";
import { assertIsString, assertValidDateRange, toInteger } from "../reportValues";
import {
  aiUsageReportLabel,
  buildAiUsagePeriods,
  minAiUsageExposureDays,
  type AiUsageAudience,
  type AiUsagePeriod,
  type AiUsagePeriodPlan,
  type AiUsagePeriodWeeks,
} from "./reportModel";

/** One dot: one person inside one period, with the raw counts every rate on screen is derived from. */
export type AiUsageDot = Readonly<{
  periodIndex: number;
  actorId: string;
  /** Empty when the person has no stored email, which every guest and every deleted account has. */
  actorEmail: string;
  isRegistered: boolean;
  reviews: number;
  chatMessages: number;
  /** Characters of chat text in the period, both roles together: the vertical axis before scaling. */
  chatChars: number;
  /** The same characters split by role, for the hover only; both axes and every median read the sum. */
  promptChars: number;
  responseChars: number;
  exposureDays: number;
}>;

export type AiUsageCohortsReport = Readonly<{
  generatedAtUtc: string;
  periods: ReadonlyArray<AiUsagePeriod>;
  droppedPeriodCount: number;
  remainderDays: number;
  dots: ReadonlyArray<AiUsageDot>;
}>;

function buildPeriodValuesSql(periods: ReadonlyArray<AiUsagePeriod>): string {
  return periods
    .map((period) => `    (${period.index}, ${escapeSqlStringLiteral(period.from)}::date, ${escapeSqlStringLiteral(period.to)}::date)`)
    .join(",\n");
}

function buildAudiencePredicateSql(audience: AiUsageAudience): string {
  if (audience === "registered") {
    return "dots.is_registered";
  }

  if (audience === "guests") {
    return "NOT dots.is_registered";
  }

  return "TRUE";
}

/**
 * One row per person per period, with the counts rather than the rates.
 *
 * WHY THE RATES ARE NOT COMPUTED HERE. The browser divides by exposure, and that is the whole of the
 * arithmetic this query leaves undone. It keeps every returned value an exact integer, so nothing in
 * the report depends on how a `numeric` crosses JSON, and it leaves the panels' medians and shares to
 * be taken over exactly the dots that are drawn rather than over a second, separately filtered
 * population in SQL that could disagree with them.
 *
 * WHY THE PERIODS ARRIVE AS A LITERAL `VALUES` LIST. They are equal-length and anchored at the end of
 * the range, so their boundaries are plain calendar arithmetic that `buildAiUsagePeriods` already has
 * to do for the panel titles, the panel cap and the remainder note. Deriving them a second time in
 * SQL, from `generate_series` running backwards, would be the same arithmetic written where it cannot
 * be read back - and admin report SQL is never executed before deploy in this repository, so a
 * statement that can be checked by reading it is worth more here than one that is shorter.
 *
 * TWO SOURCES, ONE PERSON KEY. Reviews come from `analytics.product_events_resolved`, keyed on
 * `actor_id`, which is where every other section of this dashboard counts people. Chat messages come
 * from `ai.chat_items`, whose session carries the raw `org.user_settings.user_id` instead, so
 * `chat_actors` below folds that id through the same `analytics.identity_links` lookup the view's own
 * `actor_id` uses. Without it a guest who was later merged into an account would appear as two
 * people: their chat under the guest id and their reviews under the account, each with half the
 * story, and the report exists to compare exactly those two halves.
 *
 * TWO COLUMNS AND NEVER THE PAYLOAD. `role` and `content_char_count` are stored generated columns on
 * `ai.chat_items` (`db/migrations/0155_ai_chat_item_content_metrics.sql`, which owns their exact
 * definitions). `payload` is never named here, which is the point of them: its large values live in
 * TOAST, so reading one key out of a row costs about what reading the whole message costs.
 *
 * WHAT A CHARACTER IS HERE: CHAT TEXT, AND ONLY CHAT TEXT. `content_char_count` measures the `text`
 * parts of a message - what the person typed and what the model wrote back - and nothing else.
 * Attachments, file uploads, tool calls and reasoning summaries are excluded by the column itself.
 * This is not a detail to be tidied away in a tooltip: measuring the serialized content array
 * instead, which is overwhelmingly attachment bytes on the person's side and tool traffic on the
 * model's, put the per-period medians out by a factor of eleven to eighteen. The vertical axis is
 * therefore conversation volume, and it is deliberately not a proxy for provider cost or tokens.
 *
 * THE PER-PERSON WORK RUNS OVER THE PEOPLE WHO GET A DOT, AND NOTHING WIDER. `active_actors` is
 * taken from the period join, and the exclusion anti-joins, the email lookup and the registration
 * test all hang off it. Written the other way round - a person set assembled from both full
 * histories, tested, and only then joined to the periods - every one of those tests runs over every
 * actor the product has ever had, and `dots` discards most of that work again a few lines later. The
 * `reporting_readonly` role carries a 30 second statement timeout and a connection limit of three,
 * and admin report SQL is never executed before deploy in this repository, so the first sight of that
 * cost would be a 500 on the live page.
 *
 * `first_activity` STAYS UNBOUNDED, WHICH IS A DIFFERENT THING FROM THE ABOVE. It is the person's
 * first ever review or chat message, whenever that was, because it is the left end of the exposure
 * both rates are divided by. Bounding it to the selected range would raise `first_at` for everybody
 * who was already here, shrink their divisor and inflate both rates - a wrong number rather than a
 * failure, and one nothing on screen would show. So both sources are split the same way: `review_first`
 * and `chat_first` keep their lower end open and read the whole history of the active actors alone,
 * while `review_events` and `chat_text`, which feed nothing but the period aggregation, are each
 * bounded to the span the drawn periods cover. Leaving either whole-history scan attached to the
 * period aggregation would materialize it to serve a count that only needs the periods' span.
 *
 * REGISTRATION IS ANSWERED ONCE FOR THE WHOLE SET, NOT ONCE PER ROW. `buildSignedInActorSql` still
 * owns the predicate, so there is one definition of who is registered and the funnels read that same
 * one, but it is applied in the `WHERE` of `registered_actors`, where Postgres plans it as a
 * semi-join that scans `auth.user_identities` once; the answer is then read back as a value through a
 * LEFT JOIN. In a select list the identical expression is a SubPlan re-executed per output row, and
 * because the only index on that table is on the raw `user_id` while the predicate is on
 * `pg_catalog.lower(user_id)`, each of those executions is a sequential scan.
 * `apps/admin/src/filters/filterSql.ts` sets out the same failure mode and why a person-level test
 * has to be evaluated exactly once.
 *
 * THE MESSAGE `state` IS NOT READ. An errored, cancelled or still-running message was still typed or
 * still written back, and dropping one would make the vertical axis a count of successful turns
 * rather than of how much conversation happened. Image generation and composer suggestions produce
 * no message text and are therefore absent by construction rather than by a predicate.
 */
export function buildAiUsageCohortsSql(
  filters: AnalyticsFilterState,
  periods: ReadonlyArray<AiUsagePeriod>,
  audience: AiUsageAudience,
): string {
  const dateRange = assertValidDateRange(filters.dateRange, aiUsageReportLabel);
  if (periods.length === 0) {
    throw new Error(`${aiUsageReportLabel} cannot build a statement without a whole period.`);
  }

  const rangeEndSql = `(${escapeSqlStringLiteral(dateRange.to)}::date + 1)::timestamp AT TIME ZONE 'UTC'`;
  // The union of the drawn periods: every instant the period aggregation can read, and therefore the
  // bound both of its sources, `review_events` and `chat_text`, are cut to. The periods are equal-length, contiguous and anchored at the recent
  // end, so their union is one span rather than a set with holes; taking a minimum and a maximum over
  // the list anyway keeps this correct whatever order a caller hands them over in.
  const earliestPeriodStart = periods.reduce(
    (earliest, period) => (period.from < earliest ? period.from : earliest),
    periods[0].from,
  );
  const latestPeriodEnd = periods.reduce(
    (latest, period) => (period.to > latest ? period.to : latest),
    periods[0].to,
  );
  const periodsStartSql = `(${escapeSqlStringLiteral(earliestPeriodStart)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const periodsEndSql = `(${escapeSqlStringLiteral(latestPeriodEnd)}::date + 1)::timestamp AT TIME ZONE 'UTC'`;
  // The exclusion rule is applied once, on the person, rather than on each of the two sources. Both
  // of them resolve to the same actor key by then, and a person reachable through only one of them -
  // an admin who has only ever chatted - has to be dropped from the report just as completely as one
  // reachable through both.
  // Named for `first_activity`, which is the relation the `person_first` body actually scans: the CTE
  // cannot refer to itself, and a predicate written against `person_first.actor_id` would abort the
  // statement with a missing FROM-clause entry. `first_activity` now holds only the actors that
  // appear in some period, so the rule is tested on those people rather than on the whole history.
  const excludedActorLines = buildExcludedActorSqlLines("first_activity.actor_id").join("\n");
  // `org.user_settings.user_id` is an unconstrained TEXT key while `actor_id` renders canonical
  // lowercase hex, so the stored side is folded to match - and then grouped, because folding alone
  // would let two rows of one person differing only in case join twice and draw that person as two
  // dots. `apps/admin/src/filters/optionsQuery.ts` dedupes the same join for the same reason.

  return `WITH periods (period_index, starts_on, ends_on) AS (
  VALUES
${buildPeriodValuesSql(periods)}
), review_events AS MATERIALIZED (
  SELECT events.actor_id::text AS actor_id, events.occurred_at
  FROM analytics.product_events_resolved AS events
  WHERE events.event_name = 'review_answered'
    AND events.actor_id IS NOT NULL
    AND events.occurred_at >= ${periodsStartSql}
    AND events.occurred_at < ${periodsEndSql}
    AND ${buildTrustedActorRowsFilterSql("events.trust_level")}
), chat_actors AS (
  SELECT chat_sessions.session_id,
    COALESCE(guest_upgrade.account_user_id::text, pg_catalog.lower(chat_sessions.user_id)) AS actor_id
  FROM ai.chat_sessions AS chat_sessions
  LEFT JOIN (
    SELECT DISTINCT ON (identity_links.anonymous_id)
      identity_links.anonymous_id AS guest_user_id,
      identity_links.user_id AS account_user_id
    FROM analytics.identity_links AS identity_links
    WHERE identity_links.source = 'server_derived'
    ORDER BY identity_links.anonymous_id, identity_links.linked_at, identity_links.link_id
  ) AS guest_upgrade
    ON guest_upgrade.guest_user_id::text = pg_catalog.lower(chat_sessions.user_id)
), chat_text AS MATERIALIZED (
  SELECT chat_actors.actor_id, chat_items.created_at, chat_items.role, chat_items.content_char_count
  FROM ai.chat_items AS chat_items
  JOIN chat_actors ON chat_actors.session_id = chat_items.session_id
  WHERE chat_items.role IN ('user', 'assistant')
    AND chat_items.created_at >= ${periodsStartSql}
    AND chat_items.created_at < ${periodsEndSql}
), period_activity AS (
  SELECT review_events.actor_id, periods.period_index,
    count(*) AS reviews,
    0::bigint AS chat_messages,
    0::bigint AS chat_chars,
    0::bigint AS prompt_chars,
    0::bigint AS response_chars
  FROM review_events
  JOIN periods
    ON review_events.occurred_at >= (periods.starts_on)::timestamp AT TIME ZONE 'UTC'
    AND review_events.occurred_at < (periods.ends_on + 1)::timestamp AT TIME ZONE 'UTC'
  GROUP BY review_events.actor_id, periods.period_index
  UNION ALL
  SELECT chat_text.actor_id, periods.period_index,
    0::bigint AS reviews,
    count(*) AS chat_messages,
    COALESCE(sum(chat_text.content_char_count), 0) AS chat_chars,
    COALESCE(sum(chat_text.content_char_count) FILTER (WHERE chat_text.role = 'user'), 0) AS prompt_chars,
    COALESCE(sum(chat_text.content_char_count) FILTER (WHERE chat_text.role = 'assistant'), 0) AS response_chars
  FROM chat_text
  JOIN periods
    ON chat_text.created_at >= (periods.starts_on)::timestamp AT TIME ZONE 'UTC'
    AND chat_text.created_at < (periods.ends_on + 1)::timestamp AT TIME ZONE 'UTC'
  GROUP BY chat_text.actor_id, periods.period_index
), person_periods AS (
  SELECT actor_id, period_index,
    sum(reviews) AS reviews,
    sum(chat_messages) AS chat_messages,
    sum(chat_chars) AS chat_chars,
    sum(prompt_chars) AS prompt_chars,
    sum(response_chars) AS response_chars
  FROM period_activity
  GROUP BY actor_id, period_index
), active_actors AS (
  SELECT DISTINCT person_periods.actor_id
  FROM person_periods
), review_first AS (
  SELECT events.actor_id::text AS actor_id, min(events.occurred_at) AS first_at
  FROM active_actors
  JOIN analytics.product_events_resolved AS events ON events.actor_id::text = active_actors.actor_id
  WHERE events.event_name = 'review_answered'
    AND events.actor_id IS NOT NULL
    AND events.occurred_at < ${rangeEndSql}
    AND ${buildTrustedActorRowsFilterSql("events.trust_level")}
  GROUP BY events.actor_id
), chat_first AS (
  SELECT chat_actors.actor_id, min(chat_items.created_at) AS first_at
  FROM active_actors
  JOIN chat_actors ON chat_actors.actor_id = active_actors.actor_id
  JOIN ai.chat_items AS chat_items ON chat_items.session_id = chat_actors.session_id
  WHERE chat_items.role IN ('user', 'assistant')
  GROUP BY chat_actors.actor_id
), first_activity AS (
  SELECT actor_id, min(first_at) AS first_at
  FROM (
    SELECT review_first.actor_id, review_first.first_at FROM review_first
    UNION ALL
    SELECT chat_first.actor_id, chat_first.first_at FROM chat_first
  ) AS sources
  GROUP BY actor_id
), person_first AS (
  SELECT first_activity.actor_id, first_activity.first_at
  FROM first_activity
  WHERE TRUE
${excludedActorLines}
), person_emails AS (
  SELECT pg_catalog.lower(user_settings.user_id) AS user_key,
    MIN(NULLIF(btrim(user_settings.email), '')) AS email
  FROM org.user_settings AS user_settings
  JOIN active_actors ON active_actors.actor_id = pg_catalog.lower(user_settings.user_id)
  GROUP BY pg_catalog.lower(user_settings.user_id)
), registered_actors AS (
  SELECT active_actors.actor_id
  FROM active_actors
  WHERE ${buildSignedInActorSql("active_actors.actor_id")}
), persons AS (
  SELECT person_first.actor_id, person_first.first_at,
    COALESCE(person_emails.email, '') AS actor_email,
    registered_actors.actor_id IS NOT NULL AS is_registered
  FROM person_first
  LEFT JOIN person_emails ON person_emails.user_key = person_first.actor_id
  LEFT JOIN registered_actors ON registered_actors.actor_id = person_first.actor_id
), dots AS (
  SELECT person_periods.period_index, persons.actor_id, persons.actor_email, persons.is_registered,
    person_periods.reviews, person_periods.chat_messages, person_periods.chat_chars,
    person_periods.prompt_chars, person_periods.response_chars,
    (periods.ends_on - GREATEST((persons.first_at AT TIME ZONE 'UTC')::date, periods.starts_on)) + 1
      AS exposure_days
  FROM person_periods
  JOIN persons ON persons.actor_id = person_periods.actor_id
  JOIN periods ON periods.period_index = person_periods.period_index
)
SELECT dots.period_index, dots.actor_id, dots.actor_email, dots.is_registered, dots.reviews,
  dots.chat_messages, dots.chat_chars, dots.prompt_chars, dots.response_chars, dots.exposure_days
FROM dots
WHERE dots.exposure_days >= ${minAiUsageExposureDays}
  AND ${buildAudiencePredicateSql(audience)}
ORDER BY dots.period_index, dots.actor_id`;
}

function toBoolean(value: AdminQueryValue, fieldName: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`${aiUsageReportLabel} field "${fieldName}" must be a boolean.`);
}

function toCount(value: AdminQueryValue, fieldName: string): number {
  const count = toInteger(value, aiUsageReportLabel, fieldName);
  if (count < 0) {
    throw new Error(`${aiUsageReportLabel} field "${fieldName}" must not be negative.`);
  }

  return count;
}

function parseDot(row: AdminQueryRow, periodCount: number): AiUsageDot {
  const periodIndex = toCount(row.period_index ?? null, "period_index");
  if (periodIndex >= periodCount) {
    throw new Error(`${aiUsageReportLabel} returned a period index outside the requested periods.`);
  }

  return {
    periodIndex,
    actorId: assertIsString(row.actor_id ?? null, aiUsageReportLabel, "actor_id"),
    actorEmail: assertIsString(row.actor_email ?? null, aiUsageReportLabel, "actor_email"),
    isRegistered: toBoolean(row.is_registered ?? null, "is_registered"),
    reviews: toCount(row.reviews ?? null, "reviews"),
    chatMessages: toCount(row.chat_messages ?? null, "chat_messages"),
    chatChars: toCount(row.chat_chars ?? null, "chat_chars"),
    promptChars: toCount(row.prompt_chars ?? null, "prompt_chars"),
    responseChars: toCount(row.response_chars ?? null, "response_chars"),
    exposureDays: toCount(row.exposure_days ?? null, "exposure_days"),
  };
}

/**
 * The report for one selection, or an empty one when the range does not hold a whole period.
 *
 * A range shorter than the selected period length is a legitimate view rather than an error - it is
 * one click away on the period control - so it returns no dots and lets the section say why, without
 * sending a statement whose `VALUES` list would have no rows.
 */
export async function loadAiUsageCohortsReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  periodWeeks: AiUsagePeriodWeeks,
  audience: AiUsageAudience,
): Promise<AiUsageCohortsReport> {
  const plan: AiUsagePeriodPlan = buildAiUsagePeriods(
    assertValidDateRange(filters.dateRange, aiUsageReportLabel),
    periodWeeks,
  );

  if (plan.periods.length === 0) {
    return {
      generatedAtUtc: new Date().toISOString(),
      periods: plan.periods,
      droppedPeriodCount: plan.droppedPeriodCount,
      remainderDays: plan.remainderDays,
      dots: [],
    };
  }

  const response = await runAdminQuery(
    config,
    buildAiUsageCohortsSql(filters, plan.periods, audience),
  );
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined) {
    throw new Error(`${aiUsageReportLabel} query must return exactly one result set.`);
  }

  return {
    generatedAtUtc: response.executedAtUtc,
    periods: plan.periods,
    droppedPeriodCount: plan.droppedPeriodCount,
    remainderDays: plan.remainderDays,
    dots: result.rows.map((row) => parseDot(row, plan.periods.length)),
  };
}
