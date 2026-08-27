import { createHash, randomUUID } from "node:crypto";
import {
  captureBackendWarning,
  createBackendObservationScope,
  getBackendErrorLogDetails,
} from "../observability/sentry";
import {
  productAnalyticsSchemaVersion,
  type ProductAnalyticsEventName,
  type ProductAnalyticsEventProperties,
} from "./catalog";
import type { ProductAnalyticsEventRow } from "./types";
import { insertProductAnalyticsEvents, insertProductAnalyticsIdentityLink } from "./writer";

// A server-derived emission carries only what the backend observed itself. There is no field for
// client context here on purpose: the row below leaves every client-owned column NULL, and
// product_events_client_columns_shape rejects the row if it ever stops doing so.
export type ServerDerivedProductAnalyticsEvent = Readonly<{
  // Chosen by the producer so an operation that can be replayed can derive a stable id and be
  // counted once, because the writer deduplicates on event_id.
  eventId: string;
  eventName: ProductAnalyticsEventName;
  occurredAt: Date;
  userId: string | null;
  subjectUserId: string | null;
  guestSessionId: string | null;
  workspaceId: string | null;
  properties: ProductAnalyticsEventProperties;
}>;

// Folded into every derived id, and part of no request or response. Without it an id is a pure
// function of the operation's own inputs, all of which the client already holds, and the writer
// deduplicates on event_id alone regardless of event_name: a client could then send an ordinary
// event through the ingestion route carrying the id its own guest_upgrade_completed or
// catalog_deck_installed row will later be derived from, and suppress that row for good on an
// append-only table.
//
// This value must never change. Every id ever stored was derived from it, so a new one would let a
// replayed operation store a second row for a fact that is already counted, which is exactly what
// deriving the id is here to prevent.
const serverDerivedProductAnalyticsEventIdSalt =
  "flashcards-open-source-app:product-analytics:server-derived-event-id:v1";

/**
 * Derives one server-derived event id from the operation the event reports.
 *
 * Producers must never mint a fresh id per attempt. Every producer here sits behind an operation a
 * client can retry, and a retried operation reaches its producer again, so a fresh id would store a
 * second row for one fact and inflate the metric permanently: analytics.product_events is
 * append-only and nothing rewrites it afterwards. Deriving the id from inputs that are stable across
 * retries makes the replay conflict on event_id in the writer and store nothing.
 *
 * The digest is laid out as a UUID because event_id is a uuid column. It is not a version-4 value
 * and is never used as one; it only has to be stable and collision-free.
 */
export function deriveServerDerivedProductAnalyticsEventId(
  eventName: ProductAnalyticsEventName,
  stableKeyParts: ReadonlyArray<string>,
): string {
  const digest = createHash("sha256")
    .update([serverDerivedProductAnalyticsEventIdSalt, eventName, ...stableKeyParts].join(":"))
    .digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

function createServerDerivedProductAnalyticsRow(
  event: ServerDerivedProductAnalyticsEvent,
): ProductAnalyticsEventRow {
  return {
    eventId: event.eventId,
    schemaVersion: productAnalyticsSchemaVersion,
    eventName: event.eventName,
    origin: "server",
    // product_events_backfill_id_shape ties backfill_id to origin 'backfill' exactly, so a row the
    // backend observed live always leaves it NULL.
    backfillId: null,
    // Client-owned columns. The server never saw the device this event happened on, so inventing
    // any of them would put a made-up client context behind a server observation.
    clientOccurredAt: null,
    clientSentAt: null,
    sessionId: null,
    anonymousId: null,
    platform: null,
    appVersion: null,
    osVersion: null,
    deviceModel: null,
    deviceLocale: null,
    timezone: null,
    country: null,
    networkState: null,
    // server_received_at anchors the skew correction of a client batch. A server-derived row has no
    // client clock to correct, so it repeats the time the backend observed the event.
    serverReceivedAt: event.occurredAt,
    occurredAt: event.occurredAt,
    userId: event.userId,
    subjectUserId: event.subjectUserId,
    authTransport: null,
    trustLevel: "server_derived",
    guestSessionId: event.guestSessionId,
    workspaceId: event.workspaceId,
    // No catalog event the backend emits itself is defined around a surface, and the backend has no
    // surface of its own to report.
    screen: null,
    eventProperties: event.properties,
    // Experiment assignments are client state that was active at event time. The backend does not
    // observe them, and guessing them would misattribute the outcome to a variant.
    experimentAssignments: {},
    requestId: null,
  };
}

// Analytics is best effort by definition and the product operation that produced the fact is not, so
// a failed emission is logged with its error text and never propagated. This is also what keeps a
// local AUTH_MODE=none run working, where a non-UUID user id fails the uuid cast in the database.
export async function emitServerDerivedProductAnalyticsEvent(
  event: ServerDerivedProductAnalyticsEvent,
): Promise<void> {
  try {
    await insertProductAnalyticsEvents([createServerDerivedProductAnalyticsRow(event)]);
  } catch (error) {
    const errorDetails = getBackendErrorLogDetails(error);
    captureBackendWarning({
      action: "product_analytics_server_event_write_failed",
      scope: createBackendObservationScope(
        "backend-api",
        null,
        null,
        null,
        event.userId,
        event.workspaceId,
        null,
        null,
        // The guest session behind the event. A dropped emission is the only signal this path ever
        // produces, so it has to name the session it lost rather than leave it uncorrelatable.
        event.guestSessionId,
        null,
        null,
      ),
      details: {
        eventName: event.eventName,
        errorClass: errorDetails.errorClass,
        errorMessage: errorDetails.errorMessage,
      },
    });
  }
}

// The highest-trust link available: the pair comes from an upgrade the backend performed, not from
// anything a client claimed. Best effort for the same reason the events above are.
export async function linkServerDerivedProductAnalyticsIdentity(
  identity: Readonly<{ anonymousId: string; userId: string }>,
): Promise<void> {
  try {
    await insertProductAnalyticsIdentityLink({
      // Only the anonymous_id and user_id pair identifies the link, so a repeated observation
      // conflicts on that pair and this id is never seen again. On that conflict the writer raises
      // the stored row's source to server_derived, so an earlier client claim for the same pair
      // cannot keep this upgrade out of the resolved view's server namespace.
      linkId: randomUUID(),
      anonymousId: identity.anonymousId,
      userId: identity.userId,
      source: "server_derived",
    });
  } catch (error) {
    const errorDetails = getBackendErrorLogDetails(error);
    captureBackendWarning({
      action: "product_analytics_identity_link_write_failed",
      scope: createBackendObservationScope(
        "backend-api",
        null,
        null,
        null,
        identity.userId,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
      details: {
        source: "server_derived",
        errorClass: errorDetails.errorClass,
        errorMessage: errorDetails.errorMessage,
      },
    });
  }
}
