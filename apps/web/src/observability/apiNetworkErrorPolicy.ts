import { ApiNetworkError } from "../api";
import { readLastApiResponseAtMs } from "../api/transport/lastApiResponse";

const apiReachabilityWindowMs = 60_000;
const pageUnloadQuietWindowMs = 10_000;

// A navigation cancels in-flight fetches while the page still reads as visible. `beforeunload` also fires
// for navigations that keep the document (mailto:, downloads), so the quiet period is bounded, and a page
// restored from the back-forward cache reports again.
let pageUnloadStartedAtMs: number | null = null;
function markPageUnloading(): void {
  pageUnloadStartedAtMs = Date.now();
}
window.addEventListener("beforeunload", markPageUnloading);
window.addEventListener("pagehide", markPageUnloading);
window.addEventListener("pageshow", (event: PageTransitionEvent): void => {
  if (event.persisted) {
    pageUnloadStartedAtMs = null;
  }
});

export function isBrowserApiNetworkError(error: Error): error is ApiNetworkError {
  return error instanceof ApiNetworkError;
}

/**
 * A network failure is reported only while the API is demonstrably reachable: no navigation started in the
 * last 10 seconds, the page is visible, the browser is online, and an API response body was read in full
 * within the last minute of this page session. Offline, captive-portal, and navigation- or
 * backgrounding-killed fetches stay out of Sentry; a request the browser blocks on a reachable API, such as
 * a failed CORS preflight, does not. A negative age means the clock moved back, so the response is not
 * treated as recent, while a navigation is still treated as recent.
 */
export function isApiDemonstrablyReachable(): boolean {
  const lastApiResponseAtMs = readLastApiResponseAtMs();
  if (lastApiResponseAtMs === null) {
    return false;
  }

  const nowMs = Date.now();
  if (pageUnloadStartedAtMs !== null && nowMs - pageUnloadStartedAtMs <= pageUnloadQuietWindowMs) {
    return false;
  }

  const lastApiResponseAgeMs = nowMs - lastApiResponseAtMs;
  return document.visibilityState === "visible"
    && navigator.onLine
    && lastApiResponseAgeMs >= 0
    && lastApiResponseAgeMs <= apiReachabilityWindowMs;
}
