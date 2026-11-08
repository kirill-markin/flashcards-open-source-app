import { runAdminQuery } from "../../adminApi";
import type { AdminQueryResultSet, AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange, AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildCatalogAttributionFiltersSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
  buildExcludedActorSqlLines,
  buildMinimumEventCountsFilterSql,
  buildTrustedActorRowsFilterSql,
  buildUserCohortsFilterSql,
  buildUsersFilterSql,
  isEveryUserCohortSelected,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import {
  assertIsString,
  assertValidDateRange,
  parseActivityCount,
  parseActivityDate,
  toInteger,
} from "../reportValues";

export const homeScreenWidgetsReportLabel = "Home Screen widgets report";

/** The platforms that report widget placement; Mac Catalyst reports as `ios` but never sends the event. */
export const widgetPlatforms = ["ios", "android"] as const;
export type WidgetPlatform = (typeof widgetPlatforms)[number];

/** `widget_opened.widget_size` in `apps/backend/src/productAnalytics/catalog.ts`. */
export const widgetSizes = ["small", "medium", "large"] as const;
export type WidgetSize = (typeof widgetSizes)[number];

export type WidgetPeopleDay = Readonly<{
  date: string;
  peopleByPlatform: ReadonlyMap<WidgetPlatform, number>;
  /** Distinct people over both platforms, so someone with a widget on each counts once. */
  totalPeople: number;
}>;

export type WidgetTapsDay = Readonly<{
  date: string;
  tapsBySize: ReadonlyMap<WidgetSize, number>;
  totalTaps: number;
  totalPeople: number;
}>;

/** One cohort group's size and, once its 7-day window has ended, how many of it came back. */
export type WidgetReturnGroup = Readonly<{
  people: number;
  /** Null while the window D+1..D+7 is not over. */
  returnedPeople: number | null;
}>;

export type WidgetReturnDay = Readonly<{
  date: string;
  withWidget: WidgetReturnGroup;
  withoutWidget: WidgetReturnGroup;
}>;

export type HomeScreenWidgetsReport = Readonly<{
  generatedAtUtc: string;
  from: string;
  to: string;
  /** Only the days that have a row; a missing day is zero people, zero taps or an empty cohort. */
  peopleDays: ReadonlyArray<WidgetPeopleDay>;
  tapsDays: ReadonlyArray<WidgetTapsDay>;
  returnDays: ReadonlyArray<WidgetReturnDay>;
}>;

/** Days after D an `app_opened` counts as a return. */
export const widgetReturnWindowDays = 7;

function buildRangeStartSql(dateRange: AnalyticsDateRange): string {
  return `((${escapeSqlStringLiteral(dateRange.from)}::date)::timestamp AT TIME ZONE 'UTC')`;
}

function buildRangeEndSql(dateRange: AnalyticsDateRange, extraDays: number): string {
  return `((${escapeSqlStringLiteral(dateRange.to)}::date + INTERVAL '${1 + extraDays} days')::timestamp AT TIME ZONE 'UTC')`;
}

/** The person-level fields, which hold for a person rather than for one row. */
function buildPersonFiltersSql(
  actorIdSqlExpression: string,
  filters: AnalyticsFilterState,
  dateRange: AnalyticsDateRange,
): string {
  return [
    buildUsersFilterSql(actorIdSqlExpression, filters.users),
    buildMinimumEventCountsFilterSql(actorIdSqlExpression, filters.minimumEventCounts, dateRange),
    buildConnectionCountriesFilterSql(actorIdSqlExpression, filters.connectionCountries, dateRange),
    buildAppUiLanguagesFilterSql(actorIdSqlExpression, filters.appUiLanguages, dateRange),
    buildCatalogAttributionFiltersSql(actorIdSqlExpression, filters),
  ].join("\n  AND ");
}

// NEW VERSUS RETURNING ON DAY D IS THE PERSON'S FIRST TRUSTED `app_opened` DAY, the first-open
// definition Who opened the app and Catalog deck installs use: new when it is D, returning when it is
// earlier. A person with no trusted open by D belongs to neither side and is kept only while both
// cohorts are selected, as `isEveryUserCohortSelected` describes.
function buildActorFirstOpensCteSql(
  actorIdsSql: string,
  dateRange: AnalyticsDateRange,
): ReadonlyArray<string> {
  return [
    "actor_first_opens AS (",
    "  SELECT",
    "    resolved.actor_id::text AS actor_id,",
    "    MIN((resolved.occurred_at AT TIME ZONE 'UTC')::date) AS first_open_date",
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.event_name = 'app_opened'",
    `    AND resolved.occurred_at < ${buildRangeEndSql(dateRange, 0)}`,
    `    AND ${buildTrustedActorRowsFilterSql("resolved.trust_level")}`,
    `    AND resolved.actor_id::text = ANY (ARRAY(${actorIdsSql}))`,
    "  GROUP BY resolved.actor_id",
    ")",
  ];
}

function buildCohortPredicateSql(
  filters: AnalyticsFilterState,
  dayDateSqlExpression: string,
): string {
  const cohortSql = [
    "CASE",
    `  WHEN actor_first_opens.first_open_date IS NULL OR actor_first_opens.first_open_date > ${dayDateSqlExpression} THEN NULL`,
    `  WHEN actor_first_opens.first_open_date = ${dayDateSqlExpression} THEN 'new'`,
    "  ELSE 'returning'",
    "END",
  ].join(" ");
  const unknownCohortSelectionSql = isEveryUserCohortSelected(filters) ? "TRUE" : "FALSE";
  return `((${cohortSql}) IS NULL AND ${unknownCohortSelectionSql} OR ${buildUserCohortsFilterSql(`(${cohortSql})`, filters.userCohorts)})`;
}

// THE WIDGET STATE IS A STOCK. Each installation (`anonymous_id`) reports its three placed-widget
// counts whenever they change, so on day D it holds the state of its latest report at or before the
// end of D, however long before the range that report was. `installation_day_reports` keeps each
// installation's last report of every UTC day over all history up to the range end, and
// `installation_day_states` says until which day it held. The installation belongs to the person its
// latest report resolves to and to that report's platform. The platform filter narrows installations,
// the trust and exclusion rules drop rows before the latest one is chosen.
function buildPlacementStateCtesSql(
  filters: AnalyticsFilterState,
  dateRange: AnalyticsDateRange,
): ReadonlyArray<string> {
  return [
    "requested_dates AS (",
    "  SELECT generate_series(",
    `    ${escapeSqlStringLiteral(dateRange.from)}::date,`,
    `    ${escapeSqlStringLiteral(dateRange.to)}::date,`,
    "    INTERVAL '1 day'",
    "  )::date AS report_date",
    "),",
    "installation_day_reports AS (",
    "  SELECT DISTINCT ON (resolved.anonymous_id, (resolved.occurred_at AT TIME ZONE 'UTC')::date)",
    "    resolved.anonymous_id,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date AS reported_date,",
    "    resolved.actor_id::text AS actor_id,",
    "    resolved.platform,",
    "    (resolved.event_properties ->> 'small_count')::int",
    "      + (resolved.event_properties ->> 'medium_count')::int",
    "      + (resolved.event_properties ->> 'large_count')::int > 0 AS has_widget",
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.event_name = 'widget_placement_changed'",
    `    AND resolved.occurred_at < ${buildRangeEndSql(dateRange, 0)}`,
    "    AND resolved.anonymous_id IS NOT NULL",
    `    AND resolved.platform IN (${widgetPlatforms.map(escapeSqlStringLiteral).join(", ")})`,
    `    AND ${buildEventPlatformsFilterSql("resolved.platform", filters.eventPlatforms)}`,
    `    AND ${buildTrustedActorRowsFilterSql("resolved.trust_level")}`,
    ...buildExcludedActorSqlLines("resolved.actor_id::text"),
    "  ORDER BY",
    "    resolved.anonymous_id,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date,",
    "    resolved.occurred_at DESC,",
    "    resolved.event_id DESC",
    "),",
    "installation_day_states AS (",
    "  SELECT",
    "    installation_day_reports.*,",
    "    LEAD(installation_day_reports.reported_date) OVER (",
    "      PARTITION BY installation_day_reports.anonymous_id",
    "      ORDER BY installation_day_reports.reported_date",
    "    ) AS superseded_date",
    "  FROM installation_day_reports",
    "),",
    // One row per (person, platform, requested day) the person had any known state on that platform.
    "actor_platform_day_states AS (",
    "  SELECT",
    "    installation_day_states.actor_id,",
    "    installation_day_states.platform,",
    "    requested_dates.report_date,",
    "    bool_or(installation_day_states.has_widget) AS has_widget",
    "  FROM installation_day_states",
    "  INNER JOIN requested_dates",
    "    ON requested_dates.report_date >= installation_day_states.reported_date",
    "    AND (",
    "      installation_day_states.superseded_date IS NULL",
    "      OR requested_dates.report_date < installation_day_states.superseded_date",
    "    )",
    "  GROUP BY",
    "    installation_day_states.actor_id,",
    "    installation_day_states.platform,",
    "    requested_dates.report_date",
    "),",
  ];
}

// People with a Home Screen widget per day and platform. `GROUPING SETS` adds each day's distinct
// people over both platforms as the row whose `platform` is NULL, which no per-platform row can be.
function buildWidgetPeopleSql(filters: AnalyticsFilterState, dateRange: AnalyticsDateRange): string {
  return [
    "WITH",
    ...buildPlacementStateCtesSql(filters, dateRange),
    ...buildActorFirstOpensCteSql("SELECT DISTINCT installation_day_reports.actor_id FROM installation_day_reports", dateRange),
    "SELECT",
    "  to_char(actor_platform_day_states.report_date, 'YYYY-MM-DD') AS report_date,",
    "  actor_platform_day_states.platform,",
    "  COUNT(DISTINCT actor_platform_day_states.actor_id)::int AS people_count",
    "FROM actor_platform_day_states",
    "LEFT JOIN actor_first_opens",
    "  ON actor_first_opens.actor_id = actor_platform_day_states.actor_id",
    "WHERE actor_platform_day_states.has_widget",
    `  AND ${buildPersonFiltersSql("actor_platform_day_states.actor_id", filters, dateRange)}`,
    `  AND ${buildCohortPredicateSql(filters, "actor_platform_day_states.report_date")}`,
    "GROUP BY GROUPING SETS (",
    "  (actor_platform_day_states.report_date, actor_platform_day_states.platform),",
    "  (actor_platform_day_states.report_date)",
    ")",
    "ORDER BY 1, 2 NULLS FIRST",
  ].join("\n");
}

// Widget taps per day and size, from `widget_opened`. The `widget_size` NULL row is the day's total,
// which carries the day's distinct people over every size. The platform is bucketed with the same CASE
// as every other report.
function buildWidgetTapsSql(filters: AnalyticsFilterState, dateRange: AnalyticsDateRange): string {
  return [
    "WITH widget_taps AS (",
    "  SELECT",
    "    resolved.actor_id::text AS actor_id,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date AS tap_date,",
    "    resolved.event_properties ->> 'widget_size' AS widget_size",
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.event_name = 'widget_opened'",
    `    AND resolved.occurred_at >= ${buildRangeStartSql(dateRange)}`,
    `    AND resolved.occurred_at < ${buildRangeEndSql(dateRange, 0)}`,
    `    AND ${buildEventPlatformsFilterSql(
      "CASE WHEN resolved.platform IN ('web', 'android', 'ios', 'agent') THEN resolved.platform ELSE 'unattributed' END",
      filters.eventPlatforms,
    )}`,
    `    AND ${buildTrustedActorRowsFilterSql("resolved.trust_level")}`,
    ...buildExcludedActorSqlLines("resolved.actor_id::text"),
    "),",
    ...buildActorFirstOpensCteSql("SELECT DISTINCT widget_taps.actor_id FROM widget_taps", dateRange),
    "SELECT",
    "  to_char(widget_taps.tap_date, 'YYYY-MM-DD') AS report_date,",
    "  widget_taps.widget_size,",
    "  COUNT(*)::int AS tap_count,",
    "  COUNT(DISTINCT widget_taps.actor_id)::int AS people_count",
    "FROM widget_taps",
    "LEFT JOIN actor_first_opens",
    "  ON actor_first_opens.actor_id = widget_taps.actor_id",
    `WHERE ${buildPersonFiltersSql("widget_taps.actor_id", filters, dateRange)}`,
    `  AND ${buildCohortPredicateSql(filters, "widget_taps.tap_date")}`,
    "GROUP BY GROUPING SETS ((widget_taps.tap_date, widget_taps.widget_size), (widget_taps.tap_date))",
    "ORDER BY 1, 2 NULLS FIRST",
  ].join("\n");
}

// 7-DAY RETURN WITH VERSUS WITHOUT A WIDGET. The cohort of day D is everyone with an `app_opened` on
// D on iOS or Android (narrowed by the platform filter) whose widget state is known by the end of D,
// split by whether any of their installations then had a widget. A member returned when they have an
// `app_opened` on any platform on D+1..D+7. Only people with a placement report can be in a cohort, so
// app opens are read for them alone. The returned counts are NULL until D+7 has ended in UTC.
function buildWidgetReturnSql(filters: AnalyticsFilterState, dateRange: AnalyticsDateRange): string {
  const mobileOpenSql = [
    `resolved.platform IN (${widgetPlatforms.map(escapeSqlStringLiteral).join(", ")})`,
    `AND ${buildEventPlatformsFilterSql("resolved.platform", filters.eventPlatforms)}`,
  ].join(" ");

  return [
    "WITH",
    ...buildPlacementStateCtesSql(filters, dateRange),
    "actor_day_states AS (",
    "  SELECT",
    "    actor_platform_day_states.actor_id,",
    "    actor_platform_day_states.report_date,",
    "    bool_or(actor_platform_day_states.has_widget) AS has_widget",
    "  FROM actor_platform_day_states",
    "  GROUP BY actor_platform_day_states.actor_id, actor_platform_day_states.report_date",
    "),",
    "app_open_days AS (",
    "  SELECT",
    "    resolved.actor_id::text AS actor_id,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date AS open_date,",
    `    bool_or(${mobileOpenSql}) AS is_mobile_open`,
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.event_name = 'app_opened'",
    `    AND resolved.occurred_at >= ${buildRangeStartSql(dateRange)}`,
    `    AND resolved.occurred_at < ${buildRangeEndSql(dateRange, widgetReturnWindowDays)}`,
    `    AND ${buildTrustedActorRowsFilterSql("resolved.trust_level")}`,
    "    AND resolved.actor_id::text = ANY (ARRAY(SELECT DISTINCT actor_day_states.actor_id FROM actor_day_states))",
    "  GROUP BY resolved.actor_id, (resolved.occurred_at AT TIME ZONE 'UTC')::date",
    "),",
    ...buildActorFirstOpensCteSql("SELECT DISTINCT actor_day_states.actor_id FROM actor_day_states", dateRange),
    ",",
    "cohort_members AS (",
    "  SELECT",
    "    actor_day_states.report_date,",
    "    actor_day_states.has_widget,",
    "    EXISTS (",
    "      SELECT 1",
    "      FROM app_open_days AS later_opens",
    "      WHERE later_opens.actor_id = actor_day_states.actor_id",
    "        AND later_opens.open_date > actor_day_states.report_date",
    `        AND later_opens.open_date <= actor_day_states.report_date + ${widgetReturnWindowDays}`,
    "    ) AS returned",
    "  FROM actor_day_states",
    "  INNER JOIN app_open_days",
    "    ON app_open_days.actor_id = actor_day_states.actor_id",
    "    AND app_open_days.open_date = actor_day_states.report_date",
    "    AND app_open_days.is_mobile_open",
    "  LEFT JOIN actor_first_opens",
    "    ON actor_first_opens.actor_id = actor_day_states.actor_id",
    `  WHERE ${buildPersonFiltersSql("actor_day_states.actor_id", filters, dateRange)}`,
    `    AND ${buildCohortPredicateSql(filters, "actor_day_states.report_date")}`,
    ")",
    "SELECT",
    "  to_char(cohort_members.report_date, 'YYYY-MM-DD') AS report_date,",
    "  COUNT(*) FILTER (WHERE cohort_members.has_widget)::int AS with_widget_people,",
    "  COUNT(*) FILTER (WHERE NOT cohort_members.has_widget)::int AS without_widget_people,",
    `  CASE WHEN cohort_members.report_date + ${widgetReturnWindowDays} < (statement_timestamp() AT TIME ZONE 'UTC')::date`,
    "    THEN COUNT(*) FILTER (WHERE cohort_members.has_widget AND cohort_members.returned)::int",
    "  END AS with_widget_returned_people,",
    `  CASE WHEN cohort_members.report_date + ${widgetReturnWindowDays} < (statement_timestamp() AT TIME ZONE 'UTC')::date`,
    "    THEN COUNT(*) FILTER (WHERE NOT cohort_members.has_widget AND cohort_members.returned)::int",
    "  END AS without_widget_returned_people",
    "FROM cohort_members",
    "GROUP BY cohort_members.report_date",
    "ORDER BY cohort_members.report_date",
  ].join("\n");
}

/** Three statements, one result set each: people with a widget, taps, and the 7-day return. */
export function buildHomeScreenWidgetsSql(filters: AnalyticsFilterState): string {
  const dateRange = assertValidDateRange(filters.dateRange, homeScreenWidgetsReportLabel);
  return [
    buildWidgetPeopleSql(filters, dateRange),
    buildWidgetTapsSql(filters, dateRange),
    buildWidgetReturnSql(filters, dateRange),
  ].join(";\n");
}

function parseWidgetPlatform(row: AdminQueryRow): WidgetPlatform {
  const platform = assertIsString(row.platform ?? null, homeScreenWidgetsReportLabel, "platform");
  if (widgetPlatforms.includes(platform as WidgetPlatform) === false) {
    throw new Error(`${homeScreenWidgetsReportLabel} field "platform" must be ios or android, got: ${platform}`);
  }
  return platform as WidgetPlatform;
}

function parseWidgetSize(row: AdminQueryRow): WidgetSize {
  const widgetSize = assertIsString(row.widget_size ?? null, homeScreenWidgetsReportLabel, "widget_size");
  if (widgetSizes.includes(widgetSize as WidgetSize) === false) {
    throw new Error(`${homeScreenWidgetsReportLabel} field "widget_size" must be small, medium or large, got: ${widgetSize}`);
  }
  return widgetSize as WidgetSize;
}

function parseRequiredCount(row: AdminQueryRow, field: string): number {
  const count = parseActivityCount(row[field] ?? null, homeScreenWidgetsReportLabel, field);
  if (count === null) {
    throw new Error(`${homeScreenWidgetsReportLabel} field "${field}" must not be NULL.`);
  }
  return count;
}

/** Rows ordered by day with each day's total row (the NULL key) first, as the statements order them. */
function groupDayRows(resultSet: AdminQueryResultSet, keyField: string): ReadonlyArray<Readonly<{
  date: string;
  totalRow: AdminQueryRow;
  keyRows: ReadonlyArray<AdminQueryRow>;
}>> {
  const days = new Map<string, { totalRow: AdminQueryRow | null; keyRows: Array<AdminQueryRow> }>();
  for (const row of resultSet.rows) {
    const date = parseActivityDate(row.report_date ?? null, homeScreenWidgetsReportLabel, "report_date");
    const day = days.get(date) ?? { totalRow: null, keyRows: [] };
    if ((row[keyField] ?? null) === null) {
      day.totalRow = row;
    } else {
      day.keyRows.push(row);
    }
    days.set(date, day);
  }

  return Array.from(days.entries()).map(([date, day]) => {
    if (day.totalRow === null) {
      throw new Error(`${homeScreenWidgetsReportLabel} has no total row for ${date}.`);
    }
    return { date, totalRow: day.totalRow, keyRows: day.keyRows };
  });
}

function buildWidgetPeopleDays(resultSet: AdminQueryResultSet): ReadonlyArray<WidgetPeopleDay> {
  return groupDayRows(resultSet, "platform").map((day) => ({
    date: day.date,
    peopleByPlatform: new Map(day.keyRows.map((row) => [parseWidgetPlatform(row), parseRequiredCount(row, "people_count")])),
    totalPeople: parseRequiredCount(day.totalRow, "people_count"),
  }));
}

function buildWidgetTapsDays(resultSet: AdminQueryResultSet): ReadonlyArray<WidgetTapsDay> {
  return groupDayRows(resultSet, "widget_size").map((day) => ({
    date: day.date,
    tapsBySize: new Map(day.keyRows.map((row) => [parseWidgetSize(row), parseRequiredCount(row, "tap_count")])),
    totalTaps: parseRequiredCount(day.totalRow, "tap_count"),
    totalPeople: parseRequiredCount(day.totalRow, "people_count"),
  }));
}

function buildWidgetReturnDays(resultSet: AdminQueryResultSet): ReadonlyArray<WidgetReturnDay> {
  return resultSet.rows.map((row) => ({
    date: parseActivityDate(row.report_date ?? null, homeScreenWidgetsReportLabel, "report_date"),
    withWidget: {
      people: toInteger(row.with_widget_people ?? null, homeScreenWidgetsReportLabel, "with_widget_people"),
      returnedPeople: parseActivityCount(row.with_widget_returned_people ?? null, homeScreenWidgetsReportLabel, "with_widget_returned_people"),
    },
    withoutWidget: {
      people: toInteger(row.without_widget_people ?? null, homeScreenWidgetsReportLabel, "without_widget_people"),
      returnedPeople: parseActivityCount(row.without_widget_returned_people ?? null, homeScreenWidgetsReportLabel, "without_widget_returned_people"),
    },
  }));
}

export async function loadHomeScreenWidgetsReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  signal: AbortSignal,
): Promise<HomeScreenWidgetsReport> {
  const response = await runAdminQuery(config, buildHomeScreenWidgetsSql(filters), signal);
  const [peopleResultSet, tapsResultSet, returnResultSet] = response.resultSets;
  if (response.resultSets.length !== 3 || peopleResultSet === undefined || tapsResultSet === undefined || returnResultSet === undefined) {
    throw new Error(`${homeScreenWidgetsReportLabel} must return exactly three result sets. Got ${response.resultSets.length}.`);
  }

  return {
    generatedAtUtc: response.executedAtUtc,
    from: filters.dateRange.from,
    to: filters.dateRange.to,
    peopleDays: buildWidgetPeopleDays(peopleResultSet),
    tapsDays: buildWidgetTapsDays(tapsResultSet),
    returnDays: buildWidgetReturnDays(returnResultSet),
  };
}
