import { runAdminQuery, type AdminQueryRow } from "../adminApi";
import type { AdminAppConfig } from "../config";
import { buildExcludedActorReasonSql } from "../filters/filterSql";
import { buildDataTableSqlClauses, type DataTableSqlClauses } from "../table/dataTableSql";
import type { DataTableColumn, DataTableState } from "../table/dataTableModel";
import {
  buildDistinctOptionsSql,
  buildNamedColumnsSql,
  emptyEnumOptions,
  parseEnumOptionsResponse,
  parsePageTotal,
} from "../table/dataTableServerQuery";
import { utcInstantSql } from "../users/usersQuery";
import { readRowNullableString, readRowString } from "../users/userPage/queryRowValues";

const reportLabel = "Events";

export type EventRow = Readonly<{
  eventId: string;
  /** ISO-8601 UTC instants. */
  occurredAt: string;
  serverReceivedAt: string;
  eventName: string;
  actorId: string | null;
  actorEmail: string | null;
  /** The recorded `user_id`, which differs from `actorId` for a merged guest and is null for a visitor. */
  userId: string | null;
  platform: string | null;
  appVersion: string | null;
  screen: string | null;
  country: string | null;
  uiLocale: string | null;
  origin: string;
  trustLevel: string;
  identityState: string;
  sessionId: string | null;
  /** Comma-separated arms of the analytics exclusion rule; null for an actor every report counts. */
  exclusionReason: string | null;
  /** Compact JSON text of `event_properties`. */
  eventProperties: string;
}>;

type EventField = keyof EventRow;

const exclusionReasonSql = buildExcludedActorReasonSql("events.actor_id::text");

/**
 * The SQL every column's filter and sort read, keyed by the column ids `EventsPage` declares. Each one
 * reads only `events` - a row of `analytics.product_events_resolved` - and `actor_settings`, so it
 * holds both inside the paged statement and around the page it returns.
 */
const eventColumnSqlById: Readonly<Record<string, string>> = {
  "event-id": "events.event_id::text",
  occurred: "events.occurred_at",
  received: "events.server_received_at",
  event: "events.event_name",
  "actor-id": "events.actor_id::text",
  "actor-email": "actor_settings.email",
  "user-id": "events.user_id::text",
  platform: "events.platform",
  "app-version": "events.app_version",
  screen: "events.screen",
  country: "events.country",
  "ui-locale": "events.ui_locale",
  origin: "events.origin",
  "trust-level": "events.trust_level",
  "identity-state": "events.identity_state",
  session: "events.session_id::text",
  excluded: `${exclusionReasonSql} <> ''`,
  "exclusion-reason": `NULLIF(${exclusionReasonSql}, '')`,
  properties: "events.event_properties::text",
};

/** Each `EventRow` field, selected under its own name by `buildEventsPageSql`. */
const eventFieldSql: Readonly<Record<EventField, string>> = {
  eventId: "events.event_id::text",
  occurredAt: utcInstantSql("events.occurred_at"),
  serverReceivedAt: utcInstantSql("events.server_received_at"),
  eventName: "events.event_name",
  actorId: "events.actor_id::text",
  actorEmail: "actor_settings.email",
  userId: "events.user_id::text",
  platform: "events.platform",
  appVersion: "events.app_version",
  screen: "events.screen",
  country: "events.country",
  uiLocale: "events.ui_locale",
  origin: "events.origin",
  trustLevel: "events.trust_level",
  identityState: "events.identity_state",
  sessionId: "events.session_id::text",
  exclusionReason: `NULLIF(${exclusionReasonSql}, '')`,
  eventProperties: "events.event_properties::text",
};

/** The view columns the paged statement hands to the outer one, which aliases them as `events` again. */
const pagedViewColumnsSql = [
  "event_id", "occurred_at", "server_received_at", "event_name", "actor_id", "user_id", "platform",
  "app_version", "screen", "country", "ui_locale", "origin", "trust_level", "identity_state", "session_id",
  "event_properties",
].map((column) => `events.${column}`).join(", ");

// One email per actor, on the folded settings id every admin surface joins `actor_id` to. Unique on
// `actor_id`, so the join never duplicates an event row and Postgres drops it from a statement that
// never reads the email.
const actorSettingsJoinSql = `LEFT JOIN (
    SELECT DISTINCT ON (pg_catalog.lower(settings.user_id))
      pg_catalog.lower(settings.user_id) AS actor_id, settings.email
    FROM org.user_settings AS settings
    ORDER BY pg_catalog.lower(settings.user_id), settings.user_id
  ) AS actor_settings ON actor_settings.actor_id = events.actor_id::text`;

// The index on `occurred_at` serves the bare descending order, which `NULLS LAST` would not match.
const defaultOrderBySql = "events.occurred_at DESC";

const tiebreakOrderBySql = "events.event_id DESC";

/**
 * One page of every analytics event, every trust level and excluded actor included. The inner statement
 * filters, sorts and pages the whole view and reads the email or the exclusion rule only where a filter
 * or the sort names them; the outer one computes both for the page rows alone and restores the order.
 */
function buildEventsPageSql(clauses: DataTableSqlClauses): string {
  return `SELECT ${buildNamedColumnsSql(eventFieldSql).join(",\n    ")}
  FROM (
    SELECT ${pagedViewColumnsSql}
    FROM analytics.product_events_resolved AS events
    ${actorSettingsJoinSql}
    WHERE ${clauses.whereConditionSql}
    ${clauses.orderBySql}
    ${clauses.limitOffsetSql}
  ) AS events
  ${actorSettingsJoinSql}
  ${clauses.orderBySql}`;
}

function buildEventsTotalSql(clauses: DataTableSqlClauses): string {
  return `SELECT count(*)::int AS total_count
  FROM analytics.product_events_resolved AS events
  ${actorSettingsJoinSql}
  WHERE ${clauses.whereConditionSql}`;
}

function parseEventRow(row: AdminQueryRow, rowIndex: number): EventRow {
  const location = `${reportLabel} row ${rowIndex}`;
  const string = (field: EventField): string => readRowString(row, field, location);
  const nullableString = (field: EventField): string | null => readRowNullableString(row, field, location);
  return {
    eventId: string("eventId"),
    occurredAt: string("occurredAt"),
    serverReceivedAt: string("serverReceivedAt"),
    eventName: string("eventName"),
    actorId: nullableString("actorId"),
    actorEmail: nullableString("actorEmail"),
    userId: nullableString("userId"),
    platform: nullableString("platform"),
    appVersion: nullableString("appVersion"),
    screen: nullableString("screen"),
    country: nullableString("country"),
    uiLocale: nullableString("uiLocale"),
    origin: string("origin"),
    trustLevel: string("trustLevel"),
    identityState: string("identityState"),
    sessionId: nullableString("sessionId"),
    exclusionReason: nullableString("exclusionReason"),
    eventProperties: string("eventProperties"),
  };
}

export type EventsPageResult = Readonly<{
  generatedAtUtc: string;
  /** The events matching the filters across every page. */
  totalCount: number;
  rows: ReadonlyArray<EventRow>;
}>;

/** The page at `state.page` and the matching total, in one request of two statements. */
export async function loadEventsPage(
  config: AdminAppConfig,
  state: DataTableState,
  columns: ReadonlyArray<DataTableColumn<EventRow>>,
): Promise<EventsPageResult> {
  const clauses = buildDataTableSqlClauses(state, columns, eventColumnSqlById, defaultOrderBySql, tiebreakOrderBySql);
  const response = await runAdminQuery(config, `${buildEventsPageSql(clauses)};\n${buildEventsTotalSql(clauses)}`);
  const pageResult = response.resultSets[0];
  if (response.resultSets.length !== 2 || pageResult === undefined) {
    throw new Error(`${reportLabel} query must return exactly two result sets.`);
  }
  return {
    generatedAtUtc: response.executedAtUtc,
    totalCount: parsePageTotal(response.resultSets[1]?.rows[0]?.total_count, reportLabel),
    rows: pageResult.rows.map((row, rowIndex) => parseEventRow(row, rowIndex)),
  };
}

const plainEnumColumnIds = [
  "event", "platform", "app-version", "screen", "country", "ui-locale", "origin", "trust-level", "identity-state",
] as const;

const exclusionReasonColumnId = "exclusion-reason";

/** Every enum column `EventsPage` declares. */
const eventEnumColumnIds: ReadonlyArray<string> = [...plainEnumColumnIds, exclusionReasonColumnId];

/**
 * Every value each enum column holds across the whole view, NULL as `""`: the row columns in one scan,
 * and the exclusion reasons per distinct actor rather than per row, where `''` is already the reason of
 * an actor every report counts.
 */
function buildEventsEnumOptionsSql(): string {
  const plainOptionsSql = plainEnumColumnIds.map((columnId) => {
    const sqlExpression = eventColumnSqlById[columnId];
    if (sqlExpression === undefined) {
      throw new Error(`${reportLabel} enum column "${columnId}" has no SQL expression.`);
    }
    return `'${columnId}', ${buildDistinctOptionsSql(`COALESCE(${sqlExpression}, '')`)}`;
  });
  return `SELECT json_build_object(
    ${plainOptionsSql.join(",\n    ")},
    '${exclusionReasonColumnId}', (
      SELECT ${buildDistinctOptionsSql("actor_reasons.reason")}
      FROM (
        SELECT ${buildExcludedActorReasonSql("actors.actor_id")} AS reason
        FROM (
          SELECT DISTINCT actor_events.actor_id::text AS actor_id
          FROM analytics.product_events_resolved AS actor_events
        ) AS actors
      ) AS actor_reasons
    )
  ) AS o
  FROM analytics.product_events_resolved AS events`;
}

export type EventsEnumOptions = ReadonlyMap<string, ReadonlyArray<string>>;

/** Every enum column with no options, which the table shows until `loadEventsEnumOptions` answers. */
export const emptyEventsEnumOptions: EventsEnumOptions = emptyEnumOptions(eventEnumColumnIds);

export async function loadEventsEnumOptions(config: AdminAppConfig): Promise<EventsEnumOptions> {
  const response = await runAdminQuery(config, buildEventsEnumOptionsSql());
  return parseEnumOptionsResponse(response, eventEnumColumnIds, reportLabel);
}
