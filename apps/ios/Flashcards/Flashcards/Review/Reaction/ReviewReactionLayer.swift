import Foundation
import Lottie
import OSLog
import SwiftUI
import UIKit

private let reviewReactionAnimationMinimumIntervalSeconds: Double = 1.0 / 60.0
private let reviewReactionLottieReducedMotionProgress: AnimationProgressTime = 0.55
private let reviewReactionLottieFallbackVariant: ReviewReactionVariant = .fallbackCrownBounce
private let reviewReactionLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "review_reactions"
)

private struct ReviewReactionLottieAssetConfiguration {
    let variant: ReviewReactionVariant
    let assetName: String
    let assetDescription: String
    let frameScale: CGFloat
    let centerX: CGFloat
    let centerY: CGFloat
}

private struct ReviewReactionLottieConfiguration {
    let animation: LottieAnimation
    let frameScale: CGFloat
    let centerX: CGFloat
    let centerY: CGFloat
    let reducedMotionProgress: AnimationProgressTime
}

private typealias ReviewReactionLottieAnimationStore = [ReviewReactionVariant: LottieAnimation]

private let reviewReactionLottieAssetConfigurations: [ReviewReactionLottieAssetConfiguration] = [
    ReviewReactionLottieAssetConfiguration(
        variant: .againRainCloud,
        assetName: "ReviewAgainRainCloud",
        assetDescription: "rain cloud",
        frameScale: 0.62,
        centerX: 0.50,
        centerY: 0.44
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againTornado,
        assetName: "ReviewAgainTornado",
        assetDescription: "tornado",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.45
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againWindFace,
        assetName: "ReviewAgainWindFace",
        assetDescription: "wind face",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.45
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againSnowflake,
        assetName: "ReviewAgainSnowflake",
        assetDescription: "snowflake",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.45
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againSnailCrawl,
        assetName: "ReviewAgainSnail",
        assetDescription: "snail",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againTurtle,
        assetName: "ReviewAgainTurtle",
        assetDescription: "turtle",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againWiltedFlower,
        assetName: "ReviewAgainWiltedFlower",
        assetDescription: "wilted flower",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againSpider,
        assetName: "ReviewAgainSpider",
        assetDescription: "spider",
        frameScale: 0.54,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againRat,
        assetName: "ReviewAgainRat",
        assetDescription: "rat",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againWormWiggle,
        assetName: "ReviewAgainWorm",
        assetDescription: "worm",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.52
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardTiger,
        assetName: "ReviewHardTiger",
        assetDescription: "tiger",
        frameScale: 0.62,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardTRex,
        assetName: "ReviewHardTRex",
        assetDescription: "t rex",
        frameScale: 0.62,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardShark,
        assetName: "ReviewHardShark",
        assetDescription: "shark",
        frameScale: 0.62,
        centerX: 0.50,
        centerY: 0.47
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardOxCharge,
        assetName: "ReviewHardOx",
        assetDescription: "ox",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardRacehorseGallop,
        assetName: "ReviewHardRacehorse",
        assetDescription: "racehorse",
        frameScale: 0.62,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardSnake,
        assetName: "ReviewHardSnake",
        assetDescription: "snake",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardVolcanoEruption,
        assetName: "ReviewHardVolcano",
        assetDescription: "volcano",
        frameScale: 0.64,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardScorpion,
        assetName: "ReviewHardScorpion",
        assetDescription: "scorpion",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardPawPrints,
        assetName: "ReviewHardPawPrints",
        assetDescription: "paw prints",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardRooster,
        assetName: "ReviewHardRooster",
        assetDescription: "rooster",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodOtter,
        assetName: "ReviewGoodOtter",
        assetDescription: "otter",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodOwl,
        assetName: "ReviewGoodOwl",
        assetDescription: "owl",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodRabbit,
        assetName: "ReviewGoodRabbit",
        assetDescription: "rabbit",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.47
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodSeal,
        assetName: "ReviewGoodSeal",
        assetDescription: "seal",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.47
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodServiceDog,
        assetName: "ReviewGoodServiceDog",
        assetDescription: "service dog",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.47
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodPoodle,
        assetName: "ReviewGoodPoodle",
        assetDescription: "poodle",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.43
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodChimpanzee,
        assetName: "ReviewGoodChimpanzee",
        assetDescription: "chimpanzee",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.46
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodWhale,
        assetName: "ReviewGoodWhale",
        assetDescription: "whale",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodPeacock,
        assetName: "ReviewGoodPeacock",
        assetDescription: "peacock",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodPig,
        assetName: "ReviewGoodPig",
        assetDescription: "pig",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easySunrise,
        assetName: "ReviewEasySunrise",
        assetDescription: "sunrise",
        frameScale: 0.64,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easySunriseOverMountains,
        assetName: "ReviewEasySunriseOverMountains",
        assetDescription: "sunrise over mountains",
        frameScale: 0.64,
        centerX: 0.50,
        centerY: 0.44
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyRoseBloom,
        assetName: "ReviewEasyRose",
        assetDescription: "rose",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyPeace,
        assetName: "ReviewEasyPeace",
        assetDescription: "peace",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyPlant,
        assetName: "ReviewEasyPlant",
        assetDescription: "plant",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyRainbowStreak,
        assetName: "ReviewEasyRainbow",
        assetDescription: "rainbow",
        frameScale: 0.64,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyPhoenixRise,
        assetName: "ReviewEasyPhoenix",
        assetDescription: "phoenix",
        frameScale: 0.64,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyUnicornFlyby,
        assetName: "ReviewEasyUnicorn",
        assetDescription: "unicorn",
        frameScale: 0.52,
        centerX: 0.56,
        centerY: 0.30
    )
]

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
    var animationStore: ReviewReactionLottieAnimationStore = [:]
    for assetConfiguration in reviewReactionLottieAssetConfigurations {
        if let animation = makeReviewReactionLottieAnimation(
            assetName: assetConfiguration.assetName,
            assetDescription: assetConfiguration.assetDescription
        ) {
            animationStore[assetConfiguration.variant] = animation
        }
    }

    return animationStore
}

private func reviewReactionFallbackEvent(event: ReviewReactionEvent) -> ReviewReactionEvent {
    ReviewReactionEvent(
        id: event.id,
        rating: event.rating,
        variant: reviewReactionLottieFallbackVariant
    )
}

private func isReviewReactionLottieVariant(variant: ReviewReactionVariant) -> Bool {
    reviewReactionLottieAssetConfigurations.contains { assetConfiguration in
        assetConfiguration.variant == variant
    }
}

private func reviewReactionLottieConfiguration(
    variant: ReviewReactionVariant,
    animationStore: ReviewReactionLottieAnimationStore
) -> ReviewReactionLottieConfiguration? {
    guard let assetConfiguration = reviewReactionLottieAssetConfigurations.first(where: { configuration in
        configuration.variant == variant
    }) else {
        return nil
    }
    guard let animation = animationStore[variant] else {
        return nil
    }

    return ReviewReactionLottieConfiguration(
        animation: animation,
        frameScale: assetConfiguration.frameScale,
        centerX: assetConfiguration.centerX,
        centerY: assetConfiguration.centerY,
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
    @State private var hasStartedReviewReactionLottiePreload: Bool = false
    @State private var reviewReactionLottieAnimationStore: ReviewReactionLottieAnimationStore = [:]

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
