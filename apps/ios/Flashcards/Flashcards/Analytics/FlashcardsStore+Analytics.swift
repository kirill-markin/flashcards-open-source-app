import Foundation

@MainActor
extension FlashcardsStore {
    /**
     * The credential the analytics client posts with, read without touching the network.
     *
     * The endpoint accepts `bearer`, `session` and `guest`, and a guest credential is enough, so this
     * prefers the live session and falls back to the stored guest session. It deliberately never
     * refreshes a token and never creates a guest session: analytics must not drive cloud work of its
     * own, and events simply wait in the queue until the app has a credential for its own reasons.
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
 * Maps a sign-in failure onto the shared `signin_failed` reasons, using the backend code where the
 * server named the cause and the local classification otherwise.
 */
func analyticsSignInFailureReason(error: Error) -> AnalyticsSignInFailureReason {
    if isRequestCancellationError(error: error) {
        return .cancelled
    }
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
    case "OTP_SESSION_EXPIRED", "OTP_CHALLENGE_CONSUMED":
        return .expiredCode
    case "OTP_TOO_MANY_ATTEMPTS":
        return .rateLimited
    default:
        return statusCode == 429 ? .rateLimited : .serverError
    }
}
