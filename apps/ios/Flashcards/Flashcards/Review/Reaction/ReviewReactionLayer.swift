import Foundation
import Lottie
import OSLog
import SwiftUI
import UIKit

private let reviewReactionAnimationMinimumIntervalSeconds: Double = 1.0 / 60.0
private let reviewAgainWormAnimationAssetName: String = "ReviewAgainWorm"
private let reviewEasyRainbowAnimationAssetName: String = "ReviewEasyRainbow"
private let reviewEasyUnicornAnimationAssetName: String = "ReviewEasyUnicorn"
private let reviewReactionLottieReducedMotionProgress: AnimationProgressTime = 0.55
private let reviewReactionLottieFallbackVariant: ReviewReactionVariant = .easyCrownBounce
private let reviewReactionLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "review_reactions"
)

private struct ReviewReactionLottieConfiguration {
    let animation: LottieAnimation
    let frameScale: CGFloat
    let centerX: CGFloat
    let centerY: CGFloat
    let reducedMotionProgress: AnimationProgressTime
}

private struct ReviewReactionLottieAnimationStore {
    let reviewAgainWormAnimation: LottieAnimation?
    let reviewEasyRainbowAnimation: LottieAnimation?
    let reviewEasyUnicornAnimation: LottieAnimation?
}

private func makeReviewReactionLottieAnimation(assetName: String, assetDescription: String) -> LottieAnimation? {
    guard let dataAsset: NSDataAsset = NSDataAsset(name: assetName) else {
        reviewReactionLogger.error(
            "Review Lottie data asset is missing. assetName=\(assetName, privacy: .public) assetDescription=\(assetDescription, privacy: .public)"
        )
        return nil
    }

    do {
        return try LottieAnimation.from(data: dataAsset.data)
    } catch {
        let errorMessage: String = String(describing: error)
        reviewReactionLogger.error(
            "Review Lottie asset failed to decode. assetName=\(assetName, privacy: .public) assetDescription=\(assetDescription, privacy: .public) error=\(errorMessage, privacy: .public)"
        )
        return nil
    }
}

private func makeReviewReactionLottieAnimationStore() -> ReviewReactionLottieAnimationStore {
    ReviewReactionLottieAnimationStore(
        reviewAgainWormAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewAgainWormAnimationAssetName,
            assetDescription: "worm"
        ),
        reviewEasyRainbowAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewEasyRainbowAnimationAssetName,
            assetDescription: "rainbow"
        ),
        reviewEasyUnicornAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewEasyUnicornAnimationAssetName,
            assetDescription: "unicorn"
        )
    )
}

private func reviewReactionFallbackEvent(event: ReviewReactionEvent) -> ReviewReactionEvent {
    ReviewReactionEvent(
        id: event.id,
        rating: event.rating,
        variant: reviewReactionLottieFallbackVariant
    )
}

private func isReviewReactionLottieVariant(variant: ReviewReactionVariant) -> Bool {
    switch variant {
    case .againWormWiggle, .easyRainbowStreak, .easyUnicornFlyby:
        return true
    case .againRewindVortex,
         .againStampFlyby,
         .againWarningTape,
         .hardHourglassSand,
         .hardFallingWeight,
         .hardYellowCrack,
         .hardRollingBoulder,
         .goodHandDrawnCheck,
         .goodLightSweep,
         .goodPaperPlaneCheck,
         .goodCheckSealBounce,
         .easySparkleBurst,
         .easyCrownBounce:
        return false
    }
}

private func reviewReactionLottieConfiguration(
    variant: ReviewReactionVariant,
    animationStore: ReviewReactionLottieAnimationStore
) -> ReviewReactionLottieConfiguration? {
    switch variant {
    case .againWormWiggle:
        guard let reviewAgainWormAnimation = animationStore.reviewAgainWormAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewAgainWormAnimation,
            frameScale: 0.58,
            centerX: 0.50,
            centerY: 0.52,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .easyRainbowStreak:
        guard let reviewEasyRainbowAnimation = animationStore.reviewEasyRainbowAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewEasyRainbowAnimation,
            frameScale: 0.64,
            centerX: 0.50,
            centerY: 0.42,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .easyUnicornFlyby:
        guard let reviewEasyUnicornAnimation = animationStore.reviewEasyUnicornAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewEasyUnicornAnimation,
            frameScale: 0.52,
            centerX: 0.56,
            centerY: 0.30,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .againRewindVortex,
         .againStampFlyby,
         .againWarningTape,
         .hardHourglassSand,
         .hardFallingWeight,
         .hardYellowCrack,
         .hardRollingBoulder,
         .goodHandDrawnCheck,
         .goodLightSweep,
         .goodPaperPlaneCheck,
         .goodCheckSealBounce,
         .easySparkleBurst,
         .easyCrownBounce:
        return nil
    }
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
    @State private var hasStartedReviewReactionLottiePreload: Bool = false
    @State private var reviewReactionLottieAnimationStore: ReviewReactionLottieAnimationStore =
        ReviewReactionLottieAnimationStore(
            reviewAgainWormAnimation: nil,
            reviewEasyRainbowAnimation: nil,
            reviewEasyUnicornAnimation: nil
        )

    let events: [ReviewReactionEvent]
    let onEventFinished: (UUID) -> Void

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                ForEach(self.events) { event in
                    ReviewReactionEventView(
                        event: event,
                        animationStore: self.reviewReactionLottieAnimationStore,
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
        .onAppear {
            self.preloadReviewReactionLottieAnimations()
        }
        .onDisappear {
            self.finishActiveEvents()
        }
    }

    private func preloadReviewReactionLottieAnimations() {
        if self.hasStartedReviewReactionLottiePreload {
            return
        }

        self.hasStartedReviewReactionLottiePreload = true
        DispatchQueue.global(qos: .utility).async {
            let animationStore: ReviewReactionLottieAnimationStore = makeReviewReactionLottieAnimationStore()
            DispatchQueue.main.async {
                self.reviewReactionLottieAnimationStore = animationStore
            }
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
    let animationStore: ReviewReactionLottieAnimationStore
    let isReduceMotionEnabled: Bool
    let onEventFinished: (UUID) -> Void

    @State private var shouldUseCrownFallback: Bool

    init(
        event: ReviewReactionEvent,
        animationStore: ReviewReactionLottieAnimationStore,
        isReduceMotionEnabled: Bool,
        onEventFinished: @escaping (UUID) -> Void
    ) {
        self.event = event
        self.animationStore = animationStore
        self.isReduceMotionEnabled = isReduceMotionEnabled
        self.onEventFinished = onEventFinished
        self._shouldUseCrownFallback = State(
            initialValue: isReviewReactionLottieVariant(variant: event.variant)
                && reviewReactionLottieConfiguration(
                    variant: event.variant,
                    animationStore: animationStore
                ) == nil
        )
    }

    var body: some View {
        if isReviewReactionLottieVariant(variant: self.event.variant),
           !self.shouldUseCrownFallback,
           let lottieConfiguration: ReviewReactionLottieConfiguration = reviewReactionLottieConfiguration(
                variant: self.event.variant,
                animationStore: self.animationStore
           ) {
            ReviewReactionLottieView(
                event: self.event,
                isReduceMotionEnabled: self.isReduceMotionEnabled,
                configuration: lottieConfiguration,
                onEventFinished: self.onEventFinished
            )
        } else {
            ReviewReactionCanvas(
                event: self.canvasEvent,
                isReduceMotionEnabled: self.isReduceMotionEnabled,
                onEventFinished: self.onEventFinished
            )
        }
    }

    private var canvasEvent: ReviewReactionEvent {
        if isReviewReactionLottieVariant(variant: self.event.variant) {
            return reviewReactionFallbackEvent(event: self.event)
        }

        return self.event
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
                    .playbackMode(self.playbackMode)
                    .frame(width: sideLength, height: sideLength)
                    .position(
                        x: proxy.size.width * self.configuration.centerX,
                        y: proxy.size.height * self.configuration.centerY
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

    private var playbackMode: LottiePlaybackMode {
        switch self.motionMode {
        case .standard:
            return .playing(.fromProgress(0, toProgress: 1, loopMode: .playOnce))
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
