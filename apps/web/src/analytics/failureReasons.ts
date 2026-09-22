import { ApiError, ApiNetworkError } from "../api";
import {
  isChatAttachmentTooLargeError,
  isExpectedImageAttachmentPreparationError,
} from "../chat/attachments/FileAttachment";
import { isChatAttachmentUnsupportedTypeError } from "../chat/attachments/attachmentMediaTypes";
import {
  HeicConverterUnavailableError,
  UnsupportedImagePreparationError,
} from "../media/imagePreparation";
import type {
  AnalyticsDictationFailureReason,
  AnalyticsMediaUploadFailureReason,
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
 * Maps a failed image attachment onto the reasons this client can prove, for both paths that attach
 * one: the chat composer and the card editor.
 *
 * Each refusal a person can act on is raised as a distinct error type, so the classification is read
 * off the type rather than off a message. Everything else is the catch-all bucket, which here means
 * the attachment could not be completed for a reason the person cannot act on.
 */
export function toAnalyticsMediaUploadFailureReason(
  error: unknown,
): AnalyticsMediaUploadFailureReason {
  if (isChatAttachmentTooLargeError(error)) {
    return "too_large";
  }

  // Matched before the refusal it is presented as, and through the cause because the chat composer
  // folds every image preparation failure into one error: a HEIC decoder chunk that would not load
  // says nothing about the picked file and leaves the person nothing to pick instead.
  if (
    error instanceof HeicConverterUnavailableError
    || (error instanceof Error && error.cause instanceof HeicConverterUnavailableError)
  ) {
    return "server_error";
  }

  if (
    isChatAttachmentUnsupportedTypeError(error)
    || isExpectedImageAttachmentPreparationError(error)
    || error instanceof UnsupportedImagePreparationError
  ) {
    return "unsupported_type";
  }

  return "server_error";
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
