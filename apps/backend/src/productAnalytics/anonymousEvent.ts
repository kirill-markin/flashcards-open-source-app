import { z } from "zod";
import { HttpError } from "../shared/errors";
import {
  findProductAnalyticsEventDefinition,
  isPlainObject,
  isProductAnalyticsEventIdVersionValid,
  isRetiredProductAnalyticsClientEventName,
  productAnalyticsSchemaVersion,
  productAnalyticsSurfaceSchema,
  type ProductAnalyticsEventDefinition,
  type ProductAnalyticsEventProperties,
} from "./catalog";
import type { ProductAnalyticsEventRow } from "./types";
import { correctProductAnalyticsClockSkew, productAnalyticsUiLocaleSchema } from "./validation";

// Every rule this collector applies per event comes off the catalog entry, read through
// findProductAnalyticsEventDefinition below: the accepted names are the entries that are already
// `serverOnly: false`, and the entries that may not be stored beside an identity are the ones that
// declare `identityFree`. A second list beside the catalog would drift from it silently, and a
// consent-shaped event added later would lose the guard without anything saying so.

const anonymousEventUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const anonymousEventDeviceLocaleMaximumLength = 64;

// Strict, and every field beyond the event itself is optional, so a producer that knows nothing of
// a field keeps working unchanged. `anonymousId` is the shared browser visitor id from
// docs/analytics-visitor-identity.md; nothing else on this route may carry identity, which is why
// there is no session, platform, app version or experiment field to send.
const anonymousEventSchema = z.object({
  eventId: anonymousEventUuidSchema,
  eventName: z.string(),
  clientOccurredAt: z.string().datetime(),
  clientSentAt: z.string().datetime(),
  anonymousId: anonymousEventUuidSchema.nullish(),
  uiLocale: productAnalyticsUiLocaleSchema.nullish(),
  deviceLocale: z.string().min(1).max(anonymousEventDeviceLocaleMaximumLength).nullish(),
  screen: productAnalyticsSurfaceSchema.nullish(),
  properties: z.unknown(),
}).strict();

function parseTimestamp(value: string, fieldName: string): Date {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new HttpError(
      400,
      `Anonymous analytics ${fieldName} must be a valid UTC timestamp.`,
      "ANONYMOUS_ANALYTICS_INVALID_EVENT",
    );
  }

  return timestamp;
}

function normalizeDeviceLocale(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value.trim() !== value) {
    throw new HttpError(
      400,
      "Anonymous analytics deviceLocale must be a canonical language tag.",
      "ANONYMOUS_ANALYTICS_INVALID_EVENT",
    );
  }

  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(value);
  } catch {
    throw new HttpError(
      400,
      "Anonymous analytics deviceLocale must be a valid language tag.",
      "ANONYMOUS_ANALYTICS_INVALID_EVENT",
    );
  }

  const normalizedLocale = locale.toString();
  if (normalizedLocale.length > anonymousEventDeviceLocaleMaximumLength) {
    throw new HttpError(
      400,
      `Anonymous analytics deviceLocale must contain at most ${anonymousEventDeviceLocaleMaximumLength} characters.`,
      "ANONYMOUS_ANALYTICS_INVALID_EVENT",
    );
  }

  return normalizedLocale;
}

// Postgres returns uuid values lowercased, and the catalog's UUID property format is lowercase hex,
// so the two id properties the catalog install funnel joins on are accepted in either spelling and
// stored in one.
function normalizeUuidProperties(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!isPlainObject(value)) {
    return null;
  }

  return {
    ...value,
    ...(typeof value.install_journey_id === "string"
      ? { install_journey_id: value.install_journey_id.toLowerCase() }
      : {}),
    ...(typeof value.package_version_id === "string"
      ? { package_version_id: value.package_version_id.toLowerCase() }
      : {}),
  };
}

function findClientReportableDefinition(eventName: string): ProductAnalyticsEventDefinition {
  const definition = findProductAnalyticsEventDefinition(eventName);
  if (definition === null) {
    throw new HttpError(
      400,
      isRetiredProductAnalyticsClientEventName(eventName)
        ? "Anonymous analytics eventName names a retired event."
        : "Anonymous analytics eventName is not in the event catalog.",
      "ANONYMOUS_ANALYTICS_INVALID_EVENT",
    );
  }

  // A server-only event records something the backend observed itself, so an unauthenticated caller
  // claiming one would be forging an outcome the server never saw.
  if (definition.serverOnly) {
    throw new HttpError(
      400,
      "Anonymous analytics eventName names a server-derived event no client may report.",
      "ANONYMOUS_ANALYTICS_INVALID_EVENT",
    );
  }

  return definition;
}

function parseEventProperties(
  definition: ProductAnalyticsEventDefinition,
  value: unknown,
): ProductAnalyticsEventProperties {
  const normalizedProperties = normalizeUuidProperties(value === undefined || value === null ? {} : value);
  const properties = normalizedProperties === null
    ? null
    : definition.parseProperties(normalizedProperties);
  if (properties === null) {
    throw new HttpError(
      400,
      "Anonymous analytics properties do not match the selected event.",
      "ANONYMOUS_ANALYTICS_INVALID_EVENT",
    );
  }

  return properties;
}

// A claimed id on an identity-free event is refused rather than quietly stripped:
// analytics.product_events is append-only, so the row could never be repaired afterwards, and a
// silent strip would leave the producer believing it reported something it did not.
function assertEventMayCarryIdentity(
  definition: ProductAnalyticsEventDefinition,
  claimedAnonymousId: string | null | undefined,
): void {
  if (claimedAnonymousId === null || claimedAnonymousId === undefined) {
    return;
  }

  if (definition.identityFree) {
    throw new HttpError(
      400,
      `Anonymous analytics ${definition.eventName} must be reported with no anonymousId, because its catalog entry allows it no identity at all.`,
      "ANONYMOUS_ANALYTICS_IDENTITY_NOT_ALLOWED",
    );
  }
}

// The actor the row is counted under, which is a claim this route never verifies and is the only
// identity it stores at all. A producer sends the shared browser visitor id. The catalog install
// funnel predates that identity and sends none, so its one-attempt journey UUID stays the column
// the reporting contract in docs/catalog-install-funnel.md already reads as its attempt key.
function readAnonymousId(
  claimedAnonymousId: string | null | undefined,
  properties: ProductAnalyticsEventProperties,
): string | null {
  if (claimedAnonymousId !== null && claimedAnonymousId !== undefined) {
    return claimedAnonymousId;
  }

  const installJourneyId = properties.install_journey_id;
  return typeof installJourneyId === "string" ? installJourneyId : null;
}

export function parseAnonymousEvent(
  input: unknown,
  serverReceivedAt: Date,
  requestId: string,
): ProductAnalyticsEventRow {
  const parsedEvent = anonymousEventSchema.safeParse(input);
  if (parsedEvent.success === false) {
    throw new HttpError(
      400,
      "Anonymous analytics event does not match the collector contract.",
      "ANONYMOUS_ANALYTICS_INVALID_EVENT",
    );
  }

  const event = parsedEvent.data;
  if (isProductAnalyticsEventIdVersionValid(event.eventId) === false) {
    throw new HttpError(
      400,
      "Anonymous analytics eventId must be a UUIDv7.",
      "ANONYMOUS_ANALYTICS_INVALID_EVENT",
    );
  }

  const definition = findClientReportableDefinition(event.eventName);
  assertEventMayCarryIdentity(definition, event.anonymousId);
  const screen = event.screen ?? null;
  if (definition.requiresScreen && screen === null) {
    throw new HttpError(
      400,
      "Anonymous analytics event is missing the surface its catalog entry requires.",
      "ANONYMOUS_ANALYTICS_INVALID_EVENT",
    );
  }

  const clientOccurredAt = parseTimestamp(event.clientOccurredAt, "clientOccurredAt");
  const clientSentAt = parseTimestamp(event.clientSentAt, "clientSentAt");
  const occurredAt = correctProductAnalyticsClockSkew(
    clientOccurredAt,
    clientSentAt,
    serverReceivedAt,
  );
  if (occurredAt === null) {
    throw new HttpError(
      400,
      "Anonymous analytics clientOccurredAt is outside the accepted clock window.",
      "ANONYMOUS_ANALYTICS_EVENT_TIME_INVALID",
    );
  }

  const properties = parseEventProperties(definition, event.properties);

  return {
    eventId: event.eventId,
    schemaVersion: productAnalyticsSchemaVersion,
    eventName: definition.eventName,
    origin: "client",
    backfillId: null,
    clientOccurredAt,
    clientSentAt,
    serverReceivedAt,
    occurredAt,
    userId: null,
    subjectUserId: null,
    authTransport: null,
    trustLevel: "anonymous_client",
    guestSessionId: null,
    workspaceId: null,
    anonymousId: readAnonymousId(event.anonymousId, properties),
    sessionId: null,
    // The collector is reachable only from the browser origins on its CORS allowlist, so the
    // platform is known from the route rather than claimed by the caller.
    platform: "web",
    appVersion: null,
    osVersion: null,
    deviceModel: null,
    deviceLocale: normalizeDeviceLocale(event.deviceLocale),
    timezone: null,
    country: null,
    uiLocale: event.uiLocale ?? null,
    networkState: null,
    screen,
    eventProperties: properties,
    experimentAssignments: {},
    requestId,
    details: null,
  };
}
