import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { escapeSqlStringLiteral } from "../../sql";
import { buildDataTableSqlClauses, type DataTableSqlClauses } from "../../table/dataTableSql";
import type { DataTableColumn, DataTableState } from "../../table/dataTableModel";
import {
  buildDistinctOptionsSql,
  buildNamedColumnsSql,
  emptyEnumOptions,
  parseEnumOptionsResponse,
  parsePageTotal,
} from "../../table/dataTableServerQuery";
import { utcInstantSql } from "../usersQuery";
import { readRowNullableString, readRowString } from "./queryRowValues";
import { buildMatchesUserIdSql, buildUserSubjectSql, type UserSubjectSql } from "./userSubjectSql";

const reportLabel = "User activity";

export const activitySources = ["analytics", "purchase", "grant", "feedback"] as const;

export type ActivitySource = (typeof activitySources)[number];

export const activityRecordedAs = ["guest", "account", "visitor"] as const;

export type ActivityRecordedAs = (typeof activityRecordedAs)[number];

export type ActivityRow = Readonly<{
  /** `<source>:<row id>`, unique across sources and the tiebreak of every order. */
  key: string;
  /** ISO-8601 UTC instant. */
  occurredAt: string;
  source: ActivitySource;
  /** The analytics event's `event_id`, read off the key; null for every other source. */
  eventId: string | null;
  name: string;
  platform: string | null;
  appVersion: string | null;
  screen: string | null;
  country: string | null;
  uiLocale: string | null;
  sessionId: string | null;
  origin: string | null;
  /** JSON text of the event properties, or of the source row's own fields. */
  details: string;
  recordedAs: ActivityRecordedAs;
}>;

type ActivityField = Exclude<keyof ActivityRow, "eventId">;

const analyticsKeyPrefix = "analytics:";

/**
 * Every fact credited to the person, one row each, labelled by source. The analytics events come from
 * `analytics.product_events_resolved` on `actor_id`, so a merged guest's history is already folded in,
 * and every trust level is kept and shown. Reviews, cards and AI chat runs are not merged in: each is
 * already an analytics event (`review_answered`, `card_created`, `ai_message_sent`).
 *
 * `recorded_as` is the credential an analytics event was recorded under: `visitor` without a user id;
 * `guest` on a guest credential (`guest_client` trust or a guest session), or under a merged guest's
 * id that resolves onto another actor; `account` on an authenticated client credential. Most server
 * and backfill rows carry no credential of their own, as the backend's review and content-write
 * producers say, so they take the recorded id's history instead: an id that never had a guest
 * session was always an account, and one that did was a guest until its first sign-in identity, the
 * boundary no guest-credential row has ever crossed. Purchases, grants and feedback are `account`.
 */
function buildActivityUnionSql(subject: UserSubjectSql): string {
  const matches = (textColumnSql: string): string => buildMatchesUserIdSql(textColumnSql, subject);
  return `SELECT events.occurred_at, ${escapeSqlStringLiteral(analyticsKeyPrefix)} || events.event_id::text AS row_key, 'analytics' AS source,
    events.event_name AS name, events.platform, events.app_version, events.screen, events.country,
    events.ui_locale, events.session_id::text AS session_id,
    events.origin || ' / ' || events.trust_level AS origin, events.event_properties AS details,
    CASE
      WHEN events.user_id IS NULL THEN 'visitor'
      WHEN events.trust_level = 'guest_client' OR events.guest_session_id IS NOT NULL OR events.user_id <> events.actor_id THEN 'guest'
      WHEN events.trust_level = 'authenticated_client' OR recorded_guests.user_id IS NULL THEN 'account'
      WHEN recorded_accounts.account_since IS NULL OR events.occurred_at < recorded_accounts.account_since THEN 'guest'
      ELSE 'account'
    END AS recorded_as
  FROM analytics.product_events_resolved AS events
  LEFT JOIN (
    SELECT DISTINCT pg_catalog.lower(guest_sessions.user_id) AS user_id
    FROM auth.guest_sessions AS guest_sessions
  ) AS recorded_guests ON recorded_guests.user_id = events.user_id::text
  LEFT JOIN (
    SELECT pg_catalog.lower(identities.user_id) AS user_id, min(identities.created_at) AS account_since
    FROM auth.user_identities AS identities
    GROUP BY pg_catalog.lower(identities.user_id)
  ) AS recorded_accounts ON recorded_accounts.user_id = events.user_id::text
  WHERE events.actor_id = ${subject.uuidSql}
  UNION ALL
  SELECT purchases.created_at, 'purchase:' || purchases.purchase_id::text, 'purchase',
    purchases.kind || ' ' || purchases.status
      || CASE WHEN ${matches("purchases.user_id")} THEN '' ELSE ' (as previous owner)' END,
    NULL, NULL, NULL, NULL, NULL, NULL, purchases.environment,
    jsonb_build_object(
      'purchase_id', purchases.purchase_id, 'provider', purchases.provider,
      'provider_purchase_id', purchases.provider_purchase_id, 'user_id', purchases.user_id,
      'previous_user_id', purchases.previous_user_id, 'tier', purchases.tier,
      'is_trial', purchases.is_trial, 'will_renew', purchases.will_renew, 'until', purchases.until,
      'grace_until', purchases.grace_until, 'provider_status_raw', purchases.provider_status_raw,
      'linked_from_purchase_id', purchases.linked_from_purchase_id,
      'invalidated_at', purchases.invalidated_at, 'account_deleted_at', purchases.account_deleted_at,
      'updated_at', purchases.updated_at
    ),
    'account'
  FROM billing.purchases AS purchases
  WHERE ${matches("purchases.user_id")} OR ${matches("purchases.previous_user_id")}
  UNION ALL
  SELECT grants.granted_at, 'grant:' || grants.grant_id::text, 'grant',
    grants.source || ' ' || grants.tier,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    jsonb_build_object(
      'grant_id', grants.grant_id, 'expires_at', grants.expires_at,
      'revoked_at', grants.revoked_at, 'reason', grants.reason
    ),
    'account'
  FROM billing.grants AS grants
  WHERE ${matches("grants.user_id")}
  UNION ALL
  SELECT feedback.created_at_server, 'feedback:' || feedback.feedback_submission_id::text, 'feedback',
    feedback.trigger,
    feedback.platform, feedback.app_version, NULL, feedback.country, feedback.locale, NULL, NULL,
    jsonb_build_object(
      'feedback_submission_id', feedback.feedback_submission_id, 'message', feedback.message,
      'email', feedback.email, 'workspace_id', feedback.workspace_id,
      'installation_id', feedback.installation_id, 'timezone', feedback.timezone,
      'created_at_client', feedback.created_at_client,
      'email_notification_status', feedback.email_notification_status,
      'email_notification_error', feedback.email_notification_error
    ),
    'account'
  FROM support.feedback_submissions AS feedback
  WHERE ${matches("feedback.user_id")}`;
}

/**
 * The SQL every column's filter and sort read, keyed by the column ids `ActivityTab` declares. Each one
 * reads only `activity`, a row of `buildActivityUnionSql`.
 */
const activityColumnSqlById: Readonly<Record<string, string>> = {
  occurred: "activity.occurred_at",
  source: "activity.source",
  "recorded-as": "activity.recorded_as",
  name: "activity.name",
  platform: "activity.platform",
  "app-version": "activity.app_version",
  screen: "activity.screen",
  country: "activity.country",
  "ui-locale": "activity.ui_locale",
  session: "activity.session_id",
  origin: "activity.origin",
  details: "activity.details::text",
};

/** Each `ActivityRow` field but the derived `eventId`, selected under its own name by `buildActivityPageSql`. */
const activityFieldSql: Readonly<Record<ActivityField, string>> = {
  key: "activity.row_key",
  occurredAt: utcInstantSql("activity.occurred_at"),
  source: "activity.source",
  name: "activity.name",
  platform: "activity.platform",
  appVersion: "activity.app_version",
  screen: "activity.screen",
  country: "activity.country",
  uiLocale: "activity.ui_locale",
  sessionId: "activity.session_id",
  origin: "activity.origin",
  details: "activity.details::text",
  recordedAs: "activity.recorded_as",
};

const defaultOrderBySql = "activity.occurred_at DESC";

const tiebreakOrderBySql = "activity.row_key DESC";

function buildActivityPageSql(subject: UserSubjectSql, clauses: DataTableSqlClauses): string {
  return `SELECT ${buildNamedColumnsSql(activityFieldSql).join(",\n    ")}
  FROM (
  ${buildActivityUnionSql(subject)}
  ) AS activity
  WHERE ${clauses.whereConditionSql}
  ${clauses.orderBySql}
  ${clauses.limitOffsetSql}`;
}

function buildActivityTotalSql(subject: UserSubjectSql, clauses: DataTableSqlClauses): string {
  return `SELECT count(*)::int AS total_count
  FROM (
  ${buildActivityUnionSql(subject)}
  ) AS activity
  WHERE ${clauses.whereConditionSql}`;
}

function parseActivityRow(row: AdminQueryRow, rowIndex: number): ActivityRow {
  const location = `${reportLabel} row ${rowIndex}`;
  const string = (field: ActivityField): string => readRowString(row, field, location);
  const nullableString = (field: ActivityField): string | null => readRowNullableString(row, field, location);
  const source = string("source");
  const matchedSource = activitySources.find((candidate) => candidate === source);
  if (matchedSource === undefined) {
    throw new Error(`${location} field "source" has unsupported value: ${source}`);
  }
  const recordedAs = string("recordedAs");
  const matchedRecordedAs = activityRecordedAs.find((candidate) => candidate === recordedAs);
  if (matchedRecordedAs === undefined) {
    throw new Error(`${location} field "recordedAs" has unsupported value: ${recordedAs}`);
  }
  const key = string("key");
  return {
    key,
    occurredAt: string("occurredAt"),
    source: matchedSource,
    eventId: matchedSource === "analytics" ? key.slice(analyticsKeyPrefix.length) : null,
    name: string("name"),
    platform: nullableString("platform"),
    appVersion: nullableString("appVersion"),
    screen: nullableString("screen"),
    country: nullableString("country"),
    uiLocale: nullableString("uiLocale"),
    sessionId: nullableString("sessionId"),
    origin: nullableString("origin"),
    details: string("details"),
    recordedAs: matchedRecordedAs,
  };
}

export type ActivityPageResult = Readonly<{
  /** The rows matching the filters across every page. */
  totalCount: number;
  rows: ReadonlyArray<ActivityRow>;
}>;

/** The page at `state.page` and the matching total, in one request of two statements. */
export async function loadActivityPage(
  config: AdminAppConfig,
  userId: string,
  state: DataTableState,
  columns: ReadonlyArray<DataTableColumn<ActivityRow>>,
): Promise<ActivityPageResult> {
  const subject = buildUserSubjectSql(userId);
  const clauses = buildDataTableSqlClauses(state, columns, activityColumnSqlById, defaultOrderBySql, tiebreakOrderBySql);
  const response = await runAdminQuery(
    config,
    `${buildActivityPageSql(subject, clauses)};\n${buildActivityTotalSql(subject, clauses)}`,
  );
  const pageResult = response.resultSets[0];
  if (response.resultSets.length !== 2 || pageResult === undefined) {
    throw new Error(`${reportLabel} query must return exactly two result sets.`);
  }
  return {
    totalCount: parsePageTotal(response.resultSets[1]?.rows[0]?.total_count, reportLabel),
    rows: pageResult.rows.map((row, rowIndex) => parseActivityRow(row, rowIndex)),
  };
}

/** Every enum column `ActivityTab` declares. */
const activityEnumColumnIds = [
  "source", "recorded-as", "name", "platform", "app-version", "screen", "country", "ui-locale", "origin",
] as const;

/** Every value each enum column holds across the person's whole activity, NULL as `""`, in one scan. */
function buildActivityEnumOptionsSql(subject: UserSubjectSql): string {
  const optionsSql = activityEnumColumnIds.map((columnId) => {
    const sqlExpression = activityColumnSqlById[columnId];
    if (sqlExpression === undefined) {
      throw new Error(`${reportLabel} enum column "${columnId}" has no SQL expression.`);
    }
    return `'${columnId}', ${buildDistinctOptionsSql(`COALESCE(${sqlExpression}, '')`)}`;
  });
  return `SELECT json_build_object(
    ${optionsSql.join(",\n    ")}
  ) AS o
  FROM (
  ${buildActivityUnionSql(subject)}
  ) AS activity`;
}

export type ActivityEnumOptions = ReadonlyMap<string, ReadonlyArray<string>>;

/** Every enum column with no options, which the table shows until `loadActivityEnumOptions` answers. */
export const emptyActivityEnumOptions: ActivityEnumOptions = emptyEnumOptions(activityEnumColumnIds);

export async function loadActivityEnumOptions(config: AdminAppConfig, userId: string): Promise<ActivityEnumOptions> {
  const response = await runAdminQuery(config, buildActivityEnumOptionsSql(buildUserSubjectSql(userId)));
  return parseEnumOptionsResponse(response, activityEnumColumnIds, reportLabel);
}
