import Foundation
import Lottie
import OSLog
import SwiftUI
import UIKit

private let reviewReactionAnimationMinimumIntervalSeconds: Double = 1.0 / 60.0
private let reviewEasyUnicornAnimationAssetName: String = "ReviewEasyUnicorn"
private let reviewEasyUnicornAnimationFrameScale: CGFloat = 0.52
private let reviewEasyUnicornAnimationCenterX: CGFloat = 0.56
private let reviewEasyUnicornAnimationCenterY: CGFloat = 0.30
private let reviewEasyUnicornReducedMotionProgress: AnimationProgressTime = 0.55
private let reviewReactionLottieFallbackVariant: ReviewReactionVariant = .easyCrownBounce
private let reviewReactionLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "review_reactions"
)

private func makeReviewEasyUnicornAnimation() -> LottieAnimation? {
    guard let dataAsset: NSDataAsset = NSDataAsset(name: reviewEasyUnicornAnimationAssetName) else {
        reviewReactionLogger.error(
            "Review easy unicorn Lottie data asset is missing. assetName=\(reviewEasyUnicornAnimationAssetName, privacy: .public)"
        )
        return nil
    }

    do {
        return try LottieAnimation.from(data: dataAsset.data)
    } catch {
        let errorMessage: String = String(describing: error)
        reviewReactionLogger.error(
            "Review easy unicorn Lottie asset failed to decode. assetName=\(reviewEasyUnicornAnimationAssetName, privacy: .public) error=\(errorMessage, privacy: .public)"
        )
        return nil
    }
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
    case .easyUnicornFlyby:
        return true
    default:
        return false
    }
}

private func reviewReactionLottieAnimation(
    variant: ReviewReactionVariant,
    reviewEasyUnicornAnimation: LottieAnimation?
) -> LottieAnimation? {
    switch variant {
    case .easyUnicornFlyby:
        return reviewEasyUnicornAnimation
    default:
        return nil
    }
}

struct ReviewReactionLayer: View {
    @Environment(\.accessibilityReduceMotion) private var isReduceMotionEnabled
    @State private var hasStartedReviewEasyUnicornAnimationPreload: Bool = false
    @State private var reviewEasyUnicornAnimation: LottieAnimation?

    let events: [ReviewReactionEvent]

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                ForEach(self.events) { event in
                    ReviewReactionEventView(
                        event: event,
                        reviewEasyUnicornAnimation: self.reviewEasyUnicornAnimation,
                        isReduceMotionEnabled: self.isReduceMotionEnabled
                    )
                    .id(event.id)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear {
            self.preloadReviewEasyUnicornAnimation()
        }
    }

    private func preloadReviewEasyUnicornAnimation() {
        if self.hasStartedReviewEasyUnicornAnimationPreload {
            return
        }

        self.hasStartedReviewEasyUnicornAnimationPreload = true
        DispatchQueue.global(qos: .utility).async {
            let animation: LottieAnimation? = makeReviewEasyUnicornAnimation()
            DispatchQueue.main.async {
                self.reviewEasyUnicornAnimation = animation
            }
        }
    }
}

private struct ReviewReactionEventView: View {
    let event: ReviewReactionEvent
    let reviewEasyUnicornAnimation: LottieAnimation?
    let isReduceMotionEnabled: Bool

    @State private var shouldUseCrownFallback: Bool

    init(
        event: ReviewReactionEvent,
        reviewEasyUnicornAnimation: LottieAnimation?,
        isReduceMotionEnabled: Bool
    ) {
        self.event = event
        self.reviewEasyUnicornAnimation = reviewEasyUnicornAnimation
        self.isReduceMotionEnabled = isReduceMotionEnabled
        self._shouldUseCrownFallback = State(
            initialValue: isReviewReactionLottieVariant(variant: event.variant)
                && reviewReactionLottieAnimation(
                    variant: event.variant,
                    reviewEasyUnicornAnimation: reviewEasyUnicornAnimation
                ) == nil
        )
    }

    var body: some View {
        if isReviewReactionLottieVariant(variant: self.event.variant),
           !self.shouldUseCrownFallback,
           let lottieAnimation: LottieAnimation = reviewReactionLottieAnimation(
                variant: self.event.variant,
                reviewEasyUnicornAnimation: self.reviewEasyUnicornAnimation
           ) {
            ReviewReactionLottieView(
                event: self.event,
                animation: lottieAnimation,
                isReduceMotionEnabled: self.isReduceMotionEnabled
            )
        } else {
            ReviewReactionCanvas(
                event: self.canvasEvent,
                isReduceMotionEnabled: self.isReduceMotionEnabled
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
    let animation: LottieAnimation
    let isReduceMotionEnabled: Bool

    @State private var startedAt: Date = Date()

    var body: some View {
        GeometryReader { proxy in
            TimelineView(.animation(minimumInterval: reviewReactionAnimationMinimumIntervalSeconds)) { timelineContext in
                let progress: CGFloat = self.progress(date: timelineContext.date)
                let sideLength: CGFloat = max(
                    min(proxy.size.width, proxy.size.height) * reviewEasyUnicornAnimationFrameScale,
                    1
                )

                LottieView(animation: self.animation)
                    .resizable()
                    .playbackMode(self.playbackMode)
                    .frame(width: sideLength, height: sideLength)
                    .position(
                        x: proxy.size.width * reviewEasyUnicornAnimationCenterX,
                        y: proxy.size.height * reviewEasyUnicornAnimationCenterY
                    )
                    .opacity(ReviewReactionRenderer.reviewReactionOpacity(progress: progress))
            }
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
            return .paused(at: .progress(reviewEasyUnicornReducedMotionProgress))
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
