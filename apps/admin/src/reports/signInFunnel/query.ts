import { runAdminQuery } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
  buildExcludedActorSqlLines,
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

const reportLabel = "Sign-in funnel";
// First whole UTC day after all three clients' method-aware producer implementations were added.
// This is a reporting boundary, not a claim that every installed native version emits these facts.
export const signInFunnelStartDate = "2026-10-16";

export type SignInFunnelCounts = Readonly<{
  selectedCount: number;
  sessionAcceptedCount: number;
  accountReadyCount: number;
  maturingCount: number;
}>;

export type SignInFunnelGroup = SignInFunnelCounts & Readonly<{ key: string }>;

export type SignInMethodDetail = SignInFunnelGroup & Readonly<{
  entryDetailCount: number;
  responseDetailCount: number;
}>;

export type SignInFunnelReport = Readonly<{
  generatedAtUtc: string;
  groups: ReadonlyArray<SignInFunnelGroup>;
  methods: ReadonlyArray<SignInMethodDetail>;
}>;

export const signInFunnelGroupByDimensions: ReadonlyArray<FunnelGroupByDimension> = [
  {
    id: platformFunnelGroupByDimensionId,
    label: "First selection platform",
    buildGroupKeySql: () => "cohort.platform",
  },
  {
    id: "first-method",
    label: "First selected method",
    buildGroupKeySql: () => "cohort.method",
  },
];

/**
 * One entry per resolved person at their first method selection in range. Each method/platform path
 * independently requires selection -> accepted session -> ready account within that entry's week;
 * overall progress is the union of those paths. Retries can contribute observations to a path, but
 * different methods/platforms cannot supply each other's accepted/ready steps. No attempt is inferred.
 *
 * Auth-origin browser facts are anonymous_client by design and share the consented visitor id with
 * the app. Read them explicitly, including visitors who never registered; resolved.actor_id folds
 * the existing anonymous/guest links when present. All scans of the resolved view precede the cohort
 * joins so the unindexed computed actor_id never induces a per-person scan of the event store.
 */
export function buildSignInFunnelSql(
  filters: AnalyticsFilterState,
  groupByDimension: FunnelGroupByDimension | null,
): string {
  const { from: selectedFrom, to } = assertValidDateRange(filters.dateRange, reportLabel);
  const from = laterCalendarDate(selectedFrom, signInFunnelStartDate);
  const rangeStartSql = `(${escapeSqlStringLiteral(from)}::date)::timestamp AT TIME ZONE 'UTC'`;
  const rangeEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;
  const windowEndSql = `(${escapeSqlStringLiteral(to)}::date + INTERVAL '${catalogInstallConversionWindowDays + 1} days')::timestamp AT TIME ZONE 'UTC'`;
  const windowSql = `INTERVAL '${catalogInstallConversionWindowDays} days'`;
  const groupKeySql = groupByDimension === null
    ? "'all'::text"
    : `COALESCE(${groupByDimension.buildGroupKeySql(filters)}, ${escapeSqlStringLiteral(unresolvedFunnelGroupKey)})::text`;

  return [
    "WITH funnel_rows AS MATERIALIZED (",
    "  SELECT event.event_id, event.actor_id, event.event_name, event.occurred_at, event.platform,",
    "    event.event_properties ->> 'method' AS method,",
    "    event.event_properties ->> 'outcome' AS outcome",
    "  FROM analytics.product_events_resolved AS event",
    "  WHERE event.event_name IN (",
    "    'auth_method_selected', 'auth_session_accepted', 'auth_account_ready',",
    "    'auth_code_form_shown', 'auth_code_submitted', 'auth_provider_requested', 'auth_provider_finished'",
    "  )",
    "    AND event.screen = 'signin'",
    "    AND event.platform IN ('web', 'ios', 'android')",
    "    AND event.event_properties ->> 'method' IN ('email', 'google', 'apple')",
    "    AND event.actor_id IS NOT NULL",
    `    AND event.occurred_at >= ${rangeStartSql}`,
    `    AND event.occurred_at < ${windowEndSql}`,
    "), first_selections AS MATERIALIZED (",
    "  SELECT DISTINCT ON (selected.actor_id)",
    "    selected.actor_id, selected.occurred_at AS selected_at, selected.platform, selected.method",
    "  FROM funnel_rows AS selected",
    "  WHERE selected.event_name = 'auth_method_selected'",
    `    AND selected.occurred_at < ${rangeEndSql}`,
    "  ORDER BY selected.actor_id, selected.occurred_at, selected.event_id",
    "), cohort AS MATERIALIZED (",
    "  SELECT candidate.*",
    "  FROM first_selections AS candidate",
    `  WHERE ${buildEventPlatformsFilterSql("candidate.platform", filters.eventPlatforms)}`,
    ...buildExcludedActorSqlLines("candidate.actor_id::text"),
    ...buildFunnelAudienceActorSqlLines(filters, "candidate.actor_id::text"),
    `    AND ${buildConnectionCountriesFilterSql("candidate.actor_id::text", filters.connectionCountries, filters.dateRange)}`,
    `    AND ${buildAppUiLanguagesFilterSql("candidate.actor_id::text", filters.appUiLanguages, filters.dateRange)}`,
    "), window_rows AS MATERIALIZED (",
    "  SELECT event.*",
    "  FROM funnel_rows AS event",
    "  INNER JOIN cohort ON cohort.actor_id = event.actor_id",
    "    AND event.occurred_at >= cohort.selected_at",
    `    AND event.occurred_at <= cohort.selected_at + ${windowSql}`,
    "), method_selections AS MATERIALIZED (",
    "  SELECT actor_id, method, platform, MIN(occurred_at) AS selected_at",
    "  FROM window_rows",
    "  WHERE event_name = 'auth_method_selected'",
    "  GROUP BY actor_id, method, platform",
    "), accepted_sessions AS MATERIALIZED (",
    "  SELECT selected.actor_id, selected.method, selected.platform, MIN(event.occurred_at) AS accepted_at",
    "  FROM method_selections AS selected",
    "  INNER JOIN window_rows AS event",
    "    ON event.actor_id = selected.actor_id AND event.method = selected.method",
    "    AND event.platform = selected.platform AND event.occurred_at >= selected.selected_at",
    "  WHERE event.event_name = 'auth_session_accepted'",
    "  GROUP BY selected.actor_id, selected.method, selected.platform",
    "), ready_accounts AS MATERIALIZED (",
    "  SELECT accepted.actor_id, accepted.method, accepted.platform, MIN(event.occurred_at) AS ready_at",
    "  FROM accepted_sessions AS accepted",
    "  INNER JOIN window_rows AS event",
    "    ON event.actor_id = accepted.actor_id AND event.method = accepted.method",
    "    AND event.platform = accepted.platform AND event.occurred_at >= accepted.accepted_at",
    "  WHERE event.event_name = 'auth_account_ready'",
    "  GROUP BY accepted.actor_id, accepted.method, accepted.platform",
    "), path_details AS MATERIALIZED (",
    "  SELECT selected.actor_id, selected.method, selected.platform,",
    "    BOOL_OR((selected.method = 'email' AND event.event_name = 'auth_code_form_shown')",
    "      OR (selected.method IN ('google', 'apple') AND event.event_name = 'auth_provider_requested')) AS entry_observed,",
    "    BOOL_OR((selected.method = 'email' AND event.event_name = 'auth_code_submitted')",
    "      OR (selected.method IN ('google', 'apple') AND event.event_name = 'auth_provider_finished'",
    "        AND event.outcome = 'credential_received')) AS response_observed",
    "  FROM method_selections AS selected",
    "  INNER JOIN window_rows AS event",
    "    ON event.actor_id = selected.actor_id AND event.method = selected.method",
    "    AND event.platform = selected.platform AND event.occurred_at >= selected.selected_at",
    "  GROUP BY selected.actor_id, selected.method, selected.platform",
    "), method_paths AS MATERIALIZED (",
    "  SELECT selected.actor_id, selected.method, selected.platform,",
    "    accepted.accepted_at, ready.ready_at, detail.entry_observed, detail.response_observed",
    "  FROM method_selections AS selected",
    "  LEFT JOIN accepted_sessions AS accepted USING (actor_id, method, platform)",
    "  LEFT JOIN ready_accounts AS ready USING (actor_id, method, platform)",
    "  INNER JOIN path_details AS detail USING (actor_id, method, platform)",
    "), person_progress AS MATERIALIZED (",
    "  SELECT actor_id, BOOL_OR(accepted_at IS NOT NULL) AS accepted, BOOL_OR(ready_at IS NOT NULL) AS ready",
    "  FROM method_paths",
    "  GROUP BY actor_id",
    ")",
    "SELECT 'cohort'::text AS row_kind,",
    `  ${groupKeySql} AS group_key,`,
    "  COUNT(*)::int AS selected_count,",
    "  (COUNT(*) FILTER (WHERE progress.accepted))::int AS session_accepted_count,",
    "  (COUNT(*) FILTER (WHERE progress.ready))::int AS account_ready_count,",
    `  (COUNT(*) FILTER (WHERE cohort.selected_at + ${windowSql} > now()))::int AS maturing_count,`,
    "  0::int AS entry_detail_count, 0::int AS response_detail_count",
    "FROM cohort",
    "INNER JOIN person_progress AS progress USING (actor_id)",
    "GROUP BY group_key",
    "UNION ALL",
    "SELECT 'method'::text AS row_kind, path.method AS group_key,",
    "  COUNT(DISTINCT path.actor_id)::int AS selected_count,",
    "  (COUNT(DISTINCT path.actor_id) FILTER (WHERE path.accepted_at IS NOT NULL))::int AS session_accepted_count,",
    "  (COUNT(DISTINCT path.actor_id) FILTER (WHERE path.ready_at IS NOT NULL))::int AS account_ready_count,",
    `  (COUNT(DISTINCT path.actor_id) FILTER (WHERE cohort.selected_at + ${windowSql} > now()))::int AS maturing_count,`,
    "  (COUNT(DISTINCT path.actor_id) FILTER (WHERE path.entry_observed))::int AS entry_detail_count,",
    "  (COUNT(DISTINCT path.actor_id) FILTER (WHERE path.response_observed))::int AS response_detail_count",
    "FROM method_paths AS path",
    "INNER JOIN cohort USING (actor_id)",
    "GROUP BY path.method",
  ].join("\n");
}

export async function loadSignInFunnelReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  groupByDimension: FunnelGroupByDimension | null,
): Promise<SignInFunnelReport> {
  const response = await runAdminQuery(config, buildSignInFunnelSql(filters, groupByDimension));
  if (response.resultSets.length !== 1) {
    throw new Error(`${reportLabel} must return exactly one result set. Got ${response.resultSets.length}.`);
  }
  const groups: Array<SignInFunnelGroup> = [];
  const methods: Array<SignInMethodDetail> = [];
  for (const row of response.resultSets[0]?.rows ?? []) {
    const count = (fieldName: string): number => toInteger(row[fieldName] ?? null, reportLabel, fieldName);
    const group: SignInFunnelGroup = {
      key: assertIsString(row.group_key ?? null, reportLabel, "group_key"),
      selectedCount: count("selected_count"),
      sessionAcceptedCount: count("session_accepted_count"),
      accountReadyCount: count("account_ready_count"),
      maturingCount: count("maturing_count"),
    };
    const kind = assertIsString(row.row_kind ?? null, reportLabel, "row_kind");
    if (kind === "cohort") {
      groups.push(group);
    } else if (kind === "method" && ["email", "google", "apple"].includes(group.key)) {
      methods.push({ ...group, entryDetailCount: count("entry_detail_count"), responseDetailCount: count("response_detail_count") });
    } else {
      throw new Error(`${reportLabel} returned an unsupported row: ${kind}/${group.key}.`);
    }
  }
  return { generatedAtUtc: response.executedAtUtc, groups, methods };
}
