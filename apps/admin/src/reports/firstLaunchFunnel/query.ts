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
import {
  platformFunnelGroupByDimensionId,
  unresolvedFunnelGroupKey,
  type FunnelGroupByDimension,
} from "../funnels/funnelGroupBy";
import { assertIsString, assertValidDateRange, laterCalendarDate, toInteger } from "../reportValues";

export const firstLaunchFunnelReportLabel = "First launch funnel";

/**
 * The first UTC day first launches count from, whatever range is selected: the first day on which the
 * iOS, Android and web apps all reported the review-screen `screen_viewed` and `review_card_revealed`.
 * Before it a first launch would fall out at step two although the person may have studied.
 */
export const firstLaunchFunnelStartDate = "2026-09-01";

/** Where "studied it properly" is drawn, the same line the deck funnel draws. */
export const firstLaunchEngagedReviewThreshold = 20;

/** People per step, each step a subset of the one before it: one group's, or the funnel's own sum. */
export type FirstLaunchFunnelCounts = Readonly<{
  firstLaunchCount: number;
  reviewScreenCount: number;
  revealedCount: number;
  oneReviewCount: number;
  twoReviewsCount: number;
  twoReviewDaysCount: number;
  engagedReturningCount: number;
  /** First launches whose seven-day window had not closed when the query ran. */
  maturingCount: number;
}>;

/**
 * One group's counts under the key the SQL produced: the dimension's own value,
 * `unresolvedFunnelGroupKey` for a person it cannot place, or `ungroupedFirstLaunchGroupKey`
 * while no dimension is selected.
 */
export type FirstLaunchFunnelGroup = FirstLaunchFunnelCounts & Readonly<{ key: string }>;

/**
 * One entry per group, and exactly one while no dimension is selected.
 *
 * EVERY COUNT IS GROUPED, so a range nobody entered returns no groups at all rather than a row of
 * zeros; the section sums the groups it did get, which is zero people and its own empty state.
 */
export type FirstLaunchFunnelReport = Readonly<{
  generatedAtUtc: string;
  groups: ReadonlyArray<FirstLaunchFunnelGroup>;
}>;

/** The one key of the ungrouped funnel. Nothing reads it: with no dimension there is one group. */
const ungroupedFirstLaunchGroupKey = "all";

/**
 * The dimensions whose key is not on the cohort row but in a source joined beside it. The ids are
 * named here because the dimension that declares one and the join that supplies it have to agree,
 * and they are written in two places.
 */
const connectionCountryGroupByDimensionId = "country";
const appUiLanguageGroupByDimensionId = "language";
const signInStateGroupByDimensionId = "sign-in-state";
const appVersionGroupByDimensionId = "app-version";

/**
 * What this funnel offers in its `Group by` field, in picker order.
 *
 * Each expression yields exactly one key per person in the cohort, so the groups partition the
 * funnel and still sum to it. Country and language read the per-actor sources joined beside the
 * cohort, sign-in state and app version the first launch's own row, and any of them can be NULL for
 * somebody it cannot place, which the query folds into the `Unresolved` group.
 */
export const firstLaunchFunnelGroupByDimensions: ReadonlyArray<FunnelGroupByDimension> = [
  {
    id: platformFunnelGroupByDimensionId,
    label: "Platform",
    // The FIRST launch's platform rather than any later one, which is what the funnel is anchored on.
    // A person the cohort kept launched on iOS, Android or web first, so an iOS or Android launch at
    // that same instant names it and anything else means web; two launches at the same microsecond
    // on different platforms read as iOS, then Android, the same tie the cohort itself accepts.
    buildGroupKeySql: () => [
      "CASE",
      "  WHEN cohort.first_ios_launch_at = cohort.first_launch_at THEN 'ios'",
      "  WHEN cohort.first_android_launch_at = cohort.first_launch_at THEN 'android'",
      "  ELSE 'web'",
      "END",
    ].join("\n"),
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
  {
    id: signInStateGroupByDimensionId,
    label: "Sign-in state",
    buildGroupKeySql: () => [
      "CASE anchor_launch.trust_level",
      "  WHEN 'guest_client' THEN 'Guest'",
      "  WHEN 'authenticated_client' THEN 'Signed in'",
      "  ELSE anchor_launch.trust_level",
      "END",
    ].join("\n"),
  },
  {
    id: appVersionGroupByDimensionId,
    label: "App version",
    buildGroupKeySql: () => "NULLIF(anchor_launch.app_version, '')",
  },
];

/**
 * How long before the first app launch a `card_created` may be and still not count as earlier activity.
 *
 * Every client seeds the demo onboarding card (`docs/demo-card.md`) during the first launch, and its
 * server-derived `card_created` can land just before the launch event. On iOS the store seeds it
 * before `Analytics.track(.appOpened(launchType: .cold))` runs, and on Android the startup coroutine
 * races the lifecycle `ON_START` that tracks the open. The card also carries the device's raw clock,
 * while client events are corrected for clock skew.
 */
export const firstLaunchDemoCardAllowanceSeconds = 60;

/**
 * A row that is an app launch. A reconstructed open (`origin = 'backfill'`, migrations 0121 and
 * 0126) is never one: it stands for activity the series missed, so it still counts as earlier
 * activity, but its instant is derived, not a launch the app reported.
 */
function buildLaunchEventSql(rowAlias: string): string {
  return `(${rowAlias}.event_name IN ('app_opened', 'screen_viewed') AND ${rowAlias}.origin <> 'backfill')`;
}

/**
 * Keeps every row except the auth service's own sign-in page rows
 * (`docs/analytics-db-access.md#auth-origin-sign-in-rows`): client rows on `web` with no app version.
 * The web app always sends its version (`sendAnalyticsEventsBatch` in
 * `apps/web/src/api/endpoints/analytics.ts`), while server and backfill rows carry none, hence the
 * origin test. Such a row is neither a launch nor earlier activity, so a sign-up's sign-in page view
 * never disqualifies their first launch.
 */
function buildNonAuthOriginRowSql(rowAlias: string): string {
  return `(${rowAlias}.origin <> 'client' OR ${rowAlias}.platform IS DISTINCT FROM 'web' OR ${rowAlias}.app_version IS NOT NULL)`;
}

/**
 * The source the selected dimension's key expression reads, joined to the cohort, or no lines for a
 * dimension whose key is already on the cohort row.
 *
 * ONE SOURCE, NEVER TWO. Each is a scan of its own - the country one cross-joins the retained
 * connection samples to their endpoints and hash-joins the view again, the language one is another
 * full pass over the range, the first launch's row is another pass over the range's launch rows -
 * and this query is shaped around the 30 s statement timeout, so a join whose alias the group key
 * never mentions is paid for nothing. `platform` reads the cohort's per-platform first launches and
 * needs none, and it is both the cheapest dimension and the likeliest first pick. The alias each case
 * supplies is the one the matching dimension's `buildGroupKeySql` names, which is why the two are
 * written against the same id constants.
 */
function buildGroupSourceJoinSqlLines(
  groupByDimension: FunnelGroupByDimension | null,
  filters: AnalyticsFilterState,
  rangeStartSql: string,
  rangeEndSql: string,
): ReadonlyArray<string> {
  if (groupByDimension?.id === connectionCountryGroupByDimensionId) {
    return [
      "LEFT JOIN (",
      buildActorConnectionCountrySql(filters.dateRange),
      ") AS actor_country ON actor_country.actor_id = cohort.actor_id",
    ];
  }

  if (groupByDimension?.id === appUiLanguageGroupByDimensionId) {
    return [
      "LEFT JOIN (",
      buildActorAppUiLanguageSql(filters.dateRange),
      ") AS actor_language ON actor_language.actor_id = cohort.actor_id",
    ];
  }

  // The first launch's own row, found the way `step_events` finds steps: the range's launch rows joined
  // to the unfiltered `actor_first_events` on the actor and the first launch's instant, never to the
  // filtered cohort, whose one-row estimate would rescan the view per person. Actors outside the cohort
  // drop out at the outer join. The cohort pass's launch, trust and auth-origin rules and the platform
  // filter stay on the launch row, so only a row the cohort could anchor on names the group, never a
  // reconstructed open at that instant. Two launches at that instant are the cohort's own tie, so the
  // row is picked in the platform dimension's order, then an open before a screen view.
  if (
    groupByDimension?.id === signInStateGroupByDimensionId
    || groupByDimension?.id === appVersionGroupByDimensionId
  ) {
    return [
      "LEFT JOIN (",
      "  SELECT DISTINCT ON (launch.actor_id) launch.actor_id, launch.trust_level, launch.app_version",
      "  FROM analytics.product_events_resolved AS launch",
      "  INNER JOIN actor_first_events AS history",
      "    ON history.actor_id = launch.actor_id",
      "    AND launch.occurred_at = history.first_launch_at",
      `  WHERE ${buildLaunchEventSql("launch")}`,
      "    AND launch.platform IN ('ios', 'android', 'web')",
      `    AND ${buildEventPlatformsFilterSql("launch.platform", filters.eventPlatforms)}`,
      `    AND ${buildTrustedActorRowsFilterSql("launch.trust_level")}`,
      `    AND ${buildNonAuthOriginRowSql("launch")}`,
      `    AND launch.occurred_at >= ${rangeStartSql}`,
      `    AND launch.occurred_at < ${rangeEndSql}`,
      "  ORDER BY",
      "    launch.actor_id,",
      "    CASE launch.platform WHEN 'ios' THEN 0 WHEN 'android' THEN 1 ELSE 2 END,",
      "    launch.event_name,",
      "    launch.event_id",
      ") AS anchor_launch ON anchor_launch.actor_id = cohort.actor_id",
    ];
  }

  // `None` and `platform` both land here: neither reads anything outside the cohort row.
  return [];
}

/**
 * One row per person whose first-ever trusted event is an app launch on iOS, Android or web on a
 * selected UTC day from `firstLaunchFunnelStartDate` on, reduced in SQL to one row of step counts
 * per group that follow the funnel rule in `../funnels/funnelSections.ts`.
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
 *   actor. The pass reads no cohort, so it costs the same for a week as for a year. A launch is an
 *   `app_opened` or a `screen_viewed` the app reported (`buildLaunchEventSql`): either can be the
 *   first trusted row of a first launch, because a client can queue a screen view ahead of its open.
 *   The auth service's sign-in page rows are dropped from the whole pass (`buildNonAuthOriginRowSql`).
 *   Per actor it keeps the first launch, the first launch on a selected one of the three platforms,
 *   the first launch on iOS and on Android, the first `card_created`, and the first event other than
 *   `card_created`, a reconstructed open included. `first_launches` then keeps the
 *   people whose first launch is on a selected day and on a selected platform, with no earlier event.
 *   A `card_created` is allowed up to `firstLaunchDemoCardAllowanceSeconds` before the launch, and
 *   nothing else is. The allowance is not simply "any `card_created`": a person whose first activity
 *   was creating cards through the agent API or MCP must not pass as new. Trusted is `buildTrustedActorRowsFilterSql`,
 *   so a marketing-site visit sent through the credential-free collector is not an earlier event.
 * - `step_events` hash-joins the step event rows in the range to `actor_first_events`. That relation
 *   is the per-actor aggregate, and it is scanned with no filter of its own, so the planner never sees
 *   the one-row guess that would make it rescan the view per person. Each row is bounded to its own
 *   actor's `[first launch, first launch + 7 days]`, so only the first week of people whose first
 *   launch is in the range is read. Rows of people who are not in the cohort are dropped when the
 *   cohort joins the step aggregates.
 * - Each step is then a `GROUP BY` over those rows, joined to the step above it, so no step is a
 *   per-person scan.
 * - A sign-in state or app version reads the first launch's own row the same way, launch rows joined
 *   to `actor_first_events` rather than to the cohort, and only while that dimension is selected
 *   (`buildGroupSourceJoinSqlLines`).
 *
 * Every later step is the same actor within seven days of the first launch, at or after the step
 * above it: the review screen, which the launch itself may be, then an answer reveal, then a first
 * `review_answered`. The review count runs from that first answer to the seven-day bound, and the
 * review day count is the distinct UTC dates those same answers fall on. The tail steps are two
 * reviews, then reviews on two distinct days, then the threshold together with three distinct days,
 * and all three read that one per-person aggregate of the count pair, so a later step can never
 * exceed an earlier one. `review_answered` is
 * the server's fact and carries no platform, so an answer given on another device of the same person
 * counts. Two launches at the same microsecond on different platforms count as a first launch when
 * either platform is selected.
 */
export function buildFirstLaunchFunnelSql(
  filters: AnalyticsFilterState,
  groupByDimension: FunnelGroupByDimension | null,
): string {
  const { from: selectedFrom, to } = assertValidDateRange(filters.dateRange, firstLaunchFunnelReportLabel);
  // A range ending before the start date leaves `from` after `to`, so nobody enters.
  const from = laterCalendarDate(selectedFrom, firstLaunchFunnelStartDate);
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
    ? `${escapeSqlStringLiteral(ungroupedFirstLaunchGroupKey)}::text`
    : `COALESCE(${groupByDimension.buildGroupKeySql(filters)}, ${escapeSqlStringLiteral(unresolvedFunnelGroupKey)})::text`;
  const groupSourceJoinSqlLines = buildGroupSourceJoinSqlLines(groupByDimension, filters, rangeStartSql, rangeEndSql);
  const launchEventSql = buildLaunchEventSql("resolved");

  return [
    "WITH actor_first_events AS MATERIALIZED (",
    "  SELECT",
    "    resolved.actor_id,",
    `    MIN(resolved.occurred_at) FILTER (WHERE ${launchEventSql}) AS first_launch_at,`,
    "    MIN(resolved.occurred_at) FILTER (",
    `      WHERE ${launchEventSql}`,
    "        AND resolved.platform IN ('ios', 'android', 'web')",
    `        AND ${buildEventPlatformsFilterSql("resolved.platform", filters.eventPlatforms)}`,
    "    ) AS first_selected_launch_at,",
    // Only the `platform` group key reads these two: they name which platform the first launch was
    // on, without a second pass over the events to find that one row again.
    "    MIN(resolved.occurred_at) FILTER (",
    `      WHERE ${launchEventSql} AND resolved.platform = 'ios'`,
    "    ) AS first_ios_launch_at,",
    "    MIN(resolved.occurred_at) FILTER (",
    `      WHERE ${launchEventSql} AND resolved.platform = 'android'`,
    "    ) AS first_android_launch_at,",
    "    MIN(resolved.occurred_at) FILTER (WHERE resolved.event_name = 'card_created') AS first_card_created_at,",
    "    MIN(resolved.occurred_at) FILTER (WHERE resolved.event_name <> 'card_created') AS first_other_event_at",
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.actor_id IS NOT NULL",
    `    AND ${buildTrustedActorRowsFilterSql("resolved.trust_level")}`,
    `    AND ${buildNonAuthOriginRowSql("resolved")}`,
    `    AND resolved.occurred_at < ${rangeEndSql}`,
    "  GROUP BY resolved.actor_id",
    "), first_launches AS MATERIALIZED (",
    "  SELECT history.actor_id, history.first_launch_at, history.first_ios_launch_at, history.first_android_launch_at",
    "  FROM actor_first_events AS history",
    `  WHERE history.first_launch_at >= ${rangeStartSql}`,
    "    AND history.first_selected_launch_at = history.first_launch_at",
    // `first_other_event_at` includes the first launch itself, so equality is "nothing earlier".
    "    AND history.first_other_event_at >= history.first_launch_at",
    "    AND (",
    "      history.first_card_created_at IS NULL",
    `      OR history.first_card_created_at >= history.first_launch_at - INTERVAL '${firstLaunchDemoCardAllowanceSeconds} seconds'`,
    "    )",
    "), cohort AS MATERIALIZED (",
    "  SELECT candidate.actor_id, candidate.first_launch_at, candidate.first_ios_launch_at, candidate.first_android_launch_at",
    "  FROM first_launches AS candidate",
    "  WHERE TRUE",
    ...buildExcludedActorSqlLines("candidate.actor_id::text"),
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
    "    AND step_event.occurred_at >= history.first_launch_at",
    `    AND step_event.occurred_at <= history.first_launch_at + ${windowSql}`,
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
    "  COUNT(*)::int AS first_launch_count,",
    "  COUNT(review_screen.review_screen_at)::int AS review_screen_count,",
    "  COUNT(revealed.revealed_at)::int AS revealed_count,",
    "  COUNT(first_review.first_review_at)::int AS one_review_count,",
    "  (COUNT(*) FILTER (WHERE engagement.review_count >= 2))::int AS two_reviews_count,",
    "  (COUNT(*) FILTER (WHERE engagement.review_day_count >= 2))::int AS two_review_days_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE engagement.review_count >= ${firstLaunchEngagedReviewThreshold}`,
    "      AND engagement.review_day_count >= 3",
    "  ))::int AS engaged_returning_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE cohort.first_launch_at + ${windowSql} > now()`,
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

export async function loadFirstLaunchFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  groupByDimension: FunnelGroupByDimension | null,
  signal: AbortSignal,
): Promise<FirstLaunchFunnelReport> {
  const response = await runAdminQuery(
    config,
    buildFirstLaunchFunnelSql(filters, groupByDimension),
    signal,
  );
  if (response.resultSets.length !== 1) {
    throw new Error(
      `${firstLaunchFunnelReportLabel} must return exactly one result set. Got ${response.resultSets.length}.`,
    );
  }

  // No row is a legal answer and means nobody entered the funnel, because every count is grouped.
  const rows = response.resultSets[0]?.rows ?? [];

  return {
    generatedAtUtc: response.executedAtUtc,
    groups: rows.map((row) => {
      const count = (fieldName: string): number => (
        toInteger(row[fieldName] ?? null, firstLaunchFunnelReportLabel, fieldName)
      );

      return {
        key: assertIsString(row.group_key ?? null, firstLaunchFunnelReportLabel, "group_key"),
        firstLaunchCount: count("first_launch_count"),
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
