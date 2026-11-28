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
  reviewAndCardAddedCount: number;
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
      buildActorConnectionCountrySql(filters.dateRange, null),
      ") AS actor_country ON actor_country.actor_id = cohort.actor_id",
    ];
  }

  if (groupByDimension?.id === appUiLanguageGroupByDimensionId) {
    return [
      "LEFT JOIN (",
      buildActorAppUiLanguageSql(filters.dateRange, null),
      ") AS actor_language ON actor_language.actor_id = cohort.actor_id",
    ];
  }

  // Join to unfiltered history to avoid a small cohort estimate that can trigger a view scan per
  // actor. Apply the cohort's launch rules so only an eligible launch can supply the group key.
  // Break ties in the platform dimension's order, then prefer an open to a screen view.
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
 * per group.
 *
 * THE GROUP KEY IS A PROPERTY OF THE PERSON, never of a step: it is computed once per cohort row and
 * every count is taken inside it, so the groups partition the funnel and sum back to it step by
 * step, `maturing_count` included. `None` groups by one literal, so there is one group of everybody
 * and no dimension source is joined at all, and any other dimension joins only the one source its
 * own key reads.
 *
 * - `actor_first_events` makes one pass over trusted history up to the range end and groups it by
 *   actor. The pass reads no cohort, so it costs the same for a week as for a year. A launch is an
 *   `app_opened` or a `screen_viewed` the app reported (`buildLaunchEventSql`): either can be the
 *   first trusted row of a first launch, because a client can queue a screen view ahead of its open.
 *   The auth service's sign-in page rows are dropped from the whole pass (`buildNonAuthOriginRowSql`).
 *   Per actor it keeps the first launch, the first launch on a selected one of the three platforms,
 *   the first launch on iOS and on Android, the first `card_created`, and the first other event,
 *   a reconstructed open included.
 *   `first_launches` then keeps the people whose first launch is on a selected day and on a selected
 *   platform, with no earlier event.
 *   A `card_created` is allowed up to `firstLaunchDemoCardAllowanceSeconds` before the launch, and
 *   nothing else is. The allowance is not simply "any `card_created`": a person whose first activity
 *   was creating cards through the agent API or MCP must not pass as new. Trusted is `buildTrustedActorRowsFilterSql`,
 *   so a marketing-site visit sent through the credential-free collector is not an earlier event.
 * - A sign-in state or app version reads the first launch's own row from launch rows joined
 *   to `actor_first_events`, and only while that dimension is selected
 *   (`buildGroupSourceJoinSqlLines`).
 *
 * A person can add their first card before or after their first accepted review. The engagement
 * aggregate starts at that first review, but stays empty until the person reviews again after
 * both events. That lets reviews before the first card addition contribute to the totals without
 * letting the addition itself qualify someone for a later study step.
 * Two launches at the same microsecond on different platforms count as a first launch when either
 * platform is selected.
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
  const liveCardCreationSql = "(step_event.event_name = 'card_created' AND step_event.origin = 'server')";

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
    // Durable addition facts can be dated before launch by a device snapshot. They change the
    // evidence for the addition step, not the launch-eligibility history.
    "    AND resolved.event_name NOT IN ('card_addition_committed', 'card_addition_recovered')",
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
    "    cohort.actor_id,",
    "    step_event.event_name,",
    "    step_time.step_at,",
    // A synced review may keep its device time, but a manual save uses a corrected clock.
    "    CASE WHEN step_event.event_name = 'manual_card_saved'",
    "      THEN GREATEST(step_time.step_at, step_event.client_occurred_at)",
    "      ELSE step_time.step_at",
    "    END AS ordering_at,",
    // Live and backfilled reviews can have their occurrence time replaced by receipt time.
    "    (step_event.occurred_at <> step_event.server_received_at",
    "      OR step_event.client_occurred_at IS NOT NULL) AS has_occurrence_time",
    "  FROM analytics.product_events_resolved AS step_event",
    // Live creations can carry a timestamp from before the write committed.
    "  CROSS JOIN LATERAL (SELECT CASE",
    `    WHEN ${liveCardCreationSql}`,
    "      THEN step_event.server_received_at",
    "    ELSE step_event.occurred_at",
    "  END AS step_at) AS step_time",
    "  INNER JOIN cohort",
    "    ON cohort.actor_id = step_event.actor_id",
    "    AND step_time.step_at >= cohort.first_launch_at",
    `    AND step_time.step_at <= cohort.first_launch_at + ${windowSql}`,
    "  WHERE (",
    "      step_event.event_name IN ('review_card_revealed', 'review_answered')",
    "      OR (step_event.event_name = 'screen_viewed' AND step_event.screen = 'review')",
    "      OR (step_event.event_name = 'manual_card_saved' AND step_event.origin = 'client')",
    // App-origin card_created also covers demo seed writes. Only the named sources prove an addition.
    "      OR (step_event.event_name = 'card_created' AND step_event.origin IN ('server', 'backfill')",
    "        AND step_event.event_properties->>'source' IN ('ai_chat', 'agent', 'package_import'))",
    "      OR (step_event.event_name = 'card_addition_committed' AND step_event.origin = 'server'",
    "        AND step_event.event_properties->>'demo_status' = 'non_demo')",
    "      OR (step_event.event_name = 'card_addition_recovered' AND step_event.origin = 'backfill'",
    "        AND step_event.trust_level = 'backfill_derived')",
    "      OR (step_event.event_name IN ('catalog_deck_installed', 'workspace_package_imported')",
    "        AND step_event.origin IN ('server', 'backfill')",
    "        AND jsonb_typeof(step_event.event_properties->'card_count') = 'number'",
    "        AND step_event.event_properties->'card_count' > '0'::jsonb)",
    "    )",
    `    AND ${buildTrustedActorRowsFilterSql("step_event.trust_level")}`,
    // Bounds on the actual timestamp columns let Postgres estimate the scan and hash the small cohort.
    "    AND (",
    `      (${liveCardCreationSql}`,
    `        AND step_event.server_received_at >= ${rangeStartSql}`,
    `        AND step_event.server_received_at < ${stepWindowEndSql})`,
    `      OR (NOT ${liveCardCreationSql}`,
    `        AND step_event.occurred_at >= ${rangeStartSql}`,
    `        AND step_event.occurred_at < ${stepWindowEndSql})`,
    "    )",
    "), review_screens AS MATERIALIZED (",
    "  SELECT screen_event.actor_id, MIN(screen_event.step_at) AS review_screen_at",
    "  FROM step_events AS screen_event",
    "  WHERE screen_event.event_name = 'screen_viewed'",
    "  GROUP BY screen_event.actor_id",
    "), reveals AS MATERIALIZED (",
    "  SELECT revealed_event.actor_id, MIN(revealed_event.step_at) AS revealed_at",
    "  FROM step_events AS revealed_event",
    "  INNER JOIN review_screens AS review_screen",
    "    ON review_screen.actor_id = revealed_event.actor_id",
    "    AND revealed_event.step_at >= review_screen.review_screen_at",
    "  WHERE revealed_event.event_name = 'review_card_revealed'",
    "  GROUP BY revealed_event.actor_id",
    "), first_reviews AS MATERIALIZED (",
    "  SELECT review_event.actor_id, MIN(review_event.step_at) AS first_review_at",
    "  FROM step_events AS review_event",
    "  INNER JOIN reveals AS revealed",
    "    ON revealed.actor_id = review_event.actor_id",
    "    AND review_event.step_at >= revealed.revealed_at",
    "  WHERE review_event.event_name = 'review_answered'",
    "  GROUP BY review_event.actor_id",
    "), bounded_card_events AS MATERIALIZED (",
    "  SELECT creation.event_id, creation.event_name, creation.actor_id, creation.subject_user_id,",
    "    creation.workspace_id, creation.occurred_at, creation.server_received_at,",
    "    creation.event_properties->>'demo_status' AS demo_status",
    "  FROM analytics.product_events_resolved AS creation",
    "  WHERE (",
    "      (creation.event_name = 'card_created' AND creation.origin IN ('server', 'backfill')",
    "        AND COALESCE(creation.event_properties->>'source', 'app') = 'app')",
    "      OR (creation.event_name = 'card_addition_committed' AND creation.origin = 'server'",
    "        AND creation.event_properties->>'demo_status' IN ('demo', 'unknown'))",
    "    )",
    `    AND ${buildTrustedActorRowsFilterSql("creation.trust_level")}`,
    "    AND creation.subject_user_id IS NOT NULL",
    `    AND creation.occurred_at >= ${rangeStartSql} - INTERVAL '${firstLaunchDemoCardAllowanceSeconds} seconds'`,
    `    AND creation.occurred_at < ${stepWindowEndSql}`,
    // Materialize the bounded event scan before joining the people who reviewed. The small
    // estimate for first_reviews otherwise makes Postgres rescan the resolved view per person.
    "), recoverable_card_events AS MATERIALIZED (",
    "  SELECT creation.*, cohort.first_launch_at",
    "  FROM bounded_card_events AS creation",
    "  INNER JOIN cohort ON cohort.actor_id = creation.actor_id",
    "  INNER JOIN first_reviews AS first_review ON first_review.actor_id = creation.actor_id",
    `  WHERE creation.occurred_at >= cohort.first_launch_at - INTERVAL '${firstLaunchDemoCardAllowanceSeconds} seconds'`,
    `    AND creation.occurred_at <= cohort.first_launch_at + ${windowSql}`,
    "), observed_card_additions AS MATERIALIZED (",
    "  SELECT actor_id, MIN(ordering_at) AS ordering_at",
    "  FROM step_events",
    "  WHERE event_name IN ('manual_card_saved', 'card_created', 'card_addition_committed', 'card_addition_recovered',",
    "    'catalog_deck_installed', 'workspace_package_imported')",
    "  GROUP BY actor_id",
    // A recovered addition must beat the observed one to affect the funnel. Its card was created
    // by that cutoff or the end of the first week, and its demo seed was created earlier still.
    "), workspaces_to_recover AS MATERIALIZED (",
    "  SELECT creation.workspace_id,",
    `    MAX(LEAST(creation.first_launch_at + ${windowSql}, observed.ordering_at)) AS last_relevant_card_at`,
    "  FROM recoverable_card_events AS creation",
    "  LEFT JOIN observed_card_additions AS observed ON observed.actor_id = creation.actor_id",
    "  WHERE (creation.event_name = 'card_created' OR creation.demo_status = 'unknown')",
    "    AND (observed.ordering_at IS NULL OR creation.occurred_at < observed.ordering_at)",
    "  GROUP BY creation.workspace_id",
    "), candidate_workspaces AS MATERIALIZED (",
    "  SELECT workspace.workspace_id, workspace.event_name, recovery.last_relevant_card_at",
    "  FROM (SELECT DISTINCT workspace_id, event_name FROM recoverable_card_events) AS workspace",
    "  INNER JOIN workspaces_to_recover AS recovery USING (workspace_id)",
    // Skip deriving keys for entire libraries with no possible seed.
    "  WHERE EXISTS (",
    "    SELECT 1 FROM content.cards AS possible_seed",
    "    WHERE possible_seed.workspace_id = workspace.workspace_id",
    "      AND possible_seed.metadata->'onboardingDemo'->'version' = '1'::jsonb",
    "  ) OR EXISTS (",
    "    SELECT 1 FROM recoverable_card_events AS possible_seed",
    "    WHERE possible_seed.workspace_id = workspace.workspace_id AND possible_seed.demo_status = 'demo'",
    "  )",
    // Derive each workspace's card keys only for event types recorded there.
    "), workspace_card_keys AS MATERIALIZED (",
    "  SELECT card.workspace_id, card.card_id, card.created_at,",
    "    analytics.derive_server_event_id(workspace.event_name, ARRAY[card.card_id::text]) AS event_id,",
    "    card.metadata ? 'onboardingDemo' AS has_demo_marker,",
    "    card.metadata->'onboardingDemo'->'version' = '1'::jsonb AS marked_demo",
    "  FROM candidate_workspaces AS workspace",
    "  INNER JOIN content.cards AS card ON card.workspace_id = workspace.workspace_id",
    "  WHERE card.created_at <= workspace.last_relevant_card_at",
    `    AND card.created_at < ${stepWindowEndSql}`,
    `    AND (card.created_at >= ${rangeStartSql} OR card.metadata ? 'onboardingDemo')`,
    "), matched_card_creations AS MATERIALIZED (",
    "  SELECT creation.*, card.card_id, card.created_at, card.has_demo_marker, card.marked_demo,",
    "    first_write.replica_id AS original_replica_id",
    "  FROM workspace_card_keys AS card",
    // Match the original workspace because a guest transfer can reinsert the same id into another
    // workspace.
    "  INNER JOIN recoverable_card_events AS creation",
    "    ON creation.workspace_id = card.workspace_id AND creation.event_id = card.event_id",
    // A write after the event receipt cannot establish its provenance. The first retained write
    // can also be the guest transfer itself when the original analytics write was missed.
    "  INNER JOIN LATERAL (",
    "    SELECT change.replica_id, change.recorded_at",
    "    FROM sync.hot_changes AS change",
    "    WHERE change.workspace_id = card.workspace_id",
    "      AND change.entity_type = 'card' AND change.entity_id = card.card_id::text",
    "    ORDER BY change.change_id",
    "    LIMIT 1",
    "  ) AS first_write ON first_write.recorded_at <= creation.server_received_at",
    "  WHERE NOT EXISTS (",
    "    SELECT 1 FROM auth.guest_upgrade_history AS upgrade",
    "    WHERE upgrade.target_workspace_id = card.workspace_id",
    "      AND upgrade.merged_at = first_write.recorded_at",
    "  )",
    "), workspace_demo_seeds AS MATERIALIZED (",
    "  SELECT workspace_id, actor_id, subject_user_id, original_replica_id, MIN(created_at) AS seed_created_at",
    "  FROM matched_card_creations",
    "  WHERE marked_demo OR demo_status = 'demo'",
    "  GROUP BY workspace_id, actor_id, subject_user_id, original_replica_id",
    "), seed_backed_card_creations AS MATERIALIZED (",
    "  SELECT creation.actor_id, creation.card_id, creation.event_name, creation.demo_status, addition.ordering_at",
    "  FROM matched_card_creations AS creation",
    "  INNER JOIN workspace_demo_seeds AS seed",
    "    ON seed.workspace_id = creation.workspace_id",
    "    AND seed.actor_id = creation.actor_id AND seed.subject_user_id = creation.subject_user_id",
    // Two offline installations can both seed an empty workspace for the same account.
    "    AND seed.original_replica_id = creation.original_replica_id",
    "    AND seed.seed_created_at < creation.created_at",
    "  CROSS JOIN LATERAL (SELECT GREATEST(creation.created_at, creation.occurred_at) AS ordering_at) AS addition",
    "  WHERE NOT creation.has_demo_marker",
    "    AND creation.created_at >= creation.first_launch_at",
    `    AND addition.ordering_at <= creation.first_launch_at + ${windowSql}`,
    "), recovered_card_additions AS (",
    "  SELECT creation.actor_id, creation.ordering_at",
    "  FROM seed_backed_card_creations AS creation",
    // A durable fact owns this card's classification and original workspace once it exists.
    "  WHERE creation.demo_status = 'unknown' OR (creation.event_name = 'card_created' AND NOT EXISTS (",
    "      SELECT 1 FROM analytics.product_events AS committed",
    "      WHERE committed.event_id = analytics.derive_server_event_id('card_addition_committed', ARRAY[creation.card_id::text])",
    "  ))",
    "), first_card_additions AS MATERIALIZED (",
    "  SELECT added.actor_id, MIN(added.ordering_at) AS first_addition_ordering_at",
    "  FROM (",
    "    SELECT actor_id, ordering_at FROM observed_card_additions",
    "    UNION ALL",
    "    SELECT actor_id, ordering_at FROM recovered_card_additions",
    "  ) AS added",
    "  GROUP BY added.actor_id",
    "), activations AS MATERIALIZED (",
    "  SELECT first_review.actor_id, first_review.first_review_at,",
    "    GREATEST(first_review.first_review_at, first_addition.first_addition_ordering_at) AS review_after",
    "  FROM first_reviews AS first_review",
    "  INNER JOIN first_card_additions AS first_addition ON first_addition.actor_id = first_review.actor_id",
    "), person_engagement AS MATERIALIZED (",
    "  SELECT",
    "    review.actor_id,",
    "    COUNT(*)::int AS review_count,",
    "    COUNT(DISTINCT (review.step_at AT TIME ZONE 'UTC')::date)::int AS review_day_count",
    "  FROM step_events AS review",
    "  INNER JOIN activations AS activation",
    "    ON activation.actor_id = review.actor_id",
    "    AND review.step_at >= activation.first_review_at",
    "  WHERE review.event_name = 'review_answered'",
    "    AND review.has_occurrence_time",
    "  GROUP BY review.actor_id",
    "  HAVING BOOL_OR(review.step_at > activation.review_after)",
    ")",
    "SELECT",
    `  ${groupKeySql} AS group_key,`,
    "  COUNT(*)::int AS first_launch_count,",
    "  COUNT(review_screen.review_screen_at)::int AS review_screen_count,",
    "  COUNT(revealed.revealed_at)::int AS revealed_count,",
    "  COUNT(first_review.first_review_at)::int AS one_review_count,",
    "  COUNT(activation.actor_id)::int AS review_and_card_added_count,",
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
    "LEFT JOIN activations AS activation ON activation.actor_id = cohort.actor_id",
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
        reviewAndCardAddedCount: count("review_and_card_added_count"),
        twoReviewsCount: count("two_reviews_count"),
        twoReviewDaysCount: count("two_review_days_count"),
        engagedReturningCount: count("engaged_returning_count"),
        maturingCount: count("maturing_count"),
      };
    }),
  };
}
