import Foundation
import Lottie
import SwiftUI

private let reviewReactionAnimationMinimumIntervalSeconds: Double = 1.0 / 60.0
private let reviewReactionLottieReducedMotionProgress: AnimationProgressTime = 0.55

private struct ReviewReactionLottieConfiguration {
    let animation: LottieAnimation
    let frameScale: CGFloat
    let reducedMotionProgress: AnimationProgressTime
}

private func reviewReactionFallbackEvent(event: ReviewReactionEvent) -> ReviewReactionEvent {
    ReviewReactionEvent(
        id: event.id,
        rating: event.rating,
        variant: reviewReactionLottieFallbackVariant
    )
}

private func reviewReactionLottieConfiguration(
    variant: ReviewReactionVariant,
    assetStore: ReviewReactionLottieAssetStore
) -> ReviewReactionLottieConfiguration? {
    guard let assetConfiguration = reviewReactionLottieAssetConfiguration(variant: variant) else {
        return nil
    }
    guard let animation = assetStore.readyAnimations[variant] else {
        return nil
    }

    return ReviewReactionLottieConfiguration(
        animation: animation,
        frameScale: assetConfiguration.frameScale,
        reducedMotionProgress: reviewReactionLottieReducedMotionProgress
    )
}

@MainActor
private func finishReviewReactionEventAfterDelay(
    event: ReviewReactionEvent,
    motionMode: ReviewReactionMotionMode,
    onEventFinished: (UUID) -> Void
) async {
    do {
        try await Task.sleep(
            nanoseconds: reviewReactionCleanupDelayNanoseconds(
                variant: event.variant,
                motionMode: motionMode
            )
        )
    } catch is CancellationError {
        return
    } catch {
        preconditionFailure("Unexpected review reaction visual cleanup sleep error: \(error).")
    }

    onEventFinished(event.id)
}

struct ReviewReactionLayer: View {
    @Environment(\.accessibilityReduceMotion) private var isReduceMotionEnabled

    let events: [ReviewReactionEvent]
    let lottieAssetStore: ReviewReactionLottieAssetStore
    let onEventFinished: (UUID) -> Void

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                ForEach(self.events) { event in
                    ReviewReactionEventView(
                        event: event,
                        lottieAssetStore: self.lottieAssetStore,
                        isReduceMotionEnabled: self.isReduceMotionEnabled,
                        onEventFinished: self.onEventFinished
                    )
                    .id(event.id)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onDisappear {
            self.finishActiveEvents()
        }
    }

    private func finishActiveEvents() {
        for event in self.events {
            self.onEventFinished(event.id)
        }
    }
}

private struct ReviewReactionEventView: View {
    let event: ReviewReactionEvent
    let lottieAssetStore: ReviewReactionLottieAssetStore
    let isReduceMotionEnabled: Bool
    let onEventFinished: (UUID) -> Void

    var body: some View {
        switch reviewReactionLottieAssetStatus(
            variant: self.event.variant,
            readiness: self.lottieAssetStore.readiness
        ) {
        case .ready:
            ReviewReactionLottieView(
                event: self.event,
                isReduceMotionEnabled: self.isReduceMotionEnabled,
                configuration: self.requiredLottieConfiguration,
                onEventFinished: self.onEventFinished
            )
        case .failed:
            ReviewReactionCanvas(
                event: reviewReactionFallbackEvent(event: self.event),
                isReduceMotionEnabled: self.isReduceMotionEnabled,
                onEventFinished: self.onEventFinished
            )
        case .pending:
            ReviewReactionPendingEventView(
                event: self.event,
                onEventFinished: self.onEventFinished
            )
        case .notLottie:
            ReviewReactionCanvas(
                event: self.event,
                isReduceMotionEnabled: self.isReduceMotionEnabled,
                onEventFinished: self.onEventFinished
            )
        }
    }

    private var requiredLottieConfiguration: ReviewReactionLottieConfiguration {
        guard let configuration: ReviewReactionLottieConfiguration = reviewReactionLottieConfiguration(
            variant: self.event.variant,
            assetStore: self.lottieAssetStore
        ) else {
            preconditionFailure("Ready Review Lottie asset is missing decoded animation for \(self.event.variant.debugIdentifier).")
        }

        return configuration
    }
}

private struct ReviewReactionPendingEventView: View {
    let event: ReviewReactionEvent
    let onEventFinished: (UUID) -> Void

    var body: some View {
        Color.clear
            .task(id: self.event.id) {
                await MainActor.run {
                    self.onEventFinished(self.event.id)
                }
            }
    }
}

private struct ReviewReactionLottieView: View {
    let event: ReviewReactionEvent
    let isReduceMotionEnabled: Bool
    let configuration: ReviewReactionLottieConfiguration
    let onEventFinished: (UUID) -> Void

    @State private var startedAt: Date = Date()

    var body: some View {
        GeometryReader { proxy in
            TimelineView(.animation(minimumInterval: reviewReactionAnimationMinimumIntervalSeconds)) { timelineContext in
                let progress: CGFloat = self.progress(date: timelineContext.date)
                let sideLength: CGFloat = max(
                    min(proxy.size.width, proxy.size.height) * self.configuration.frameScale,
                    1
                )

                LottieView(animation: self.configuration.animation)
                    .resizable()
                    .playbackMode(self.playbackMode(progress: progress))
                    .frame(width: sideLength, height: sideLength)
                    .position(
                        x: proxy.size.width * reviewReactionCenterX,
                        y: proxy.size.height * reviewReactionCenterY
                    )
                    .opacity(ReviewReactionRenderer.reviewReactionOpacity(progress: progress))
            }
        }
        .task(id: self.event.id) {
            await finishReviewReactionEventAfterDelay(
                event: self.event,
                motionMode: self.motionMode,
                onEventFinished: self.onEventFinished
            )
        }
    }

    private var motionMode: ReviewReactionMotionMode {
        self.isReduceMotionEnabled ? .reduced : .standard
    }

    private func playbackMode(progress: CGFloat) -> LottiePlaybackMode {
        switch self.motionMode {
        case .standard:
            return .paused(at: .progress(AnimationProgressTime(progress)))
        case .reduced:
            return .paused(at: .progress(self.configuration.reducedMotionProgress))
        }
    }

    private func progress(date: Date) -> CGFloat {
        let durationSeconds: Double
        switch self.motionMode {
        case .standard:
            durationSeconds = self.event.variant.animationDurationSeconds
        case .reduced:
            durationSeconds = ReviewReactionRenderer.reducedMotionDurationSeconds
        }

        let elapsedSeconds = date.timeIntervalSince(self.startedAt)
        return ReviewReactionRenderer.reviewReactionClampedProgress(progress: CGFloat(elapsedSeconds / durationSeconds))
    }
}

private struct ReviewReactionCanvas: View {
    let event: ReviewReactionEvent
    let isReduceMotionEnabled: Bool
    let onEventFinished: (UUID) -> Void

    @State private var startedAt: Date = Date()

    var body: some View {
        TimelineView(.animation(minimumInterval: reviewReactionAnimationMinimumIntervalSeconds)) { timelineContext in
            let progress = self.progress(date: timelineContext.date)

            Canvas(rendersAsynchronously: true) { context, size in
                ReviewReactionRenderer.draw(
                    context: context,
                    size: size,
                    event: self.event,
                    progress: progress,
                    motionMode: self.motionMode
                )
            }
        }
        .task(id: self.event.id) {
            await finishReviewReactionEventAfterDelay(
                event: self.event,
                motionMode: self.motionMode,
                onEventFinished: self.onEventFinished
            )
        }
    }

    private var motionMode: ReviewReactionMotionMode {
        self.isReduceMotionEnabled ? .reduced : .standard
    }

    private func progress(date: Date) -> CGFloat {
        let durationSeconds: Double
        switch self.motionMode {
        case .standard:
            durationSeconds = self.event.variant.animationDurationSeconds
        case .reduced:
            durationSeconds = ReviewReactionRenderer.reducedMotionDurationSeconds
        }

        let elapsedSeconds = date.timeIntervalSince(self.startedAt)
        return ReviewReactionRenderer.reviewReactionClampedProgress(progress: CGFloat(elapsedSeconds / durationSeconds))
    }
}
