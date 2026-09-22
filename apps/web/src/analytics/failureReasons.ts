import { ApiError, ApiNetworkError } from "../api";
import type {
  AnalyticsDictationFailureReason,
  AnalyticsReviewAnswerFailureReason,
  AnalyticsSyncFailureReason,
} from "./events";

/**
 * Maps a caught failure onto the catalog's closed reason vocabulary. The vocabulary is shared with
 * iOS and Android, so the mapping stays on transport-level facts every client can observe.
 */

function isBrowserOffline(): boolean {
  return navigator.onLine === false;
}

function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

export function toAnalyticsSyncFailureReason(error: unknown): AnalyticsSyncFailureReason {
  if (isQuotaExceededError(error)) {
    return "storage_full";
  }

  if (error instanceof ApiNetworkError) {
    return isBrowserOffline() ? "offline" : "timeout";
  }

  if (error instanceof ApiError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return "unauthorized";
    }

    if (error.statusCode === 409) {
      return "conflict";
    }

    if (error.statusCode === 408 || error.statusCode === 504) {
      return "timeout";
    }

    return "server_error";
  }

  return isBrowserOffline() ? "offline" : "server_error";
}

/**
 * Maps a failed dictation attempt onto the shared `dictation_failed` reasons.
 *
 * The `DOMException` branches are the ones only a client can see, which is why the transcription
 * route never reports this event: a refused microphone and an aborted recording never reach the
 * server. `no_speech` has no branch here because an empty recording throws nothing — the composer
 * observes an empty blob and reports that reason directly.
 *
 * The fallthrough is `server_error` outright, where the two neighbouring mappers —
 * `toAnalyticsSyncFailureReason` and `toAnalyticsReviewAnswerFailureReason` — first ask whether the
 * browser is offline. Everything that reaches this one without being an `ApiError` is a local
 * recorder or validation failure, and connectivity does not make one of those a network failure;
 * the transport is already told apart above.
 */
export function toAnalyticsDictationFailureReason(error: unknown): AnalyticsDictationFailureReason {
  if (error instanceof DOMException) {
    if (error.name === "AbortError") {
      return "cancelled";
    }

    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "permission_denied";
    }
  }

  if (error instanceof ApiNetworkError) {
    return isBrowserOffline() ? "offline" : "timeout";
  }

  if (error instanceof ApiError && (error.statusCode === 408 || error.statusCode === 504)) {
    return "timeout";
  }

  return "server_error";
}

export function toAnalyticsReviewAnswerFailureReason(
  error: unknown,
): AnalyticsReviewAnswerFailureReason {
  if (error instanceof ApiNetworkError) {
    return isBrowserOffline() ? "offline" : "timeout";
  }

  if (error instanceof ApiError) {
    if (error.statusCode === 409) {
      return "sync_conflict";
    }

    if (error.statusCode === 408 || error.statusCode === 504) {
      return "timeout";
    }

    return "server_error";
  }

  return isBrowserOffline() ? "offline" : "server_error";
}
