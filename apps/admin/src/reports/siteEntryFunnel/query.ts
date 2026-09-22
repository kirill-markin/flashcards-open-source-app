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
  buildFunnelAudienceActorSqlLines,
  buildHashedPageViewFilterSqlLines,
  buildHashedSiteRowSqlLines,
  buildHashedVisitorDayRangeSqlLines,
  buildHashedVisitorDaySql,
  isFunnelHashedCohortRead,
} from "../funnels/funnelAudienceSql";
import {
  unresolvedFunnelGroupKey,
  type FunnelGroupByDimension,
} from "../funnels/funnelGroupBy";
import { assertIsString, assertValidDateRange, laterCalendarDate, toInteger } from "../reportValues";

/** The marketing-site `page_kind` values a funnel on this page can start from. */
export type SiteEntryPageKind = "home" | "blog_article";

/**
 * The first UTC day entries count from, whatever range is selected. The site began sending identified
 * page views partway through 2026-09-22, so that day is partial and no day before it has any.
 */
export const siteEntryFunnelStartDate = "2026-09-23";

/** Where "studied it properly" is drawn, the same line the other funnels draw. */
export const siteEntryEngagedReviewThreshold = 20;

/**
 * People per step, each step a subset of the one before it: one group's, or the funnel's own sum.
 *
 * The six step counts are the people with an identifier, which is every mode's cohort. The two
 * `hashed` counts are the cookieless visitors of the `all` mode, counted separately because they are
 * a separate cohort keyed on a daily hash rather than on an actor; the section adds the two together
 * to get the step a reader sees. They are zero outside that mode and zero whenever a connection
 * country is selected, and there is no hashed count for the steps below the site ones, because a hash
 * names nobody the web app or the server could ever meet again.
 */
export type SiteEntryFunnelCounts = Readonly<{
  entryViewCount: number;
  appEntryClickCount: number;
  signedInCount: number;
  oneReviewCount: number;
  engagedCount: number;
  engagedReturningCount: number;
  hashedEntryViewCount: number;
  hashedAppEntryClickCount: number;
  /** Entries whose seven-day window had not closed when the query ran; a hashed person has none. */
  maturingCount: number;
}>;

/**
 * One group's counts under the key the SQL produced: the dimension's own value,
 * `unresolvedFunnelGroupKey` for a person it cannot place, or `ungroupedSiteEntryGroupKey` while no
 * dimension is selected.
 *
 * The cookieless visitors are `Unresolved` under either dimension while one is selected, and on the
 * single group while none is. Their country is unknowable, and their page view's own `ui_locale` is
 * readable but deliberately not grouped on here, so a language group is short by the cookieless
 * people who carry that language rather than containing them.
 */
export type SiteEntryFunnelGroup = SiteEntryFunnelCounts & Readonly<{ key: string }>;

/**
 * One entry per group, and exactly one while no dimension is selected.
 *
 * EVERY COUNT IS GROUPED, so a range nobody entered returns no groups at all rather than a row of
 * zeros; the section sums the groups it did get, which is zero people and its own empty state.
 */
export type SiteEntryFunnelReport = Readonly<{
  generatedAtUtc: string;
  groups: ReadonlyArray<SiteEntryFunnelGroup>;
}>;

/**
 * The one key of the ungrouped funnel, and the hashed row's key too while no dimension is selected.
 * Both reads must produce this same literal: the outer `SUM ... GROUP BY group_key` merges the two
 * rows on it, and a second literal would return the ungrouped `all`-mode funnel as two rows.
 */
const ungroupedSiteEntryGroupKey = "all";

/**
 * The two dimensions, whose key is not on the cohort row but in a per-actor source joined beside it.
 * The ids are named here because the dimension that declares one and the join that supplies it have
 * to agree, and they are written in two places.
 */
const connectionCountryGroupByDimensionId = "country";
const appUiLanguageGroupByDimensionId = "language";

/**
 * What these funnels offer in their `Group by` field, in picker order.
 *
 * Each expression yields exactly one key per person in the cohort, so the groups partition the funnel
 * and still sum to it, and both can be NULL for somebody they cannot place, which the query folds
 * into the `Unresolved` group. The client platform is not offered: the entry is a marketing-site page
 * view and the site always reports as web, as the field explanations in
 * `../../filters/analyticsFilters.ts` state, so grouping by it would always draw one bar.
 */
export const siteEntryFunnelGroupByDimensions: ReadonlyArray<FunnelGroupByDimension> = [
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
 * The per-actor source the selected dimension's key expression reads, joined to the cohort, or no
 * lines at all while none is selected.
 *
 * ONE SOURCE, NEVER BOTH, the way `../mobileFirstLaunchFunnel/query.ts` does it: each of the two is a
 * scan of its own and this query is shaped around the 30 s statement timeout, so a join whose alias
 * the group key never mentions is paid for nothing. The alias each case supplies is the one the
 * matching dimension's `buildGroupKeySql` names, which is why the two are written against the same
 * id constants.
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

  return [];
}

/** A marketing-site fact: only the credential-free collector writes these, under the visitor cookie. */
function buildSiteFactSql(rowAlias: string, eventName: string): string {
  return [
    `${rowAlias}.event_name = ${escapeSqlStringLiteral(eventName)}`,
    `${rowAlias}.origin = 'client'`,
    `${rowAlias}.trust_level = 'anonymous_client'`,
  ].join(" AND ");
}

/**
 * The cookieless half of `all`, as the two CTEs the identified chain is extended with.
 *
 * ONE PERSON IS ONE HASH ON ONE UTC DAY, and both site steps are read on that same pair, so the
 * funnel rule holds here exactly as it does above: `hashed_cohort` is one row per person, and
 * `hashed_clicks` is a `DISTINCT` over those rows, so neither step can grow by more than one per
 * person and the click is only counted for a person the entry already kept.
 *
 * The entry rule is the identified one with the part that cannot be asked removed. A hashed person
 * enters when their first marketing-site page view of the day is a `pageKind` page, which is the same
 * "first page they saw" test; there is no "and nothing trusted before it" arm, because a hash has no
 * history to have anything before it, and no seven-day window, because the person ceases to exist at
 * the end of their UTC day. The click is a `site_app_entry_clicked` for the web app at or after that
 * entry, which is where these people stop: every step below reads a trusted in-app row, and a
 * cookieless browser can produce none.
 */
function buildHashedSiteEntryCteSqlLines(
  filters: AnalyticsFilterState,
  pageKind: SiteEntryPageKind,
  from: string,
  to: string,
): ReadonlyArray<string> {
  const visitorDaySql = buildHashedVisitorDaySql("hashed_view");

  return [
    "), hashed_entries AS MATERIALIZED (",
    "  SELECT",
    "    hashed_view.daily_visitor_hash,",
    `    ${visitorDaySql} AS visitor_day,`,
    "    MIN(hashed_view.occurred_at) AS first_page_viewed_at,",
    "    MIN(hashed_view.occurred_at) FILTER (",
    `      WHERE hashed_view.event_properties ->> 'page_kind' = ${escapeSqlStringLiteral(pageKind)}`,
    `        AND ${buildHashedPageViewFilterSqlLines("hashed_view", "hashed_view.platform", filters).join("\n        AND ")}`,
    "    ) AS first_entry_viewed_at",
    "  FROM analytics.product_events_resolved AS hashed_view",
    `  WHERE ${buildHashedSiteRowSqlLines("hashed_view", "site_page_viewed").join("\n    AND ")}`,
    `    AND ${buildHashedVisitorDayRangeSqlLines("hashed_view", from, to).join("\n    AND ")}`,
    `  GROUP BY hashed_view.daily_visitor_hash, ${visitorDaySql}`,
    "), hashed_cohort AS MATERIALIZED (",
    "  SELECT entry.*",
    "  FROM hashed_entries AS entry",
    "  WHERE entry.first_entry_viewed_at = entry.first_page_viewed_at",
    "), hashed_clicks AS MATERIALIZED (",
    "  SELECT DISTINCT entry.daily_visitor_hash, entry.visitor_day",
    "  FROM hashed_cohort AS entry",
    "  INNER JOIN analytics.product_events_resolved AS hashed_click",
    "    ON hashed_click.daily_visitor_hash = entry.daily_visitor_hash",
    `    AND ${buildHashedVisitorDaySql("hashed_click")} = entry.visitor_day`,
    "    AND hashed_click.occurred_at >= entry.first_entry_viewed_at",
    `  WHERE ${buildHashedSiteRowSqlLines("hashed_click", "site_app_entry_clicked").join("\n    AND ")}`,
    "    AND hashed_click.event_properties ->> 'target' = 'web_app'",
    `    AND ${buildHashedVisitorDayRangeSqlLines("hashed_click", from, to).join("\n    AND ")}`,
  ];
}

/**
 * One row per person whose first identified marketing-site page view is a `pageKind` page on a
 * selected UTC day from `siteEntryFunnelStartDate` on, reduced in SQL to one row of step counts per
 * group that follow the funnel rule in `../funnels/funnelSections.ts`.
 *
 * THE GROUP KEY IS A PROPERTY OF THE PERSON, never of a step: it is computed once per cohort row and
 * every count is taken inside it, so the groups partition the funnel and sum back to it step by
 * step, `maturing_count` included. `None` groups by one literal, so there is one group of everybody
 * and no dimension source is joined at all, and a selected dimension joins only the one source its
 * own key reads.
 *
 * The person is the visitor cookie the site reports under, `analytics_visitor`, which the web app on
 * the same domain reports under too. The web app's first authenticated analytics batch after sign-in
 * carries that cookie and writes the `authenticated_client` link that resolves every site row to the
 * account (`createIngestIdentityLink` in `apps/backend/src/routes/productAnalytics.ts`), so the site
 * steps and the in-app steps meet on one `actor_id`. The web app mints no guests
 * (`apps/web/src/appData/session/guest/webGuestSession.ts`), so a session here is always a sign-in.
 *
 * The shape is the mobile funnel's (`../mobileFirstLaunchFunnel/query.ts`), for the same reason: no
 * step joins a cohort to `analytics.product_events_resolved` by membership.
 *
 * - `actor_first_events` is one pass grouped by actor over trusted history and the site's page views
 *   up to the range end. Per actor it keeps the first page view, the first one of `pageKind` on a
 *   selected platform, and the first trusted event. `entries` keeps the people whose first page view
 *   is that one, on a selected day, with no trusted event before it, so someone who was already
 *   using the product does not enter as a new visitor once their cookie resolves to their account.
 * - `step_events` hash-joins the step rows in the range to `actor_first_events`, each bounded to its
 *   own actor's `[first page view of pageKind, + 7 days]`, and each step is then a `GROUP BY` joined
 *   to the step above it.
 *
 * Every later step is the same actor within seven days of the entry, at or after the step above it:
 * a `site_app_entry_clicked` with `target = 'web_app'` from any site page, a web `app_opened` sent on
 * an account credential (`authenticated_client`), and a first `review_answered`. Opening the web app
 * and signing in are one step: signed-out events are held until sign-in and web has no guests, so a
 * trusted web open is always a signed-in one, and reading only those opens avoids scanning every
 * `authenticated_client` row in the range. The review count runs from that first answer to the seven-day bound, and the
 * return day is one of those answers on a later UTC day than the entry. The in-app steps take
 * `buildTrustedActorRowsFilterSql`, so a credential-free claim never advances anybody.
 *
 * The audience mode reaches this in two places and nowhere else: `signed-in` adds one restriction to
 * `cohort`, and `all` appends `buildHashedSiteEntryCteSqlLines` as a second, independent cohort whose
 * two counts are a group row of their own that the section adds to the first two steps. Neither
 * changes anything above, so the default mode produces exactly the statement it produced before.
 */
export function buildSiteEntryFunnelSql(
  filters: AnalyticsFilterState,
  pageKind: SiteEntryPageKind,
  reportLabel: string,
  groupByDimension: FunnelGroupByDimension | null,
): string {
  const { from: selectedFrom, to } = assertValidDateRange(filters.dateRange, reportLabel);
  // A range ending before the start date leaves `from` after `to`, so nobody enters.
  const from = laterCalendarDate(selectedFrom, siteEntryFunnelStartDate);
  const rangeStartSql = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;
  const stepWindowEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`;
  const windowSql = `INTERVAL '${catalogInstallConversionWindowDays} days'`;
  const pageViewSql = buildSiteFactSql("resolved", "site_page_viewed");
  // Left out of the statement entirely rather than executed and discarded, so the default mode costs
  // what it cost before the modes existed and only `all` pays for the second pass over the site rows.
  const isHashedCohortRead = isFunnelHashedCohortRead(filters);

  const cteSqlLines = [
    "WITH actor_first_events AS MATERIALIZED (",
    "  SELECT",
    "    resolved.actor_id,",
    `    MIN(resolved.occurred_at) FILTER (WHERE ${pageViewSql}) AS first_page_viewed_at,`,
    "    MIN(resolved.occurred_at) FILTER (",
    `      WHERE ${pageViewSql}`,
    `        AND resolved.event_properties ->> 'page_kind' = ${escapeSqlStringLiteral(pageKind)}`,
    `        AND ${buildEventPlatformsFilterSql("resolved.platform", filters.eventPlatforms)}`,
    "    ) AS first_entry_viewed_at,",
    `    MIN(resolved.occurred_at) FILTER (WHERE ${buildTrustedActorRowsFilterSql("resolved.trust_level")}) AS first_trusted_event_at`,
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.actor_id IS NOT NULL",
    `    AND (${buildTrustedActorRowsFilterSql("resolved.trust_level")} OR (${pageViewSql}))`,
    `    AND resolved.occurred_at < ${rangeEndSql}`,
    "  GROUP BY resolved.actor_id",
    "), entries AS MATERIALIZED (",
    "  SELECT history.actor_id, history.first_entry_viewed_at AS entered_at",
    "  FROM actor_first_events AS history",
    `  WHERE history.first_entry_viewed_at >= ${rangeStartSql}`,
    "    AND history.first_entry_viewed_at = history.first_page_viewed_at",
    "    AND (",
    "      history.first_trusted_event_at IS NULL",
    "      OR history.first_trusted_event_at >= history.first_entry_viewed_at",
    "    )",
    "), cohort AS MATERIALIZED (",
    "  SELECT candidate.actor_id, candidate.entered_at",
    "  FROM entries AS candidate",
    "  WHERE TRUE",
    ...buildExcludedActorSqlLines("candidate.actor_id::text"),
    ...buildFunnelAudienceActorSqlLines(filters, "candidate.actor_id::text"),
    `    AND ${buildConnectionCountriesFilterSql("candidate.actor_id::text", filters.connectionCountries, filters.dateRange)}`,
    `    AND ${buildAppUiLanguagesFilterSql("candidate.actor_id::text", filters.appUiLanguages, filters.dateRange)}`,
    "), step_events AS MATERIALIZED (",
    "  SELECT",
    "    history.actor_id,",
    "    history.first_entry_viewed_at AS entered_at,",
    "    CASE",
    `      WHEN ${buildSiteFactSql("step_event", "site_app_entry_clicked")} THEN 'app_entry_click'`,
    "      WHEN step_event.event_name = 'review_answered' THEN 'review'",
    "      ELSE 'web_sign_in'",
    "    END AS step,",
    "    step_event.occurred_at",
    "  FROM analytics.product_events_resolved AS step_event",
    "  INNER JOIN actor_first_events AS history",
    "    ON history.actor_id = step_event.actor_id",
    "    AND step_event.occurred_at >= history.first_entry_viewed_at",
    `    AND step_event.occurred_at <= history.first_entry_viewed_at + ${windowSql}`,
    "  WHERE (",
    `      (${buildSiteFactSql("step_event", "site_app_entry_clicked")}`,
    "        AND step_event.event_properties ->> 'target' = 'web_app')",
    `      OR (${buildTrustedActorRowsFilterSql("step_event.trust_level")} AND (`,
    "        step_event.event_name = 'review_answered'",
    "        OR (",
    "          step_event.event_name = 'app_opened'",
    "          AND step_event.platform = 'web'",
    "          AND step_event.trust_level = 'authenticated_client'",
    "        )",
    "      ))",
    "    )",
    `    AND step_event.occurred_at >= ${rangeStartSql}`,
    `    AND step_event.occurred_at < ${stepWindowEndSql}`,
    "), app_entry_clicks AS MATERIALIZED (",
    "  SELECT click.actor_id, MIN(click.occurred_at) AS clicked_at",
    "  FROM step_events AS click",
    "  WHERE click.step = 'app_entry_click'",
    "  GROUP BY click.actor_id",
    "), sessions AS MATERIALIZED (",
    "  SELECT session_event.actor_id, MIN(session_event.occurred_at) AS signed_in_at",
    "  FROM step_events AS session_event",
    "  INNER JOIN app_entry_clicks AS clicked",
    "    ON clicked.actor_id = session_event.actor_id",
    "    AND session_event.occurred_at >= clicked.clicked_at",
    "  WHERE session_event.step = 'web_sign_in'",
    "  GROUP BY session_event.actor_id",
    "), first_reviews AS MATERIALIZED (",
    "  SELECT review_event.actor_id, MIN(review_event.occurred_at) AS first_review_at",
    "  FROM step_events AS review_event",
    "  INNER JOIN sessions AS signed_in",
    "    ON signed_in.actor_id = review_event.actor_id",
    "    AND review_event.occurred_at >= signed_in.signed_in_at",
    "  WHERE review_event.step = 'review'",
    "  GROUP BY review_event.actor_id",
    "), person_engagement AS MATERIALIZED (",
    "  SELECT",
    "    review.actor_id,",
    "    COUNT(*)::int AS review_count,",
    "    bool_or(",
    "      (review.occurred_at AT TIME ZONE 'UTC')::date",
    "        > (review.entered_at AT TIME ZONE 'UTC')::date",
    "    ) AS has_return_day",
    "  FROM step_events AS review",
    "  INNER JOIN first_reviews AS first_review",
    "    ON first_review.actor_id = review.actor_id",
    "    AND review.occurred_at >= first_review.first_review_at",
    "  WHERE review.step = 'review'",
    "  GROUP BY review.actor_id",
    ...(isHashedCohortRead
      ? buildHashedSiteEntryCteSqlLines(filters, pageKind, from, to)
      : []),
    ")",
  ];
  // Every count is grouped, always: with no dimension the key is one literal, so the shape of the
  // query is the same whichever way the field is set and `None` is simply one group of everybody.
  // `::text` on both branches, deliberately rather than by default: the key is also the `GROUP BY`
  // target and is read back as a string, so nothing here depends on how Postgres resolves the type
  // of a bare literal or of a `COALESCE` over one.
  const groupKeySql = groupByDimension === null
    ? `${escapeSqlStringLiteral(ungroupedSiteEntryGroupKey)}::text`
    : `COALESCE(${groupByDimension.buildGroupKeySql(filters)}, ${escapeSqlStringLiteral(unresolvedFunnelGroupKey)})::text`;
  const identifiedGroupSqlLines = [
    "SELECT",
    `  ${groupKeySql} AS group_key,`,
    "  COUNT(*)::int AS entry_view_count,",
    "  COUNT(clicked.clicked_at)::int AS app_entry_click_count,",
    "  COUNT(signed_in.signed_in_at)::int AS signed_in_count,",
    "  COUNT(first_review.first_review_at)::int AS one_review_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE engagement.review_count >= ${siteEntryEngagedReviewThreshold}`,
    "  ))::int AS engaged_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE engagement.review_count >= ${siteEntryEngagedReviewThreshold}`,
    "      AND engagement.has_return_day",
    "  ))::int AS engaged_returning_count,",
    "  (COUNT(*) FILTER (",
    `    WHERE cohort.entered_at + ${windowSql} > now()`,
    "  ))::int AS maturing_count,",
    "  0::int AS hashed_entry_view_count,",
    "  0::int AS hashed_app_entry_click_count",
    "FROM cohort",
    "LEFT JOIN app_entry_clicks AS clicked ON clicked.actor_id = cohort.actor_id",
    "LEFT JOIN sessions AS signed_in ON signed_in.actor_id = cohort.actor_id",
    "LEFT JOIN first_reviews AS first_review ON first_review.actor_id = cohort.actor_id",
    "LEFT JOIN person_engagement AS engagement ON engagement.actor_id = cohort.actor_id",
    ...buildGroupSourceJoinSqlLines(groupByDimension, filters.dateRange),
    "GROUP BY group_key",
  ];
  if (isHashedCohortRead === false) {
    return [...cteSqlLines, ...identifiedGroupSqlLines].join("\n");
  }

  // The cookieless people are a row of their own rather than two scalars on the identified rows,
  // because a grouped aggregate returns no row at all when nobody identified entered, and their
  // count may not disappear with them; the outer aggregate then merges that row into the identified
  // group of the same key and every count stays summed exactly once. The key is `Unresolved` under
  // either dimension while one is selected, and the single ungrouped key while none is: a hashed
  // person has no actor, so their country is unknowable, and their locale never reaches this row at
  // all, because `hashed_entries` projects only the hash, the day and the two timestamps and
  // `hashed_cohort` is a `SELECT entry.*` over it. `ui_locale` stays on the underlying
  // `site_page_viewed` rows, where `buildHashedPageViewFilterSqlLines` reads it only to emit the App
  // interface language predicate, so an unfiltered query reads no locale for these people. Grouping
  // them by it is deliberately out of scope: keying this row on a locale would make it an aggregate
  // whose two uncorrelated hashed scalars would be attributed to every locale group at once.
  const hashedGroupKey = groupByDimension === null ? ungroupedSiteEntryGroupKey : unresolvedFunnelGroupKey;

  return [
    ...cteSqlLines,
    "SELECT",
    "  funnel_group.group_key,",
    "  SUM(funnel_group.entry_view_count)::int AS entry_view_count,",
    "  SUM(funnel_group.app_entry_click_count)::int AS app_entry_click_count,",
    "  SUM(funnel_group.signed_in_count)::int AS signed_in_count,",
    "  SUM(funnel_group.one_review_count)::int AS one_review_count,",
    "  SUM(funnel_group.engaged_count)::int AS engaged_count,",
    "  SUM(funnel_group.engaged_returning_count)::int AS engaged_returning_count,",
    "  SUM(funnel_group.maturing_count)::int AS maturing_count,",
    "  SUM(funnel_group.hashed_entry_view_count)::int AS hashed_entry_view_count,",
    "  SUM(funnel_group.hashed_app_entry_click_count)::int AS hashed_app_entry_click_count",
    "FROM (",
    ...identifiedGroupSqlLines,
    "  UNION ALL",
    "  SELECT",
    `    ${escapeSqlStringLiteral(hashedGroupKey)}::text AS group_key,`,
    "    0::int AS entry_view_count,",
    "    0::int AS app_entry_click_count,",
    "    0::int AS signed_in_count,",
    "    0::int AS one_review_count,",
    "    0::int AS engaged_count,",
    "    0::int AS engaged_returning_count,",
    // A hashed person ceases to exist at the end of their UTC day, so they have no window to fill.
    "    0::int AS maturing_count,",
    // Uncorrelated scalars over the hashed relations, evaluated once each rather than per person.
    "    (SELECT COUNT(*) FROM hashed_cohort)::int AS hashed_entry_view_count,",
    "    (SELECT COUNT(*) FROM hashed_clicks)::int AS hashed_app_entry_click_count",
    ") AS funnel_group",
    "GROUP BY funnel_group.group_key",
    // The hashed row is emitted unconditionally, so without this the `Unresolved` group survives
    // with nobody in it whenever the hashed relations are empty - common, since hashed rows exist
    // only for pre-consent EEA and UK traffic - and the chart spends a legend entry, a band slot
    // that narrows every real bar, and a table row on it. Only a group that entered is a group.
    "HAVING SUM(funnel_group.entry_view_count) + SUM(funnel_group.hashed_entry_view_count) > 0",
  ].join("\n");
}

export async function loadSiteEntryFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  pageKind: SiteEntryPageKind,
  reportLabel: string,
  groupByDimension: FunnelGroupByDimension | null,
): Promise<SiteEntryFunnelReport> {
  const response = await runAdminQuery(
    config,
    buildSiteEntryFunnelSql(filters, pageKind, reportLabel, groupByDimension),
  );
  if (response.resultSets.length !== 1) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  // No row is a legal answer and means nobody entered the funnel, because every count is grouped.
  const rows = response.resultSets[0]?.rows ?? [];

  return {
    generatedAtUtc: response.executedAtUtc,
    groups: rows.map((row) => {
      const count = (fieldName: string): number => toInteger(row[fieldName] ?? null, reportLabel, fieldName);

      return {
        key: assertIsString(row.group_key ?? null, reportLabel, "group_key"),
        entryViewCount: count("entry_view_count"),
        appEntryClickCount: count("app_entry_click_count"),
        signedInCount: count("signed_in_count"),
        oneReviewCount: count("one_review_count"),
        engagedCount: count("engaged_count"),
        engagedReturningCount: count("engaged_returning_count"),
        hashedEntryViewCount: count("hashed_entry_view_count"),
        hashedAppEntryClickCount: count("hashed_app_entry_click_count"),
        maturingCount: count("maturing_count"),
      };
    }),
  };
}
