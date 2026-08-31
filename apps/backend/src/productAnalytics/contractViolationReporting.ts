import {
  captureBackendWarningWithFingerprint,
  type BackendObservationScope,
} from "../observability/sentry";
import { HttpError } from "../shared/errors";
import {
  findProductAnalyticsEventDefinition,
  isPlainObject,
  type ProductAnalyticsClientReportablePlatform,
} from "./catalog";
import type {
  ProductAnalyticsRejectedEvent,
  ProductAnalyticsRejectionReason,
} from "./types";

// The UUID version requirement itself lives in the catalog module every client mirrors by hand, and
// is enforced in the ingest route because it is the only path that writes a client-supplied event
// id. The frozen rejection union has no member for it, so the client is told invalid_event and
// Sentry is told which check refused it.
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
// validateProductAnalyticsBatch in validation.ts; the body-cap code is raised by the ingest route.
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
  platform: ProductAnalyticsClientReportablePlatform | null;
  appVersion: string | null;
}>;

// The stored version already carries the one shape both surfaces accept, so a header that failed it
// is absent here as well and collapses onto a single fingerprint token.
function toSentryAppVersion(appVersion: string | null): string {
  return appVersion ?? unknownFingerprintValue;
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

export function captureContractViolations(
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

export function captureBatchViolation(
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
