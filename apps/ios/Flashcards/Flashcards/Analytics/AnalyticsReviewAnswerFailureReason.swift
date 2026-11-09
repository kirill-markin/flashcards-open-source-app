import Foundation

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
