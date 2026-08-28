import {
  captureWebException,
  captureWebWarning,
  normalizeCaughtError,
  type AnalyticsDeliveryWarningDetails,
  type WebObservationScope,
} from "../observability/webObservability";
import { AnalyticsQueueError } from "./queue";

/**
 * Reports only what the server cannot see. Per-event rejections are deliberately not reported: the
 * ingest endpoint already captures contract violations with cross-client grouping, and the loss is
 * carried into the data itself by `analytics_events_dropped`. Ordinary offline and transient network
 * failures are expected behavior and are not reported either.
 */

type AnalyticsWarningKind = AnalyticsDeliveryWarningDetails["eventName"];

// Every report in this file is capped at one per session. Analytics failure modes are sticky rather
// than one-off — an unusable IndexedDB stays unusable for the whole session — and the periodic flush
// timer would otherwise turn a single unavailable store into a report a minute, forever.
const reportedKeys = new Set<string>();

function shouldReportOnceInSession(reportKey: string): boolean {
  if (reportedKeys.has(reportKey)) {
    return false;
  }

  reportedKeys.add(reportKey);
  return true;
}

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildAnalyticsObservationScope(statusCode: number | null): WebObservationScope {
  return {
    app: "web",
    feature: "analytics",
    userId: null,
    workspaceId: null,
    installationId: null,
    route: getCurrentRoute(),
    requestId: null,
    statusCode,
    code: null,
  };
}

function captureOnceInSession(
  eventName: AnalyticsWarningKind,
  count: number | null,
  statusCode: number | null,
): void {
  if (shouldReportOnceInSession(eventName) === false) {
    return;
  }

  captureWebWarning({
    action: "analytics_delivery_degraded",
    scope: buildAnalyticsObservationScope(statusCode),
    details: { eventName, count, statusCode },
  });
}

export function reportAnalyticsQueueOverflow(count: number): void {
  captureOnceInSession("analytics_queue_overflow", count, null);
}

export function reportAnalyticsQueueTtlExpiry(count: number): void {
  captureOnceInSession("analytics_queue_ttl_expired", count, null);
}

/**
 * Undelivered events dropped by an identity reset. The catalog's `analytics_events_dropped` cannot
 * carry this loss: its `reason` is a frozen enum of `queue_overflow`, `ttl_expired` and `rejected`,
 * and reusing `rejected` for a local discard would corrupt the one signal that reports server-side
 * refusals. Observability is therefore the only place this loss can be made visible.
 */
export function reportAnalyticsQueueDiscardedOnReset(count: number): void {
  captureOnceInSession("analytics_queue_discarded_on_reset", count, null);
}

/** A whole-batch refusal means this client is off contract and is losing every event it sends. */
export function reportAnalyticsInvalidBatch(statusCode: number): void {
  captureOnceInSession("analytics_batch_invalid", null, statusCode);
}

export function reportAnalyticsSustainedDeliveryFailure(statusCode: number): void {
  captureOnceInSession("analytics_delivery_unavailable", null, statusCode);
}

/**
 * The guest identity this browser measured under could not be bound to the account that signed in.
 * The server sees the refusal, but not that the client gave up on it, and the cost is invisible in
 * the data: that person's signed-out tail stays attributed to the guest.
 */
export function reportAnalyticsGuestIdentityLinkFailure(statusCode: number | null): void {
  captureOnceInSession("analytics_guest_identity_link_failed", null, statusCode);
}

/**
 * The local queue failing to open, write, or read back is invisible everywhere else. Keyed by
 * operation so each distinct failure is still reported once, while a store that is unusable for the
 * whole session — a private window, blocked site data, an exhausted quota — reports a handful of
 * exceptions instead of one per periodic flush.
 */
export function reportAnalyticsQueueFailure(error: unknown): void {
  if (error instanceof AnalyticsQueueError === false) {
    return;
  }

  if (shouldReportOnceInSession(`analytics_queue_failed:${error.operation}`) === false) {
    return;
  }

  captureWebException({
    action: "analytics_queue_failed",
    error: normalizeCaughtError(error),
    scope: buildAnalyticsObservationScope(null),
    details: {
      operation: error.operation,
      indexedDbErrorName: error.indexedDbErrorName,
    },
  });
}
