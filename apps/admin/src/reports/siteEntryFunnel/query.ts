import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
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
} from "../funnels/funnelAudienceSql";
import {
  unresolvedFunnelGroupKey,
  type FunnelGroupByDimension,
} from "../funnels/funnelGroupBy";
import { assertValidDateRange, laterCalendarDate } from "../reportValues";

/**
 * The marketing-site `page_kind` values a funnel starting on the site can enter on, which is what the
 * shared fragments below are written against.
 */
export type SiteFunnelEntryPageKind = "home" | "blog_article";

/**
 * The date bounds one site-entry statement is written against, resolved once and read by every
 * fragment below.
 *
 * THE START DATE IS THE CALLER'S, NOT A SHARED CONSTANT: the blog funnel passes `blogFunnelStartDate`.
 * `from` is the selected first day raised to it, so a range ending before that day leaves `from` after
 * `to` and nobody enters.
 */
export type SiteEntryFunnelRangeSql = Readonly<{
  from: string;
  to: string;
  rangeStartSql: string;
  rangeEndSql: string;
  /** The last instant a step row is read at: the range end plus the whole conversion window. */
  stepWindowEndSql: string;
  /** The conversion window itself, which every later step of every site-entry funnel is bounded by. */
  windowSql: string;
}>;

export function buildSiteEntryFunnelRangeSql(
  filters: AnalyticsFilterState,
  reportLabel: string,
  entryStartDate: string,
): SiteEntryFunnelRangeSql {
  const { from: selectedFrom, to } = assertValidDateRange(filters.dateRange, reportLabel);
  const from = laterCalendarDate(selectedFrom, entryStartDate);
  return {
    from,
    to,
    rangeStartSql: `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    rangeEndSql: `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    stepWindowEndSql: `(${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`,
    windowSql: `INTERVAL '${catalogInstallConversionWindowDays} days'`,
  };
}

/**
 * The one key of the ungrouped funnel, on the identified rows and the hashed ones alike. Both arms
 * take it from the same `groupKeySql` below: the outer `SUM ... GROUP BY group_key` merges them on
 * it, and a second literal would return the ungrouped `all`-mode funnel as two rows.
 */
const ungroupedSiteEntryGroupKey = "all";

/**
 * The entry page view's own `ui_locale`, carried onto a cohort row under this name.
 *
 * BOTH COHORTS PROJECT IT UNDER THIS NAME AND UNDER THE `cohort` ALIAS, which is what lets the one
 * key expression below be written once and read by the identified arm and the hashed arm alike.
 */
const entryUiLocaleColumnName = "entry_ui_locale";

/**
 * The entry page view's own `page_path`, carried onto a cohort row under this name.
 *
 * BOTH COHORTS PROJECT IT UNDER THIS NAME AND UNDER THE `cohort` ALIAS, exactly as the locale above is,
 * which is what lets one key expression be read by the identified arm and the hashed arm alike. Only the
 * blog funnel groups by it, through `blogFunnelGroupByDimensions` in
 * `../blogFunnels/blogFunnelEntry.ts`. It rides out of the same aggregate the locale does on both arms,
 * so carrying it costs nothing beyond the column.
 */
export const siteEntryPagePathColumnName = "entry_page_path";

/**
 * What every funnel entering on a marketing-site page can be grouped by; the blog funnel extends it
 * with the article the reader entered on, through `blogFunnelGroupByDimensions` in
 * `../blogFunnels/blogFunnelEntry.ts`.
 *
 * ONE DIMENSION, KEYED ON THE ENTRY ROW ITSELF rather than on a per-actor source joined beside the
 * cohort. The connection country and the app interface language of a person read trusted rows only,
 * which a site page view never is and an entrant of this cohort rarely goes on to produce, so both
 * would place nearly every entrant in `Unresolved` and are not offered here. It is that rarity and
 * not the entry rule that rules them out - the rule bars a trusted event only BEFORE the entry, so
 * an entrant who signs in afterwards does have trusted rows in the range and could in principle
 * carry such a key. The first launch and the deck funnels keep both dimensions, because their cohorts are
 * identified. The locale the entry page was viewed in is on a row the statement already reads, is a
 * property of the person by construction because one person enters on exactly one page view, and is
 * NULL only for a client that reported none, which the query folds into `Unresolved`. The client
 * platform is not offered either: the entry is a marketing-site page view and the site always
 * reports as web, as the field explanations in `../../filters/analyticsFilters.ts` state, so
 * grouping by it would always draw one bar.
 */
export const siteEntryFunnelGroupByDimensions: ReadonlyArray<FunnelGroupByDimension> = [
  {
    // The id is `language` while the label and the key are narrower than that word: it is the URL
    // token in `<funnelId>GroupBy` that shared links already carry, so it is not free to follow the
    // label.
    id: "language",
    label: "Entry page language",
    buildGroupKeySql: () => `cohort.${entryUiLocaleColumnName}`,
  },
];

/** A marketing-site fact: only the credential-free collector writes these, under the visitor cookie. */
export function buildSiteFactSql(rowAlias: string, eventName: string): string {
  return `${rowAlias}.event_name = ${escapeSqlStringLiteral(eventName)} AND ${buildSiteFactSourceSql(rowAlias)}`;
}

/** The writer test of `buildSiteFactSql`, for a read of several site facts at once. */
export function buildSiteFactSourceSql(rowAlias: string): string {
  return [
    `${rowAlias}.origin = 'client'`,
    `${rowAlias}.trust_level = 'anonymous_client'`,
  ].join(" AND ");
}

/**
 * The page views a person can enter on: a marketing-site `pageKind` page view on a selected platform.
 *
 * TAKES THE ALIAS BECAUSE TWO STATEMENTS APPLY THE SAME TEST: the pass that takes the entry
 * timestamp, and the lookup that takes the group keys of the row that timestamp names. A key read
 * under a wider test could come from a page this person never entered on, so the two may not drift.
 * The `page_kind` test is also what bounds the entry path: every path a group key can hold came off a
 * row the site itself reported under this funnel's page kind. IT IS NOT A CHECK THAT THE PAGE EXISTS.
 * The site classifies every `/blog/...` route as `blog_article`, and its only not-found downgrade to
 * `other` is the package page, so a mistyped, deleted or badly linked article URL that somebody really
 * visited is still an entry and is drawn as its own small article group - which is what it is, a real
 * visit to a route that answered not-found. Nothing here filters it out, and nothing should: this
 * repository holds no list of valid blog slugs to filter it against.
 */
function buildSiteEntryViewFilterSqlLines(
  rowAlias: string,
  pageKind: SiteFunnelEntryPageKind,
  filters: AnalyticsFilterState,
): ReadonlyArray<string> {
  return [
    buildSiteFactSql(rowAlias, "site_page_viewed"),
    `${rowAlias}.event_properties ->> 'page_kind' = ${escapeSqlStringLiteral(pageKind)}`,
    buildEventPlatformsFilterSql(`${rowAlias}.platform`, filters.eventPlatforms),
  ];
}

/**
 * The cookieless half of `all`, as the two CTEs the identified chain is extended with: one row per
 * person in `hashed_cohort`, which each funnel then reads its own hashed steps off.
 *
 * ONE PERSON IS ONE HASH ON ONE UTC DAY, so every hashed step a funnel adds has to be read on that
 * same pair and be a distinct count over it; that is what keeps the funnel rule holding inside this
 * cohort exactly as it does in the identified one.
 *
 * The entry rule is the identified one with the part that cannot be asked removed. A hashed person
 * enters when their first marketing-site page view of the day is a `pageKind` page, which is the same
 * "first page they saw" test; there is no "and nothing trusted before it" arm, because a hash has no
 * history to have anything before it, and no seven-day window, because the person ceases to exist at
 * the end of their UTC day. How far down a funnel these people can go is the funnel's own business:
 * a marketing-site step can be read on the hash, while every step reading a trusted in-app row is
 * identified-only, because a cookieless browser produces none.
 *
 * The selection is applied to the entry page view alone, the row the person is keyed and grouped by,
 * exactly as the identified arm applies it to the entry; a later hashed step reads only that the row
 * belongs to this person's day.
 *
 * The entry page view's own locale and path ride out with the person, and `hashed_cohort` is a
 * `SELECT entry.*` over it, so these people are grouped by exactly the keys the identified cohort is
 * grouped by. They are the only dimensions that can reach them: they have no actor, so nothing that
 * reads a person's history can say anything about them, while their single page view can.
 */
export function buildHashedSiteEntryCohortCteSqlLines(
  filters: AnalyticsFilterState,
  pageKind: SiteFunnelEntryPageKind,
  range: SiteEntryFunnelRangeSql,
): ReadonlyArray<string> {
  const visitorDaySql = buildHashedVisitorDaySql("hashed_view");
  // Written once and read twice below, because the entry timestamp and the entry locale have to be
  // taken over the same rows: a locale read under a wider test could come from a page this person
  // never entered on.
  const entryViewFilterSql = [
    `hashed_view.event_properties ->> 'page_kind' = ${escapeSqlStringLiteral(pageKind)}`,
    ...buildHashedPageViewFilterSqlLines("hashed_view", "hashed_view.platform", filters),
  ].join("\n        AND ");

  return [
    "), hashed_entries AS MATERIALIZED (",
    "  SELECT",
    "    hashed_view.daily_visitor_hash,",
    `    ${visitorDaySql} AS visitor_day,`,
    "    MIN(hashed_view.occurred_at) AS first_page_viewed_at,",
    "    MIN(hashed_view.occurred_at) FILTER (",
    `      WHERE ${entryViewFilterSql}`,
    "    ) AS first_entry_viewed_at,",
    // The locale of the earliest entry page view, not an aggregate over every one of them, so it is
    // the locale of the view the person actually entered on: `hashed_cohort` below keeps only the
    // people whose earliest page view of the day is that row. Postgres has no first-value aggregate,
    // hence the ordered array and its first element; the locale is the sort's own tiebreak, so two
    // rows sharing a timestamp still answer the same way every run. NULL stands for a client that
    // reported no locale, which the group key folds into `Unresolved`.
    //
    // THE ORDERED AGGREGATE STAYS HERE AND NOT ON THE IDENTIFIED PASS, which resolves its locale
    // after the cohort instead: an ordered aggregate forbids hashed aggregation for the whole node,
    // and this node is one group per hash and day over the selected range's site page views alone,
    // so its sort is cheap and a second pass to avoid it would cost more than it saves. The two arms
    // still name the same value: the first element under `ORDER BY occurred_at, ui_locale` is the
    // alphabetically first locale among the rows at the entry instant, NULLs sorting last, which is
    // exactly the `MIN` `entry_group_keys` takes over that same tie.
    "    (ARRAY_AGG(hashed_view.ui_locale ORDER BY hashed_view.occurred_at, hashed_view.ui_locale) FILTER (",
    `      WHERE ${entryViewFilterSql}`,
    `    ))[1] AS ${entryUiLocaleColumnName},`,
    // The path of that same earliest entry page view, in the same form and for the same reasons, with
    // the path itself as the sort's tiebreak so it is the value `entry_group_keys` takes with `MIN`
    // over rows sharing the entry instant. NULL stands for a client that reported no path.
    "    (ARRAY_AGG(hashed_view.event_properties ->> 'page_path' ORDER BY hashed_view.occurred_at, hashed_view.event_properties ->> 'page_path') FILTER (",
    `      WHERE ${entryViewFilterSql}`,
    `    ))[1] AS ${siteEntryPagePathColumnName}`,
    "  FROM analytics.product_events_resolved AS hashed_view",
    `  WHERE ${buildHashedSiteRowSqlLines("hashed_view", "site_page_viewed").join("\n    AND ")}`,
    `    AND ${buildHashedVisitorDayRangeSqlLines("hashed_view", range.from, range.to).join("\n    AND ")}`,
    `  GROUP BY hashed_view.daily_visitor_hash, ${visitorDaySql}`,
    "), hashed_cohort AS MATERIALIZED (",
    "  SELECT entry.*",
    "  FROM hashed_entries AS entry",
    "  WHERE entry.first_entry_viewed_at = entry.first_page_viewed_at",
  ];
}

/**
 * The cohort every site-entry funnel starts from, as the CTE lines a statement opens with: one row per
 * person whose first identified marketing-site page view is a `pageKind` page on a selected UTC day
 * from the funnel's own start date on, carrying `entered_at` and the group key beside it.
 *
 * The lines open with `WITH` and end inside `cohort`, so a caller continues with
 * `"), <its own first step CTE> AS MATERIALIZED ("` and reads its steps off `cohort`.
 *
 * THE GROUP KEY IS A PROPERTY OF THE PERSON, never of a step: it is the locale or the path of the one
 * page view the person entered on, carried onto the cohort row beside `entered_at`, and every count
 * is taken inside it, so the groups partition the funnel and sum back to it step by step,
 * `maturing_count` included. `None` groups by one literal, so there is one group of everybody, and
 * the two statements differ in that literal alone. The key costs the same either way, and deliberately little: it is
 * read back off the entrants' own entry rows inside the selected range (`entry_group_keys`), never from
 * a per-actor source joined beside the cohort and never from an aggregate on the whole-history pass
 * below, whose plan it would change for every load.
 *
 * The person is the visitor cookie the site reports under, `analytics_visitor`, which the web app on
 * the same domain reports under too. The web app's first authenticated analytics batch after sign-in
 * carries that cookie and writes the `authenticated_client` link that resolves every site row to the
 * account (`createIngestIdentityLink` in `apps/backend/src/routes/productAnalytics.ts`), so the site
 * steps and the in-app steps meet on one `actor_id`. The web app mints no guests
 * (`apps/web/src/appData/session/guest/webGuestSession.ts`), so a session here is always a sign-in.
 *
 * The shape is the first launch funnel's (`../firstLaunchFunnel/query.ts`), for the same reason: no
 * step joins a cohort to `analytics.product_events_resolved` by membership.
 *
 * - `actor_first_events` is one pass grouped by actor over trusted history and the site's page views
 *   up to the range end. Per actor it keeps the first page view, the first one of `pageKind` on a
 *   selected platform, and the first trusted event, and carries no group key, which is what keeps this
 *   widest node a hash aggregate. `entries` keeps the people whose first page view is that one, on a
 *   selected day, with no trusted event before it, so someone who was already using the product does
 *   not enter as a new visitor once their cookie resolves to their account; `entry_group_keys` then
 *   reads the group keys back off those entrants' own entry rows and `cohort` carries them beside
 *   `entered_at`.
 * - a funnel's own step CTEs hash-join their step rows in the range to `actor_first_events`, each
 *   bounded to its own actor's `[first page view of pageKind, + 7 days]`, and each step is then a
 *   `GROUP BY` joined to the step above it.
 *
 * The audience mode reaches this in two places and nowhere else: `signed-in` adds one restriction to
 * `cohort` here, and `all` appends `buildHashedSiteEntryCohortCteSqlLines` as a second, independent
 * cohort whose counts are rows of their own, one per group key, that a section adds to the site steps.
 * Neither changes anything above, so the default mode produces exactly the statement it produced
 * before.
 */
export function buildSiteEntryCohortCteSqlLines(
  filters: AnalyticsFilterState,
  pageKind: SiteFunnelEntryPageKind,
  range: SiteEntryFunnelRangeSql,
): ReadonlyArray<string> {
  const pageViewSql = buildSiteFactSql("resolved", "site_page_viewed");
  // The one entry-view test under the two aliases that apply it: the pass that takes the entry
  // timestamp, and the lookup that takes the group keys of the row that timestamp names.
  const entryViewFilterSql = buildSiteEntryViewFilterSqlLines("resolved", pageKind, filters)
    .join("\n        AND ");
  const entryGroupKeyFilterSql = buildSiteEntryViewFilterSqlLines("entry_view", pageKind, filters)
    .join("\n    AND ");

  return [
    "WITH actor_first_events AS MATERIALIZED (",
    "  SELECT",
    "    resolved.actor_id,",
    `    MIN(resolved.occurred_at) FILTER (WHERE ${pageViewSql}) AS first_page_viewed_at,`,
    "    MIN(resolved.occurred_at) FILTER (",
    `      WHERE ${entryViewFilterSql}`,
    "    ) AS first_entry_viewed_at,",
    `    MIN(resolved.occurred_at) FILTER (WHERE ${buildTrustedActorRowsFilterSql("resolved.trust_level")}) AS first_trusted_event_at`,
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.actor_id IS NOT NULL",
    `    AND (${buildTrustedActorRowsFilterSql("resolved.trust_level")} OR (${pageViewSql}))`,
    `    AND resolved.occurred_at < ${range.rangeEndSql}`,
    "  GROUP BY resolved.actor_id",
    "), entries AS MATERIALIZED (",
    "  SELECT",
    "    history.actor_id,",
    "    history.first_entry_viewed_at AS entered_at",
    "  FROM actor_first_events AS history",
    `  WHERE history.first_entry_viewed_at >= ${range.rangeStartSql}`,
    "    AND history.first_entry_viewed_at = history.first_page_viewed_at",
    "    AND (",
    "      history.first_trusted_event_at IS NULL",
    "      OR history.first_trusted_event_at >= history.first_entry_viewed_at",
    "    )",
    // The group keys, resolved over the entrants alone rather than on the pass above.
    //
    // NOT AN ORDERED AGGREGATE ON `actor_first_events`, which is where they would read most
    // directly: Postgres refuses hashed aggregation for any query holding an `ORDER BY` or
    // `DISTINCT` aggregate (`create_grouping_paths`), so taking the first entry row's values there
    // would turn that node - one group per actor over all of history, with no lower time bound -
    // from a hash aggregate into a sort, on every load including `None`, against the 30 s
    // `reporting_readonly` statement timeout.
    //
    // `entered_at` already names the exact row, so this is a lookup and not a reduction: the entry
    // rows of that actor at that instant, normally one. `MIN` over a tie is the same value the
    // ordered-array form picks, because both take the alphabetically first value and both answer
    // NULL only when every tied row reported none. The range bounds are redundant against the
    // equality and are there for the planner, so the scan can use the `event_name, occurred_at`
    // index rather than read every site page view ever sent.
    "), entry_group_keys AS MATERIALIZED (",
    "  SELECT",
    "    entrant.actor_id,",
    `    MIN(entry_view.ui_locale) AS ${entryUiLocaleColumnName},`,
    // The path of the page this person entered on, off the very same rows the locale is taken from, so
    // it names the page they actually entered on. NULL where that row carried no path - a site bundle
    // released before the property, or a route whose shape the site could not report - which the key
    // folds into `Unresolved`.
    `    MIN(entry_view.event_properties ->> 'page_path') AS ${siteEntryPagePathColumnName}`,
    "  FROM entries AS entrant",
    "  INNER JOIN analytics.product_events_resolved AS entry_view",
    "    ON entry_view.actor_id = entrant.actor_id",
    "    AND entry_view.occurred_at = entrant.entered_at",
    `  WHERE ${entryGroupKeyFilterSql}`,
    `    AND entry_view.occurred_at >= ${range.rangeStartSql}`,
    `    AND entry_view.occurred_at < ${range.rangeEndSql}`,
    "  GROUP BY entrant.actor_id",
    "), cohort AS MATERIALIZED (",
    "  SELECT",
    "    candidate.actor_id,",
    "    candidate.entered_at,",
    `    entry_key.${entryUiLocaleColumnName},`,
    `    entry_key.${siteEntryPagePathColumnName}`,
    "  FROM entries AS candidate",
    // `LEFT JOIN` though `entries` guarantees the row: an entrant may never be dropped over their
    // group key, and a person whose entry row carried no locale or no path arrives NULL either way,
    // which the key folds into `Unresolved`.
    "  LEFT JOIN entry_group_keys AS entry_key ON entry_key.actor_id = candidate.actor_id",
    "  WHERE TRUE",
    ...buildExcludedActorSqlLines("candidate.actor_id::text"),
    ...buildFunnelAudienceActorSqlLines(filters, "candidate.actor_id::text"),
    `    AND ${buildConnectionCountriesFilterSql("candidate.actor_id::text", filters.connectionCountries, filters.dateRange)}`,
    `    AND ${buildAppUiLanguagesFilterSql("candidate.actor_id::text", filters.appUiLanguages, filters.dateRange)}`,
  ];
}

/**
 * The one group-key expression a site-entry funnel's two cohorts are merged on.
 *
 * Every count is grouped, always: with no dimension the key is one literal, so the shape of the query
 * is the same whichever way the field is set and `None` is simply one group of everybody.
 *
 * ONE EXPRESSION FOR BOTH COHORTS, which is why every hashed arm aliases `hashed_cohort` as `cohort`:
 * the two arms are `UNION ALL`ed and merged on this key, so they may not read it from two expressions
 * that could drift apart.
 *
 * `::text` on both branches, deliberately rather than by default: the key is also the `GROUP BY`
 * target and is read back as a string, so nothing here depends on how Postgres resolves the type of a
 * bare literal or of a `COALESCE` over one.
 */
export function buildSiteEntryFunnelGroupKeySql(
  filters: AnalyticsFilterState,
  groupByDimension: FunnelGroupByDimension | null,
): string {
  return groupByDimension === null
    ? `${escapeSqlStringLiteral(ungroupedSiteEntryGroupKey)}::text`
    : `COALESCE(${groupByDimension.buildGroupKeySql(filters)}, ${escapeSqlStringLiteral(unresolvedFunnelGroupKey)})::text`;
}
