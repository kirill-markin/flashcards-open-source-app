import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildActorAppUiLanguageSql,
  buildActorConnectionCountrySql,
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

export const mobileFirstLaunchFunnelReportLabel = "Mobile first launch funnel";

/**
 * The first UTC day first opens count from, whatever range is selected: the first day on which the
 * iOS and Android apps both reported the review-screen `screen_viewed` and `review_card_revealed`.
 * Before it a first open would fall out at step two although the person may have studied.
 */
export const mobileFirstLaunchFunnelStartDate = "2026-09-01";

/** Where "studied it properly" is drawn, the same line the deck funnel draws. */
export const mobileFirstLaunchEngagedReviewThreshold = 20;

/** People per step, each step a subset of the one before it: one group's, or the funnel's own sum. */
export type MobileFirstLaunchFunnelCounts = Readonly<{
  firstOpenCount: number;
  reviewScreenCount: number;
  revealedCount: number;
  oneReviewCount: number;
  twoReviewsCount: number;
  twoReviewDaysCount: number;
  engagedReturningCount: number;
  /** First opens whose seven-day window had not closed when the query ran. */
  maturingCount: number;
}>;

/**
 * One group's counts under the key the SQL produced: the dimension's own value,
 * `unresolvedFunnelGroupKey` for a person it cannot place, or `ungroupedMobileFirstLaunchGroupKey`
 * while no dimension is selected.
 */
export type MobileFirstLaunchFunnelGroup = MobileFirstLaunchFunnelCounts & Readonly<{ key: string }>;

/**
 * One entry per group, and exactly one while no dimension is selected.
 *
 * EVERY COUNT IS GROUPED, so a range nobody entered returns no groups at all rather than a row of
 * zeros; the section sums the groups it did get, which is zero people and its own empty state.
 */
export type MobileFirstLaunchFunnelReport = Readonly<{
  generatedAtUtc: string;
  groups: ReadonlyArray<MobileFirstLaunchFunnelGroup>;
}>;

/** The one key of the ungrouped funnel. Nothing reads it: with no dimension there is one group. */
const ungroupedMobileFirstLaunchGroupKey = "all";

/**
 * The two dimensions whose key is not on the cohort row but in a per-actor source joined beside it.
 * The ids are named here because the dimension that declares one and the join that supplies it have
 * to agree, and they are written in two places.
 */
const connectionCountryGroupByDimensionId = "country";
const appUiLanguageGroupByDimensionId = "language";

/**
 * What this funnel offers in its `Group by` field, in picker order.
 *
 * Each expression yields exactly one key per person in the cohort, so the groups partition the
 * funnel and still sum to it. Country and language read the per-actor sources joined beside the
 * cohort, and both can be NULL for somebody they cannot place, which the query folds into the
 * `Unresolved` group.
 */
export const mobileFirstLaunchFunnelGroupByDimensions: ReadonlyArray<FunnelGroupByDimension> = [
  {
    id: platformFunnelGroupByDimensionId,
    label: "Platform",
    // The FIRST open's platform rather than any later one, which is what the funnel is anchored on.
    // A person the cohort kept opened on iOS or Android first, so an iOS open at that same instant
    // means iOS and anything else means Android; two opens at the same microsecond on both
    // platforms read as iOS, the same tie the cohort itself already accepts.
    buildGroupKeySql: () => "CASE WHEN cohort.first_ios_opened_at = cohort.first_opened_at THEN 'ios' ELSE 'android' END",
  },
  {
    id: connectionCountryGroupByDimensionId,
    label: "Connection country",
    buildGroupKeySql: () => "actor_country.country",
  },
  {
    id: appUiLanguageGroupByDimensionId,
    label: "App interface language",
    buildGroupKeySql: () => "actor_language.ui_locale",
  },
];

/**
 * How long before the first app open a `card_created` may be and still not count as earlier activity.
 *
 * Both clients seed the demo onboarding card (`docs/demo-card.md`) during the first launch, and its
 * server-derived `card_created` can land just before the cold `app_opened`. On iOS the store seeds it
 * before `Analytics.track(.appOpened(launchType: .cold))` runs, and on Android the startup coroutine
 * races the lifecycle `ON_START` that tracks the open. The card also carries the device's raw clock,
 * while `app_opened` is corrected for clock skew. No mobile client sends any other event before that
 * open: there is no consent event on mobile.
 */
export const mobileFirstLaunchDemoCardAllowanceSeconds = 60;

/**
 * The per-actor source the selected dimension's key expression reads, joined to the cohort, or no
 * lines for a dimension whose key is already on the cohort row.
 *
 * ONE SOURCE, NEVER BOTH. Each of the two is a scan of its own - the country one cross-joins the
 * retained connection samples to their endpoints and hash-joins the view again, the language one is
 * another full pass over the range - and this query is shaped around the 30 s statement timeout, so
 * a join whose alias the group key never mentions is paid for nothing. `platform` reads
 * `cohort.first_ios_opened_at` and needs neither, and it is both the cheapest dimension and the
 * likeliest first pick. The alias each case supplies is the one the matching dimension's
 * `buildGroupKeySql` names, which is why the two are written against the same id constants.
 */
function buildGroupSourceJoinSqlLines(
  groupByDimension: FunnelGroupByDimension | null,
  dateRange: AnalyticsFilterState["dateRange"],
): ReadonlyArray<string> {
  if (groupByDimension?.id === connectionCountryGroupByDimensionId) {
    return [
      "LEFT JOIN (",
      buildActorConnectionCountrySql(dateRange),
      ") AS actor_country ON actor_country.actor_id = cohort.actor_id",
    ];
  }

  if (groupByDimension?.id === appUiLanguageGroupByDimensionId) {
    return [
      "LEFT JOIN (",
      buildActorAppUiLanguageSql(dateRange),
      ") AS actor_language ON actor_language.actor_id = cohort.actor_id",
    ];
  }

  // `None` and `platform` both land here: neither reads anything outside the cohort row.
  return [];
}

/**
 * One row per person whose first-ever trusted event is a mobile `app_opened` on a selected UTC day
 * from `mobileFirstLaunchFunnelStartDate` on, reduced in SQL to one row of step counts per group
 * that follow the funnel rule in `../funnels/funnelSections.ts`.
 *
 * THE GROUP KEY IS A PROPERTY OF THE PERSON, never of a step: it is computed once per cohort row and
 * every count is taken inside it, so the groups partition the funnel and sum back to it step by
 * step, `maturing_count` included. `None` groups by one literal, so there is one group of everybody
 * and no dimension source is joined at all, and any other dimension joins only the one source its
 * own key reads.
 *
 * NO STEP HERE JOINS A COHORT TO `analytics.product_events_resolved` BY MEMBERSHIP, and that is what
 * keeps a long range inside the 30 s statement timeout. The view's `actor_id` is a computed
 * `COALESCE` that no index serves, and an `= ANY (ARRAY(...))` membership is compared entry by entry,
 * so each view row costs the size of the cohort, and a year's cohort is too large for that. Instead:
 *
 * - `actor_first_events` makes one pass over trusted history up to the range end and groups it by
 *   actor. The pass reads no cohort, so it costs the same for a week as for a year. Per actor it keeps
 *   the first app open, the first open on a selected mobile platform, the first `card_created`, and the
 *   first of every other event. `first_launches` then keeps the people whose first app open is on a
 *   selected day and on iOS or Android, with no earlier event of any other name. A `card_created` is
 *   allowed up to `mobileFirstLaunchDemoCardAllowanceSeconds` before the open, and nothing else is.
 *   The allowance is not simply "any `card_created`": a person whose first activity was creating cards
 *   through the agent API or MCP must not pass as new. Trusted is `buildTrustedActorRowsFilterSql`,
 *   so a marketing-site visit sent through the credential-free collector is not an earlier event.
 * - `step_events` hash-joins the step event rows in the range to `actor_first_events`. That relation
 *   is the per-actor aggregate, and it is scanned with no filter of its own, so the planner never sees
 *   the one-row guess that would make it rescan the view per person. Each row is bounded to its own
 *   actor's `[first open, first open + 7 days]`, so only the first week of people whose first open is
 *   in the range is read. Rows of people who are not in the cohort are dropped when the cohort joins
 *   the step aggregates.
 * - Each step is then a `GROUP BY` over those rows, joined to the step above it, so no step is a
 *   per-person scan.
 *
 * Every later step is the same actor within seven days of the first app open, at or after the step
 * above it: the review screen, then an answer reveal, then a first `review_answered`. The review
 * count runs from that first answer to the seven-day bound, and the review day count is the distinct
 * UTC dates those same answers fall on. The tail steps are two reviews, then reviews on two distinct
 * days, then the threshold together with three distinct days, and all three read that one per-person
 * aggregate of the count pair, so a later step can never exceed an earlier one. `review_answered` is
 * the server's fact and carries no platform, so an answer given on another device of the same person
 * counts. Two app opens at the same microsecond on different platforms count as a mobile first open.
 */
export function buildMobileFirstLaunchFunnelSql(
  filters: AnalyticsFilterState,
  groupByDimension: FunnelGroupByDimension | null,
): string {
  const { from: selectedFrom, to } = assertValidDateRange(filters.dateRange, mobileFirstLaunchFunnelReportLabel);
  // A range ending before the start date leaves `from` after `to`, so nobody enters.
  const from = laterCalendarDate(selectedFrom, mobileFirstLaunchFunnelStartDate);
  const rangeStartSql = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;
  const stepWindowEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`;
  const windowSql = `INTERVAL '${catalogInstallConversionWindowDays} days'`;
  // Every count is grouped, always: with no dimension the key is one literal, so the shape of the
  // query is the same whichever way the field is set and `None` is simply one group of everybody.
  // `::text` on both branches, deliberately rather than by default: the key is also the `GROUP BY`
  // target and is read back as a string, so nothing here depends on how Postgres resolves the type
  // of a bare literal or of a `COALESCE` over one.
  const groupKeySql = groupByDimension === null
    ? `${escapeSqlStringLiteral(ungroupedMobileFirstLaunchGroupKey)}::text`
    : `COALESCE(${groupByDimension.buildGroupKeySql(filters)}, ${escapeSqlStringLiteral(unresolvedFunnelGroupKey)})::text`;
  const groupSourceJoinSqlLines = buildGroupSourceJoinSqlLines(groupByDimension, filters.dateRange);

  return [
    "WITH actor_first_events AS MATERIALIZED (",
    "  SELECT",
    "    resolved.actor_id,",
    "    MIN(resolved.occurred_at) FILTER (WHERE resolved.event_name = 'app_opened') AS first_opened_at,",
    "    MIN(resolved.occurred_at) FILTER (",
    "      WHERE resolved.event_name = 'app_opened'",
    "        AND resolved.platform IN ('ios', 'android')",
    `        AND ${buildEventPlatformsFilterSql("resolved.platform", filters.eventPlatforms)}`,
    "    ) AS first_selected_mobile_opened_at,",
    // Only the `platform` group key reads this: it names which of the two mobile platforms the
    // first open was on, without a second pass over the events to find that one row again.
    "    MIN(resolved.occurred_at) FILTER (",
    "      WHERE resolved.event_name = 'app_opened' AND resolved.platform = 'ios'",
    "    ) AS first_ios_opened_at,",
    "    MIN(resolved.occurred_at) FILTER (WHERE resolved.event_name = 'card_created') AS first_card_created_at,",
    "    MIN(resolved.occurred_at) FILTER (WHERE resolved.event_name <> 'card_created') AS first_other_event_at",
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.actor_id IS NOT NULL",
    `    AND ${buildTrustedActorRowsFilterSql("resolved.trust_level")}`,
    `    AND resolved.occurred_at < ${rangeEndSql}`,
    "  GROUP BY resolved.actor_id",
    "), first_launches AS MATERIALIZED (",
    "  SELECT history.actor_id, history.first_opened_at, history.first_ios_opened_at",
    "  FROM actor_first_events AS history",
    `  WHERE history.first_opened_at >= ${rangeStartSql}`,
    "    AND history.first_selected_mobile_opened_at = history.first_opened_at",
    // `first_other_event_at` includes the first app open itself, so equality is "nothing earlier".
    "    AND history.first_other_event_at >= history.first_opened_at",
    "    AND (",
    "      history.first_card_created_at IS NULL",
    `      OR history.first_card_created_at >= history.first_opened_at - INTERVAL '${mobileFirstLaunchDemoCardAllowanceSeconds} seconds'`,
    "    )",
    "), cohort AS MATERIALIZED (",
    "  SELECT candidate.actor_id, candidate.first_opened_at, candidate.first_ios_opened_at",
    "  FROM first_launches AS candidate",
    "  WHERE TRUE",
    ...buildExcludedActorSqlLines("candidate.actor_id::text"),
    // The one place the audience mode reaches this funnel. There are no cookieless people on mobile -
    // the hash exists only on marketing-site rows - so `all` is the default mode here and adds nothing.
    ...buildFunnelAudienceActorSqlLines(filters, "candidate.actor_id::text"),
    `    AND ${buildConnectionCountriesFilterSql("candidate.actor_id::text", filters.connectionCountries, filters.dateRange)}`,
    `    AND ${buildAppUiLanguagesFilterSql("candidate.actor_id::text", filters.appUiLanguages, filters.dateRange)}`,
    "), step_events AS MATERIALIZED (",
    "  SELECT",
    "    history.actor_id,",
    "    step_event.event_name,",
    "    step_event.occurred_at",
    "  FROM analytics.product_events_resolved AS step_event",
    "  INNER JOIN actor_first_events AS history",
    "    ON history.actor_id = step_event.actor_id",
    "    AND step_event.occurred_at >= history.first_opened_at",
    `    AND step_event.occurred_at <= history.first_opened_at + ${windowSql}`,
    "  WHERE (",
    "      step_event.event_name IN ('review_card_revealed', 'review_answered')",
    "      OR (step_event.event_name = 'screen_viewed' AND step_event.screen = 'review')",
    "    )",
    `    AND ${buildTrustedActorRowsFilterSql("step_event.trust_level")}`,
    `    AND step_event.occurred_at >= ${rangeStartSql}`,
    `    AND step_event.occurred_at < ${stepWindowEndSql}`,
    "), review_screens AS MATERIALIZED (",
    "  SELECT screen_event.actor_id, MIN(screen_event.occurred_at) AS review_screen_at",
    "  FROM step_events AS screen_event",
    "  WHERE screen_event.event_name = 'screen_viewed'",
    "  GROUP BY screen_event.actor_id",
    "), reveals AS MATERIALIZED (",
    "  SELECT revealed_event.actor_id, MIN(revealed_event.occurred_at) AS revealed_at",
    "  FROM step_events AS revealed_event",
    "  INNER JOIN review_screens AS review_screen",
    "    ON review_screen.actor_id = revealed_event.actor_id",
    "    AND revealed_event.occurred_at >= review_screen.review_screen_at",
    "  WHERE revealed_event.event_name = 'review_card_revealed'",
    "  GROUP BY revealed_event.actor_id",
    "), first_reviews AS MATERIALIZED (",
    "  SELECT review_event.actor_id, MIN(review_event.occurred_at) AS first_review_at",
    "  FROM step_events AS review_event",
    "  INNER JOIN reveals AS revealed",
    "    ON revealed.actor_id = review_event.actor_id",
    "    AND review_event.occurred_at >= revealed.revealed_at",
    "  WHERE review_event.event_name = 'review_answered'",
    "  GROUP BY review_event.actor_id",
    "), person_engagement AS MATERIALIZED (",
    "  SELECT",
    "    review.actor_id,",
    "    COUNT(*)::int AS review_count,",
    "    COUNT(DISTINCT (review.occurred_at AT TIME ZONE 'UTC')::date)::int AS review_day_count",
    "  FROM step_events AS review",
    "  INNER JOIN first_reviews AS first_review",
    "    ON first_review.actor_id = review.actor_id",
    "    AND review.occurred_at >= first_review.first_review_at",
    "  WHERE review.event_name = 'review_answered'",
    "  GROUP BY review.actor_id",
    ")",
    "SELECT",
    `  ${groupKeySql} AS group_key,`,
    "  COUNT(*)::int AS first_open_count,",
    "  COUNT(review_screen.review_screen_at)::int AS review_screen_count,",
    "  COUNT(revealed.revealed_at)::int AS revealed_count,",
    "  COUNT(first_review.first_review_at)::int AS one_review_count,",
    "  (COUNT(*) FILTER (WHERE engagement.review_count >= 2))::int AS two_reviews_count,",
    "  (COUNT(*) FILTER (WHERE engagement.review_day_count >= 2))::int AS two_review_days_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE engagement.review_count >= ${mobileFirstLaunchEngagedReviewThreshold}`,
    "      AND engagement.review_day_count >= 3",
    "  ))::int AS engaged_returning_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE cohort.first_opened_at + ${windowSql} > now()`,
    "  ))::int AS maturing_count",
    "FROM cohort",
    "LEFT JOIN review_screens AS review_screen ON review_screen.actor_id = cohort.actor_id",
    "LEFT JOIN reveals AS revealed ON revealed.actor_id = cohort.actor_id",
    "LEFT JOIN first_reviews AS first_review ON first_review.actor_id = cohort.actor_id",
    "LEFT JOIN person_engagement AS engagement ON engagement.actor_id = cohort.actor_id",
    ...groupSourceJoinSqlLines,
    "GROUP BY group_key",
  ].join("\n");
}

export async function loadMobileFirstLaunchFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  groupByDimension: FunnelGroupByDimension | null,
): Promise<MobileFirstLaunchFunnelReport> {
  const response = await runAdminQuery(
    config,
    buildMobileFirstLaunchFunnelSql(filters, groupByDimension),
  );
  if (response.resultSets.length !== 1) {
    throw new Error(
      `${mobileFirstLaunchFunnelReportLabel} must return exactly one result set. Got ${response.resultSets.length}.`,
    );
  }

  // No row is a legal answer and means nobody entered the funnel, because every count is grouped.
  const rows = response.resultSets[0]?.rows ?? [];

  return {
    generatedAtUtc: response.executedAtUtc,
    groups: rows.map((row) => {
      const count = (fieldName: string): number => (
        toInteger(row[fieldName] ?? null, mobileFirstLaunchFunnelReportLabel, fieldName)
      );

      return {
        key: assertIsString(row.group_key ?? null, mobileFirstLaunchFunnelReportLabel, "group_key"),
        firstOpenCount: count("first_open_count"),
        reviewScreenCount: count("review_screen_count"),
        revealedCount: count("revealed_count"),
        oneReviewCount: count("one_review_count"),
        twoReviewsCount: count("two_reviews_count"),
        twoReviewDaysCount: count("two_review_days_count"),
        engagedReturningCount: count("engaged_returning_count"),
        maturingCount: count("maturing_count"),
      };
    }),
  };
}
