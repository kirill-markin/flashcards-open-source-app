import { ApiError, ApiNetworkError } from "../api";
import type {
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
