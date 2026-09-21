import { runAdminQuery } from "../../adminApi";
import type {
  AdminQueryObject,
  AdminQueryResultSet,
  AdminQueryValue,
} from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildActorIsExcludedSql,
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

export type CatalogInstallFunnelAttempt = Readonly<{
  journeyId: string;
  packageVersionId: string;
  clickedAt: string;
  placement: CatalogInstallPlacement;
  source: CatalogInstallSource;
  deviceCategory: CatalogInstallDeviceCategory;
  landedAt: string | null;
  landedAuthState: "signed_in" | "signed_out" | null;
  previewReadyAt: string | null;
  installStartedAt: string | null;
  installedAt: string | null;
  /**
   * The three post-install engagement facts, all null together exactly when the attempt has no
   * server install, because only that row names the person whose reviews they measure.
   *
   * `installReviewCount` counts the install actor's `review_answered` rows from the install to the
   * click's seven-day bound, anywhere in the product rather than in the installed deck.
   * `installHasReturnDay` is one of those reviews on a later UTC day than the install.
   * `installActorIsNew` is that actor having no trusted row at all before the click, over every
   * event name, trusted as `buildTrustedActorRowsFilterSql` defines it.
   */
  installReviewCount: number | null;
  installHasReturnDay: boolean | null;
  installActorIsNew: boolean | null;
  signedOutLandedAt: string | null;
  signInStartedAt: string | null;
  codeRequestedAt: string | null;
  signInSucceededAt: string | null;
  signedOutPreviewReadyAt: string | null;
  failureBuckets: ReadonlyArray<CatalogInstallFailureBucket>;
}>;

export type CatalogInstallMissingClickCount = Readonly<{
  packageVersionId: string;
  attemptCount: number;
}>;

export type CatalogInstallFunnelReport = Readonly<{
  generatedAtUtc: string;
  from: string;
  to: string;
  attempts: ReadonlyArray<CatalogInstallFunnelAttempt>;
  missingClickCounts: ReadonlyArray<CatalogInstallMissingClickCount>;
  /**
   * Server installs on a selected UTC day carrying no `install_journey_id`, so no attempt row can
   * hold them. It is one slice of the gap between real installs and the funnel rather than all of
   * it: an install that does carry a journey is equally unheld whenever that journey's click fell
   * outside the selected dates, was dropped by a filter, or has a broken step chain.
   */
  installsWithoutJourneyCount: number;
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

function parseAttemptRow(row: Readonly<Record<string, AdminQueryValue>>): CatalogInstallFunnelAttempt {
  const landedAuthState = row.landed_auth_state ?? null;
  if (
    landedAuthState !== null
    && landedAuthState !== "signed_in"
    && landedAuthState !== "signed_out"
  ) {
    throw new Error(`${catalogInstallFunnelReportLabel} field "landed_auth_state" is invalid.`);
  }

  return {
    journeyId: assertIsString(row.journey_id ?? null, catalogInstallFunnelReportLabel, "journey_id"),
    packageVersionId: assertIsString(
      row.package_version_id ?? null,
      catalogInstallFunnelReportLabel,
      "package_version_id",
    ),
    clickedAt: assertTimestamp(row.clicked_at ?? null, "clicked_at"),
    placement: assertEnumValue(row.placement ?? null, catalogInstallPlacements, "placement"),
    source: assertEnumValue(row.source ?? null, catalogInstallSources, "source"),
    deviceCategory: assertEnumValue(
      row.device_category ?? null,
      catalogInstallDeviceCategories,
      "device_category",
    ),
    landedAt: assertNullableTimestamp(row.landed_at ?? null, "landed_at"),
    landedAuthState,
    previewReadyAt: assertNullableTimestamp(row.preview_ready_at ?? null, "preview_ready_at"),
    installStartedAt: assertNullableTimestamp(row.install_started_at ?? null, "install_started_at"),
    installedAt: assertNullableTimestamp(row.installed_at ?? null, "installed_at"),
    installReviewCount: assertNullableInteger(row.install_review_count ?? null, "install_review_count"),
    installHasReturnDay: assertNullableBoolean(row.install_has_return_day ?? null, "install_has_return_day"),
    installActorIsNew: assertNullableBoolean(row.install_actor_is_new ?? null, "install_actor_is_new"),
    signedOutLandedAt: assertNullableTimestamp(row.signed_out_landed_at ?? null, "signed_out_landed_at"),
    signInStartedAt: assertNullableTimestamp(row.signin_started_at ?? null, "signin_started_at"),
    codeRequestedAt: assertNullableTimestamp(row.code_requested_at ?? null, "code_requested_at"),
    signInSucceededAt: assertNullableTimestamp(row.signin_succeeded_at ?? null, "signin_succeeded_at"),
    signedOutPreviewReadyAt: assertNullableTimestamp(
      row.signed_out_preview_ready_at ?? null,
      "signed_out_preview_ready_at",
    ),
    failureBuckets: parseFailureBuckets(row.failure_buckets ?? null),
  };
}

function parseMissingClickCounts(
  resultSet: AdminQueryResultSet,
): ReadonlyArray<CatalogInstallMissingClickCount> {
  return resultSet.rows.map((row) => ({
    packageVersionId: assertIsString(
      row.package_version_id ?? null,
      catalogInstallFunnelReportLabel,
      "package_version_id",
    ),
    attemptCount: toInteger(
      row.attempt_count ?? null,
      catalogInstallFunnelReportLabel,
      "attempt_count",
    ),
  }));
}

function parseInstallsWithoutJourneyCount(resultSet: AdminQueryResultSet): number {
  const row = resultSet.rows[0];
  if (row === undefined) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} installs-without-journey result set must return one row. Got ${resultSet.rows.length}.`,
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
    "WHERE resolved.event_name IN ('catalog_install_clicked', 'catalog_install_landed')",
    "  AND resolved.origin = 'client'",
    "  AND resolved.trust_level = 'anonymous_client'",
  ].join("\n");
}

/** One dimension of the row's own properties, as a predicate; picking nothing keeps every value. */
function buildAttemptDimensionFilterSqlLines(
  columnSqlExpression: string,
  values: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (values.length === 0) {
    return [];
  }

  return [`    AND ${columnSqlExpression} IN (${values.map(escapeSqlStringLiteral).join(", ")})`];
}

/**
 * The five catalog dimensions and the platform, as predicates on the click attempt itself.
 *
 * A row here is one anonymous click rather than a person, so each field reads the click's own
 * properties instead of resolving somebody through a completed install the way the user-scoped areas
 * do. The identity-derived fields are absent from this area for the same reason.
 *
 * These are applied after `cohort_clicks` has already reduced a journey to its first click, so a
 * selection drops whole journeys and can never move the anchor the later stages are measured from.
 * Selecting nothing anywhere leaves every predicate out, so a stage counts exactly what it counted
 * before this area had filters.
 */
function buildFunnelClickFilterSqlLines(filters: AnalyticsFilterState): ReadonlyArray<string> {
  return [
    `    AND ${buildEventPlatformsFilterSql("COALESCE(candidate.platform, 'unattributed')", filters.eventPlatforms)}`,
    ...buildAttemptDimensionFilterSqlLines("candidate.package_version_id", filters.installedDecks),
    ...buildAttemptDimensionFilterSqlLines("candidate.placement", filters.catalogPlacements),
    ...buildAttemptDimensionFilterSqlLines("candidate.source", filters.catalogSources),
    ...buildAttemptDimensionFilterSqlLines("candidate.device_category", filters.catalogDeviceCategories),
    ...buildAttemptDimensionFilterSqlLines("candidate.device_locale", filters.catalogClickBrowserLanguages),
  ];
}

/**
 * The same selection on the no-click diagnostic, which counts landings that recorded no click at
 * all. Only the two things such a row answers itself can narrow it: the deck version it names and
 * its own client platform. The four click dimensions are absent from it by definition, so the
 * diagnostic stays wider than the funnel whenever one of them is narrowed, and the section says so.
 */
function buildFunnelLandingFilterSqlLines(filters: AnalyticsFilterState): ReadonlyArray<string> {
  return [
    `    AND ${buildEventPlatformsFilterSql("COALESCE(candidate.platform, 'unattributed')", filters.eventPlatforms)}`,
    ...buildAttemptDimensionFilterSqlLines("candidate.package_version_id", filters.installedDecks),
  ];
}

function buildEventWindowSql(from: string, to: string): ReadonlyArray<string> {
  return [
    "events AS MATERIALIZED (",
    "  SELECT resolved.*",
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.event_name IN (",
    "    'catalog_install_clicked',",
    "    'catalog_install_landed',",
    "    'catalog_install_signin_started',",
    "    'catalog_install_signin_code_requested',",
    "    'catalog_install_signin_succeeded',",
    "    'catalog_install_preview_ready',",
    "    'catalog_install_failed',",
    "    'catalog_deck_install_started',",
    "    'catalog_deck_installed'",
    "  )",
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
 * The two `NOT EXISTS` disqualifiers that drop a journey belonging to somebody this area does not
 * count: a test address, an active admin, or an actor listed in `analytics.excluded_actors`.
 *
 * A JOURNEY NAMES NOBODY OF ITSELF, so this is what the exclusion can and cannot reach here. The
 * click and the landing are anonymous by construction, and a person appears only through one of two
 * bridges inside the conversion window: a matching server `catalog_deck_installed`, or a matching
 * `catalog_deck_install_started` sent by the authenticated client collector, which carries the
 * signed-in request's `user_id` that the resolved view turns into an `actor_id`. A journey that
 * reached either one is dropped when that actor is excluded; a journey that neither completed a server
 * install nor started an install while signed in is attributable to no actor at all and is therefore
 * counted whoever produced it. That remaining case is the one this cannot exclude, and no join here can
 * fix it - only an identity on the click itself could, and the public collector deliberately stores
 * none.
 *
 * THE INSTALL-INTENT BRIDGE MOVES THE FUNNEL ON ITS OWN, before any actor is listed. It carries the
 * same condition as the install bridge, so the long-standing `%@example.com` and active-admin
 * exclusions now also reach a journey that only started an install while signed in. Until now they
 * needed a server `catalog_deck_installed` row, so the funnel and the no-click diagnostic drop the
 * moment this lands: a failed install, or an install whose confirm omitted
 * `installJourneyId` and therefore carries no matching server fact (`docs/catalog-install-funnel.md`
 * documents both as valid), no longer keeps a test-address or admin journey in the counts. That is
 * deliberate - the funnel already dropped such a person's completed install, and a signed-in install
 * start names the same person just as well.
 *
 * `trust_level = 'authenticated_client'` on the install-intent bridge is load-bearing rather than
 * tidiness: only such a row carries the `user_id` the resolved `actor_id` is taken from. An
 * `anonymous_client` row's `actor_id` is the browser's shared visitor id, because
 * `catalog_deck_install_started` travels on the general collector that attaches it
 * (`apps/web/src/analytics/client.ts`), and it is the journey UUID only when the browser claimed no
 * `anonymousId` at all - a refused consent, or a row predating that collector - which is when the
 * backend falls back to `install_journey_id` (`apps/backend/src/productAnalytics/anonymousEvent.ts`).
 * An unrestricted check would compare one of those two anonymous ids against the exclusion list.
 *
 * Both bridges anchor on `candidate.anchor_at`, which is the click in the funnel and the landing in
 * the no-click diagnostic, so the conversion window shifts with whichever candidate row applies.
 */
function buildExcludedJourneyActorFilterSqlLines(): ReadonlyArray<string> {
  const buildBridgeSqlLines = (
    sourceRelation: string,
    eventAlias: string,
    sourceConditionSqlLines: ReadonlyArray<string>,
  ): ReadonlyArray<string> => [
    "    AND NOT EXISTS (",
    "      SELECT 1",
    `      FROM ${sourceRelation} AS ${eventAlias}`,
    "      LEFT JOIN org.user_settings AS excluded_user_settings",
    `        ON pg_catalog.lower(excluded_user_settings.user_id) = ${eventAlias}.actor_id::text`,
    ...sourceConditionSqlLines,
    `        AND ${eventAlias}.event_properties ->> 'install_journey_id' = candidate.install_journey_id`,
    `        AND ${eventAlias}.event_properties ->> 'package_version_id' = candidate.package_version_id`,
    `        AND ${eventAlias}.occurred_at >= candidate.anchor_at`,
    `        AND ${eventAlias}.occurred_at <= candidate.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "        AND (",
    "          LOWER(btrim(excluded_user_settings.email)) LIKE '%@example.com'",
    "          OR EXISTS (",
    "            SELECT 1",
    "            FROM auth.admin_users AS excluded_admin",
    "            WHERE excluded_admin.email = LOWER(btrim(excluded_user_settings.email))",
    "              AND excluded_admin.revoked_at IS NULL",
    "          )",
    `          OR ${buildActorIsExcludedSql(`${eventAlias}.actor_id::text`)}`,
    "        )",
    "    )",
  ];

  return [
    ...buildBridgeSqlLines("events", "excluded_install", [
      "      WHERE excluded_install.event_name = 'catalog_deck_installed'",
      "        AND excluded_install.origin = 'server'",
    ]),
    ...buildBridgeSqlLines("install_start_events", "excluded_install_start", [
      "      WHERE excluded_install_start.trust_level = 'authenticated_client'",
    ]),
  ];
}

/**
 * The install actors, as an uncorrelated membership test rather than a correlation.
 *
 * `analytics.product_events_resolved.actor_id` is
 * `COALESCE(first_guest_upgrade_link.user_id, product_events.user_id, first_anonymous_link.user_id,
 * product_events.anonymous_id)` over two `LEFT JOIN`ed `DISTINCT ON` subqueries
 * (`db/migrations/0137_audience_context.sql`), so an equality on it can never become an index qual and
 * can never be pushed below those joins: one comparison against it is one full pass of that view. So
 * the engagement facts must never be computed per attempt row. This is the same `= ANY (ARRAY(...))`
 * that `buildSubqueryMembershipSql` in `apps/admin/src/filters/filterSql.ts` uses and for the same
 * reason - the subquery is uncorrelated, so the planner evaluates it once as an InitPlan instead of
 * re-running it per row of a CTE it has no statistics for, which is what takes a report past the 30s
 * `reporting_readonly` statement timeout and fails every statement of the page with it.
 */
function buildInstallActorMembershipSql(actorIdSqlExpression: string): string {
  return [
    `${actorIdSqlExpression} = ANY (ARRAY(`,
    "  SELECT install_actors.actor_id",
    "  FROM install_actors",
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
    "    events.event_properties ->> 'install_journey_id' AS install_journey_id,",
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
    // The journey id is optional on the collector while the click fact is still sent, so a
    // journey-less click is a real row that belongs to no attempt. Unguarded they collapse into one
    // NULL journey that no bridge and no filter can reject, and whose `journey_id` then fails to
    // parse and fails the whole section with it.
    "    AND events.event_properties ->> 'install_journey_id' IS NOT NULL",
    "    AND events.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "), cohort_clicks AS (",
    "  SELECT DISTINCT ON (click_candidates.install_journey_id)",
    "    click_candidates.*",
    "  FROM click_candidates",
    "  ORDER BY click_candidates.install_journey_id, click_candidates.anchor_at, click_candidates.event_id",
    "), eligible_clicks AS (",
    "  SELECT candidate.*",
    "  FROM cohort_clicks AS candidate",
    "  WHERE NOT EXISTS (",
    "    SELECT 1",
    "    FROM install_start_events AS test_start",
    "    WHERE test_start.event_name = 'catalog_deck_install_started'",
    "      AND test_start.event_properties ->> 'install_journey_id' = candidate.install_journey_id",
    "      AND test_start.event_properties ->> 'package_version_id' = candidate.package_version_id",
    "      AND test_start.event_properties ->> 'package_slug' = 'test'",
    "      AND test_start.occurred_at >= candidate.anchor_at",
    `      AND test_start.occurred_at <= candidate.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  )",
    ...buildExcludedJourneyActorFilterSqlLines(),
    ...buildFunnelClickFilterSqlLines(filters),
    "), attempt_rows AS MATERIALIZED (",
    "SELECT",
    "  click.install_journey_id AS journey_id,",
    "  click.package_version_id,",
    "  click.anchor_at AS clicked_at,",
    "  click.placement,",
    "  click.source,",
    "  click.device_category,",
    "  landed.occurred_at AS landed_at,",
    "  landed.auth_state AS landed_auth_state,",
    "  preview.occurred_at AS preview_ready_at,",
    "  install_started.occurred_at AS install_started_at,",
    "  installed.occurred_at AS installed_at,",
    // Carried out of the chain so the engagement relations below can key on it. It is the only place
    // a journey names a person, and it is NULL exactly when the attempt has no server install.
    "  installed.actor_id AS install_actor_id,",
    "  signed_out_landed.occurred_at AS signed_out_landed_at,",
    "  signin_started.occurred_at AS signin_started_at,",
    "  code_requested.occurred_at AS code_requested_at,",
    "  signin_succeeded.occurred_at AS signin_succeeded_at,",
    "  signed_out_preview.occurred_at AS signed_out_preview_ready_at,",
    "  COALESCE(failures.failure_buckets, '[]'::jsonb) AS failure_buckets",
    "FROM eligible_clicks AS click",
    "LEFT JOIN LATERAL (",
    "  SELECT",
    "    landed_event.occurred_at,",
    "    landed_event.event_properties ->> 'auth_state' AS auth_state",
    "  FROM client_events AS landed_event",
    "  WHERE landed_event.event_name = 'catalog_install_landed'",
    "    AND landed_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "    AND landed_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "    AND landed_event.occurred_at >= click.anchor_at",
    `    AND landed_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY landed_event.occurred_at, landed_event.event_id",
    "  LIMIT 1",
    ") AS landed ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT preview_event.occurred_at",
    "  FROM client_events AS preview_event",
    "  WHERE preview_event.event_name = 'catalog_install_preview_ready'",
    "    AND preview_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "    AND preview_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "    AND preview_event.occurred_at >= landed.occurred_at",
    `    AND preview_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY preview_event.occurred_at, preview_event.event_id",
    "  LIMIT 1",
    ") AS preview ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT start_event.occurred_at",
    "  FROM install_start_events AS start_event",
    "  WHERE start_event.event_name = 'catalog_deck_install_started'",
    "    AND start_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "    AND start_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "    AND start_event.occurred_at >= preview.occurred_at",
    `    AND start_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY start_event.occurred_at, start_event.event_id",
    "  LIMIT 1",
    ") AS install_started ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT",
    "    installed_event.occurred_at,",
    // The one place a journey names a person. Every later engagement column is measured on it.
    "    installed_event.actor_id",
    "  FROM events AS installed_event",
    "  WHERE installed_event.event_name = 'catalog_deck_installed'",
    "    AND installed_event.origin = 'server'",
    "    AND installed_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "    AND installed_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "    AND installed_event.occurred_at >= install_started.occurred_at",
    `    AND installed_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY installed_event.occurred_at, installed_event.event_id",
    "  LIMIT 1",
    ") AS installed ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT signed_out_event.occurred_at",
    "  FROM client_events AS signed_out_event",
    "  WHERE signed_out_event.event_name = 'catalog_install_landed'",
    "    AND signed_out_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "    AND signed_out_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "    AND signed_out_event.event_properties ->> 'auth_state' = 'signed_out'",
    "    AND signed_out_event.occurred_at >= click.anchor_at",
    `    AND signed_out_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY signed_out_event.occurred_at, signed_out_event.event_id",
    "  LIMIT 1",
    ") AS signed_out_landed ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT signin_event.occurred_at",
    "  FROM client_events AS signin_event",
    "  WHERE signin_event.event_name = 'catalog_install_signin_started'",
    "    AND signin_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "    AND signin_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "    AND signin_event.occurred_at >= signed_out_landed.occurred_at",
    `    AND signin_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY signin_event.occurred_at, signin_event.event_id",
    "  LIMIT 1",
    ") AS signin_started ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT code_event.occurred_at",
    "  FROM client_events AS code_event",
    "  WHERE code_event.event_name = 'catalog_install_signin_code_requested'",
    "    AND code_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "    AND code_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "    AND code_event.occurred_at >= signin_started.occurred_at",
    `    AND code_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY code_event.occurred_at, code_event.event_id",
    "  LIMIT 1",
    ") AS code_requested ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT success_event.occurred_at",
    "  FROM client_events AS success_event",
    "  WHERE success_event.event_name = 'catalog_install_signin_succeeded'",
    "    AND success_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "    AND success_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "    AND success_event.occurred_at >= signed_out_landed.occurred_at",
    `    AND success_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY success_event.occurred_at, success_event.event_id",
    "  LIMIT 1",
    ") AS signin_succeeded ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT preview_event.occurred_at",
    "  FROM client_events AS preview_event",
    "  WHERE preview_event.event_name = 'catalog_install_preview_ready'",
    "    AND preview_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "    AND preview_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "    AND preview_event.occurred_at >= signin_succeeded.occurred_at",
    `    AND preview_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY preview_event.occurred_at, preview_event.event_id",
    "  LIMIT 1",
    ") AS signed_out_preview ON TRUE",
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
    "      AND failure_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "      AND failure_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "      AND failure_event.occurred_at >= click.anchor_at",
    `      AND failure_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ) AS distinct_failures",
    ") AS failures ON TRUE",
    // Post-install engagement, in three uncorrelated passes keyed by the install actor rather than
    // per attempt row. Every attempt without a server install names nobody, so it is absent from all
    // three and its columns arrive null together rather than as a zero that would read as a drop-off.
    "), install_actors AS (",
    "  SELECT DISTINCT attempt.install_actor_id AS actor_id",
    "  FROM attempt_rows AS attempt",
    "  WHERE attempt.installed_at IS NOT NULL",
    "    AND attempt.install_actor_id IS NOT NULL",
    // THE REVIEWS ARE THE PERSON'S, NOT THE DECK'S. `review_answered` carries only `rating` and
    // `source`, so no deck or card identity exists to narrow them by, and this reads every review
    // those actors answered. It cannot reuse the `events` CTE: that one is restricted to the nine
    // catalog event names, and `review_answered` is not among them.
    //
    // The bounds are the widest any attempt can ask for, so one pass serves all of them: no review
    // counts before the install, and no install is earlier than the range's first instant, while the
    // per-attempt bound below reaches at most a click on the last selected day plus the window.
    "), install_actor_reviews AS MATERIALIZED (",
    "  SELECT",
    "    review_event.actor_id,",
    "    review_event.occurred_at",
    "  FROM analytics.product_events_resolved AS review_event",
    "  WHERE review_event.event_name = 'review_answered'",
    `    AND ${buildInstallActorMembershipSql("review_event.actor_id")}`,
    "    AND review_event.occurred_at >= (",
    `      (${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND review_event.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    // New is the absence of any trusted event before the click, over that actor's whole history, so
    // this carries NO LOWER BOUND AND NO EVENT-NAME RESTRICTION - reusing a bounded or catalog-only
    // relation here would silently make every actor look new. It reads that history as one grouped
    // `MIN(occurred_at)` per actor, the way `apps/backend/src/productAnalytics/syntheticActorDetector.ts`
    // and the `history` CTE of `apps/admin/src/reports/audience/query.ts` read an actor's first day.
    //
    // The upper bound is the only thing added, and it removes nothing the test can see: every click
    // in this cohort is before it, so an event at or after it can never precede one. An actor with no
    // row at all under it produced no trusted event before any click here and is therefore new.
    //
    // The trust rule is the second thing this reads the history through, and it is what the absent
    // event-name restriction makes load-bearing: this sees every name the credential-free collector
    // accepts, so without it a row nobody stands behind could be an actor's earliest event and make
    // a genuinely new installer read as returning. See `buildTrustedActorRowsFilterSql`.
    "), install_actor_first_event AS MATERIALIZED (",
    "  SELECT",
    "    prior_event.actor_id,",
    "    MIN(prior_event.occurred_at) AS first_event_at",
    "  FROM analytics.product_events_resolved AS prior_event",
    `  WHERE ${buildInstallActorMembershipSql("prior_event.actor_id")}`,
    `    AND ${buildTrustedActorRowsFilterSql("prior_event.trust_level")}`,
    "    AND prior_event.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "  GROUP BY prior_event.actor_id",
    // The count and the return day come from one grouped pass over the same review rows rather than
    // two scans of them. The window runs from the install - a review before it cannot be a
    // consequence of it - to the same seven-day bound on the click every other step here uses, so a
    // late install leaves less of it. The return day is a UTC calendar day strictly after the
    // install's, the same UTC day every other admin report reads, and it is reported only together
    // with the review threshold, never on its own, because two independent conditions would let a
    // later step exceed an earlier one.
    //
    // The join is on an attempt rather than on an actor, which is what keeps one person who installs
    // two decks in range counted as the two attempts they are: each row carries that actor's reviews
    // for its own window. `docs/catalog-install-funnel.md` already calls the journey an attempt key
    // and not a unique-person measure, and the card says so on screen.
    "), attempt_engagement AS (",
    "  SELECT",
    "    attempt.journey_id,",
    "    COUNT(review.occurred_at)::int AS review_count,",
    "    COALESCE(",
    "      bool_or(",
    "        (review.occurred_at AT TIME ZONE 'UTC')::date",
    "          > (attempt.installed_at AT TIME ZONE 'UTC')::date",
    "      ),",
    "      FALSE",
    "    ) AS has_return_day",
    "  FROM attempt_rows AS attempt",
    "  LEFT JOIN install_actor_reviews AS review",
    "    ON review.actor_id = attempt.install_actor_id",
    "    AND review.occurred_at >= attempt.installed_at",
    `    AND review.occurred_at <= attempt.clicked_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  WHERE attempt.installed_at IS NOT NULL",
    "  GROUP BY attempt.journey_id",
    ")",
    "SELECT",
    "  attempt.journey_id,",
    "  attempt.package_version_id,",
    "  attempt.clicked_at,",
    "  attempt.placement,",
    "  attempt.source,",
    "  attempt.device_category,",
    "  attempt.landed_at,",
    "  attempt.landed_auth_state,",
    "  attempt.preview_ready_at,",
    "  attempt.install_started_at,",
    "  attempt.installed_at,",
    "  engagement.review_count AS install_review_count,",
    "  engagement.has_return_day AS install_has_return_day,",
    "  CASE",
    "    WHEN attempt.installed_at IS NULL THEN NULL",
    "    ELSE (",
    "      first_event.first_event_at IS NULL",
    "      OR first_event.first_event_at >= attempt.clicked_at",
    "    )",
    "  END AS install_actor_is_new,",
    "  attempt.signed_out_landed_at,",
    "  attempt.signin_started_at,",
    "  attempt.code_requested_at,",
    "  attempt.signin_succeeded_at,",
    "  attempt.signed_out_preview_ready_at,",
    "  attempt.failure_buckets",
    "FROM attempt_rows AS attempt",
    "LEFT JOIN attempt_engagement AS engagement",
    "  ON engagement.journey_id = attempt.journey_id",
    "LEFT JOIN install_actor_first_event AS first_event",
    "  ON first_event.actor_id = attempt.install_actor_id",
    "ORDER BY attempt.clicked_at, attempt.journey_id",
  ].join("\n");

  const missingClickQuery = [
    "WITH",
    ...buildEventWindowSql(from, to),
    ", landing_candidates AS (",
    "  SELECT DISTINCT ON (",
    "    landing.event_properties ->> 'install_journey_id',",
    "    landing.event_properties ->> 'package_version_id'",
    "  )",
    "    landing.event_properties ->> 'install_journey_id' AS install_journey_id,",
    "    landing.event_properties ->> 'package_version_id' AS package_version_id,",
    "    landing.occurred_at AS anchor_at,",
    "    landing.platform",
    "  FROM client_events AS landing",
    "  WHERE landing.event_name = 'catalog_install_landed'",
    // The same guard the click cohort carries: a journey-less landing belongs to no attempt either.
    "    AND landing.event_properties ->> 'install_journey_id' IS NOT NULL",
    "    AND landing.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "  ORDER BY",
    "    landing.event_properties ->> 'install_journey_id',",
    "    landing.event_properties ->> 'package_version_id',",
    "    landing.occurred_at,",
    "    landing.event_id",
    "), eligible_landings AS (",
    "  SELECT candidate.*",
    "  FROM landing_candidates AS candidate",
    "  WHERE NOT EXISTS (",
    "    SELECT 1",
    "    FROM client_events AS selected_click",
    "    WHERE selected_click.event_name = 'catalog_install_clicked'",
    "      AND selected_click.event_properties ->> 'install_journey_id' = candidate.install_journey_id",
    "      AND selected_click.event_properties ->> 'package_version_id' = candidate.package_version_id",
    "      AND selected_click.occurred_at <= candidate.anchor_at",
    "  )",
    "    AND NOT EXISTS (",
    "      SELECT 1",
    "      FROM install_start_events AS test_start",
    "      WHERE test_start.event_name = 'catalog_deck_install_started'",
    "        AND test_start.event_properties ->> 'install_journey_id' = candidate.install_journey_id",
    "        AND test_start.event_properties ->> 'package_version_id' = candidate.package_version_id",
    "        AND test_start.event_properties ->> 'package_slug' = 'test'",
    "        AND test_start.occurred_at >= candidate.anchor_at",
    `        AND test_start.occurred_at <= candidate.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "    )",
    ...buildExcludedJourneyActorFilterSqlLines(),
    ...buildFunnelLandingFilterSqlLines(filters),
    ")",
    "SELECT",
    "  eligible_landings.package_version_id,",
    "  COUNT(DISTINCT eligible_landings.install_journey_id)::int AS attempt_count",
    "FROM eligible_landings",
    "GROUP BY eligible_landings.package_version_id",
    "ORDER BY attempt_count DESC, eligible_landings.package_version_id",
  ].join("\n");

  // Server installs the funnel can never place. A journey is bridged to its install by
  // `install_journey_id`, so an install without one is invisible to every stage above, and its
  // absence is legitimate: `docs/catalog-install-funnel.md` keeps a confirm that omits
  // `installJourneyId` valid. This counts them so part of the gap is a number rather than a
  // suspicion.
  //
  // IT IS A LOWER BOUND ON THAT GAP, NOT THE WHOLE OF IT, and the card and the doc say so. An
  // install that does carry a journey id is just as unheld by any attempt row when that journey's
  // `catalog_install_clicked` fell outside the selected cohort dates - which this line does not
  // share, since it takes installs by their own UTC day - when the click was dropped by a placement,
  // source, device-category or browser-language selection, or when the landed/preview/started/
  // installed chain is broken. Nothing here can count those, because they are absences.
  //
  // It narrows itself the way the no-click diagnostic does, on what the row can answer alone: the
  // selected UTC days, the installed deck, the client platform and the actor exclusions, read off
  // the install row directly because it names its actor without any bridge. Nothing else reaches it
  // - a row with no journey holds no placement, source, device category or browser language - and
  // the platform on a server fact is always NULL, so picking any device platform empties this line.
  const installWithoutJourneyQuery = [
    "SELECT COUNT(*)::int AS install_count",
    "FROM analytics.product_events_resolved AS orphan_install",
    "LEFT JOIN org.user_settings AS orphan_user_settings",
    "  ON pg_catalog.lower(orphan_user_settings.user_id) = orphan_install.actor_id::text",
    "WHERE orphan_install.event_name = 'catalog_deck_installed'",
    "  AND orphan_install.origin = 'server'",
    "  AND orphan_install.event_properties ->> 'install_journey_id' IS NULL",
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
    ...buildAttemptDimensionFilterSqlLines(
      "orphan_install.event_properties ->> 'package_version_id'",
      filters.installedDecks,
    ),
  ].join("\n");

  return [cohortQuery, missingClickQuery, installWithoutJourneyQuery].join(";\n");
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

  const attemptsResultSet = response.resultSets[0];
  const missingClicksResultSet = response.resultSets[1];
  const installsWithoutJourneyResultSet = response.resultSets[2];
  if (
    attemptsResultSet === undefined
    || missingClicksResultSet === undefined
    || installsWithoutJourneyResultSet === undefined
  ) {
    throw new Error(`${catalogInstallFunnelReportLabel} result sets are missing.`);
  }

  return {
    generatedAtUtc: response.executedAtUtc,
    from: filters.dateRange.from,
    to: filters.dateRange.to,
    attempts: attemptsResultSet.rows.map(parseAttemptRow),
    missingClickCounts: parseMissingClickCounts(missingClicksResultSet),
    installsWithoutJourneyCount: parseInstallsWithoutJourneyCount(installsWithoutJourneyResultSet),
  };
}
