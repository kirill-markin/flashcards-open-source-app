import Lottie
import SwiftUI
import UIKit

private let reviewReactionAnimationMinimumIntervalSeconds: Double = 1.0 / 60.0
private let reviewEasyUnicornAnimationAssetName: String = "ReviewEasyUnicorn"
private let reviewEasyUnicornAnimationFrameScale: CGFloat = 0.52
private let reviewEasyUnicornAnimationCenterX: CGFloat = 0.56
private let reviewEasyUnicornAnimationCenterY: CGFloat = 0.30
private let reviewEasyUnicornReducedMotionProgress: AnimationProgressTime = 0.55
private let reviewEasyUnicornAnimation: LottieAnimation = makeReviewEasyUnicornAnimation()

private func makeReviewEasyUnicornAnimation() -> LottieAnimation {
    guard let dataAsset = NSDataAsset(name: reviewEasyUnicornAnimationAssetName) else {
        preconditionFailure("Missing ReviewEasyUnicorn data asset for review reaction animation.")
    }

    do {
        return try LottieAnimation.from(data: dataAsset.data)
    } catch {
        preconditionFailure("Unable to decode ReviewEasyUnicorn review reaction animation: \(error).")
    }
}

struct ReviewReactionLayer: View {
    @Environment(\.accessibilityReduceMotion) private var isReduceMotionEnabled

    let events: [ReviewReactionEvent]

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                ForEach(self.events) { event in
                    if event.variant == .easyUnicornFlyby {
                        ReviewReactionLottieView(
                            event: event,
                            isReduceMotionEnabled: self.isReduceMotionEnabled
                        )
                        .id(event.id)
                    } else {
                        ReviewReactionCanvas(
                            event: event,
                            isReduceMotionEnabled: self.isReduceMotionEnabled
                        )
                        .id(event.id)
                    }
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct ReviewReactionLottieView: View {
    let event: ReviewReactionEvent
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

                LottieView(animation: reviewEasyUnicornAnimation)
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
