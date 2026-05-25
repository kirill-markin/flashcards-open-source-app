import Foundation
import Lottie
import OSLog
import SwiftUI
import UIKit

private let reviewReactionAnimationMinimumIntervalSeconds: Double = 1.0 / 60.0
private let reviewAgainWiltedFlowerAnimationAssetName: String = "ReviewAgainWiltedFlower"
private let reviewAgainWormAnimationAssetName: String = "ReviewAgainWorm"
private let reviewAgainTornadoAnimationAssetName: String = "ReviewAgainTornado"
private let reviewAgainSnailAnimationAssetName: String = "ReviewAgainSnail"
private let reviewGoodOwlAnimationAssetName: String = "ReviewGoodOwl"
private let reviewGoodPoodleAnimationAssetName: String = "ReviewGoodPoodle"
private let reviewGoodWhaleAnimationAssetName: String = "ReviewGoodWhale"
private let reviewGoodPeacockAnimationAssetName: String = "ReviewGoodPeacock"
private let reviewHardOxAnimationAssetName: String = "ReviewHardOx"
private let reviewHardPawPrintsAnimationAssetName: String = "ReviewHardPawPrints"
private let reviewHardRacehorseAnimationAssetName: String = "ReviewHardRacehorse"
private let reviewHardVolcanoAnimationAssetName: String = "ReviewHardVolcano"
private let reviewEasyRoseAnimationAssetName: String = "ReviewEasyRose"
private let reviewEasyRainbowAnimationAssetName: String = "ReviewEasyRainbow"
private let reviewEasyPhoenixAnimationAssetName: String = "ReviewEasyPhoenix"
private let reviewEasyUnicornAnimationAssetName: String = "ReviewEasyUnicorn"
private let reviewReactionLottieReducedMotionProgress: AnimationProgressTime = 0.55
private let reviewReactionLottieFallbackVariant: ReviewReactionVariant = .fallbackCrownBounce
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
    let reviewAgainWiltedFlowerAnimation: LottieAnimation?
    let reviewAgainWormAnimation: LottieAnimation?
    let reviewAgainTornadoAnimation: LottieAnimation?
    let reviewAgainSnailAnimation: LottieAnimation?
    let reviewGoodOwlAnimation: LottieAnimation?
    let reviewGoodPoodleAnimation: LottieAnimation?
    let reviewGoodWhaleAnimation: LottieAnimation?
    let reviewGoodPeacockAnimation: LottieAnimation?
    let reviewHardOxAnimation: LottieAnimation?
    let reviewHardPawPrintsAnimation: LottieAnimation?
    let reviewHardRacehorseAnimation: LottieAnimation?
    let reviewHardVolcanoAnimation: LottieAnimation?
    let reviewEasyRoseAnimation: LottieAnimation?
    let reviewEasyRainbowAnimation: LottieAnimation?
    let reviewEasyPhoenixAnimation: LottieAnimation?
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
        reviewAgainWiltedFlowerAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewAgainWiltedFlowerAnimationAssetName,
            assetDescription: "wilted flower"
        ),
        reviewAgainWormAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewAgainWormAnimationAssetName,
            assetDescription: "worm"
        ),
        reviewAgainTornadoAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewAgainTornadoAnimationAssetName,
            assetDescription: "tornado"
        ),
        reviewAgainSnailAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewAgainSnailAnimationAssetName,
            assetDescription: "snail"
        ),
        reviewGoodOwlAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewGoodOwlAnimationAssetName,
            assetDescription: "owl"
        ),
        reviewGoodPoodleAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewGoodPoodleAnimationAssetName,
            assetDescription: "poodle"
        ),
        reviewGoodWhaleAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewGoodWhaleAnimationAssetName,
            assetDescription: "whale"
        ),
        reviewGoodPeacockAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewGoodPeacockAnimationAssetName,
            assetDescription: "peacock"
        ),
        reviewHardOxAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewHardOxAnimationAssetName,
            assetDescription: "ox"
        ),
        reviewHardPawPrintsAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewHardPawPrintsAnimationAssetName,
            assetDescription: "paw prints"
        ),
        reviewHardRacehorseAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewHardRacehorseAnimationAssetName,
            assetDescription: "racehorse"
        ),
        reviewHardVolcanoAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewHardVolcanoAnimationAssetName,
            assetDescription: "volcano"
        ),
        reviewEasyRoseAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewEasyRoseAnimationAssetName,
            assetDescription: "rose"
        ),
        reviewEasyRainbowAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewEasyRainbowAnimationAssetName,
            assetDescription: "rainbow"
        ),
        reviewEasyPhoenixAnimation: makeReviewReactionLottieAnimation(
            assetName: reviewEasyPhoenixAnimationAssetName,
            assetDescription: "phoenix"
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
    case .againWormWiggle,
         .againTornado,
         .againSnailCrawl,
         .againWiltedFlower,
         .goodOwl,
         .goodPoodle,
         .goodWhale,
         .goodPeacock,
         .hardOxCharge,
         .hardPawPrints,
         .hardRacehorseGallop,
         .hardVolcanoEruption,
         .easyRoseBloom,
         .easyRainbowStreak,
         .easyPhoenixRise,
         .easyUnicornFlyby:
        return true
    case .fallbackCrownBounce:
        return false
    }
}

private func reviewReactionLottieConfiguration(
    variant: ReviewReactionVariant,
    animationStore: ReviewReactionLottieAnimationStore
) -> ReviewReactionLottieConfiguration? {
    switch variant {
    case .againWiltedFlower:
        guard let reviewAgainWiltedFlowerAnimation = animationStore.reviewAgainWiltedFlowerAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewAgainWiltedFlowerAnimation,
            frameScale: 0.56,
            centerX: 0.50,
            centerY: 0.50,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
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
    case .againTornado:
        guard let reviewAgainTornadoAnimation = animationStore.reviewAgainTornadoAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewAgainTornadoAnimation,
            frameScale: 0.58,
            centerX: 0.50,
            centerY: 0.45,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .againSnailCrawl:
        guard let reviewAgainSnailAnimation = animationStore.reviewAgainSnailAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewAgainSnailAnimation,
            frameScale: 0.58,
            centerX: 0.50,
            centerY: 0.48,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .goodOwl:
        guard let reviewGoodOwlAnimation = animationStore.reviewGoodOwlAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewGoodOwlAnimation,
            frameScale: 0.56,
            centerX: 0.50,
            centerY: 0.42,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .goodPoodle:
        guard let reviewGoodPoodleAnimation = animationStore.reviewGoodPoodleAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewGoodPoodleAnimation,
            frameScale: 0.56,
            centerX: 0.50,
            centerY: 0.43,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .goodWhale:
        guard let reviewGoodWhaleAnimation = animationStore.reviewGoodWhaleAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewGoodWhaleAnimation,
            frameScale: 0.58,
            centerX: 0.50,
            centerY: 0.42,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .goodPeacock:
        guard let reviewGoodPeacockAnimation = animationStore.reviewGoodPeacockAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewGoodPeacockAnimation,
            frameScale: 0.58,
            centerX: 0.50,
            centerY: 0.42,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .hardOxCharge:
        guard let reviewHardOxAnimation = animationStore.reviewHardOxAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewHardOxAnimation,
            frameScale: 0.58,
            centerX: 0.50,
            centerY: 0.50,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .hardPawPrints:
        guard let reviewHardPawPrintsAnimation = animationStore.reviewHardPawPrintsAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewHardPawPrintsAnimation,
            frameScale: 0.56,
            centerX: 0.50,
            centerY: 0.50,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .hardRacehorseGallop:
        guard let reviewHardRacehorseAnimation = animationStore.reviewHardRacehorseAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewHardRacehorseAnimation,
            frameScale: 0.62,
            centerX: 0.50,
            centerY: 0.50,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .hardVolcanoEruption:
        guard let reviewHardVolcanoAnimation = animationStore.reviewHardVolcanoAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewHardVolcanoAnimation,
            frameScale: 0.64,
            centerX: 0.50,
            centerY: 0.50,
            reducedMotionProgress: reviewReactionLottieReducedMotionProgress
        )
    case .easyRoseBloom:
        guard let reviewEasyRoseAnimation = animationStore.reviewEasyRoseAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewEasyRoseAnimation,
            frameScale: 0.58,
            centerX: 0.50,
            centerY: 0.50,
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
    case .easyPhoenixRise:
        guard let reviewEasyPhoenixAnimation = animationStore.reviewEasyPhoenixAnimation else {
            return nil
        }

        return ReviewReactionLottieConfiguration(
            animation: reviewEasyPhoenixAnimation,
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
    case .fallbackCrownBounce:
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
            reviewAgainWiltedFlowerAnimation: nil,
            reviewAgainWormAnimation: nil,
            reviewAgainTornadoAnimation: nil,
            reviewAgainSnailAnimation: nil,
            reviewGoodOwlAnimation: nil,
            reviewGoodPoodleAnimation: nil,
            reviewGoodWhaleAnimation: nil,
            reviewGoodPeacockAnimation: nil,
            reviewHardOxAnimation: nil,
            reviewHardPawPrintsAnimation: nil,
            reviewHardRacehorseAnimation: nil,
            reviewHardVolcanoAnimation: nil,
            reviewEasyRoseAnimation: nil,
            reviewEasyRainbowAnimation: nil,
            reviewEasyPhoenixAnimation: nil,
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
                    .playbackMode(self.playbackMode(progress: progress))
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
