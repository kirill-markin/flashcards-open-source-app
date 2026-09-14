import { runAdminQuery } from "../../adminApi";
import type {
  AdminQueryObject,
  AdminQueryResultSet,
  AdminQueryValue,
} from "../../adminApi";
import type { AdminAppConfig } from "../../config";
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
  packageSlug: string | null;
  clickedAt: string;
  placement: CatalogInstallPlacement;
  source: CatalogInstallSource;
  deviceCategory: CatalogInstallDeviceCategory;
  deviceLocale: string;
  landedAt: string | null;
  landedAuthState: "signed_in" | "signed_out" | null;
  previewReadyAt: string | null;
  installStartedAt: string | null;
  installedAt: string | null;
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
}>;

export type CatalogInstallFunnelRange = Readonly<{
  from: string;
  to: string;
}>;

export type CatalogInstallFunnelFilters = Readonly<{
  packageVersionId: string;
  placement: string;
  source: string;
  deviceCategory: string;
  deviceLocale: string;
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

function assertNullableString(value: AdminQueryValue, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return assertIsString(value, catalogInstallFunnelReportLabel, fieldName);
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
    packageSlug: assertNullableString(row.package_slug ?? null, "package_slug"),
    clickedAt: assertTimestamp(row.clicked_at ?? null, "clicked_at"),
    placement: assertEnumValue(row.placement ?? null, catalogInstallPlacements, "placement"),
    source: assertEnumValue(row.source ?? null, catalogInstallSources, "source"),
    deviceCategory: assertEnumValue(
      row.device_category ?? null,
      catalogInstallDeviceCategories,
      "device_category",
    ),
    deviceLocale: assertIsString(
      row.device_locale ?? null,
      catalogInstallFunnelReportLabel,
      "device_locale",
    ),
    landedAt: assertNullableTimestamp(row.landed_at ?? null, "landed_at"),
    landedAuthState,
    previewReadyAt: assertNullableTimestamp(row.preview_ready_at ?? null, "preview_ready_at"),
    installStartedAt: assertNullableTimestamp(row.install_started_at ?? null, "install_started_at"),
    installedAt: assertNullableTimestamp(row.installed_at ?? null, "installed_at"),
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

export function validateCatalogInstallFunnelRange(
  range: CatalogInstallFunnelRange,
  availableRange: CatalogInstallFunnelRange,
): string | null {
  try {
    assertValidDateRange(range, catalogInstallFunnelReportLabel);
  } catch (error) {
    return error instanceof Error ? error.message : "Catalog installation funnel date range is invalid.";
  }

  if (range.from < availableRange.from || range.to > availableRange.to) {
    return `Use a range from ${availableRange.from} to ${availableRange.to}.`;
  }

  return null;
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
    ")",
  ];
}

function buildExcludedActorPredicateSql(eventAlias: string): ReadonlyArray<string> {
  return [
    "      SELECT 1",
    `      FROM events AS ${eventAlias}`,
    "      LEFT JOIN org.user_settings AS excluded_user_settings",
    `        ON pg_catalog.lower(excluded_user_settings.user_id) = ${eventAlias}.actor_id::text`,
    `      WHERE ${eventAlias}.event_name = 'catalog_deck_installed'`,
    `        AND ${eventAlias}.origin = 'server'`,
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
    "        )",
  ];
}

export function buildCatalogInstallFunnelSql(from: string, to: string): string {
  assertValidDateRange({ from, to }, catalogInstallFunnelReportLabel);

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
    "    COALESCE(NULLIF(events.device_locale, ''), 'unknown') AS device_locale",
    "  FROM client_events AS events",
    "  WHERE events.event_name = 'catalog_install_clicked'",
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
    "    FROM client_events AS test_start",
    "    WHERE test_start.event_name = 'catalog_deck_install_started'",
    "      AND test_start.event_properties ->> 'install_journey_id' = candidate.install_journey_id",
    "      AND test_start.event_properties ->> 'package_version_id' = candidate.package_version_id",
    "      AND test_start.event_properties ->> 'package_slug' = 'test'",
    "      AND test_start.occurred_at >= candidate.anchor_at",
    `      AND test_start.occurred_at <= candidate.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  )",
    "    AND NOT EXISTS (",
    ...buildExcludedActorPredicateSql("excluded_install"),
    "    )",
    ")",
    "SELECT",
    "  click.install_journey_id AS journey_id,",
    "  click.package_version_id,",
    "  known_package.package_slug,",
    "  click.anchor_at AS clicked_at,",
    "  click.placement,",
    "  click.source,",
    "  click.device_category,",
    "  click.device_locale,",
    "  landed.occurred_at AS landed_at,",
    "  landed.auth_state AS landed_auth_state,",
    "  preview.occurred_at AS preview_ready_at,",
    "  install_started.occurred_at AS install_started_at,",
    "  installed.occurred_at AS installed_at,",
    "  signed_out_landed.occurred_at AS signed_out_landed_at,",
    "  signin_started.occurred_at AS signin_started_at,",
    "  code_requested.occurred_at AS code_requested_at,",
    "  signin_succeeded.occurred_at AS signin_succeeded_at,",
    "  signed_out_preview.occurred_at AS signed_out_preview_ready_at,",
    "  COALESCE(failures.failure_buckets, '[]'::jsonb) AS failure_buckets",
    "FROM eligible_clicks AS click",
    "LEFT JOIN LATERAL (",
    "  SELECT start_event.event_properties ->> 'package_slug' AS package_slug",
    "  FROM client_events AS start_event",
    "  WHERE start_event.event_name = 'catalog_deck_install_started'",
    "    AND start_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "    AND start_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "    AND start_event.occurred_at >= click.anchor_at",
    `    AND start_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY start_event.occurred_at, start_event.event_id",
    "  LIMIT 1",
    ") AS known_package ON TRUE",
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
    "  FROM client_events AS start_event",
    "  WHERE start_event.event_name = 'catalog_deck_install_started'",
    "    AND start_event.event_properties ->> 'install_journey_id' = click.install_journey_id",
    "    AND start_event.event_properties ->> 'package_version_id' = click.package_version_id",
    "    AND start_event.occurred_at >= preview.occurred_at",
    `    AND start_event.occurred_at <= click.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "  ORDER BY start_event.occurred_at, start_event.event_id",
    "  LIMIT 1",
    ") AS install_started ON TRUE",
    "LEFT JOIN LATERAL (",
    "  SELECT installed_event.occurred_at",
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
    "ORDER BY click.anchor_at, click.install_journey_id",
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
    "    landing.occurred_at AS anchor_at",
    "  FROM client_events AS landing",
    "  WHERE landing.event_name = 'catalog_install_landed'",
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
    "      FROM client_events AS test_start",
    "      WHERE test_start.event_name = 'catalog_deck_install_started'",
    "        AND test_start.event_properties ->> 'install_journey_id' = candidate.install_journey_id",
    "        AND test_start.event_properties ->> 'package_version_id' = candidate.package_version_id",
    "        AND test_start.event_properties ->> 'package_slug' = 'test'",
    "        AND test_start.occurred_at >= candidate.anchor_at",
    `        AND test_start.occurred_at <= candidate.anchor_at + INTERVAL '${catalogInstallConversionWindowDays} days'`,
    "    )",
    "    AND NOT EXISTS (",
    ...buildExcludedActorPredicateSql("excluded_install"),
    "    )",
    ")",
    "SELECT",
    "  eligible_landings.package_version_id,",
    "  COUNT(DISTINCT eligible_landings.install_journey_id)::int AS attempt_count",
    "FROM eligible_landings",
    "GROUP BY eligible_landings.package_version_id",
    "ORDER BY attempt_count DESC, eligible_landings.package_version_id",
  ].join("\n");

  return [cohortQuery, missingClickQuery].join(";\n");
}

export function filterCatalogInstallFunnelAttempts(
  attempts: ReadonlyArray<CatalogInstallFunnelAttempt>,
  filters: CatalogInstallFunnelFilters,
): ReadonlyArray<CatalogInstallFunnelAttempt> {
  return attempts.filter((attempt) => (
    (filters.packageVersionId === "" || attempt.packageVersionId === filters.packageVersionId)
    && (filters.placement === "" || attempt.placement === filters.placement)
    && (filters.source === "" || attempt.source === filters.source)
    && (filters.deviceCategory === "" || attempt.deviceCategory === filters.deviceCategory)
    && (filters.deviceLocale === "" || attempt.deviceLocale === filters.deviceLocale)
  ));
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
  from: string,
  to: string,
): Promise<CatalogInstallFunnelReport> {
  const response = await runAdminQuery(config, buildCatalogInstallFunnelSql(from, to));
  if (response.resultSets.length !== 2) {
    throw new Error(
      `${catalogInstallFunnelReportLabel} must return exactly two result sets. Got ${response.resultSets.length}.`,
    );
  }

  const attemptsResultSet = response.resultSets[0];
  const missingClicksResultSet = response.resultSets[1];
  if (attemptsResultSet === undefined || missingClicksResultSet === undefined) {
    throw new Error(`${catalogInstallFunnelReportLabel} result sets are missing.`);
  }

  return {
    generatedAtUtc: response.executedAtUtc,
    from,
    to,
    attempts: attemptsResultSet.rows.map(parseAttemptRow),
    missingClickCounts: parseMissingClickCounts(missingClicksResultSet),
  };
}
