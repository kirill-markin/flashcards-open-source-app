import Foundation
import UIKit

enum FlashcardsObservability {
    static func configure(bundle: Bundle, processInfo: ProcessInfo) {
        startAppUptimeReference(processInfo: processInfo)
        SentryObservabilityAdapter.configure(bundle: bundle, processInfo: processInfo)
    }

    static func setIdentity(_ identity: ObservabilityIdentity?) {
        SentryObservabilityAdapter.setIdentity(identity)
    }

    static func addBreadcrumb(_ event: IOSBreadcrumbEvent) {
        SentryObservabilityAdapter.addBreadcrumb(event)
    }

    static func captureWarning(_ event: IOSWarningEvent) {
        SentryObservabilityAdapter.captureWarning(event)
    }

    static func captureException(_ event: IOSExceptionEvent) {
        SentryObservabilityAdapter.captureException(event)
    }

    @MainActor
    static func startReviewNextCardVisibleSpan(ratedCardId: String) {
        SentryObservabilityAdapter.startReviewNextCardVisibleSpan(ratedCardId: ratedCardId)
    }

    @MainActor
    static func finishReviewNextCardVisibleSpan(shownCardId: String, hasImages: Bool) {
        SentryObservabilityAdapter.finishReviewNextCardVisibleSpan(shownCardId: shownCardId, hasImages: hasImages)
    }

    /// An empty review screen has no next card to measure.
    @MainActor
    static func discardReviewNextCardVisibleSpan() {
        SentryObservabilityAdapter.discardReviewNextCardVisibleSpan()
    }

    static func startReviewAfterRatingWorkSpan(ratedAt: Date) -> ReviewTimingSpan {
        SentryObservabilityAdapter.startReviewAfterRatingWorkSpan(ratedAt: ratedAt)
    }

    static func finishReviewAfterRatingWorkSpan(_ span: ReviewTimingSpan) {
        SentryObservabilityAdapter.finishReviewAfterRatingWorkSpan(span)
    }

    @MainActor
    static func recordReviewReaction(
        action: ReviewReactionLifecycleAction,
        variant: ReviewReactionVariant?,
        source: ReviewReactionSource,
        reason: String
    ) {
        self.addBreadcrumb(.reviewReaction(self.reviewReactionObservation(
            action: action, variant: variant, source: source, reason: reason
        )))
    }

    @MainActor
    static func captureReviewReactionFailure(
        failure: ReviewReactionLottieAssetFailure,
        source: ReviewReactionSource
    ) {
        self.captureWarning(.reviewReactionFailed(ReviewReactionFailureWarning(
            observation: self.reviewReactionObservation(
                action: .skip, variant: failure.variant, source: source, reason: failure.failureReason
            ),
            messageSummary: String(failure.message.prefix(512))
        )))
    }

    @MainActor
    private static func reviewReactionObservation(
        action: ReviewReactionLifecycleAction,
        variant: ReviewReactionVariant?,
        source: ReviewReactionSource,
        reason: String
    ) -> ReviewReactionObservation {
        ReviewReactionObservation(
            action: action,
            variant: variant,
            assetName: variant.flatMap { reviewReactionLottieAssetConfiguration(variant: $0)?.assetName },
            source: source,
            reason: reason,
            isLowPowerModeEnabled: ProcessInfo.processInfo.isLowPowerModeEnabled,
            isReduceMotionEnabled: UIAccessibility.isReduceMotionEnabled
        )
    }

    static func captureSilentFailure(
        error: Error,
        scope: IOSObservationScope,
        action: String,
        stage: String?,
        statusCode: Int?,
        backendCode: String?,
        requestId: String?
    ) {
        self.captureSilentFailure(
            error: error,
            scope: scope,
            action: action,
            stage: stage,
            statusCode: statusCode,
            backendCode: backendCode,
            requestId: requestId,
            transportDiagnostics: nil
        )
    }

    static func captureSilentFailure(
        error: Error,
        scope: IOSObservationScope,
        action: String,
        stage: String?,
        statusCode: Int?,
        backendCode: String?,
        requestId: String?,
        transportDiagnostics: IOSNetworkTransportDiagnostics
    ) {
        self.captureSilentFailure(
            error: error,
            scope: scope,
            action: action,
            stage: stage,
            statusCode: statusCode,
            backendCode: backendCode,
            requestId: requestId,
            transportDiagnostics: .some(transportDiagnostics)
        )
    }

    private static func captureSilentFailure(
        error: Error,
        scope: IOSObservationScope,
        action: String,
        stage: String?,
        statusCode: Int?,
        backendCode: String?,
        requestId: String?,
        transportDiagnostics: IOSNetworkTransportDiagnostics?
    ) {
        self.captureException(
            .silentFailure(
                error: error,
                scope: scope,
                details: SilentFailureDetails(
                    action: action,
                    stage: stage,
                    statusCode: statusCode,
                    backendCode: backendCode,
                    requestId: requestId,
                    messageSummary: Flashcards.errorMessage(error: error),
                    transportDiagnostics: transportDiagnostics
                )
            )
        )
    }
}
