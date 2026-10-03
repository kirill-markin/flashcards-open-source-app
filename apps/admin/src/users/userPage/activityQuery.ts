import { runAdminQuery, type AdminQueryResultSet, type AdminQueryValue } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { escapeSqlStringLiteral } from "../../sql";
import { readNullableString, readRowArray, readString } from "./queryRowValues";
import { buildMatchesUserIdSql, buildUserSubjectSql, type UserSubjectSql } from "./userSubjectSql";

const reportLabel = "User activity";

export const activityPageSize = 2000;

export const activitySources = ["analytics", "purchase", "grant", "feedback"] as const;

export type ActivitySource = (typeof activitySources)[number];

export const activityRecordedAs = ["guest", "account", "visitor"] as const;

export type ActivityRecordedAs = (typeof activityRecordedAs)[number];

export type ActivityRow = Readonly<{
  /** `<source>:<row id>`, unique across sources and the tiebreak of the keyset order. */
  key: string;
  /** ISO-8601 UTC instant at microsecond precision, so it doubles as the exact keyset cursor. */
  occurredAt: string;
  source: ActivitySource;
  name: string;
  platform: string | null;
  appVersion: string | null;
  screen: string | null;
  country: string | null;
  uiLocale: string | null;
  sessionId: string | null;
  origin: string | null;
  /** Compact JSON of the event properties, or of the source row's own fields. */
  details: string;
  recordedAs: ActivityRecordedAs;
}>;

export type ActivityCursor = Readonly<{ occurredAt: string; key: string }>;

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
  return `SELECT events.occurred_at, 'analytics:' || events.event_id::text AS row_key, 'analytics' AS source,
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
 * The newest `activityPageSize` rows older than `cursor`, newest first by (occurred at, key); a NULL
 * cursor is the newest page. Each row is one JSON array in `ActivityRow` field order, as the Users
 * list does, so the heaviest actor's page stays well under the Lambda response limit.
 */
function buildActivityPageSql(subject: UserSubjectSql, cursor: ActivityCursor | null): string {
  const cursorSql = cursor === null
    ? ""
    : `WHERE (activity.occurred_at, activity.row_key) < (${escapeSqlStringLiteral(cursor.occurredAt)}::timestamptz, ${escapeSqlStringLiteral(cursor.key)})`;
  return `SELECT json_build_array(
    activity.row_key,
    to_char(activity.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    activity.source, activity.name, activity.platform, activity.app_version, activity.screen,
    activity.country, activity.ui_locale, activity.session_id, activity.origin, activity.details,
    activity.recorded_as
  ) AS a
  FROM (
  ${buildActivityUnionSql(subject)}
  ) AS activity
  ${cursorSql}
  ORDER BY activity.occurred_at DESC, activity.row_key DESC
  LIMIT ${activityPageSize}`;
}

function buildActivityTotalSql(subject: UserSubjectSql): string {
  return `SELECT json_build_array(count(*)::int) AS t
  FROM (
  ${buildActivityUnionSql(subject)}
  ) AS activity`;
}

function parseActivityRow(value: AdminQueryValue | undefined, rowIndex: number): ActivityRow {
  const location = `${reportLabel} row ${rowIndex}`;
  const values = readRowArray(value, 13, location);
  const source = readString(values, 2, "source", location);
  const matchedSource = activitySources.find((candidate) => candidate === source);
  if (matchedSource === undefined) {
    throw new Error(`${location} field "source" has unsupported value: ${source}`);
  }
  const recordedAs = readString(values, 12, "recordedAs", location);
  const matchedRecordedAs = activityRecordedAs.find((candidate) => candidate === recordedAs);
  if (matchedRecordedAs === undefined) {
    throw new Error(`${location} field "recordedAs" has unsupported value: ${recordedAs}`);
  }
  const details: AdminQueryValue | undefined = values[11];
  if (details === undefined) {
    throw new Error(`${location} is missing "details".`);
  }
  return {
    key: readString(values, 0, "key", location),
    occurredAt: readString(values, 1, "occurredAt", location),
    source: matchedSource,
    name: readString(values, 3, "name", location),
    platform: readNullableString(values, 4, "platform", location),
    appVersion: readNullableString(values, 5, "appVersion", location),
    screen: readNullableString(values, 6, "screen", location),
    country: readNullableString(values, 7, "country", location),
    uiLocale: readNullableString(values, 8, "uiLocale", location),
    sessionId: readNullableString(values, 9, "sessionId", location),
    origin: readNullableString(values, 10, "origin", location),
    details: JSON.stringify(details),
    recordedAs: matchedRecordedAs,
  };
}

function parseActivityPage(result: AdminQueryResultSet | undefined): ReadonlyArray<ActivityRow> {
  if (result === undefined) {
    throw new Error(`${reportLabel} page result set is missing.`);
  }
  return result.rows.map((row, rowIndex) => parseActivityRow(row.a, rowIndex));
}

export type ActivityFirstPage = Readonly<{
  totalCount: number;
  rows: ReadonlyArray<ActivityRow>;
}>;

/** The newest page and the total across every source, in one request of two statements. */
export async function loadActivityFirstPage(config: AdminAppConfig, userId: string): Promise<ActivityFirstPage> {
  const subject = buildUserSubjectSql(userId);
  const response = await runAdminQuery(
    config,
    `${buildActivityPageSql(subject, null)};\n${buildActivityTotalSql(subject)}`,
  );
  if (response.resultSets.length !== 2) {
    throw new Error(`${reportLabel} query must return exactly two result sets.`);
  }
  const totalValue = response.resultSets[1]?.rows[0]?.t;
  const totalCount = Array.isArray(totalValue) ? totalValue[0] : undefined;
  if (typeof totalCount !== "number" || !Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw new Error(`${reportLabel} total must be a non-negative integer.`);
  }
  return {
    totalCount,
    rows: parseActivityPage(response.resultSets[0]),
  };
}

export async function loadActivityOlderPage(
  config: AdminAppConfig,
  userId: string,
  cursor: ActivityCursor,
): Promise<ReadonlyArray<ActivityRow>> {
  const response = await runAdminQuery(config, buildActivityPageSql(buildUserSubjectSql(userId), cursor));
  if (response.resultSets.length !== 1) {
    throw new Error(`${reportLabel} query must return exactly one result set.`);
  }
  return parseActivityPage(response.resultSets[0]);
}
