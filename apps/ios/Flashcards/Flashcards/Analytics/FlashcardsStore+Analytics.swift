import Foundation

@MainActor
extension FlashcardsStore {
    /**
     * The credential the analytics client posts with, read without touching the network.
     *
     * The endpoint accepts `bearer`, `session` and `guest`, and a guest credential is enough, so this
     * prefers the live session and falls back to the stored guest session whatever `cloudState` is —
     * that session is now commonly the credential minted for analytics alone on an install that is not
     * a cloud guest. It deliberately never refreshes a token and never creates one: creation is
     * `mintAnalyticsGuestCredential()`, which the flush reaches only when this read finds nothing.
     *
     * The stored-session read is not side-effect free. It can persist the active cloud session into
     * the credential record, sweep an analytics-only marker that no longer describes it, and drop a
     * record left behind by a different service configuration. Its failures are contained here rather
     * than raised: a flush that cannot answer this question sends nothing and leaves the events
     * queued, which is the same outcome as having no credential at all.
     */
    func analyticsCredentials() -> AnalyticsCredentials? {
        if let activeSession = self.cloudRuntime.activeCloudSession() {
            return AnalyticsCredentials(
                apiBaseUrl: activeSession.apiBaseUrl,
                authorizationHeaderValue: activeSession.authorizationHeaderValue
            )
        }

        guard let storedGuestSession = try? self.loadUsableGuestSessionForCurrentConfiguration() else {
            return nil
        }

        return AnalyticsCredentials(
            apiBaseUrl: storedGuestSession.apiBaseUrl,
            authorizationHeaderValue: CloudAuthorization.guest(storedGuestSession.guestToken).headerValue
        )
    }
}

/// Maps a top-level tab onto the shared, platform-independent surface enum. A native screen name is
/// never sent.
func analyticsSurface(tab: AppTab) -> AnalyticsSurface {
    switch tab {
    case .review:
        return .review
    case .progress:
        return .progress
    case .ai:
        return .ai
    case .cards:
        return .cards
    case .settings:
        return .settings
    }
}

/**
 * Maps a failed review answer onto the shared `review_answer_failed` reasons.
 *
 * Review answers are recorded locally on iOS and reach the backend later through the sync outbox, so
 * the network-flavoured reasons in the shared catalog do not all have a local counterpart. A write
 * blocked by a pending guest upgrade is the one genuine conflict; a transport failure can only reach
 * here through the surrounding refresh; everything else is the catch-all bucket, which on every client
 * means the answer could not be recorded for a reason the user cannot act on.
 */
func analyticsReviewAnswerFailureReason(error: Error) -> AnalyticsReviewAnswerFailureReason {
    if error is PendingGuestUpgradeLocalMutationError {
        return .syncConflict
    }
    if isRetryableNetworkTransportFailure(error: error) {
        return flashcardsURLErrorCode(error: error, remainingDepth: 4) == .timedOut ? .timeout : .offline
    }

    return .serverError
}

/**
 * Maps a failed attachment onto the shared `media_upload_failed` reasons.
 *
 * Both attach paths are entirely local — the asset is written to the draft or to the card and
 * uploaded later by the media upload path, which reports nothing here — so no transport reason can
 * reach this function, and the two reasons a person can act on are taken from the classification the
 * throw site already made rather than from its message.
 *
 * The chat builders name their refusals apart, so an oversized payload is told apart from a file
 * type this client will not take. The card editor's managed-image preparation does not: it raises
 * `LocalStoreError.validation` for an unreadable frame, an animated or multi-page source, an
 * oversized decoded pixel count and a failed encode alike, so all four are counted as
 * `unsupportedType` — the oversized one included, which is the single distinction this client cannot
 * make. Everything else is the catch-all bucket, which here means the attachment could not be
 * completed for a reason the person cannot act on.
 */
func analyticsMediaUploadFailureReason(error: Error) -> AnalyticsMediaUploadFailureReason {
    if let attachmentErrorCode = aiChatAttachmentErrorCode(error: error) {
        switch attachmentErrorCode {
        case .unsupportedType, .imageDimensionsInvalid:
            return .unsupportedType
        case .tooLarge:
            return .tooLarge
        case .imageEncodeFailed:
            return .serverError
        }
    }

    if let storeError = error as? LocalStoreError, case .validation = storeError {
        return .unsupportedType
    }

    return .serverError
}

/**
 * Maps a cloud sync failure onto the shared `sync_failed` reasons. Everything the client can tell
 * apart locally is told apart here; anything else is a server error, which is what the remaining
 * bucket means on all three clients.
 */
func analyticsSyncFailureReason(error: Error) -> AnalyticsSyncFailureReason {
    if isRetryableNetworkTransportFailure(error: error) {
        return flashcardsURLErrorCode(error: error, remainingDepth: 4) == .timedOut ? .timeout : .offline
    }

    guard let syncError = error as? CloudSyncError,
          case .invalidResponse(let details, let statusCode) = syncError else {
        return .serverError
    }

    if details.syncConflict != nil || statusCode == 409 {
        return .conflict
    }
    if statusCode == 401 || statusCode == 403 {
        return .unauthorized
    }
    if statusCode == 408 || statusCode == 504 {
        return .timeout
    }
    if statusCode == 413 || statusCode == 507 {
        return .storageFull
    }

    return .serverError
}

/**
 * Maps a failed dictation attempt onto the shared `dictation_failed` reasons.
 *
 * The recorder errors are the ones only a client can see, which is why the transcription route never
 * reports this event: a microphone refusal and a cancelled recording never reach the server at all.
 * Everything else is told apart by the same retryable-network split
 * `analyticsReviewAnswerFailureReason` and `analyticsSyncFailureReason` use, and lands in
 * `.serverError` when it cannot be. That split is where this mapper stops: it reads no HTTP status,
 * so a gateway timeout the server did answer is `.serverError` here where
 * `analyticsSyncFailureReason` would call it `.timeout`.
 */
func analyticsDictationFailureReason(error: Error) -> AnalyticsDictationFailureReason {
    if error is CancellationError {
        return .cancelled
    }
    if let recorderError = error as? AIChatVoiceRecorderError {
        switch recorderError {
        case .microphoneDenied, .microphoneBlocked:
            return .permissionDenied
        case .emptyRecording:
            return .noSpeech
        case .microphoneUnavailable, .invalidRecording, .recordingStartFailed:
            return .serverError
        }
    }
    if isRetryableNetworkTransportFailure(error: error) {
        return flashcardsURLErrorCode(error: error, remainingDepth: 4) == .timedOut ? .timeout : .offline
    }

    return .serverError
}

/**
 * Maps a sign-in failure onto the shared `signin_failed` reasons, using the backend code where the
 * server named the cause and the local classification otherwise.
 *
 * It deliberately never returns `.cancelled`. That reason means the person walked away from the
 * sign-in surface, which no thrown error can tell us; a transport cancellation is not the same
 * event and would be indistinguishable from an abandonment in the funnel. Every call site already
 * drops cancelled requests through `isRequestCancellationError` before reporting anything.
 */
func analyticsSignInFailureReason(error: Error) -> AnalyticsSignInFailureReason {
    if isRetryableNetworkTransportFailure(error: error) {
        return .offline
    }

    guard let authError = error as? CloudAuthError,
          case .invalidResponse(let details, let statusCode) = authError else {
        return .serverError
    }

    switch details.code {
    case "OTP_CODE_INVALID", "INVALID_EMAIL":
        return .invalidCode
    case "OTP_SESSION_EXPIRED":
        return .expiredCode
    case "OTP_CHALLENGE_CONSUMED":
        return .codeAlreadyUsed
    case "OTP_TOO_MANY_ATTEMPTS":
        return .rateLimited
    default:
        return statusCode == 429 ? .rateLimited : .serverError
    }
}
