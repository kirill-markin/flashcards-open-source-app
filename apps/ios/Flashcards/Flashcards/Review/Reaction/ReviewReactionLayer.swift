import Foundation
import Lottie
import SwiftUI

struct ReviewReactionLayer: View {
    @Environment(\.accessibilityReduceMotion) private var isReduceMotionEnabled

    let events: [ReviewReactionEvent]
    let lottieAssetStore: ReviewReactionLottieAssetStore
    let source: ReviewReactionSource
    let onEventFinished: (UUID, ReviewReactionLifecycleAction, String) -> Void

    @State private var reportedConfigurationFailures: Set<ReviewReactionVariant> = []

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                ForEach(self.events.suffix(1)) { event in
                    if let configuration = reviewReactionLottieAssetConfiguration(variant: event.variant),
                       let animation = self.lottieAssetStore.readyAnimations[event.variant],
                       animation.duration.isFinite, animation.duration > 0,
                       configuration.frameScale.isFinite, configuration.frameScale > 0 {
                        ReviewReactionLottieView(
                            event: event,
                            animation: animation,
                            frameScale: configuration.frameScale,
                            isReduceMotionEnabled: self.isReduceMotionEnabled,
                            source: self.source,
                            onEventFinished: self.onEventFinished
                        )
                        .id(event.id)
                    } else {
                        Color.clear.task(id: event.id) {
                            self.skipUnusableEvent(event: event)
                        }
                    }
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onDisappear {
            for event in self.events {
                self.onEventFinished(event.id, .cancel, "presentation_disappeared")
            }
        }
    }

    private func skipUnusableEvent(event: ReviewReactionEvent) {
        let status: ReviewReactionLottieAssetStatus = reviewReactionLottieAssetStatus(
            variant: event.variant, readiness: self.lottieAssetStore.readiness
        )
        let reason: String
        if status == .pending {
            reason = "asset_pending"
        } else if let failure = self.lottieAssetStore.failedAssets[event.variant] {
            reason = failure.failureReason
        } else {
            reason = "missing_or_invalid_presentation_configuration"
            if self.reportedConfigurationFailures.insert(event.variant).inserted {
                FlashcardsObservability.captureReviewReactionFailure(
                    failure: makeReviewReactionConfigurationFailure(
                        variant: event.variant, reason: reason,
                        message: "Review reaction requires a decoded bundled animation, positive finite duration and frame scale. Check the asset configuration and readiness."
                    ),
                    source: self.source
                )
            }
        }
        self.onEventFinished(event.id, .skip, reason)
    }
}

private struct ReviewReactionLottieView: View {
    let event: ReviewReactionEvent
    let animation: LottieAnimation
    let frameScale: CGFloat
    let isReduceMotionEnabled: Bool
    let source: ReviewReactionSource
    let onEventFinished: (UUID, ReviewReactionLifecycleAction, String) -> Void

    @State private var opacity: Double = 0
    @State private var hasFinished: Bool = false

    var body: some View {
        GeometryReader { proxy in
            let sideLength: CGFloat = max(min(proxy.size.width, proxy.size.height) * self.frameScale, 1)
            LottieView(animation: self.animation)
                .resizable()
                .animationSpeed(self.animation.duration / self.event.variant.animationDurationSeconds)
                .playbackMode(self.isReduceMotionEnabled
                    ? .paused(at: .progress(0.55))
                    : .playing(.fromProgress(0, toProgress: 1, loopMode: .playOnce)))
                .animationDidFinish { completed in
                    self.finish(
                        action: completed ? .finish : .cancel,
                        reason: completed ? "playback_completed" : "playback_interrupted"
                    )
                }
                .frame(width: sideLength, height: sideLength)
                .position(x: proxy.size.width * reviewReactionCenterX, y: proxy.size.height * reviewReactionCenterY)
                .opacity(self.opacity)
        }
        .onAppear {
            FlashcardsObservability.recordReviewReaction(
                action: .start, variant: self.event.variant, source: self.source,
                reason: self.isReduceMotionEnabled ? "reduced_motion" : "native_playback"
            )
        }
        .task(id: self.isReduceMotionEnabled) {
            let duration: Double = self.isReduceMotionEnabled
                ? ReviewReactionRenderer.reducedMotionDurationSeconds
                : self.event.variant.animationDurationSeconds
            withAnimation(.linear(duration: duration * 0.10)) {
                self.opacity = 1
            }
            do {
                try await Task.sleep(for: .seconds(duration * 0.78))
                withAnimation(.linear(duration: duration * 0.22)) {
                    self.opacity = 0
                }
                try await Task.sleep(for: .seconds(duration * 0.22 + 0.08))
            } catch {
                return
            }
            self.finish(
                action: self.isReduceMotionEnabled ? .finish : .cancel,
                reason: self.isReduceMotionEnabled ? "static_expired" : "cleanup_timeout"
            )
        }
    }

    private func finish(action: ReviewReactionLifecycleAction, reason: String) {
        guard self.hasFinished == false else { return }
        self.hasFinished = true
        self.onEventFinished(self.event.id, action, reason)
    }
}
