import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  isProductAnalyticsEventIdVersionValid,
  productAnalyticsClientReportablePlatforms,
  productAnalyticsSchemaVersion,
  type ProductAnalyticsClientReportablePlatform,
} from "../productAnalytics/catalog";
import {
  captureBatchViolation,
  captureContractViolations,
} from "../productAnalytics/contractViolationReporting";
import {
  validateProductAnalyticsBatch,
  type ProductAnalyticsBatchValidation,
} from "../productAnalytics/validation";
import { insertProductAnalyticsClientBatch } from "../productAnalytics/writer";
import type {
  ProductAnalyticsEventRow,
  ProductAnalyticsIdentityLink,
  ProductAnalyticsRejectedEvent,
  ProductAnalyticsTrustLevel,
  ValidatedProductAnalyticsEvent,
} from "../productAnalytics/types";
import { HttpError } from "../shared/errors";
import { loadRequestContextFromRequest, type RequestContext } from "../server/requestContext";
import { parseJsonBodyWithByteLimit } from "../server/requestParsing";
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import type { AppEnv } from "../server/app";

type ProductAnalyticsRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  insertProductAnalyticsClientBatchFn?: typeof insertProductAnalyticsClientBatch;
}>;

type ProductAnalyticsIngestEnvelope = Readonly<{
  accepted: number;
  rejected: ReadonlyArray<ProductAnalyticsRejectedEvent>;
}>;

// The batch cap is what bounds the response: the envelope schema caps events at
// productAnalyticsBatchEventLimit and validateProductAnalyticsBatch refuses an overflowing batch as
// a whole with a 400, so an oversized batch carries no rejection objects at all and an adjudicated
// one carries at most one per event in that cap. This cap bounds the request instead, so a body
// that would never reach validation is refused before it is read.
const productAnalyticsJsonBodyMaxBytes = 256 * 1024;
const analyticsBodyTooLargeCode = "ANALYTICS_BODY_TOO_LARGE";

// x-client-version is client-chosen text that reaches both an append-only column anonymization
// deliberately keeps and a Sentry fingerprint slot, so one shape governs both instead of a loose
// one for storage and a tight one for reporting. Every released client reports the shared marketing
// version and nothing else: apps/web/package.json, APP_MARKETING_VERSION in
// apps/ios/Flashcards/Config/Base.xcconfig, and versionName in apps/android/app/build.gradle.kts
// are all a plain numeric MAJOR.MINOR.PATCH, and every published tag has that shape too. A header
// outside it is recorded as absent rather than stored verbatim, which closes a free-text channel
// into a permanent row, and collapses onto one fingerprint token instead of opening a Sentry issue
// per spelling.
const clientAppVersionPattern = /^[0-9]{1,4}(?:\.[0-9]{1,4}){0,2}$/u;

// A link row is carried once per (anonymousId, userId) pair this container has already stored, so an
// ordinary batch from a signed-in device does not pay a second statement for a link that exists.
// Containers are many, so this is a cost control and not a correctness guarantee: the writer's
// conflict on (anonymous_id, user_id) is what keeps the table free of duplicates. Overflow evicts
// the least recently linked pair rather than clearing the set.
const identityLinkStoredPairsLimit = 500;
const identityLinkStoredPairs = new Set<string>();

type ProductAnalyticsRequestFacts = Readonly<{
  platform: ProductAnalyticsClientReportablePlatform | null;
  appVersion: string | null;
}>;

function createProductAnalyticsScope(
  requestId: string,
  route: string,
  method: string,
  userId: string | null,
  workspaceId: string | null,
  clientAppVersion: string | null,
  clientPlatform: string | null,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    workspaceId,
    null,
    null,
    null,
    clientAppVersion,
    clientPlatform,
  );
}

// api_key is a bot transport with no product surface to instrument. Rejecting none is load-bearing
// rather than hygiene: analytics.product_events.user_id is UUID and the writer casts to uuid[],
// while transport "none" carries the literal id 'local' from the local-development auth bypass, so
// this check is what stands between that id and a Postgres 22P02.
function isProductAnalyticsTransportAccepted(requestContext: RequestContext): boolean {
  return requestContext.transport === "bearer"
    || requestContext.transport === "session"
    || requestContext.transport === "guest";
}

function assertProductAnalyticsTransport(requestContext: RequestContext): void {
  if (isProductAnalyticsTransportAccepted(requestContext)) {
    return;
  }

  throw new HttpError(
    403,
    "This endpoint requires Guest, Bearer, or Session authentication.",
    "ANALYTICS_HUMAN_AUTH_REQUIRED",
  );
}

function toTrustLevel(requestContext: RequestContext): ProductAnalyticsTrustLevel {
  return requestContext.transport === "guest" ? "guest_client" : "authenticated_client";
}

// The request context is assigned before the transport assert runs, so a request refused for
// arriving on api_key or none still reaches the failure path carrying one. toTrustLevel answers
// authenticated_client for every non-guest transport, and product_events_trust_level_valid reserves
// that value for bearer and session, so a transport that never passed the assert is reported as
// unknown instead of as the level it was refused for not having.
function toFailureTrustLevel(requestContext: RequestContext | null): string {
  if (requestContext === null || !isProductAnalyticsTransportAccepted(requestContext)) {
    return "unknown";
  }

  return toTrustLevel(requestContext);
}

// x-client-platform is a claim the request makes about itself, so it is matched against the
// client-reportable list rather than the stored platform domain. Matching it against the domain
// would let any request claim `agent`, which no client-origin row can honestly carry, on a route
// that is public and human-authenticated and writes to an append-only table. A header outside the
// list is recorded as absent, exactly as an unparseable app version is.
function readClientPlatform(
  clientPlatform: string | null,
): ProductAnalyticsClientReportablePlatform | null {
  if (clientPlatform === null) {
    return null;
  }

  const platform = clientPlatform.trim().toLowerCase();
  return productAnalyticsClientReportablePlatforms.find(
    (knownPlatform) => knownPlatform === platform,
  ) ?? null;
}

// app_version is retained for the lifetime of the row, so it is bound to a version shape instead of
// storing whatever the header carried. A build string outside that shape is recorded as absent.
function readClientAppVersion(clientAppVersion: string | null): string | null {
  if (clientAppVersion === null) {
    return null;
  }

  const appVersion = clientAppVersion.trim();
  return clientAppVersionPattern.test(appVersion) ? appVersion : null;
}

async function parseProductAnalyticsBody(request: Request): Promise<unknown> {
  return parseJsonBodyWithByteLimit(
    request,
    productAnalyticsJsonBodyMaxBytes,
    "Analytics batch is too large. Send fewer events per request.",
    analyticsBodyTooLargeCode,
  );
}

// An occurred_at_out_of_window rejection means a device clock rather than a client off contract, so
// the two are counted apart on the ingest record: the clock signal is routed to its own alarm and is
// deliberately kept out of Sentry, while every other rejection reason is a broken client release.
// infra/aws/lib/product-analytics-monitoring.ts alarms on the difference directly, so the record
// carries it as its own field: a CloudWatch metric filter can read a field but cannot subtract one
// field from another, and this is the only place that knows the two counts describe the same batch.
function countOutOfWindowRejections(
  rejected: ReadonlyArray<ProductAnalyticsRejectedEvent>,
): number {
  return rejected.filter((event) => event.reason === "occurred_at_out_of_window").length;
}

function toIdentityLinkPairKey(anonymousId: string, userId: string): string {
  return `${anonymousId}|${userId}`;
}

function rememberStoredIdentityLinkPair(pairKey: string): void {
  identityLinkStoredPairs.delete(pairKey);
  if (identityLinkStoredPairs.size >= identityLinkStoredPairsLimit) {
    const oldestPairKey = identityLinkStoredPairs.values().next().value;
    if (oldestPairKey !== undefined) {
      identityLinkStoredPairs.delete(oldestPairKey);
    }
  }

  identityLinkStoredPairs.add(pairKey);
}

// The client never sends an identify call: an authenticated request that already carries the
// device's pre-sign-in id is the link, derived from fields the server trusts on its own. A guest
// request has no account to link the device to yet.
//
// anonymousId is an unverified client value and analytics.identity_links has no way to dedupe a
// value the caller varies on every request, so a link is derived only for a batch that actually
// produced event rows. A body with an empty events array and a fresh random anonymousId therefore
// writes nothing, and an ordinary repeat batch carries no link statement at all.
function createIngestIdentityLink(
  anonymousId: string | null,
  eventRowCount: number,
  requestContext: RequestContext,
): ProductAnalyticsIdentityLink | null {
  if (anonymousId === null || eventRowCount === 0) {
    return null;
  }

  if (requestContext.transport !== "bearer" && requestContext.transport !== "session") {
    return null;
  }

  if (identityLinkStoredPairs.has(toIdentityLinkPairKey(anonymousId, requestContext.userId))) {
    return null;
  }

  return {
    linkId: randomUUID(),
    anonymousId,
    userId: requestContext.userId,
    // The pair is a claim this request carried rather than something the backend watched happen, so
    // it never outranks the link a guest upgrade writes for the same pair.
    source: "authenticated_client",
  };
}

function toProductAnalyticsEventRow(
  event: ValidatedProductAnalyticsEvent,
  validation: ProductAnalyticsBatchValidation,
  requestContext: RequestContext,
  facts: ProductAnalyticsRequestFacts,
  serverReceivedAt: Date,
  requestId: string,
): ProductAnalyticsEventRow {
  return {
    eventId: event.eventId,
    schemaVersion: productAnalyticsSchemaVersion,
    eventName: event.eventName,
    origin: "client",
    backfillId: null,
    clientOccurredAt: event.clientOccurredAt,
    clientSentAt: validation.clientSentAt,
    serverReceivedAt,
    occurredAt: event.occurredAt,
    userId: requestContext.userId,
    subjectUserId: requestContext.subjectUserId,
    authTransport: requestContext.transport,
    trustLevel: toTrustLevel(requestContext),
    guestSessionId: requestContext.guestSessionId,
    workspaceId: requestContext.selectedWorkspaceId,
    anonymousId: validation.anonymousId,
    sessionId: validation.sessionId,
    platform: facts.platform,
    appVersion: facts.appVersion,
    osVersion: validation.context.osVersion,
    deviceModel: validation.context.deviceModel,
    deviceLocale: validation.context.deviceLocale,
    timezone: validation.context.timezone,
    // country stays NULL until a verified edge fronts this API. The API custom domain is regional
    // with nothing in front of it, so a viewer-country header on this request can only have been
    // sent by the client, and 0114 documents the column as resolved by the edge. The table is
    // append-only, so a forged value could never be repaired: a client-sent header must never be
    // trusted for this column.
    country: null,
    networkState: event.networkState,
    screen: event.screen,
    eventProperties: event.properties,
    experimentAssignments: event.experimentAssignments,
    requestId,
    // details records how a row was derived, and a client-origin row was not derived from anything.
    // The ingest path has no field that could set it and must never gain one:
    // product_events_details_client_shape refuses a client row that carries it, and the column
    // survives account anonymization untouched, which is exactly what a client-writable free-form
    // column must never do.
    details: null,
  };
}

// The tighter per-method throttle and all three ProductAnalyticsIngest* alarms hang off the concrete
// /analytics/events resource in infra/aws/lib/gateways/api-gateway.ts, and POST /v1/analytics/events/
// matches none of it: the trailing slash falls through to the /analytics/{proxy+} ANY method, where
// only the stage-wide limit applies and where the alarms, published under the {proxy+} resource
// dimension, cannot see the request at all. This endpoint ships no per-identity rate limiting, so
// that throttle and those alarms are its compensating control and a trailing slash would defeat all
// four at once. This handler is the only layer that sees the raw path, so it serves the exact path
// and refuses the trailing-slash form rather than serving it unthrottled and unmonitored. The
// app-wide strict: false setting stays as it is: changing it would alter routing for every other
// route in the service. It is also why req.path cannot be used here - it is already normalized -
// while the raw request URL still carries the slash the gateway routed on.
function hasTrailingSlashRequestPath(request: Request): boolean {
  return new URL(request.url).pathname.endsWith("/");
}

export function createProductAnalyticsRoutes(options: ProductAnalyticsRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const insertProductAnalyticsClientBatchFn = options.insertProductAnalyticsClientBatchFn
    ?? insertProductAnalyticsClientBatch;

  // Events are written on the request that carried them and nothing is retried inside it: the client
  // owns a durable queue and redelivers, and turning a database hiccup into a long-running Lambda
  // invocation is the failure mode this endpoint exists to avoid.
  app.post("/analytics/events", async (context) => {
    if (hasTrailingSlashRequestPath(context.req.raw)) {
      throw new HttpError(
        404,
        "Not found. Post analytics batches to /v1/analytics/events without a trailing slash.",
        "ANALYTICS_ROUTE_NOT_FOUND",
      );
    }

    const requestId = context.get("requestId");
    const facts: ProductAnalyticsRequestFacts = {
      platform: readClientPlatform(context.get("clientPlatform")),
      appVersion: readClientAppVersion(context.get("clientAppVersion")),
    };
    let requestContext: RequestContext | null = null;
    let validation: ProductAnalyticsBatchValidation | null = null;
    let rejected: ReadonlyArray<ProductAnalyticsRejectedEvent> = [];
    let rows: ReadonlyArray<ProductAnalyticsEventRow> = [];

    try {
      // The one surface a `web` guest credential may reach. Everywhere else the default-deny gate in
      // server/requestContext.ts refuses it, which is what keeps a token every signed-out visitor
      // holds in localStorage from reaching AI quota, sync, or any account surface.
      const loadedContext = await loadRequestContextFromRequestFn(
        context.req.raw,
        options.allowedOrigins,
        { allowWebGuestPlatform: true },
      );
      requestContext = loadedContext.requestContext;
      assertProductAnalyticsTransport(loadedContext.requestContext);

      const body = await parseProductAnalyticsBody(context.req.raw);
      // Stamped here rather than at the top of the handler: this is the anchor every occurred_at in
      // the batch is skew-corrected against, and authentication ahead of it can take seconds on a
      // cold start through Cognito JWKS verification, the profile check, and the session CSRF
      // secret fetch. Stamping before that would shift every row of an append-only table earlier by
      // the whole authentication latency, on the column analytics queries group by.
      const serverReceivedAt = new Date();
      const batch = validateProductAnalyticsBatch(body, serverReceivedAt);
      validation = batch;

      const acceptedEvents: Array<ValidatedProductAnalyticsEvent> = [];
      const rejectedEvents: Array<ProductAnalyticsRejectedEvent> = [...batch.rejected];
      // Keyed by the rejection this check produced rather than by its event id: validation already
      // rejects a repeated event id as duplicate_event_id, and a batch that repeats one non-v7 id
      // carries both rejections for the same id. Keying by id would report the duplicate as a
      // version violation too, which is a wrong reading of the only signal this endpoint produces.
      const versionPinnedRejections = new Set<ProductAnalyticsRejectedEvent>();
      for (const event of batch.accepted) {
        if (isProductAnalyticsEventIdVersionValid(event.eventId)) {
          acceptedEvents.push(event);
          continue;
        }

        const rejection: ProductAnalyticsRejectedEvent = {
          eventId: event.eventId,
          reason: "invalid_event",
        };
        versionPinnedRejections.add(rejection);
        rejectedEvents.push(rejection);
      }

      rejected = rejectedEvents;
      rows = acceptedEvents.map((event) => toProductAnalyticsEventRow(
        event,
        batch,
        loadedContext.requestContext,
        facts,
        serverReceivedAt,
        requestId,
      ));

      const scope = createProductAnalyticsScope(
        requestId,
        context.req.path,
        context.req.method,
        loadedContext.requestContext.userId,
        loadedContext.requestContext.selectedWorkspaceId,
        context.get("clientAppVersion"),
        context.get("clientPlatform"),
      );
      // Adjudication is finished by this point and the capture reads no write state, so it runs
      // before the write rather than after it. A broken client release and a database incident are
      // independent signals, and running this after the write would silence the first for exactly
      // the batches that arrive during the second, which is when both are most wanted.
      captureContractViolations(
        rejected,
        versionPinnedRejections,
        body,
        facts,
        loadedContext.requestContext.transport,
        scope,
      );

      const identityLink = createIngestIdentityLink(
        batch.anonymousId,
        rows.length,
        loadedContext.requestContext,
      );
      const stored = await insertProductAnalyticsClientBatchFn(rows, identityLink);
      if (identityLink !== null) {
        rememberStoredIdentityLinkPair(
          toIdentityLinkPairKey(identityLink.anonymousId, identityLink.userId),
        );
      }

      const outOfWindowCount = countOutOfWindowRejections(rejected);
      addBackendBreadcrumb({
        action: "analytics_events_ingest",
        scope,
        details: {
          statusCode: 200,
          authTransport: loadedContext.requestContext.transport,
          trustLevel: toTrustLevel(loadedContext.requestContext),
          platform: facts.platform,
          appVersion: facts.appVersion,
          eventCount: rows.length + rejected.length,
          acceptedCount: rows.length,
          rejectedCount: rejected.length,
          outOfWindowCount,
          contractRejectedCount: rejected.length - outOfWindowCount,
          storedCount: stored.storedEventCount,
          // null when this batch carried no link statement, false when the pair was already linked.
          identityLinked: identityLink === null ? null : stored.storedIdentityLinkCount > 0,
        },
      });

      return context.json({
        accepted: rows.length,
        rejected,
      } satisfies ProductAnalyticsIngestEnvelope);
    } catch (error) {
      const scope = createProductAnalyticsScope(
        requestId,
        context.req.path,
        context.req.method,
        requestContext === null ? null : requestContext.userId,
        requestContext === null ? null : requestContext.selectedWorkspaceId,
        context.get("clientAppVersion"),
        context.get("clientPlatform"),
      );
      const authTransport = requestContext === null ? "unknown" : requestContext.transport;
      captureBatchViolation(error, facts, authTransport, scope);
      const failedOutOfWindowCount = countOutOfWindowRejections(rejected);
      const details = {
        authTransport,
        trustLevel: toFailureTrustLevel(requestContext),
        platform: facts.platform,
        appVersion: facts.appVersion,
        eventCount: validation === null ? null : validation.accepted.length + validation.rejected.length,
        acceptedCount: rows.length,
        rejectedCount: rejected.length,
        outOfWindowCount: failedOutOfWindowCount,
        contractRejectedCount: rejected.length - failedOutOfWindowCount,
        storedCount: null,
        identityLinked: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "analytics_events_ingest_error", error: normalizeCaughtError(error), scope, details },
        { action: "analytics_events_ingest_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}
