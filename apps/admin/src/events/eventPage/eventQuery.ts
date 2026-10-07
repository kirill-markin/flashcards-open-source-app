import { runAdminQuery, type AdminQueryRow } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { buildExcludedActorReasonSql } from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import { buildNamedColumnsSql } from "../../table/dataTableServerQuery";
import { utcInstantSql } from "../../users/usersQuery";
import {
  readRowNullableBoolean,
  readRowNullableString,
  readRowNumber,
  readRowString,
} from "../../users/userPage/queryRowValues";
import { isUuid } from "../../users/userPage/userSubjectSql";

const reportLabel = "Analytics event";

/** Every column of `analytics.product_events_resolved` plus the stored `details`; instants are ISO-8601 UTC. */
export type AnalyticsEvent = Readonly<{
  eventId: string;
  eventName: string;
  schemaVersion: number;
  origin: string;
  backfillId: string | null;
  requestId: string | null;
  trustLevel: string;
  authTransport: string | null;
  automatedClient: boolean | null;
  occurredAt: string;
  clientOccurredAt: string | null;
  clientSentAt: string | null;
  serverReceivedAt: string;
  ingestedAt: string;
  actorId: string | null;
  actorEmail: string | null;
  /** Comma-separated arms of the analytics exclusion rule; null for an actor every report counts. */
  exclusionReason: string | null;
  userId: string | null;
  subjectUserId: string | null;
  anonymousId: string | null;
  guestSessionId: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  identityState: string;
  dailyVisitorHash: string | null;
  platform: string | null;
  appVersion: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  deviceLocale: string | null;
  timezone: string | null;
  country: string | null;
  networkState: string | null;
  screen: string | null;
  uiLocale: string | null;
  /** The JSON columns as pretty-printed text. */
  eventProperties: string;
  experimentAssignments: string;
  details: string | null;
}>;

type EventField = keyof AnalyticsEvent;

/** Each `AnalyticsEvent` field, selected under its own name by `buildEventSql`. */
const eventFieldSql: Readonly<Record<EventField, string>> = {
  eventId: "events.event_id::text",
  eventName: "events.event_name",
  schemaVersion: "events.schema_version",
  origin: "events.origin",
  backfillId: "events.backfill_id::text",
  requestId: "events.request_id",
  trustLevel: "events.trust_level",
  authTransport: "events.auth_transport",
  automatedClient: "events.automated_client",
  occurredAt: utcInstantSql("events.occurred_at"),
  clientOccurredAt: utcInstantSql("events.client_occurred_at"),
  clientSentAt: utcInstantSql("events.client_sent_at"),
  serverReceivedAt: utcInstantSql("events.server_received_at"),
  ingestedAt: utcInstantSql("events.ingested_at"),
  actorId: "events.actor_id::text",
  actorEmail: "(SELECT settings.email FROM org.user_settings AS settings WHERE pg_catalog.lower(settings.user_id) = events.actor_id::text)",
  exclusionReason: `NULLIF(${buildExcludedActorReasonSql("events.actor_id::text")}, '')`,
  userId: "events.user_id::text",
  subjectUserId: "events.subject_user_id::text",
  anonymousId: "events.anonymous_id::text",
  guestSessionId: "events.guest_session_id::text",
  workspaceId: "events.workspace_id::text",
  sessionId: "events.session_id::text",
  identityState: "events.identity_state",
  dailyVisitorHash: "events.daily_visitor_hash",
  platform: "events.platform",
  appVersion: "events.app_version",
  osVersion: "events.os_version",
  deviceModel: "events.device_model",
  deviceLocale: "events.device_locale",
  timezone: "events.timezone",
  country: "events.country",
  networkState: "events.network_state",
  screen: "events.screen",
  uiLocale: "events.ui_locale",
  eventProperties: "jsonb_pretty(events.event_properties)",
  experimentAssignments: "jsonb_pretty(events.experiment_assignments)",
  details: "jsonb_pretty(stored_events.details)",
};

/**
 * The view row, with `details` read off the stored row because the view does not carry it. Every
 * trust level is shown, and an excluded actor is named with its reason rather than dropped.
 */
function buildEventSql(eventId: string): string {
  return `SELECT ${buildNamedColumnsSql(eventFieldSql).join(",\n    ")}
  FROM analytics.product_events_resolved AS events
  JOIN analytics.product_events AS stored_events ON stored_events.event_id = events.event_id
  WHERE events.event_id = ${escapeSqlStringLiteral(eventId)}::uuid`;
}

function parseEvent(row: AdminQueryRow): AnalyticsEvent {
  const location = `${reportLabel} row`;
  const string = (field: EventField): string => readRowString(row, field, location);
  const nullableString = (field: EventField): string | null => readRowNullableString(row, field, location);
  return {
    eventId: string("eventId"),
    eventName: string("eventName"),
    schemaVersion: readRowNumber(row, "schemaVersion", location),
    origin: string("origin"),
    backfillId: nullableString("backfillId"),
    requestId: nullableString("requestId"),
    trustLevel: string("trustLevel"),
    authTransport: nullableString("authTransport"),
    automatedClient: readRowNullableBoolean(row, "automatedClient", location),
    occurredAt: string("occurredAt"),
    clientOccurredAt: nullableString("clientOccurredAt"),
    clientSentAt: nullableString("clientSentAt"),
    serverReceivedAt: string("serverReceivedAt"),
    ingestedAt: string("ingestedAt"),
    actorId: nullableString("actorId"),
    actorEmail: nullableString("actorEmail"),
    exclusionReason: nullableString("exclusionReason"),
    userId: nullableString("userId"),
    subjectUserId: nullableString("subjectUserId"),
    anonymousId: nullableString("anonymousId"),
    guestSessionId: nullableString("guestSessionId"),
    workspaceId: nullableString("workspaceId"),
    sessionId: nullableString("sessionId"),
    identityState: string("identityState"),
    dailyVisitorHash: nullableString("dailyVisitorHash"),
    platform: nullableString("platform"),
    appVersion: nullableString("appVersion"),
    osVersion: nullableString("osVersion"),
    deviceModel: nullableString("deviceModel"),
    deviceLocale: nullableString("deviceLocale"),
    timezone: nullableString("timezone"),
    country: nullableString("country"),
    networkState: nullableString("networkState"),
    screen: nullableString("screen"),
    uiLocale: nullableString("uiLocale"),
    eventProperties: string("eventProperties"),
    experimentAssignments: string("experimentAssignments"),
    details: nullableString("details"),
  };
}

export type LoadedAnalyticsEvent = Readonly<{
  generatedAtUtc: string;
  event: AnalyticsEvent;
}>;

/** Null when no event has this id; an id that is not a UUID names none and is never queried. */
export async function loadAnalyticsEvent(config: AdminAppConfig, eventId: string): Promise<LoadedAnalyticsEvent | null> {
  if (!isUuid(eventId)) {
    return null;
  }
  const response = await runAdminQuery(config, buildEventSql(eventId));
  const result = response.resultSets[0];
  if (response.resultSets.length !== 1 || result === undefined || result.rows.length > 1) {
    throw new Error(`${reportLabel} query must return exactly one result set with at most one row.`);
  }
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  return { generatedAtUtc: response.executedAtUtc, event: parseEvent(row) };
}
