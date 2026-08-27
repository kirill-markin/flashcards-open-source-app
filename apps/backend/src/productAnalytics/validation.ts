import { z } from "zod";
import { HttpError } from "../shared/errors";
import type { HttpErrorDetails, ValidationIssueSummary } from "../shared/errors";
import {
  findProductAnalyticsEventDefinition,
  isPlainObject,
  parseProductAnalyticsExperimentAssignments,
  productAnalyticsNetworkStateSchema,
  productAnalyticsPropertyKeyLimit,
  productAnalyticsPropertyStringMaxLength,
  productAnalyticsSurfaceSchema,
  type ProductAnalyticsEventDefinition,
  type ProductAnalyticsEventProperties,
} from "./catalog";
import type {
  ProductAnalyticsClientContext,
  ProductAnalyticsRejectedEvent,
  ProductAnalyticsRejectionReason,
  ValidatedProductAnalyticsEvent,
} from "./types";

export const productAnalyticsBatchEventLimit = 50;
export const productAnalyticsEventByteLimit = 4 * 1024;
export const productAnalyticsMaxEventAgeMs = 30 * 24 * 60 * 60 * 1000;

// Client-owned event fields. Everything else on an event is either a server-owned column or an
// unknown field, and both reject that one event instead of being stripped silently.
const clientEventFields: ReadonlySet<string> = new Set([
  "eventId",
  "eventName",
  "clientOccurredAt",
  "networkState",
  "screen",
  "properties",
  "experimentAssignments",
]);

// Fields the server derives from the request context or the database. A client that sends any of
// them is either broken or probing, and either way its event is rejected rather than trusted.
const serverOwnedEventFields: ReadonlySet<string> = new Set([
  "email",
  "userId",
  "user_id",
  "subjectUserId",
  "subject_user_id",
  "origin",
  "trustLevel",
  "trust_level",
  "identityState",
  "identity_state",
  "schemaVersion",
  "schema_version",
  "backfillId",
  "backfill_id",
  "serverReceivedAt",
  "server_received_at",
  "occurredAt",
  "occurred_at",
  "ingestedAt",
  "ingested_at",
  "workspaceId",
  "workspace_id",
  "guestSessionId",
  "guest_session_id",
  "authTransport",
  "auth_transport",
  "platform",
  "appVersion",
  "app_version",
  "country",
  "requestId",
  "request_id",
]);

// Postgres compares uuid values case-insensitively and returns them canonically lowercased, so every
// id is lowercased on the way in, exactly as apps/backend/src/feedback/input.ts already does. That
// keeps the in-batch dedupe set, later identity-link lookups by anonymous_id, and the stored rows all
// agreeing on one spelling instead of relying on ON CONFLICT to absorb a case difference.
const analyticsUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());

// Device context is optional in every field: an absent value and an explicit null mean the same
// thing, so a client that cannot read one of them still delivers its batch. Only device-stable
// fields belong here; networkState is carried per event because it changes between them.
const clientContextSchema = z.object({
  osVersion: z.string().max(productAnalyticsPropertyStringMaxLength).nullish(),
  deviceModel: z.string().max(productAnalyticsPropertyStringMaxLength).nullish(),
  deviceLocale: z.string().max(productAnalyticsPropertyStringMaxLength).nullish(),
  timezone: z.string().max(productAnalyticsPropertyStringMaxLength).nullish(),
}).strict();

// Timestamps are UTC only. The contract is mirrored by hand in every client, so one accepted
// timestamp shape keeps the skew correction unambiguous. The event cap belongs here rather than in
// the per-event loop: batch size is a property of the batch, not of any one event, so an oversized
// batch is refused whole and the client re-splits and retries it. Rejecting the overflow event by
// event instead would both scale the response with the request body and mark those events
// permanently dropped, silently losing everything past the cap.
const batchEnvelopeSchema = z.object({
  clientSentAt: z.string().datetime(),
  anonymousId: analyticsUuidSchema.nullish(),
  sessionId: analyticsUuidSchema.nullish(),
  context: clientContextSchema.nullish(),
  events: z.array(z.unknown()).max(productAnalyticsBatchEventLimit),
}).strict();

type ParsedClientContext = z.infer<typeof clientContextSchema>;

// networkState is a per-event field, not a batch field: a queued batch is flushed only once the
// device is back online, so capturing connectivity once per batch would record the state of the
// flush rather than the state of the event and could never report offline at all.
const clientEventSchema = z.object({
  eventId: analyticsUuidSchema,
  eventName: z.string(),
  clientOccurredAt: z.string().datetime(),
  networkState: productAnalyticsNetworkStateSchema.nullish(),
  screen: productAnalyticsSurfaceSchema.nullish(),
  properties: z.unknown(),
  experimentAssignments: z.unknown(),
}).strict();

export type ProductAnalyticsBatchValidation = Readonly<{
  clientSentAt: Date;
  anonymousId: string | null;
  sessionId: string | null;
  context: ProductAnalyticsClientContext;
  accepted: ReadonlyArray<ValidatedProductAnalyticsEvent>;
  rejected: ReadonlyArray<ProductAnalyticsRejectedEvent>;
}>;

type EventOutcome =
  | Readonly<{ status: "accepted"; event: ValidatedProductAnalyticsEvent }>
  | Readonly<{ status: "rejected"; rejected: ProductAnalyticsRejectedEvent }>;

function summarizeValidationIssue(issue: z.core.$ZodIssue): ValidationIssueSummary {
  return {
    path: issue.path.length > 0 ? issue.path.join(".") : "<root>",
    code: issue.code,
    message: issue.message,
  };
}

function summarizeValidationDetails(error: z.ZodError): HttpErrorDetails {
  return {
    validationIssues: error.issues.map(summarizeValidationIssue),
  };
}

function toClientContext(context: ParsedClientContext | null | undefined): ProductAnalyticsClientContext {
  return {
    osVersion: context?.osVersion ?? null,
    deviceModel: context?.deviceModel ?? null,
    deviceLocale: context?.deviceLocale ?? null,
    timezone: context?.timezone ?? null,
  };
}

function reject(eventId: string | null, reason: ProductAnalyticsRejectionReason): EventOutcome {
  return { status: "rejected", rejected: { eventId, reason } };
}

// Read straight off the raw event so a rejection reached before schema parsing can still name the
// event it refers to. Lowercased for the same reason the schema lowercases: every event id this
// module reports uses one spelling, whether the event was rejected before or after parsing.
function readCandidateEventId(rawEvent: Readonly<Record<string, unknown>>): string | null {
  return typeof rawEvent.eventId === "string" ? rawEvent.eventId.toLowerCase() : null;
}

function parseIsoTimestamp(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function findUnexpectedFieldReason(
  rawEvent: Readonly<Record<string, unknown>>,
): ProductAnalyticsRejectionReason | null {
  const fieldNames = Object.keys(rawEvent);
  if (fieldNames.some((fieldName) => serverOwnedEventFields.has(fieldName))) {
    return "server_owned_field";
  }

  return fieldNames.every((fieldName) => clientEventFields.has(fieldName)) ? null : "unknown_field";
}

function parseEventProperties(
  definition: ProductAnalyticsEventDefinition,
  value: unknown,
): ProductAnalyticsEventProperties | ProductAnalyticsRejectionReason {
  const properties = value === undefined || value === null ? {} : value;
  if (!isPlainObject(properties)) {
    return "invalid_property";
  }

  const propertyKeys = Object.keys(properties);
  if (propertyKeys.length > productAnalyticsPropertyKeyLimit) {
    return "too_many_properties";
  }

  if (propertyKeys.every((propertyKey) => definition.propertyNames.has(propertyKey)) === false) {
    return "unknown_property";
  }

  return definition.parseProperties(properties) ?? "invalid_property";
}

// Segment skew correction: the device clock is trusted only for the interval between the event and
// the send, and the server clock supplies the anchor.
function correctClockSkew(
  clientOccurredAt: Date,
  clientSentAt: Date,
  serverReceivedAt: Date,
): Date | null {
  const clientElapsedMs = clientSentAt.getTime() - clientOccurredAt.getTime();
  const occurredAtMs = serverReceivedAt.getTime() - clientElapsedMs;
  if (occurredAtMs > serverReceivedAt.getTime()) {
    return null;
  }

  if (occurredAtMs < serverReceivedAt.getTime() - productAnalyticsMaxEventAgeMs) {
    return null;
  }

  return new Date(occurredAtMs);
}

function validateEvent(
  rawEvent: unknown,
  clientSentAt: Date,
  serverReceivedAt: Date,
  acceptedEventIds: ReadonlySet<string>,
): EventOutcome {
  if (!isPlainObject(rawEvent)) {
    return reject(null, "invalid_event");
  }

  const candidateEventId = readCandidateEventId(rawEvent);
  if (Buffer.byteLength(JSON.stringify(rawEvent), "utf8") > productAnalyticsEventByteLimit) {
    return reject(candidateEventId, "event_too_large");
  }

  const unexpectedFieldReason = findUnexpectedFieldReason(rawEvent);
  if (unexpectedFieldReason !== null) {
    return reject(candidateEventId, unexpectedFieldReason);
  }

  const parsedEvent = clientEventSchema.safeParse(rawEvent);
  if (parsedEvent.success === false) {
    return reject(candidateEventId, "invalid_event");
  }

  const event = parsedEvent.data;
  if (acceptedEventIds.has(event.eventId)) {
    return reject(event.eventId, "duplicate_event_id");
  }

  const definition = findProductAnalyticsEventDefinition(event.eventName);
  if (definition === null) {
    return reject(event.eventId, "unknown_event_name");
  }

  // A server-derived event records something the backend observed itself. Accepting one here would
  // let any client forge that observation with properties of its own choosing, so client ingest
  // rejects it and only the server-side emission path may produce the row.
  if (definition.serverOnly) {
    return reject(event.eventId, "server_only_event");
  }

  const screen = event.screen ?? null;
  if (definition.requiresScreen && screen === null) {
    return reject(event.eventId, "missing_screen");
  }

  const properties = parseEventProperties(definition, event.properties);
  if (typeof properties === "string") {
    return reject(event.eventId, properties);
  }

  const experimentAssignments = parseProductAnalyticsExperimentAssignments(event.experimentAssignments);
  if (experimentAssignments === null) {
    return reject(event.eventId, "invalid_experiment_assignments");
  }

  const clientOccurredAt = parseIsoTimestamp(event.clientOccurredAt);
  if (clientOccurredAt === null) {
    return reject(event.eventId, "invalid_event");
  }

  const occurredAt = correctClockSkew(clientOccurredAt, clientSentAt, serverReceivedAt);
  if (occurredAt === null) {
    return reject(event.eventId, "occurred_at_out_of_window");
  }

  return {
    status: "accepted",
    event: {
      eventId: event.eventId,
      eventName: definition.eventName,
      clientOccurredAt,
      occurredAt,
      networkState: event.networkState ?? null,
      screen,
      properties,
      experimentAssignments,
    },
  };
}

// Validation is per event and never per batch: one malformed event must not be able to poison a
// client queue forever, so every event is adjudicated on its own and reported back by event id.
// Envelope violations are the exception, because they name no single event to blame and the client
// fixes them by reshaping the request rather than by dropping an event.
export function validateProductAnalyticsBatch(
  input: unknown,
  serverReceivedAt: Date,
): ProductAnalyticsBatchValidation {
  const parsedEnvelope = batchEnvelopeSchema.safeParse(input);
  if (parsedEnvelope.success === false) {
    throw new HttpError(
      400,
      "Analytics batch rejected: the request envelope does not match the analytics contract.",
      "ANALYTICS_INVALID_BATCH",
      summarizeValidationDetails(parsedEnvelope.error),
    );
  }

  const envelope = parsedEnvelope.data;
  const clientSentAt = parseIsoTimestamp(envelope.clientSentAt);
  if (clientSentAt === null) {
    throw new HttpError(
      400,
      "Analytics batch rejected: clientSentAt is not a valid UTC timestamp.",
      "ANALYTICS_INVALID_BATCH",
    );
  }

  const accepted: Array<ValidatedProductAnalyticsEvent> = [];
  const rejected: Array<ProductAnalyticsRejectedEvent> = [];
  const acceptedEventIds = new Set<string>();

  for (const rawEvent of envelope.events) {
    const outcome = validateEvent(rawEvent, clientSentAt, serverReceivedAt, acceptedEventIds);
    if (outcome.status === "rejected") {
      rejected.push(outcome.rejected);
      continue;
    }

    acceptedEventIds.add(outcome.event.eventId);
    accepted.push(outcome.event);
  }

  return {
    clientSentAt,
    anonymousId: envelope.anonymousId ?? null,
    sessionId: envelope.sessionId ?? null,
    context: toClientContext(envelope.context),
    accepted,
    rejected,
  };
}
