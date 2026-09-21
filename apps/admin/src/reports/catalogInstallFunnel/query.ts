import { runAdminQuery } from "../../adminApi";
import type {
  AdminQueryObject,
  AdminQueryResultSet,
  AdminQueryValue,
} from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildEventPlatformsFilterSql,
  buildExcludedActorsFilterSql,
  buildTrustedActorRowsFilterSql,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import {
  assertIsString,
  assertValidDateRange,
  toInteger,
} from "../reportValues";

export const catalogInstallFunnelReportLabel = "Catalog installation funnel";
export const catalogInstallConversionWindowDays = 7;

export const catalogInstallPlacements = ["top", "middle", "bottom"] as const;
export const catalogInstallSources = [
  "direct",
  "search",
  "social",
  "referral",
  "internal",
  "unknown",
] as const;
export const catalogInstallDeviceCategories = [
  "desktop",
  "mobile",
  "tablet",
  "unknown",
] as const;
export const catalogInstallFailureStages = [
  "landing",
  "signin",
  "preview",
  "preinstall_sync",
  "install",
  "postinstall_sync",
] as const;
export const catalogInstallFailureReasons = [
  "invalid_link",
  "package_unavailable",
  "workspace_unavailable",
  "invalid_code",
  "expired_code",
  "code_already_used",
  "rate_limited",
  "offline",
  "timeout",
  "network_error",
  "unauthorized",
  "conflict",
  "storage_error",
  "contract_error",
  "server_error",
  "cancelled",
] as const;

export type CatalogInstallPlacement = (typeof catalogInstallPlacements)[number];
export type CatalogInstallSource = (typeof catalogInstallSources)[number];
export type CatalogInstallDeviceCategory = (typeof catalogInstallDeviceCategories)[number];
export type CatalogInstallFailureStage = (typeof catalogInstallFailureStages)[number];
export type CatalogInstallFailureReason = (typeof catalogInstallFailureReasons)[number];

export type CatalogInstallFailureBucket = Readonly<{
  stage: CatalogInstallFailureStage;
  reason: CatalogInstallFailureReason;
}>;

/**
 * One visitor identity and one deck version, anchored at that identity's first site visit for it.
 *
 * The identity is `analytics.product_events_resolved.actor_id`. A row the browser sent with no
 * account credential - the site click, the signed-out import screens - resolves through the shared
 * `analytics_visitor` cookie in its `anonymous_id`, and onto the account once the web app records an
 * `authenticated_client` identity link for that cookie; the signed-in app's rows carry the account
 * in `user_id` already. That is what carries a person from the site click to the server install.
 *
 * The auth origin's rows do not work that way: they are delivered on a guest credential, so their
 * `user_id` is the guest's and outranks the cookie. `buildCatalogInstallFunnelSql` states what that
 * leaves the sign-in branch able to read.
 *
 * The four `screen_viewed` steps name no deck, because that event carries no properties at all: a
 * visitor who clicked two deck versions in range has them satisfied on both rows by the same view.
 * Only the install-start, install and failure steps require the row's own `package_version_id`.
 */
export type CatalogInstallFunnelVisit = Readonly<{
  actorId: string;
  packageVersionId: string;
  visitedAt: string;
  placement: CatalogInstallPlacement;
  source: CatalogInstallSource;
  deviceCategory: CatalogInstallDeviceCategory;
  importScreenAt: string | null;
  importConfirmAt: string | null;
  installStartedAt: string | null;
  installedAt: string | null;
  /**
   * The three post-install engagement facts, all null together exactly when the visit has no server
   * install, because a person's reviews are only measurable from the install onwards.
   *
   * `installReviewCount` counts the identity's `review_answered` rows from the install to the site
   * visit's seven-day bound, anywhere in the product rather than in the installed deck.
   * `installHasReturnDay` is one of those reviews on a later UTC day than the install.
   * `installActorIsNew` is that identity having no trusted row at all before the site visit, over
   * every event name, trusted as `buildTrustedActorRowsFilterSql` defines it.
   */
  installReviewCount: number | null;
  installHasReturnDay: boolean | null;
  installActorIsNew: boolean | null;
  signedOutGateAt: string | null;
  signedInAt: string | null;
  signedOutImportConfirmAt: string | null;
  failureBuckets: ReadonlyArray<CatalogInstallFailureBucket>;
}>;

export type CatalogInstallPreviewWithoutVisitCount = Readonly<{
  packageVersionId: string;
  visitorCount: number;
}>;

export type CatalogInstallFunnelReport = Readonly<{
  generatedAtUtc: string;
  from: string;
  to: string;
  visits: ReadonlyArray<CatalogInstallFunnelVisit>;
  previewsWithoutVisitCounts: ReadonlyArray<CatalogInstallPreviewWithoutVisitCount>;
  /**
   * Server installs on a selected UTC day whose identity made no site click for that deck in the
   * selected dates before the install, so no visit row can hold them. A click before the range counts
   * as no click here, exactly as the funnel treats it. It is one slice of the gap between real
   * installs and the funnel rather than all of it: an install whose identity did click in range is
   * equally unheld whenever that click was dropped by a filter or has a broken step chain.
   */
  installsWithoutVisitCount: number;
}>;

export type CatalogInstallFunnelRange = Readonly<{
  from: string;
  to: string;
}>;

function assertEnumValue<Value extends string>(
  value: AdminQueryValue,
  values: ReadonlyArray<Value>,
  fieldName: string,
): Value {
  const parsedValue = assertIsString(value, catalogInstallFunnelReportLabel, fieldName);
  if (values.includes(parsedValue as Value) === false) {
    throw new Error(`${catalogInstallFunnelReportLabel} field "${fieldName}" is invalid.`);
  }

  return parsedValue as Value;
}

function assertTimestamp(value: AdminQueryValue, fieldName: string): string {
  const timestamp = assertIsString(value, catalogInstallFunnelReportLabel, fieldName);
  if (Number.isNaN(new Date(timestamp).getTime())) {
    throw new Error(`${catalogInstallFunnelReportLabel} field "${fieldName}" must be a timestamp.`);
  }

  return timestamp;
}

function assertNullableTimestamp(value: AdminQueryValue, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return assertTimestamp(value, fieldName);
}

function assertNullableInteger(value: AdminQueryValue, fieldName: string): number | null {
  if (value === null) {
    return null;
  }

  return toInteger(value, catalogInstallFunnelReportLabel, fieldName);
}

function assertNullableBoolean(value: AdminQueryValue, fieldName: string): boolean | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${catalogInstallFunnelReportLabel} field "${fieldName}" must be a boolean.`);
  }

  return value;
}

function assertQueryObject(value: AdminQueryValue, fieldName: string): AdminQueryObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${catalogInstallFunnelReportLabel} field "${fieldName}" must be an object.`);
  }

  return value as AdminQueryObject;
}

function parseFailureBuckets(value: AdminQueryValue): ReadonlyArray<CatalogInstallFailureBucket> {
  if (Array.isArray(value) === false) {
    throw new Error(`${catalogInstallFunnelReportLabel} field "failure_buckets" must be an array.`);
  }

  return (value as ReadonlyArray<AdminQueryValue>).map((entry, index) => {
    const object = assertQueryObject(entry, `failure_buckets[${index}]`);
    return {
      stage: assertEnumValue(
        object.stage ?? null,
        catalogInstallFailureStages,
        `failure_buckets[${index}].stage`,
      ),
      reason: assertEnumValue(
        object.reason ?? null,
        catalogInstallFailureReasons,
        `failure_buckets[${index}].reason`,
      ),
    };
  });
}

function parseVisitRow(row: Readonly<Record<string, AdminQueryValue>>): CatalogInstallFunnelVisit {
  return {
    actorId: assertIsString(row.actor_id ?? null, catalogInstallFunnelReportLabel, "actor_id"),
    packageVersionId: assertIsString(
      row.package_version_id ?? null,
      catalogInstallFunnelReportLabel,
      "package_version_id",
    ),
    visitedAt: assertTimestamp(row.visited_at ?? null, "visited_at"),
    placement: assertEnumValue(row.placement ?? null, catalogInstallPlacements, "placement"),
    source: assertEnumValue(row.source ?? null, catalogInstallSources, "source"),
    deviceCategory: assertEnumValue(
      row.device_category ?? null,
      catalogInstallDeviceCategories,
      "device_category",
    ),
    importScreenAt: assertNullableTimestamp(row.import_screen_at ?? null, "import_screen_at"),
    importConfirmAt: assertNullableTimestamp(row.import_confirm_at ?? null, "import_confirm_at"),
    installStartedAt: assertNullableTimestamp(row.install_started_at ?? null, "install_started_at"),
    installedAt: assertNullableTimestamp(row.installed_at ?? null, "installed_at"),
    installReviewCount: assertNullableInteger(row.install_review_count ?? null, "install_review_count"),
    installHasReturnDay: assertNullableBoolean(row.install_has_return_day ?? null, "install_has_return_day"),
    installActorIsNew: assertNullableBoolean(row.install_actor_is_new ?? null, "install_actor_is_new"),
    signedOutGateAt: assertNullableTimestamp(row.signed_out_gate_at ?? null, "signed_out_gate_at"),
    signedInAt: assertNullableTimestamp(row.signed_in_at ?? null, "signed_in_at"),
    signedOutImportConfirmAt: assertNullableTimestamp(
      row.signed_out_import_confirm_at ?? null,
      "signed_out_import_confirm_at",
    ),
    failureBuckets: parseFailureBuckets(row.failure_buckets ?? null),
  };
}

function parsePreviewWithoutVisitCounts(
  resultSet: AdminQueryResultSet,
): ReadonlyArray<CatalogInstallPreviewWithoutVisitCount> {
  return resultSet.rows.map((row) => ({
    packageVersionId: assertIsString(
      row.package_version_id ?? null,
      catalogInstallFunnelReportLabel,
      "package_version_id",
    ),
    visitorCount: toInteger(
      row.visitor_count ?? null,
      catalogInstallFunnelReportLabel,
      "visitor_count",
    ),
  }));
}

function parseInstallsWithoutVisitCount(resultSet: AdminQueryResultSet): number {
  const row = resultSet.rows[0];
  if (row === undefined) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} installs-without-visit result set must return one row. Got ${resultSet.rows.length}.`,
    );
  }

  return toInteger(row.install_count ?? null, catalogInstallFunnelReportLabel, "install_count");
}

export function buildCatalogInstallFunnelAvailableRangeSql(): string {
  return [
    "SELECT",
    "  COALESCE(",
    "    to_char((MIN(resolved.occurred_at) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),",
    "    to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')",
    "  ) AS from_date,",
    "  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS to_date",
    "FROM analytics.product_events_resolved AS resolved",
    "WHERE resolved.event_name = 'catalog_install_clicked'",
    "  AND resolved.origin = 'client'",
    "  AND resolved.trust_level = 'anonymous_client'",
    // The same NULL-actor exclusion the report applies, so the earliest selectable day is a day the
    // funnel has a countable row on. A consent-refused click belongs to no identity and can anchor
    // nothing, and without this it would still pull the picker's lower bound back to itself.
    "  AND resolved.actor_id IS NOT NULL",
  ].join("\n");
}

/** One dimension of the row's own properties, as a predicate; picking nothing keeps every value. */
function buildVisitDimensionFilterSqlLines(
  columnSqlExpression: string,
  values: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (values.length === 0) {
    return [];
  }

  return [`    AND ${columnSqlExpression} IN (${values.map(escapeSqlStringLiteral).join(", ")})`];
}

/**
 * The five catalog dimensions and the platform, as predicates on the anchoring site click itself.
 *
 * Each field reads the click's own properties rather than resolving somebody: the click is where the
 * placement, the source, the device category and the browser language exist at all. The
 * identity-derived fields of the shared bar stay absent from this area for that reason, even though
 * the row now names an identity.
 *
 * These are applied after `cohort_visits` has already reduced an identity and deck version to its
 * first click, so a selection drops whole rows and can never move the anchor the later steps are
 * measured from. Selecting nothing anywhere leaves every predicate out.
 */
function buildFunnelClickFilterSqlLines(filters: AnalyticsFilterState): ReadonlyArray<string> {
  return [
    `    AND ${buildEventPlatformsFilterSql("COALESCE(candidate.platform, 'unattributed')", filters.eventPlatforms)}`,
    ...buildVisitDimensionFilterSqlLines("candidate.package_version_id", filters.installedDecks),
    ...buildVisitDimensionFilterSqlLines("candidate.placement", filters.catalogPlacements),
    ...buildVisitDimensionFilterSqlLines("candidate.source", filters.catalogSources),
    ...buildVisitDimensionFilterSqlLines("candidate.device_category", filters.catalogDeviceCategories),
    ...buildVisitDimensionFilterSqlLines("candidate.device_locale", filters.catalogClickBrowserLanguages),
  ];
}

/**
 * The same selection on the no-visit diagnostic, which counts app-side previews whose identity made
 * no site click this report can see. Only the two things such a row answers itself can narrow it:
 * the deck version it names and its own client platform. The four click dimensions are absent from
 * it by definition, so the diagnostic stays wider than the funnel whenever one of them is narrowed,
 * and the section says so.
 */
function buildFunnelPreviewFilterSqlLines(filters: AnalyticsFilterState): ReadonlyArray<string> {
  return [
    `    AND ${buildEventPlatformsFilterSql("COALESCE(candidate.platform, 'unattributed')", filters.eventPlatforms)}`,
    ...buildVisitDimensionFilterSqlLines("candidate.package_version_id", filters.installedDecks),
  ];
}

/**
 * The five catalog install facts that carry a deck version, over the widest window any row can ask
 * for. The two surface steps are not here: they are read through `surface_events` below, restricted
 * to the actors this report already selected, because `screen_viewed` is the highest-volume event in
 * the store and an unrestricted pass of it does not finish inside the statement timeout.
 */
function buildEventWindowSql(from: string, to: string): ReadonlyArray<string> {
  return [
    "events AS MATERIALIZED (",
    "  SELECT resolved.*",
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.event_name IN (",
    "    'catalog_install_clicked',",
    "    'catalog_install_preview_ready',",
    "    'catalog_install_failed',",
    "    'catalog_deck_install_started',",
    "    'catalog_deck_installed'",
    "  )",
    // A browser that refused consent is given no identifier at all, so its rows resolve to a NULL
    // actor. That is an event belonging to no identity rather than an event missing one, and this
    // report joins every step by identity, so such a row can anchor nothing and bridge nothing.
    // Dropping it here is what keeps the whole credential-free remainder from collapsing into one
    // phantom NULL visitor that no filter and no exclusion could reject.
    "    AND resolved.actor_id IS NOT NULL",
    "    AND resolved.occurred_at >= (",
    `      (${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND resolved.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "), client_events AS (",
    "  SELECT events.*",
    "  FROM events",
    "  WHERE events.origin = 'client'",
    "    AND events.trust_level = 'anonymous_client'",
    "), install_start_events AS (",
    "  SELECT events.*",
    "  FROM events",
    "  WHERE events.event_name = 'catalog_deck_install_started'",
    "    AND events.origin = 'client'",
    "    AND events.trust_level IN ('anonymous_client', 'authenticated_client')",
    ")",
  ];
}

/**
 * The identity-level disqualifiers: a test address, an active admin, or an actor listed in
 * `analytics.excluded_actors`.
 *
 * The candidate row names its own actor, so these read it directly with no bridge to an install. A
 * click whose visitor cookie the web app has linked to an account resolves to that account, so the
 * exclusions reach a person's rows from before they signed in as well.
 *
 * A visitor who never signed in resolves to their own browser id, which is no account's user id, so
 * the address and admin tests find nothing for them. Only the exclusion list can reach such a row,
 * and only if the browser id itself was listed.
 */
function buildExcludedActorFilterSqlLines(): ReadonlyArray<string> {
  return [
    "    AND NOT EXISTS (",
    "      SELECT 1",
    "      FROM org.user_settings AS excluded_user_settings",
    "      WHERE pg_catalog.lower(excluded_user_settings.user_id) = candidate.actor_id::text",
    "        AND (",
    "          LOWER(btrim(excluded_user_settings.email)) LIKE '%@example.com'",
    "          OR EXISTS (",
    "            SELECT 1",
    "            FROM auth.admin_users AS excluded_admin",
    "            WHERE excluded_admin.email = LOWER(btrim(excluded_user_settings.email))",
    "              AND excluded_admin.revoked_at IS NULL",
    "          )",
    "        )",
    "    )",
    `    AND ${buildExcludedActorsFilterSql("candidate.actor_id::text")}`,
  ];
}

/** The test deck, rejected on the candidate's own identity and deck version inside its window. */
function buildTestDeckFilterSqlLines(): ReadonlyArray<string> {
  return [
    "    AND NOT EXISTS (",
    "      SELECT 1",
    "      FROM install_start_events AS test_start",
    "      WHERE test_start.actor_id = candidate.actor_id",
    "        AND test_start.event_properties ->> 'package_version_id' = candidate.package_version_id",
    "        AND test_start.event_properties ->> 'package_slug' = 'test'",
    "        AND test_start.occurred_at >= candidate.anchor_at",
    `        AND test_start.occurred_at <= candidate.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "    )",
  ];
}

/**
 * A cohort membership test, as an uncorrelated subquery rather than a correlation.
 *
 * `analytics.product_events_resolved.actor_id` is
 * `COALESCE(first_guest_upgrade_link.user_id, product_events.user_id, first_anonymous_link.user_id,
 * product_events.anonymous_id)` over two `LEFT JOIN`ed `DISTINCT ON` subqueries
 * (`db/migrations/0137_audience_context.sql`), so an equality on it can never become an index qual and
 * can never be pushed below those joins: one comparison against it is one full pass of that view. So
 * a relation keyed on identity must never be computed per row. This is the same `= ANY (ARRAY(...))`
 * that `buildSubqueryMembershipSql` in `apps/admin/src/filters/filterSql.ts` uses and for the same
 * reason - the subquery is uncorrelated, so the planner evaluates it once as an InitPlan instead of
 * re-running it per row of a CTE it has no statistics for, which is what takes a report past the 30s
 * `reporting_readonly` statement timeout and fails every statement of the page with it.
 */
function buildActorMembershipSql(relationName: string, actorIdSqlExpression: string): string {
  return [
    `${actorIdSqlExpression} = ANY (ARRAY(`,
    `  SELECT ${relationName}.actor_id`,
    `  FROM ${relationName}`,
    "))",
  ].join("\n");
}

export function buildCatalogInstallFunnelSql(filters: AnalyticsFilterState): string {
  const { from, to } = assertValidDateRange(filters.dateRange, catalogInstallFunnelReportLabel);

  const cohortQuery = [
    "WITH",
    ...buildEventWindowSql(from, to),
    ", click_candidates AS (",
    "  SELECT",
    "    events.actor_id,",
    "    events.event_properties ->> 'package_version_id' AS package_version_id,",
    "    events.occurred_at AS anchor_at,",
    "    events.event_id,",
    "    events.event_properties ->> 'placement' AS placement,",
    "    events.event_properties ->> 'source' AS source,",
    "    events.event_properties ->> 'device_category' AS device_category,",
    // Folded with the same `NULLIF` the General attribution fragment uses, so an empty locale is the
    // absence of a reported browser language on both areas rather than a value on one of them and a
    // bucket name on the other. The one shared option list can then neither offer nor match it.
    "    NULLIF(events.device_locale, '') AS device_locale,",
    "    events.platform",
    "  FROM client_events AS events",
    "  WHERE events.event_name = 'catalog_install_clicked'",
    "    AND events.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    // One row per identity per deck version, anchored at the first site visit that identity made for
    // it. Repeated clicks on the same deck are the same person arriving again, not a second attempt.
    "), cohort_visits AS (",
    "  SELECT DISTINCT ON (click_candidates.actor_id, click_candidates.package_version_id)",
    "    click_candidates.*",
    "  FROM click_candidates",
    "  ORDER BY",
    "    click_candidates.actor_id,",
    "    click_candidates.package_version_id,",
    "    click_candidates.anchor_at,",
    "    click_candidates.event_id",
    "), eligible_visits AS (",
    "  SELECT candidate.*",
    "  FROM cohort_visits AS candidate",
    "  WHERE TRUE",
    ...buildTestDeckFilterSqlLines(),
    ...buildExcludedActorFilterSqlLines(),
    ...buildFunnelClickFilterSqlLines(filters),
    "), cohort_actors AS (",
    "  SELECT DISTINCT eligible_visits.actor_id",
    "  FROM eligible_visits",
    // The surface steps, restricted to the identities already selected above. `screen_viewed` names
    // no deck and carries no properties at all, so nothing but the identity and the clock can place
    // it. The three import screens are read at every trust level, because the gate is credential-free
    // by construction; every other screen is read only when an account credential sent it, which is
    // what the signed-in step below needs.
    "), surface_events AS MATERIALIZED (",
    "  SELECT",
    "    surface_event.actor_id,",
    "    surface_event.anonymous_id,",
    "    surface_event.trust_level,",
    "    surface_event.occurred_at,",
    "    surface_event.event_id,",
    "    surface_event.screen",
    "  FROM analytics.product_events_resolved AS surface_event",
    "  WHERE surface_event.event_name = 'screen_viewed'",
    "    AND (",
    "      surface_event.screen IN (",
    "        'catalog',",
    "        'catalog_import_signin',",
    "        'catalog_import_confirm'",
    "      )",
    "      OR surface_event.trust_level = 'authenticated_client'",
    "    )",
    "    AND surface_event.origin = 'client'",
    `    AND ${buildActorMembershipSql("cohort_actors", "surface_event.actor_id")}`,
    "    AND surface_event.occurred_at >= (",
    `      (${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND surface_event.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "), visit_rows AS MATERIALIZED (",
    "SELECT",
    "  visit.actor_id,",
    "  visit.package_version_id,",
    "  visit.anchor_at AS visited_at,",
    "  visit.placement,",
    "  visit.source,",
    "  visit.device_category,",
    "  import_screen.occurred_at AS import_screen_at,",
    "  import_confirm.occurred_at AS import_confirm_at,",
    "  install_started.occurred_at AS install_started_at,",
    "  installed.occurred_at AS installed_at,",
    "  signed_out_gate.occurred_at AS signed_out_gate_at,",
    "  signed_in.occurred_at AS signed_in_at,",
    "  signed_out_confirm.occurred_at AS signed_out_import_confirm_at,",
    "  COALESCE(failures.failure_buckets, '[]'::jsonb) AS failure_buckets",
    "FROM eligible_visits AS visit",
    // `catalog` means "the web catalog import route" only because that route's shell is its sole
    // producer today (`resolveAnalyticsSurface` in `apps/web/src/analytics/surfaces.ts`). The surface
    // itself is a general catalog-browse value in the shared enum, and Android already stamps
    // `catalog_deck_install_started` with it. A client that ships a catalog browse screen will file
    // `screen_viewed` rows here from people who never opened an import link, and this step will count
    // them with no change to this query: narrow it to the import route's own fact before that ships.
    "LEFT JOIN LATERAL (",
    "  SELECT screen_event.occurred_at",
    "  FROM surface_events AS screen_event",
    "  WHERE screen_event.screen = 'catalog'",
    "    AND screen_event.actor_id = visit.actor_id",
    "    AND screen_event.occurred_at >= visit.anchor_at",
    `    AND screen_event.occurred_at <= visit.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY screen_event.occurred_at, screen_event.event_id",
    "  LIMIT 1",
    ") AS import_screen ON TRUE",
    // NOT `catalog_install_preview_ready`, which marks the same moment. This screen view is the
    // account-side fact: the signed-in app reports it with the account credential, so it names the
    // account in `user_id` with no identity link needed, while the preview fact goes out on the
    // credential-free collector and reaches the account only through the web app's link for its
    // visitor cookie.
    //
    // Every step below the site visit, this one included, is reachable only from a click that carries
    // the shared visitor id. The click is the marketing site's fact, produced from the separate
    // `flashcards-open-source-app-website` repository, and a click body that claims no `anonymousId`
    // is stored under its per-attempt `install_journey_id` instead (`readAnonymousId` in
    // `apps/backend/src/productAnalytics/anonymousEvent.ts`). Such a click resolves to an identity
    // nothing else shares, so on any date whose clicks all arrived that way this step and every step
    // below it read zero whichever fact they are keyed on.
    "LEFT JOIN LATERAL (",
    "  SELECT confirm_event.occurred_at",
    "  FROM surface_events AS confirm_event",
    "  WHERE confirm_event.screen = 'catalog_import_confirm'",
    "    AND confirm_event.actor_id = visit.actor_id",
    "    AND confirm_event.occurred_at >= import_screen.occurred_at",
    `    AND confirm_event.occurred_at <= visit.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY confirm_event.occurred_at, confirm_event.event_id",
    "  LIMIT 1",
    ") AS import_confirm ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT start_event.occurred_at",
    "  FROM install_start_events AS start_event",
    "  WHERE start_event.actor_id = visit.actor_id",
    "    AND start_event.event_properties ->> 'package_version_id' = visit.package_version_id",
    "    AND start_event.occurred_at >= import_confirm.occurred_at",
    `    AND start_event.occurred_at <= visit.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY start_event.occurred_at, start_event.event_id",
    "  LIMIT 1",
    ") AS install_started ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT installed_event.occurred_at",
    "  FROM events AS installed_event",
    "  WHERE installed_event.event_name = 'catalog_deck_installed'",
    "    AND installed_event.origin = 'server'",
    "    AND installed_event.actor_id = visit.actor_id",
    "    AND installed_event.event_properties ->> 'package_version_id' = visit.package_version_id",
    "    AND installed_event.occurred_at >= install_started.occurred_at",
    `    AND installed_event.occurred_at <= visit.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY installed_event.occurred_at, installed_event.event_id",
    "  LIMIT 1",
    ") AS installed ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT gate_event.occurred_at, gate_event.anonymous_id",
    "  FROM surface_events AS gate_event",
    "  WHERE gate_event.screen = 'catalog_import_signin'",
    "    AND gate_event.actor_id = visit.actor_id",
    "    AND gate_event.occurred_at >= visit.anchor_at",
    `    AND gate_event.occurred_at <= visit.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY gate_event.occurred_at, gate_event.event_id",
    "  LIMIT 1",
    ") AS signed_out_gate ON TRUE",
    // Signed in on this browser: the first screen view this same browser sent with an account
    // credential after the gate. It is the account-side fact rather than the auth origin's
    // `signin_succeeded`, and that choice is load-bearing. The auth origin posts its rows on a guest
    // credential, so their `user_id` is the guest's and outranks the visitor cookie in
    // `analytics.product_events_resolved` (`db/migrations/0137_audience_context.sql`); they reach the
    // account only through the `server_derived` link `reportSignInSucceeded` writes inside a 150 ms
    // budget that a first-ever sign-in usually overruns (`analyticsReportBudgetMs` in
    // `apps/auth/src/server/analytics/signInFunnel.ts`). Keyed on it, this step would miss most of the
    // people the gate is shown to. The same guest-credential rule is why the auth origin's sign-in
    // screen and code request are not steps at all: a person who gave up there stays on a guest id
    // this cohort never contains, so they could only ever count people who went on to succeed.
    //
    // The web app's signed-in rows need no link to meet the gate: they carry the account in `user_id`,
    // and the same batch writes the `authenticated_client` link that resolves this browser's
    // credential-free rows, the gate included, onto that account.
    //
    // THE SAME `anonymous_id` AS THE GATE is what makes it this browser's sign-in rather than the
    // account's activity. A person who already had an account resolves to it at the gate as well, and
    // without that equality a screen view from their phone, or from another browser, after they gave
    // up at the gate would count as a sign-in here. Strictly after the gate, so the gate row itself can
    // never satisfy it.
    "LEFT JOIN LATERAL (",
    "  SELECT signed_in_event.occurred_at",
    "  FROM surface_events AS signed_in_event",
    "  WHERE signed_in_event.trust_level = 'authenticated_client'",
    "    AND signed_in_event.actor_id = visit.actor_id",
    "    AND signed_in_event.anonymous_id = signed_out_gate.anonymous_id",
    "    AND signed_in_event.occurred_at > signed_out_gate.occurred_at",
    `    AND signed_in_event.occurred_at <= visit.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY signed_in_event.occurred_at, signed_in_event.event_id",
    "  LIMIT 1",
    ") AS signed_in ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT confirm_event.occurred_at",
    "  FROM surface_events AS confirm_event",
    "  WHERE confirm_event.screen = 'catalog_import_confirm'",
    "    AND confirm_event.actor_id = visit.actor_id",
    "    AND confirm_event.occurred_at >= signed_in.occurred_at",
    `    AND confirm_event.occurred_at <= visit.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY confirm_event.occurred_at, confirm_event.event_id",
    "  LIMIT 1",
    ") AS signed_out_confirm ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT jsonb_agg(",
    "    jsonb_build_object('stage', distinct_failures.stage, 'reason', distinct_failures.reason)",
    "    ORDER BY distinct_failures.stage, distinct_failures.reason",
    "  ) AS failure_buckets",
    "  FROM (",
    "    SELECT DISTINCT",
    "      failure_event.event_properties ->> 'stage' AS stage,",
    "      failure_event.event_properties ->> 'reason' AS reason",
    "    FROM client_events AS failure_event",
    "    WHERE failure_event.event_name = 'catalog_install_failed'",
    "      AND failure_event.actor_id = visit.actor_id",
    "      AND failure_event.event_properties ->> 'package_version_id' = visit.package_version_id",
    "      AND failure_event.occurred_at >= visit.anchor_at",
    `      AND failure_event.occurred_at <= visit.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ) AS distinct_failures",
    ") AS failures ON TRUE",
    // Post-install engagement, in three uncorrelated passes keyed by the installing identity rather
    // than per visit row. A visit without a server install has no install to measure from, so it is
    // absent from all three and its columns arrive null together rather than as a zero that would
    // read as a drop-off.
    "), install_actors AS (",
    "  SELECT DISTINCT visit.actor_id",
    "  FROM visit_rows AS visit",
    "  WHERE visit.installed_at IS NOT NULL",
    // THE REVIEWS ARE THE PERSON'S, NOT THE DECK'S. `review_answered` carries only `rating` and
    // `source`, so no deck or card identity exists to narrow them by, and this reads every review
    // those identities answered. It cannot reuse the `events` CTE: that one is restricted to the five
    // catalog event names, and `review_answered` is not among them.
    //
    // The bounds are the widest any visit can ask for, so one pass serves all of them: no review
    // counts before the install, and no install is earlier than the range's first instant, while the
    // per-visit bound below reaches at most a site visit on the last selected day plus the window.
    "), install_actor_reviews AS MATERIALIZED (",
    "  SELECT",
    "    review_event.actor_id,",
    "    review_event.occurred_at",
    "  FROM analytics.product_events_resolved AS review_event",
    "  WHERE review_event.event_name = 'review_answered'",
    `    AND ${buildActorMembershipSql("install_actors", "review_event.actor_id")}`,
    "    AND review_event.occurred_at >= (",
    `      (${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND review_event.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    // New is the absence of any trusted event before the site visit, over that identity's whole
    // history, so this carries NO LOWER BOUND AND NO EVENT-NAME RESTRICTION - reusing a bounded or
    // catalog-only relation here would silently make every identity look new. It reads that history
    // as one grouped `MIN(occurred_at)` per actor, the way
    // `apps/backend/src/productAnalytics/syntheticActorDetector.ts` and the `history` CTE of
    // `apps/admin/src/reports/audience/query.ts` read an actor's first day.
    //
    // The upper bound is the only thing added, and it removes nothing the test can see: every site
    // visit in this cohort is before it, so an event at or after it can never precede one.
    //
    // The trust rule is the second thing this reads the history through, and the shared identity made
    // it matter more rather than less: the anchoring site click is itself a credential-free row now
    // resolving onto this same identity, so without the rule every installer would have a trusted-
    // looking event at their own first site visit and none of them would ever read as new. See
    // `buildTrustedActorRowsFilterSql`.
    "), install_actor_first_event AS MATERIALIZED (",
    "  SELECT",
    "    prior_event.actor_id,",
    "    MIN(prior_event.occurred_at) AS first_event_at",
    "  FROM analytics.product_events_resolved AS prior_event",
    `  WHERE ${buildActorMembershipSql("install_actors", "prior_event.actor_id")}`,
    `    AND ${buildTrustedActorRowsFilterSql("prior_event.trust_level")}`,
    "    AND prior_event.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "  GROUP BY prior_event.actor_id",
    // The count and the return day come from one grouped pass over the same review rows rather than
    // two scans of them. The window runs from the install - a review before it cannot be a
    // consequence of it - to the same seven-day bound on the site visit every other step here uses,
    // so a late install leaves less of it. The return day is a UTC calendar day strictly after the
    // install's, the same UTC day every other admin report reads, and it is reported only together
    // with the review threshold, never on its own, because two independent conditions would let a
    // later step exceed an earlier one.
    //
    // The join is on a visit rather than on an actor, which is what keeps one person who installs two
    // decks in range counted as the two rows they are: each row carries that identity's reviews for
    // its own window, so their reviews are counted once per deck they installed.
    "), visit_engagement AS (",
    "  SELECT",
    "    visit.actor_id,",
    "    visit.package_version_id,",
    "    COUNT(review.occurred_at)::int AS review_count,",
    "    COALESCE(",
    "      bool_or(",
    "        (review.occurred_at AT TIME ZONE 'UTC')::date",
    "          > (visit.installed_at AT TIME ZONE 'UTC')::date",
    "      ),",
    "      FALSE",
    "    ) AS has_return_day",
    "  FROM visit_rows AS visit",
    "  LEFT JOIN install_actor_reviews AS review",
    "    ON review.actor_id = visit.actor_id",
    "    AND review.occurred_at >= visit.installed_at",
    `    AND review.occurred_at <= visit.visited_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  WHERE visit.installed_at IS NOT NULL",
    "  GROUP BY visit.actor_id, visit.package_version_id",
    ")",
    "SELECT",
    "  visit.actor_id::text AS actor_id,",
    "  visit.package_version_id,",
    "  visit.visited_at,",
    "  visit.placement,",
    "  visit.source,",
    "  visit.device_category,",
    "  visit.import_screen_at,",
    "  visit.import_confirm_at,",
    "  visit.install_started_at,",
    "  visit.installed_at,",
    "  engagement.review_count AS install_review_count,",
    "  engagement.has_return_day AS install_has_return_day,",
    "  CASE",
    "    WHEN visit.installed_at IS NULL THEN NULL",
    "    ELSE (",
    "      first_event.first_event_at IS NULL",
    "      OR first_event.first_event_at >= visit.visited_at",
    "    )",
    "  END AS install_actor_is_new,",
    "  visit.signed_out_gate_at,",
    "  visit.signed_in_at,",
    "  visit.signed_out_import_confirm_at,",
    "  visit.failure_buckets",
    "FROM visit_rows AS visit",
    "LEFT JOIN visit_engagement AS engagement",
    "  ON engagement.actor_id = visit.actor_id",
    "  AND engagement.package_version_id = visit.package_version_id",
    "LEFT JOIN install_actor_first_event AS first_event",
    "  ON first_event.actor_id = visit.actor_id",
    "ORDER BY visit.visited_at, visit.actor_id, visit.package_version_id",
  ].join("\n");

  // App-side previews whose identity made no site click for that deck in the selected dates before
  // the preview: the person reached the import screen and loaded the deck without a marketing-site
  // visit the funnel could anchor on - a shared link, a bookmark, or a click older than the selected
  // range, which `site_clicks` does not reach because it is bounded below by the range like the
  // cohort is. Counted as distinct visitor
  // identities per deck version, which is why it is outside the funnel's denominator rather than a
  // step of it.
  const previewWithoutVisitQuery = [
    "WITH",
    ...buildEventWindowSql(from, to),
    ", site_clicks AS (",
    "  SELECT DISTINCT",
    "    clicked.actor_id,",
    "    clicked.event_properties ->> 'package_version_id' AS package_version_id,",
    "    clicked.occurred_at",
    "  FROM client_events AS clicked",
    "  WHERE clicked.event_name = 'catalog_install_clicked'",
    "), preview_candidates AS (",
    "  SELECT DISTINCT ON (",
    "    preview.actor_id,",
    "    preview.event_properties ->> 'package_version_id'",
    "  )",
    "    preview.actor_id,",
    "    preview.event_properties ->> 'package_version_id' AS package_version_id,",
    "    preview.occurred_at AS anchor_at,",
    "    preview.platform",
    "  FROM client_events AS preview",
    "  WHERE preview.event_name = 'catalog_install_preview_ready'",
    "    AND preview.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "  ORDER BY",
    "    preview.actor_id,",
    "    preview.event_properties ->> 'package_version_id',",
    "    preview.occurred_at,",
    "    preview.event_id",
    "), eligible_previews AS (",
    "  SELECT candidate.*",
    "  FROM preview_candidates AS candidate",
    "  WHERE NOT EXISTS (",
    "    SELECT 1",
    "    FROM site_clicks AS selected_click",
    "    WHERE selected_click.actor_id = candidate.actor_id",
    "      AND selected_click.package_version_id = candidate.package_version_id",
    "      AND selected_click.occurred_at <= candidate.anchor_at",
    "  )",
    ...buildTestDeckFilterSqlLines(),
    ...buildExcludedActorFilterSqlLines(),
    ...buildFunnelPreviewFilterSqlLines(filters),
    ")",
    "SELECT",
    "  eligible_previews.package_version_id,",
    "  COUNT(DISTINCT eligible_previews.actor_id)::int AS visitor_count",
    "FROM eligible_previews",
    "GROUP BY eligible_previews.package_version_id",
    "ORDER BY visitor_count DESC, eligible_previews.package_version_id",
  ].join("\n");

  // Server installs the funnel can never place. Every step above is bridged by identity, so an
  // install whose identity made no site click for that deck in the selected dates is invisible to all
  // of them - a click before the range included, since `site_clicks` shares the cohort's lower bound -
  // and
  // that absence is legitimate: an install link can be shared, bookmarked or reopened weeks later.
  // This counts them so part of the gap is a number rather than a suspicion.
  //
  // IT IS A LOWER BOUND ON THAT GAP, NOT THE WHOLE OF IT, and the card and the doc say so. An install
  // whose identity did click in the selected dates is just as unheld by any visit row when the click
  // was dropped by a placement, source, device-category or browser-language selection, or when the
  // import-screen/confirm/started/installed chain is broken. Nothing here can
  // count those, because they are absences.
  //
  // It narrows itself the way the no-visit diagnostic does, on what the row can answer alone: the
  // selected UTC days, the installed deck, the client platform and the actor exclusions, read off the
  // install row directly because it names its actor without any bridge. Nothing else reaches it - a
  // server install holds no placement, source, device category or browser language - and the platform
  // on a server fact is always NULL, so picking any device platform empties this line.
  const installWithoutVisitQuery = [
    "WITH",
    ...buildEventWindowSql(from, to),
    ", site_clicks AS (",
    "  SELECT DISTINCT",
    "    clicked.actor_id,",
    "    clicked.event_properties ->> 'package_version_id' AS package_version_id,",
    "    clicked.occurred_at",
    "  FROM client_events AS clicked",
    "  WHERE clicked.event_name = 'catalog_install_clicked'",
    ")",
    "SELECT COUNT(*)::int AS install_count",
    "FROM events AS orphan_install",
    "LEFT JOIN org.user_settings AS orphan_user_settings",
    "  ON pg_catalog.lower(orphan_user_settings.user_id) = orphan_install.actor_id::text",
    "WHERE orphan_install.event_name = 'catalog_deck_installed'",
    "  AND orphan_install.origin = 'server'",
    // A PRIOR click, the same way the no-visit preview diagnostic reads one. The funnel requires every
    // step to be at or after the one above it, so a click made after the install anchors no visit row
    // this install could ever have landed on: without this bound such an install is excluded here and
    // held nowhere above, and is counted by nothing at all.
    "  AND NOT EXISTS (",
    "    SELECT 1",
    "    FROM site_clicks",
    "    WHERE site_clicks.actor_id = orphan_install.actor_id",
    "      AND site_clicks.package_version_id",
    "        = orphan_install.event_properties ->> 'package_version_id'",
    "      AND site_clicks.occurred_at <= orphan_install.occurred_at",
    "  )",
    "  AND orphan_install.occurred_at >= (",
    `    (${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "  AND orphan_install.occurred_at < (",
    `    (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "  )",
    "  AND orphan_install.event_properties ->> 'package_slug' <> 'test'",
    "  AND (",
    "    orphan_user_settings.email IS NULL",
    "    OR LOWER(btrim(orphan_user_settings.email)) NOT LIKE '%@example.com'",
    "  )",
    "  AND NOT EXISTS (",
    "    SELECT 1",
    "    FROM auth.admin_users AS orphan_admin",
    "    WHERE orphan_admin.email = LOWER(btrim(orphan_user_settings.email))",
    "      AND orphan_admin.revoked_at IS NULL",
    "  )",
    `  AND ${buildExcludedActorsFilterSql("orphan_install.actor_id::text")}`,
    `  AND ${buildEventPlatformsFilterSql("COALESCE(orphan_install.platform, 'unattributed')", filters.eventPlatforms)}`,
    ...buildVisitDimensionFilterSqlLines(
      "orphan_install.event_properties ->> 'package_version_id'",
      filters.installedDecks,
    ),
  ].join("\n");

  return [cohortQuery, previewWithoutVisitQuery, installWithoutVisitQuery].join(";\n");
}

export async function loadCatalogInstallFunnelAvailableRange(
  config: AdminAppConfig,
): Promise<CatalogInstallFunnelRange> {
  const response = await runAdminQuery(config, buildCatalogInstallFunnelAvailableRangeSql());
  if (response.resultSets.length !== 1) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} available range must return exactly one result set. Got ${response.resultSets.length}.`,
    );
  }

  const resultSet = response.resultSets[0];
  if (resultSet === undefined || resultSet.rows.length !== 1) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} available range must return exactly one row. Got ${resultSet?.rows.length ?? 0}.`,
    );
  }

  const row = resultSet.rows[0];
  if (row === undefined) {
    throw new Error(`${catalogInstallFunnelReportLabel} available range row is missing.`);
  }

  return assertValidDateRange({
    from: assertIsString(row.from_date ?? null, catalogInstallFunnelReportLabel, "from_date"),
    to: assertIsString(row.to_date ?? null, catalogInstallFunnelReportLabel, "to_date"),
  }, `${catalogInstallFunnelReportLabel} available range`);
}

export async function loadCatalogInstallFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
): Promise<CatalogInstallFunnelReport> {
  const response = await runAdminQuery(config, buildCatalogInstallFunnelSql(filters));
  if (response.resultSets.length !== 3) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} must return exactly three result sets. Got ${response.resultSets.length}.`,
    );
  }

  const visitsResultSet = response.resultSets[0];
  const previewsWithoutVisitResultSet = response.resultSets[1];
  const installsWithoutVisitResultSet = response.resultSets[2];
  if (
    visitsResultSet === undefined
    || previewsWithoutVisitResultSet === undefined
    || installsWithoutVisitResultSet === undefined
  ) {
    throw new Error(`${catalogInstallFunnelReportLabel} result sets are missing.`);
  }

  return {
    generatedAtUtc: response.executedAtUtc,
    from: filters.dateRange.from,
    to: filters.dateRange.to,
    visits: visitsResultSet.rows.map(parseVisitRow),
    previewsWithoutVisitCounts: parsePreviewWithoutVisitCounts(previewsWithoutVisitResultSet),
    installsWithoutVisitCount: parseInstallsWithoutVisitCount(installsWithoutVisitResultSet),
  };
}
