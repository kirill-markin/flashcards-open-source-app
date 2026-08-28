import type { AnalyticsWireBatch } from "../../analytics/events";
import { webAppVersion } from "../../clientIdentity";
import { requestGuestJson, requestJson, type RequestOptions } from "../transport/transport";

export type AnalyticsIngestResult = Readonly<{
  acceptedCount: number;
  rejectedCount: number;
}>;

/**
 * Which credential a batch is authenticated with. The ingest endpoint always requires one, and it
 * accepts both: a signed-in browser posts on its shared session cookie, and a signed-out visitor who
 * has interacted posts on the guest token issued for this browser.
 */
export type AnalyticsRequestCredential =
  | Readonly<{ kind: "session" }>
  | Readonly<{ kind: "guest"; guestToken: string }>;

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
  credential: AnalyticsRequestCredential,
): Promise<AnalyticsIngestResult> {
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "X-Client-Platform": "web",
      "X-Client-Version": webAppVersion,
    },
    body: JSON.stringify(batch),
  };
  const payload = credential.kind === "guest"
    ? await requestGuestJson("/analytics/events", requestInit, credential.guestToken, analyticsRequestOptions)
    : await requestJson("/analytics/events", requestInit, analyticsRequestOptions);

  if (typeof payload.value !== "object" || payload.value === null || Array.isArray(payload.value)) {
    return { acceptedCount: 0, rejectedCount: 0 };
  }

  const { accepted, rejected } = payload.value as Readonly<{ accepted?: unknown; rejected?: unknown }>;
  return {
    acceptedCount: readEventCount(accepted),
    rejectedCount: readRejectedCount(rejected),
  };
}
