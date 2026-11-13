import { reportAnalyticsSustainedDeliveryFailure } from "./observation";

const retryBaseDelayMs = 1000;
const retryMaxDelayMs = 60 * 60 * 1000;
const sustainedFailureWindowMs = 60 * 60 * 1000;

type AnalyticsDeliveryRetryState = Readonly<{
  recordFailure: (statusCode: number, retryAfterMs: number | null) => number;
  getRemainingDelayMs: (nowMs: number) => number | null;
  isWaitingForRetry: (nowMs: number) => boolean;
  isWaitingForServerRetry: (nowMs: number) => boolean;
  clearClientDelayForIdentityTeardown: () => void;
  resetAfterReconnect: () => void;
  reset: () => void;
}>;

function createBackoffDelayMs(failureCount: number): number {
  const exponentialDelayMs = retryBaseDelayMs * 2 ** (failureCount - 1);
  const cappedDelayMs = Math.min(exponentialDelayMs, retryMaxDelayMs);
  return Math.floor(Math.random() * cappedDelayMs);
}

export function createAnalyticsDeliveryRetryState(): AnalyticsDeliveryRetryState {
  let consecutiveFailureCount = 0;
  let firstDeliveryFailureAtMs: number | null = null;
  let lastFailureStatusCode: number | null = null;
  let retryNotBeforeMs = 0;
  // Page hide checks this deadline even after normal backoff resets. Identity teardown uses it
  // only when deciding whether to clear an active normal backoff.
  let serverDirectedRetryNotBeforeMs = 0;

  function trackSustainedDeliveryFailure(statusCode: number): void {
    const nowMs = Date.now();
    if (firstDeliveryFailureAtMs === null) {
      firstDeliveryFailureAtMs = nowMs;
      return;
    }

    if (nowMs - firstDeliveryFailureAtMs > sustainedFailureWindowMs) {
      reportAnalyticsSustainedDeliveryFailure(statusCode);
    }
  }

  function recordFailure(statusCode: number, retryAfterMs: number | null): number {
    if (statusCode === 429 || statusCode >= 500) {
      trackSustainedDeliveryFailure(statusCode);
    }

    consecutiveFailureCount += 1;
    lastFailureStatusCode = statusCode;
    const delayMs = retryAfterMs ?? createBackoffDelayMs(consecutiveFailureCount);
    retryNotBeforeMs = Date.now() + delayMs;
    serverDirectedRetryNotBeforeMs = retryAfterMs === null ? 0 : retryNotBeforeMs;
    return delayMs;
  }

  function isWaitingForRetry(nowMs: number): boolean {
    return nowMs < retryNotBeforeMs;
  }

  function getRemainingDelayMs(nowMs: number): number | null {
    return isWaitingForRetry(nowMs) ? retryNotBeforeMs - nowMs : null;
  }

  function isWaitingForServerRetry(nowMs: number): boolean {
    return nowMs < serverDirectedRetryNotBeforeMs;
  }

  // Teardown can spend its last chance to deliver without waiting for backoff the client chose.
  function clearClientDelayForIdentityTeardown(): void {
    if (isWaitingForRetry(Date.now()) && isWaitingForServerRetry(Date.now()) === false) {
      retryNotBeforeMs = 0;
    }
  }

  function resetAfterReconnect(): void {
    if (lastFailureStatusCode === 0) {
      clearBackoff();
    }
  }

  function clearBackoff(): void {
    consecutiveFailureCount = 0;
    lastFailureStatusCode = null;
    retryNotBeforeMs = 0;
  }

  function reset(): void {
    clearBackoff();
    firstDeliveryFailureAtMs = null;
  }

  return {
    recordFailure,
    getRemainingDelayMs,
    isWaitingForRetry,
    isWaitingForServerRetry,
    clearClientDelayForIdentityTeardown,
    resetAfterReconnect,
    reset,
  };
}
