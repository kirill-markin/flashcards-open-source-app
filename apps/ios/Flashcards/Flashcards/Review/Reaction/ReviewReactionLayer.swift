import Foundation
import Lottie
import SwiftUI

/// Keeps every prepared reaction mounted, hidden and paused at its first frame, so a rating only switches the
/// playback of an existing Lottie view and never builds one in the frame that shows the next card.
struct ReviewReactionLayer: View {
    @Environment(\.accessibilityReduceMotion) private var isReduceMotionEnabled

    let preparedReactions: [ReviewReactionRating: ReviewReactionEvent]
    let playback: ReviewReactionPlayback?
    let lottieAssetStore: ReviewReactionLottieAssetStore
    let source: ReviewReactionSource
    let onPlaybackEnded: (UUID, ReviewReactionLifecycleAction, String) -> Void

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                ForEach(ReviewReactionRating.allCases.compactMap { self.preparedReactions[$0] }) { reaction in
                    // The asset loader admits only animations with a configuration, a positive finite duration
                    // and frame scale, and reports every other asset as a failure.
                    if let configuration = reviewReactionLottieAssetConfiguration(variant: reaction.variant),
                       let animation = self.lottieAssetStore.readyAnimations[reaction.variant] {
                        ReviewReactionLottieView(
                            reaction: reaction,
                            animation: animation,
                            frameScale: configuration.frameScale,
                            startedPlaybackId: self.startedPlaybackId(reaction: reaction),
                            isReduceMotionEnabled: self.isReduceMotionEnabled,
                            source: self.source,
                            onPlaybackEnded: self.onPlaybackEnded
                        )
                        .id(reaction.id)
                    }
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func startedPlaybackId(reaction: ReviewReactionEvent) -> UUID? {
        guard let playback = self.playback, playback.isStarted, playback.reaction?.id == reaction.id else {
            return nil
        }
        return playback.id
    }
}

private struct ReviewReactionLottieView: View {
    let reaction: ReviewReactionEvent
    let animation: LottieAnimation
    let frameScale: CGFloat
    /// `nil` keeps the reaction hidden and paused at its first frame; a stop takes effect in the same frame.
    let startedPlaybackId: UUID?
    let isReduceMotionEnabled: Bool
    let source: ReviewReactionSource
    let onPlaybackEnded: (UUID, ReviewReactionLifecycleAction, String) -> Void

    @State private var opacity: Double = 0

    private var playbackMode: LottiePlaybackMode {
        guard self.startedPlaybackId != nil else {
            return .paused(at: .progress(0))
        }
        return self.isReduceMotionEnabled
            ? .paused(at: .progress(0.55))
            : .playing(.fromProgress(0, toProgress: 1, loopMode: .playOnce))
    }

    var body: some View {
        GeometryReader { proxy in
            let sideLength: CGFloat = max(min(proxy.size.width, proxy.size.height) * self.frameScale, 1)
            // Lottie keeps the completion passed with the playing mode, so it reports that playback's id.
            let playbackId: UUID? = self.startedPlaybackId
            LottieView(animation: self.animation)
                .resizable()
                .animationSpeed(self.animation.duration / self.reaction.variant.animationDurationSeconds)
                .playbackMode(self.playbackMode)
                .animationDidFinish { completed in
                    guard let playbackId else { return }
                    self.onPlaybackEnded(
                        playbackId,
                        completed ? .finish : .cancel,
                        completed ? "playback_completed" : "playback_interrupted"
                    )
                }
                .frame(width: sideLength, height: sideLength)
                .position(x: proxy.size.width * reviewReactionCenterX, y: proxy.size.height * reviewReactionCenterY)
                .opacity(playbackId == nil ? 0 : self.opacity)
        }
        .task(id: self.startedPlaybackId) {
            guard let playbackId = self.startedPlaybackId else {
                self.opacity = 0
                return
            }
            FlashcardsObservability.recordReviewReaction(
                action: .start, variant: self.reaction.variant, source: self.source,
                reason: self.isReduceMotionEnabled ? "reduced_motion" : "native_playback"
            )
            let duration: Double = self.isReduceMotionEnabled
                ? ReviewReactionRenderer.reducedMotionDurationSeconds
                : self.reaction.variant.animationDurationSeconds
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
            self.onPlaybackEnded(
                playbackId,
                self.isReduceMotionEnabled ? .finish : .cancel,
                self.isReduceMotionEnabled ? "static_expired" : "cleanup_timeout"
            )
        }
    }
}
