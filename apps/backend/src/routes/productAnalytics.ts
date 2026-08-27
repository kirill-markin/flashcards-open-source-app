import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  findProductAnalyticsEventDefinition,
  isPlainObject,
  isProductAnalyticsEventIdVersionValid,
  productAnalyticsPlatforms,
  productAnalyticsSchemaVersion,
  type ProductAnalyticsPlatform,
} from "../productAnalytics/catalog";
import {
  validateProductAnalyticsBatch,
  type ProductAnalyticsBatchValidation,
} from "../productAnalytics/validation";
import { insertProductAnalyticsClientBatch } from "../productAnalytics/writer";
import type {
  ProductAnalyticsEventRow,
  ProductAnalyticsIdentityLink,
  ProductAnalyticsRejectedEvent,
  ProductAnalyticsRejectionReason,
  ProductAnalyticsTrustLevel,
  ValidatedProductAnalyticsEvent,
} from "../productAnalytics/types";
import { HttpError } from "../shared/errors";
import { loadRequestContextFromRequest, type RequestContext } from "../server/requestContext";
import { parseJsonBodyWithByteLimit } from "../server/requestParsing";
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  captureBackendWarningWithFingerprint,
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

// The UUID version requirement itself lives in the catalog module every client mirrors by hand, and
// is enforced here because this is the only path that writes a client-supplied event id. The frozen
// rejection union has no member for it, so the client is told invalid_event and Sentry is told which
// check refused it.
const eventIdNotUuidV7Violation = "event_id_not_uuid_v7";

// Reported to Sentry as a per-event contract violation. occurred_at_out_of_window is deliberately
// absent: a device with a wrong clock is a fleet-wide rate to watch on a CloudWatch alarm, not an
// issue to open per release.
const sentryReportedRejectionReasons: ReadonlySet<ProductAnalyticsRejectionReason> = new Set([
  "invalid_event",
  "event_too_large",
  "unknown_field",
  "server_owned_field",
  "unknown_event_name",
  "server_only_event",
  "missing_screen",
  "too_many_properties",
  "unknown_property",
  "invalid_property",
  "invalid_experiment_assignments",
  "duplicate_event_id",
]);

// A batch that breaks the envelope or the body cap names no single event to blame, so it is
// reported once for the request instead of per event. The envelope code is raised by
// validateProductAnalyticsBatch in apps/backend/src/productAnalytics/validation.ts.
const analyticsInvalidBatchCode = "ANALYTICS_INVALID_BATCH";
const analyticsBodyTooLargeCode = "ANALYTICS_BODY_TOO_LARGE";
const batchViolationsByErrorCode: ReadonlyMap<string, string> = new Map([
  [analyticsInvalidBatchCode, "invalid_batch_envelope"],
  [analyticsBodyTooLargeCode, "batch_body_too_large"],
]);

// One capture per fingerprint per five minutes, kept in the container. Containers are many so the
// protection is partial, but together with the fingerprint it keeps a single broken release from
// turning the path that detects the problem into the problem. Overflow evicts the least recently
// captured fingerprint instead of clearing the map: clearing would lift the throttle from every live
// fingerprint at once, so a caller able to fill the map could reset the throttle at will.
const contractViolationCaptureThrottleMs = 5 * 60 * 1000;
const contractViolationCaptureThrottleMaxFingerprints = 500;
const contractViolationCaptureTimesByFingerprint = new Map<string, number>();

// One request describes a handful of distinct fingerprints at most, because every fingerprint slot
// is drawn from a bounded vocabulary. The cap bounds what a single request can open even when a
// caller crafts a batch specifically to maximize that count, and keeps one request from spending
// the whole container budget below.
const contractViolationCapturesPerRequestLimit = 5;

// The per-fingerprint throttle only suppresses a repeat of a fingerprint it has already seen, so a
// fresh fingerprint always passes it and it bounds nothing a caller can vary. The app version slot
// is filled from a client-sent header, which makes novelty cheap to manufacture. Every Sentry
// capture this route makes therefore claims from one container-wide budget over a rolling window
// first, and that budget is the ceiling: once it is spent the container reports nothing more until
// the window rolls forward, however many distinct fingerprints arrive. Claiming it before the
// per-fingerprint throttle is recorded also keeps a flood from evicting live throttle entries,
// because only a capture that is actually paid for is remembered.
const contractViolationCaptureBudgetWindowMs = 5 * 60 * 1000;
const contractViolationCaptureBudgetPerWindow = 20;
const contractViolationCaptureTimesInWindow: Array<number> = [];

const unknownFingerprintValue = "unknown";

// An undeclared property key is by definition outside the catalog, which makes it client-chosen
// text: putting it in the fingerprint would open one Sentry issue per key a caller invents, which is
// the failure this reporting path exists to prevent. The fingerprint carries a bounded descriptor of
// the key's length band and the value's type instead, and the truncated key travels as a detail so
// every invented key still groups into the same issue.
const sentryPropertyKeyLengthBands: ReadonlyArray<number> = [8, 16, 40];
const sentryPropertyKeyDetailMaxLength = 40;

// An event name outside the catalog is client-chosen text for the same reason, and it is kept out
// of the fingerprint the same way. Its violation is the one case where the catalog name is null by
// definition, so without this detail the warning would name no name at all and could not be acted
// on. A truncated copy travels as a detail while every invented name still groups into one issue.
const sentryEventNameDetailMaxLength = 60;

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

type ProductAnalyticsPropertyDescription = Readonly<{
  propertyKey: string | null;
  propertyKeyShape: string | null;
  propertyType: string | null;
  propertyLength: number | null;
}>;

const undescribedProperty: ProductAnalyticsPropertyDescription = {
  propertyKey: null,
  propertyKeyShape: null,
  propertyType: null,
  propertyLength: null,
};

type ContractViolationCapture = Readonly<{
  fingerprint: readonly [string, ...ReadonlyArray<string>];
  eventName: string | null;
  rawEventName: string | null;
  violation: string;
}> & ProductAnalyticsPropertyDescription;

type ProductAnalyticsRequestFacts = Readonly<{
  platform: ProductAnalyticsPlatform | null;
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

function readClientPlatform(clientPlatform: string | null): ProductAnalyticsPlatform | null {
  if (clientPlatform === null) {
    return null;
  }

  const platform = clientPlatform.trim().toLowerCase();
  return productAnalyticsPlatforms.find((knownPlatform) => knownPlatform === platform) ?? null;
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

// The stored version already carries the one shape both surfaces accept, so a header that failed it
// is absent here as well and collapses onto a single fingerprint token.
function toSentryAppVersion(appVersion: string | null): string {
  return appVersion ?? unknownFingerprintValue;
}

async function parseProductAnalyticsBody(request: Request): Promise<unknown> {
  return parseJsonBodyWithByteLimit(
    request,
    productAnalyticsJsonBodyMaxBytes,
    "Analytics batch is too large. Send fewer events per request.",
    analyticsBodyTooLargeCode,
  );
}

// Rejections name the event they refer to but not its position, so the raw events are indexed once
// by event id to describe a violation without re-running validation.
function indexRawEventsByEventId(body: unknown): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
  const rawEventsByEventId = new Map<string, Readonly<Record<string, unknown>>>();
  if (!isPlainObject(body) || !Array.isArray(body.events)) {
    return rawEventsByEventId;
  }

  const rawEvents: ReadonlyArray<unknown> = body.events;
  for (const rawEvent of rawEvents) {
    if (!isPlainObject(rawEvent) || typeof rawEvent.eventId !== "string") {
      continue;
    }

    const eventId = rawEvent.eventId.toLowerCase();
    if (!rawEventsByEventId.has(eventId)) {
      rawEventsByEventId.set(eventId, rawEvent);
    }
  }

  return rawEventsByEventId;
}

function readCatalogEventName(rawEvent: Readonly<Record<string, unknown>> | undefined): string | null {
  if (rawEvent === undefined || typeof rawEvent.eventName !== "string") {
    return null;
  }

  return findProductAnalyticsEventDefinition(rawEvent.eventName)?.eventName ?? null;
}

function describePropertyKeyShape(propertyKey: string, propertyValue: unknown): string {
  const lengthBand = sentryPropertyKeyLengthBands
    .find((maxLength) => propertyKey.length <= maxLength);
  return `key_len_${lengthBand ?? "over"}_${typeof propertyValue}`;
}

function truncateSentryDetail(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

// Reported only when the catalog did not recognize the name, because a recognized one is already
// reported as eventName. The raw name never reaches the fingerprint, only the detail.
function readRawEventName(rawEvent: Readonly<Record<string, unknown>> | undefined): string | null {
  if (rawEvent === undefined || typeof rawEvent.eventName !== "string") {
    return null;
  }

  return truncateSentryDetail(rawEvent.eventName, sentryEventNameDetailMaxLength);
}

// Only the key, its type, and its length are described. The value never leaves the request: this is
// the path that rejects data for looking like personal data, so carrying it into Sentry would defeat
// the rejection. The offending key is derivable only for an unknown key, because the catalog
// validates a declared property against the whole property object rather than key by key.
function describeUnknownProperty(
  rawEvent: Readonly<Record<string, unknown>> | undefined,
): ProductAnalyticsPropertyDescription {
  const definition = rawEvent === undefined || typeof rawEvent.eventName !== "string"
    ? null
    : findProductAnalyticsEventDefinition(rawEvent.eventName);
  const properties = rawEvent?.properties;
  if (definition === null || !isPlainObject(properties)) {
    return undescribedProperty;
  }

  const unknownPropertyKey = Object.keys(properties)
    .find((propertyKey) => definition.propertyNames.has(propertyKey) === false);
  if (unknownPropertyKey === undefined) {
    return undescribedProperty;
  }

  const propertyValue = properties[unknownPropertyKey];
  return {
    propertyKey: truncateSentryDetail(unknownPropertyKey, sentryPropertyKeyDetailMaxLength),
    propertyKeyShape: describePropertyKeyShape(unknownPropertyKey, propertyValue),
    propertyType: typeof propertyValue,
    propertyLength: typeof propertyValue === "string" ? propertyValue.length : null,
  };
}

// A million violations from one broken release collapse into one issue with a count, and a new
// release opens a new issue. Every slot is drawn from a bounded vocabulary: an event name outside
// the catalog and a property key outside the catalog are both client-chosen text, so neither reaches
// the fingerprint as written.
function createContractViolationCapture(
  rejected: ProductAnalyticsRejectedEvent,
  violation: string,
  rawEvent: Readonly<Record<string, unknown>> | undefined,
  facts: ProductAnalyticsRequestFacts,
): ContractViolationCapture {
  const eventName = readCatalogEventName(rawEvent);
  const rawEventName = eventName === null ? readRawEventName(rawEvent) : null;
  const property = rejected.reason === "unknown_property"
    ? describeUnknownProperty(rawEvent)
    : undescribedProperty;
  return {
    fingerprint: [
      "analytics_contract",
      eventName ?? unknownFingerprintValue,
      violation,
      property.propertyKeyShape ?? unknownFingerprintValue,
      facts.platform ?? unknownFingerprintValue,
      toSentryAppVersion(facts.appVersion),
    ],
    eventName,
    rawEventName,
    violation,
    ...property,
  };
}

function isContractViolationFingerprintThrottled(fingerprintKey: string, nowMs: number): boolean {
  const lastCapturedAtMs = contractViolationCaptureTimesByFingerprint.get(fingerprintKey);
  return lastCapturedAtMs !== undefined
    && nowMs - lastCapturedAtMs < contractViolationCaptureThrottleMs;
}

// The window rolls rather than tumbles: timestamps older than it are dropped before the budget is
// measured, so no window boundary lets a caller spend two windows' worth back to back. The array
// never holds more entries than the budget itself.
function claimContractViolationCaptureBudget(nowMs: number): boolean {
  const windowStartedAtMs = nowMs - contractViolationCaptureBudgetWindowMs;
  while ((contractViolationCaptureTimesInWindow[0] ?? Number.POSITIVE_INFINITY) <= windowStartedAtMs) {
    contractViolationCaptureTimesInWindow.shift();
  }

  if (contractViolationCaptureTimesInWindow.length >= contractViolationCaptureBudgetPerWindow) {
    return false;
  }

  contractViolationCaptureTimesInWindow.push(nowMs);
  return true;
}

function rememberContractViolationCapture(fingerprintKey: string, nowMs: number): void {
  // Re-inserting moves the fingerprint to the end of the map's insertion order, so the first key is
  // always the least recently captured one and eviction never touches a fresher throttle.
  contractViolationCaptureTimesByFingerprint.delete(fingerprintKey);
  if (contractViolationCaptureTimesByFingerprint.size >= contractViolationCaptureThrottleMaxFingerprints) {
    const oldestFingerprintKey = contractViolationCaptureTimesByFingerprint.keys().next().value;
    if (oldestFingerprintKey !== undefined) {
      contractViolationCaptureTimesByFingerprint.delete(oldestFingerprintKey);
    }
  }

  contractViolationCaptureTimesByFingerprint.set(fingerprintKey, nowMs);
}

// Every Sentry capture this route makes goes through here, the per-event violations and the
// per-batch one alike, so the container budget is a ceiling on all of them together rather than on
// one path. The fingerprint throttle is read first so a suppressed repeat never spends budget, and
// the fingerprint is recorded only once a capture has actually been paid for.
function claimContractViolationCapture(fingerprintKey: string, nowMs: number): boolean {
  if (isContractViolationFingerprintThrottled(fingerprintKey, nowMs)) {
    return false;
  }

  if (!claimContractViolationCaptureBudget(nowMs)) {
    return false;
  }

  rememberContractViolationCapture(fingerprintKey, nowMs);
  return true;
}

function captureContractViolations(
  rejected: ReadonlyArray<ProductAnalyticsRejectedEvent>,
  versionPinnedRejections: ReadonlySet<ProductAnalyticsRejectedEvent>,
  body: unknown,
  facts: ProductAnalyticsRequestFacts,
  authTransport: string,
  scope: BackendObservationScope,
): void {
  const reportable = rejected.filter((event) => sentryReportedRejectionReasons.has(event.reason));
  if (reportable.length === 0) {
    return;
  }

  const rawEventsByEventId = indexRawEventsByEventId(body);
  const capturesByFingerprint = new Map<string, ContractViolationCapture>();
  const occurrencesByFingerprint = new Map<string, number>();
  for (const event of reportable) {
    const rawEvent = event.eventId === null ? undefined : rawEventsByEventId.get(event.eventId);
    const violation = versionPinnedRejections.has(event) ? eventIdNotUuidV7Violation : event.reason;
    const capture = createContractViolationCapture(event, violation, rawEvent, facts);
    const fingerprintKey = capture.fingerprint.join("|");
    capturesByFingerprint.set(fingerprintKey, capture);
    occurrencesByFingerprint.set(fingerprintKey, (occurrencesByFingerprint.get(fingerprintKey) ?? 0) + 1);
  }

  const nowMs = Date.now();
  let capturedCount = 0;
  for (const [fingerprintKey, capture] of capturesByFingerprint) {
    if (capturedCount >= contractViolationCapturesPerRequestLimit) {
      break;
    }

    if (!claimContractViolationCapture(fingerprintKey, nowMs)) {
      continue;
    }

    capturedCount += 1;
    captureBackendWarningWithFingerprint({
      action: "analytics_contract_violation",
      scope,
      details: {
        eventName: capture.eventName,
        rawEventName: capture.rawEventName,
        violation: capture.violation,
        propertyKey: capture.propertyKey,
        propertyKeyShape: capture.propertyKeyShape,
        propertyType: capture.propertyType,
        propertyLength: capture.propertyLength,
        platform: facts.platform,
        appVersion: facts.appVersion,
        authTransport,
        occurrenceCount: occurrencesByFingerprint.get(fingerprintKey) ?? 1,
      },
    }, capture.fingerprint);
  }
}

function captureBatchViolation(
  error: unknown,
  facts: ProductAnalyticsRequestFacts,
  authTransport: string,
  scope: BackendObservationScope,
): void {
  const violation = error instanceof HttpError && error.code !== null
    ? batchViolationsByErrorCode.get(error.code)
    : undefined;
  if (violation === undefined) {
    return;
  }

  const fingerprint = [
    "analytics_contract",
    unknownFingerprintValue,
    violation,
    unknownFingerprintValue,
    facts.platform ?? unknownFingerprintValue,
    toSentryAppVersion(facts.appVersion),
  ] as const;
  if (!claimContractViolationCapture(fingerprint.join("|"), Date.now())) {
    return;
  }

  captureBackendWarningWithFingerprint({
    action: "analytics_contract_violation",
    scope,
    details: {
      eventName: null,
      rawEventName: null,
      violation,
      propertyKey: null,
      propertyKeyShape: null,
      propertyType: null,
      propertyLength: null,
      platform: facts.platform,
      appVersion: facts.appVersion,
      authTransport,
      occurrenceCount: 1,
    },
  }, fingerprint);
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
      const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
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
          outOfWindowCount: rejected
            .filter((event) => event.reason === "occurred_at_out_of_window").length,
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
      const details = {
        authTransport,
        trustLevel: toFailureTrustLevel(requestContext),
        platform: facts.platform,
        appVersion: facts.appVersion,
        eventCount: validation === null ? null : validation.accepted.length + validation.rejected.length,
        acceptedCount: rows.length,
        rejectedCount: rejected.length,
        outOfWindowCount: rejected.filter((event) => event.reason === "occurred_at_out_of_window").length,
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
