import { createHash, randomUUID } from "node:crypto";
import { getDatabaseErrorFields } from "../../database/transient";
// Report through `observability/runtime`, never through `observability/sentry`, for the reason
// spelled out in contentCreations.ts: the content-creation drain calls the batch emission below, and
// it runs inside the direct image ingestion Lambda's import graph, whose bundle must reach no
// `observability/sentry/capture`, `config` or `tracing` module. The runtime sink is
// `captureBackendWarning` wherever `initializeBackendSentry` ran, so nothing about these two
// warnings changes for the handlers that do initialize Sentry.
import {
  captureBackendRuntimeWarning,
  createBackendObservationScope,
} from "../../observability/runtime";
import {
  productAnalyticsSchemaVersion,
  type ProductAnalyticsEventName,
  type ProductAnalyticsEventProperties,
  type ProductAnalyticsPlatform,
} from "../catalog";
import type { ProductAnalyticsEventDetails, ProductAnalyticsEventRow } from "../types";
import { insertProductAnalyticsEvents, insertProductAnalyticsIdentityLink } from "../writer";

// A server-derived emission carries only what the backend observed itself. There is no field for
// client context here on purpose: the row below leaves client_occurred_at, client_sent_at,
// session_id and anonymous_id NULL, and product_events_client_columns_shape rejects the row if it
// ever stops doing so.
//
// platform is the one field that describes a client, and it is not a hole in that rule. What the
// rule forbids is a platform a client request body claimed: a client able to name its own platform
// on a server-derived row could attribute the backend's own observation to any platform it liked,
// and the table is append-only, so that could never be repaired. A producer therefore reads it only
// from data the server itself stored.
//
// The field is optional, and null is always a correct answer. A producer that cannot justify a
// value passes null, and there is no safe default it may reach for instead. Both outcomes have a
// cost and they are not symmetric: null leaves the row out of "daily active users by platform",
// while a guess files it under a platform it never had, permanently, on an append-only table. Each
// producer therefore justifies its own derivation at its own call site, against the rows it
// actually reads, and this comment is a list of hazards rather than a mapping to copy.
//
// The hard requirement, and the reason this comment exists at all: a producer must never read
// sync.workspace_replicas.platform without reading actor_kind on the same row. The column is
// constrained to ios, android, web and system, and more than one actor kind stores a value in it
// that does not describe a client device at all, so the column on its own cannot tell a device
// apart from a backend actor. Known hazards, as examples and not as the answer for every actor
// kind:
//   - agent_connection stores 'web' (apps/backend/src/agent/syncIdentity.ts) even though the client
//     is the machine API and not a browser, so the column names the wrong client outright.
//   - ai_chat stores whatever the chat tool layer passed, and both production call sites in
//     apps/backend/src/chat/openai/tools/tools.ts hardcode "web". The value describes nothing about
//     the device the person was on: ai_chat is not a platform source, and a producer passes null
//     unless it can justify a value from something other than this column.
//   - workspace_seed and workspace_reset store 'system', which is no client at all.
// A producer that cannot name the one replica row behind the fact has an additional problem before
// any of this: a lookup by workspace alone can return an unrelated replica, so it passes null
// rather than choosing among the workspace's replicas.
//
// auth.guest_sessions.platform is the one column that is safe to read directly:
// guest_sessions_platform_check admits ios, android and web and nothing else, so it never holds a
// non-client value. It is nullable for pre-1.7.0 mobile clients, and that null passes through
// unchanged.
//
// No stored platform column anywhere holds `agent` — not sync.workspace_replicas.platform, not
// sync.installations.platform, not auth.guest_sessions.platform. A producer that wants to report
// the machine API client must therefore derive it from the actor kind and can never read it out of
// a column.
export type ServerDerivedProductAnalyticsEvent = Readonly<{
  // Chosen by the producer so an operation that can be replayed can derive a stable id and be
  // counted once, because the writer deduplicates on event_id.
  eventId: string;
  eventName: ProductAnalyticsEventName;
  // When the fact happened, and when the backend learned of it. A producer that observes both,
  // such as a backfill or anything reading a row a client synced later, passes both, so the skew
  // between them stays recoverable as their difference. A producer that observes the fact as it
  // happens passes the same value twice, which is what every producer did before these were two
  // separate fields.
  occurredAt: Date;
  serverReceivedAt: Date;
  userId: string | null;
  subjectUserId: string | null;
  guestSessionId: string | null;
  workspaceId: string | null;
  platform: ProductAnalyticsPlatform | null;
  properties: ProductAnalyticsEventProperties;
  // Free-form provenance about how this row was produced, such as the production table a
  // reconstructed fact was read from. Nothing that identifies a person may go here: the column
  // survives account anonymization untouched, so anything person-linked would outlive the deletion
  // meant to remove it.
  details: ProductAnalyticsEventDetails | null;
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
    // The exception, and only because the producer read it from a source the server stored itself.
    // See the invariant on ServerDerivedProductAnalyticsEvent: a platform a client request body
    // claimed must never reach this column on a server-derived row.
    platform: event.platform,
    appVersion: null,
    osVersion: null,
    deviceModel: null,
    deviceLocale: null,
    timezone: null,
    country: null,
    networkState: null,
    // server_received_at anchors the skew correction of a client batch. A server-derived row has no
    // client clock to correct, so here it records when the backend learned of the fact instead, and
    // the two are equal for every producer that learns of it as it happens.
    serverReceivedAt: event.serverReceivedAt,
    occurredAt: event.occurredAt,
    userId: event.userId,
    subjectUserId: event.subjectUserId,
    authTransport: null,
    trustLevel: "server_derived",
    guestSessionId: event.guestSessionId,
    workspaceId: event.workspaceId,
    // The backend has no surface of its own to report, so every server-derived row leaves this
    // NULL. That is not a property of today's catalog: ProductAnalyticsEventSpec makes serverOnly
    // together with requiresScreen unwritable, so no catalog entry the backend emits itself can
    // ever be defined around a surface.
    screen: null,
    eventProperties: event.properties,
    // Experiment assignments are client state that was active at event time. The backend does not
    // observe them, and guessing them would misattribute the outcome to a variant.
    experimentAssignments: {},
    requestId: null,
    details: event.details,
  };
}

// The outcome below is deliberately discarded here, and this signature stays void so the call sites
// that report a single fact are unaffected: a producer of one fact has nothing left to stop for.
export async function emitServerDerivedProductAnalyticsEvent(
  event: ServerDerivedProductAnalyticsEvent,
): Promise<void> {
  await emitServerDerivedProductAnalyticsEvents([event]);
}

/**
 * Whether one batch reached analytics.product_events.
 *
 * Deliberately not a boolean. A caller that reacts to a refusal reads "dropped" and nothing else, so
 * a batch with nothing in it - which stores nothing and refuses nothing - reports "stored" and can
 * never be read as a write the database turned down.
 */
export type ServerDerivedProductAnalyticsEmitOutcome = "stored" | "dropped";

// Analytics is best effort by definition and the product operation that produced the fact is not, so
// a failed emission is logged with its error text and never propagated. This is also what keeps a
// local AUTH_MODE=none run working, where a non-UUID user id fails the uuid cast in the database.
//
// The outcome is returned, never raised: this function still has no rejection path at all. Its
// callers run after a product transaction committed, so a thrown refusal would surface as a failed
// card creation, which is the one thing this path exists to prevent. Returning it instead is what
// lets a producer part-way through an unbounded sequence of batches stop rather than pay the
// writer's connection and statement timeouts again for every batch it has left.
//
// A producer that observes many facts inside one product operation emits them here as one batch. The
// insert is a single unnest statement whose parameter count does not grow with the batch, so the
// whole batch costs one analytics transaction on one pooled connection, while one call per fact
// would cost that per row and the loops behind these producers are unbounded. The batch stores or
// fails as a unit, and the warning below names the first event and how many were lost with it. That
// one statement runs under the writer's 2s statement timeout, so a producer whose fact count is
// itself unbounded chunks its facts and calls this once per chunk rather than handing over a batch
// no timeout can finish.
export async function emitServerDerivedProductAnalyticsEvents(
  events: ReadonlyArray<ServerDerivedProductAnalyticsEvent>,
): Promise<ServerDerivedProductAnalyticsEmitOutcome> {
  const event = events[0];
  if (event === undefined) {
    return "stored";
  }

  try {
    await insertProductAnalyticsEvents(events.map(createServerDerivedProductAnalyticsRow));
    return "stored";
  } catch (error) {
    // Read through the database boundary fields rather than off the error itself. The analytics
    // writer answers a refused connection with its own HttpError whose message is a fixed public
    // string, so only these fields name the failure that actually happened; they fall back to the
    // error's own class and message when it carries none.
    const errorDetails = getDatabaseErrorFields(error);
    captureBackendRuntimeWarning({
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
        eventCount: events.length,
        sqlState: errorDetails.sqlState,
        errorClass: errorDetails.errorClass,
        errorMessage: errorDetails.errorMessage,
      },
    });
    return "dropped";
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
    const errorDetails = getDatabaseErrorFields(error);
    captureBackendRuntimeWarning({
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
        sqlState: errorDetails.sqlState,
        errorClass: errorDetails.errorClass,
        errorMessage: errorDetails.errorMessage,
      },
    });
  }
}
