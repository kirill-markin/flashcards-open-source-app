import type { AnalyticsWireBatch, AnonymousAnalyticsWireEvent } from "../../analytics/events";
import { webAppVersion } from "../../clientIdentity";
import { requestCredentialFreeJson, requestJson, type RequestOptions } from "../transport/transport";

export type AnalyticsIngestResult = Readonly<{
  acceptedCount: number;
  rejectedCount: number;
}>;

/**
 * The answer of `GET /v1/analytics/visitor` (docs/analytics-visitor-identity.md). `consentRequired`
 * means "must this browser be asked before it may be given an identity" on this method only, and
 * `visitorId` is returned whether or not the browser stored the cookie that came with it, so a
 * caller that needs to know whether the identity exists reads the cookie instead of this field.
 */
export type AnalyticsVisitorEnvelope = Readonly<{
  consentRequired: boolean;
  visitorId: string | null;
}>;

/**
 * Analytics runs entirely in the background, so it never joins auth recovery: a batch that meets an
 * expired session must not refresh the session or redirect the browser to sign in. It stays queued
 * and ships on a later flush. Network retries are owned by the analytics client's own backoff.
 */
const analyticsRequestOptions: RequestOptions = {
  authRecoveryMode: "skip",
  networkRetryMode: "none",
  prepareForAuthRedirect: null,
};

// A malformed 200 body still means the server finished the batch, so the payload is read
// defensively rather than through a contract parser that would throw and hold the events back.
function readEventCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function readRejectedCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Posts one analytics batch. The path carries no trailing slash on purpose: `/v1/analytics/events/`
 * answers 404 and misses the endpoint's own API Gateway throttle and alarms.
 *
 * `X-Client-Platform` and `X-Client-Version` are the only source of the append-only `platform` and
 * `app_version` columns, and this repository sets them per endpoint rather than globally.
 */
export async function sendAnalyticsEventsBatch(
  batch: AnalyticsWireBatch,
): Promise<AnalyticsIngestResult> {
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "X-Client-Platform": "web",
      "X-Client-Version": webAppVersion,
    },
    body: JSON.stringify(batch),
  };
  const payload = await requestJson("/analytics/events", requestInit, analyticsRequestOptions);

  if (typeof payload.value !== "object" || payload.value === null || Array.isArray(payload.value)) {
    return { acceptedCount: 0, rejectedCount: 0 };
  }

  const { accepted, rejected } = payload.value as Readonly<{ accepted?: unknown; rejected?: unknown }>;
  return {
    acceptedCount: readEventCount(accepted),
    rejectedCount: readRejectedCount(rejected),
  };
}

/**
 * Asks the backend for this browser's shared analytics visitor identity, whose whole effect is the
 * cookie the answer may carry. An unreadable body is read as consent-required and no identity, the
 * same way the route itself fails closed when it cannot place the caller.
 */
export async function requestAnalyticsVisitor(): Promise<AnalyticsVisitorEnvelope> {
  const payload = await requestJson("/analytics/visitor", { method: "GET" }, analyticsRequestOptions);
  if (typeof payload.value !== "object" || payload.value === null || Array.isArray(payload.value)) {
    return { consentRequired: true, visitorId: null };
  }

  const { consentRequired, visitorId } = payload.value as Readonly<{
    consentRequired?: unknown;
    visitorId?: unknown;
  }>;
  return {
    consentRequired: consentRequired !== false,
    visitorId: typeof visitorId === "string" && visitorId !== "" ? visitorId : null,
  };
}

/**
 * Posts one event to the credential-free collector, which takes one event per request and is
 * origin-restricted rather than authenticated (docs/anonymous-client-analytics.md). A repeated
 * `eventId` is accepted and stores nothing new, so the caller's retry is safe.
 *
 * `keepalive` for the same reason the catalog install journey sets it: a signed-out browser's flush
 * is a serial loop of one request per event, so the page-hide flush — where the closing events of a
 * visit are — would otherwise lose everything still in the loop when the document goes away. One
 * event is far below the 64 KB the browser allows a keepalive body, since the queue itself refuses
 * an event above 4 KB.
 */
export async function sendAnonymousAnalyticsEvent(event: AnonymousAnalyticsWireEvent): Promise<void> {
  await requestCredentialFreeJson("/analytics/anonymous-events", {
    method: "POST",
    keepalive: true,
    body: JSON.stringify(event),
  }, analyticsRequestOptions);
}
