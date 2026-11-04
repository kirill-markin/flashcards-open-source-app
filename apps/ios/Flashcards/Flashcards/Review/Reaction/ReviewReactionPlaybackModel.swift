import Observation
import SwiftUI

/// Read at the refresh itself: gesture cancellation and environment changes must not wait for mirrored state.
struct ReviewReactionPlaybackContext {
    let areAnimationsEnabled: Bool
    let scenePhase: ScenePhase
    let isTouchDown: Bool
}

typealias ReviewReactionPlaybackContextReader = @MainActor () -> ReviewReactionPlaybackContext

@MainActor
@Observable
final class ReviewReactionPlaybackModel {
    private(set) var reviewReactionLottieAssetStore: ReviewReactionLottieAssetStore = makePendingReviewReactionLottieAssetStore()
    private(set) var preparedReviewReactions: [ReviewReactionRating: ReviewReactionEvent] = [:]
    private(set) var activeReviewReactionPlayback: ReviewReactionPlayback? = nil

    @ObservationIgnored private var isScreenVisible: Bool = false
    @ObservationIgnored private var reviewReactionLottiePrewarmTask: Task<Void, Never>?
    @ObservationIgnored private var reviewReactionLottiePrewarmId: UUID?
    @ObservationIgnored private var playedReviewReactionIds: Set<UUID> = []
    @ObservationIgnored private var reviewReactionRatingsToPrepare: Set<ReviewReactionRating> = []
    @ObservationIgnored private var isReviewReactionRefreshWorkScheduled: Bool = false
    /// A rating, stop or touch-up reserves the next refresh for the card or interaction, without a view build.
    @ObservationIgnored private var isReviewReactionNextCardRefreshPending: Bool = false

    func appear(context: @escaping ReviewReactionPlaybackContextReader) {
        self.isScreenVisible = true
        if context().areAnimationsEnabled {
            self.prewarmReviewReactionLottieAssets(context: context)
            self.prepareReviewReactions(context: context)
        }
    }

    func enablementChanged(context: @escaping ReviewReactionPlaybackContextReader) {
        if context().areAnimationsEnabled {
            self.prewarmReviewReactionLottieAssets(context: context)
            self.prepareReviewReactions(context: context)
        } else {
            self.cancelReviewReactionLottiePrewarm()
            self.releaseReviewReactions(reason: "disabled", context: context)
        }
    }

    func scenePhaseChanged(context: @escaping ReviewReactionPlaybackContextReader) {
        let phase: ScenePhase = context().scenePhase
        if phase == .active {
            self.prewarmReviewReactionLottieAssets(context: context)
            self.prepareReviewReactions(context: context)
        } else if phase == .inactive {
            // Mac window focus loss stops playback while retaining prepared views.
            self.cancelReviewReactionLottiePrewarm()
            self.dismissActiveReviewReactions(reason: "scene_inactive", context: context)
        } else {
            self.cancelReviewReactionLottiePrewarm()
            self.releaseReviewReactions(reason: "scene_background", context: context)
        }
    }

    func receiveMemoryWarning(context: @escaping ReviewReactionPlaybackContextReader) {
        self.cancelReviewReactionLottiePrewarm()
        self.releaseReviewReactions(reason: "memory_warning", context: context)
    }

    func disappear(context: @escaping ReviewReactionPlaybackContextReader) {
        self.isScreenVisible = false
        self.cancelReviewReactionLottiePrewarm()
        self.releaseReviewReactions(reason: "screen_disappeared", context: context)
    }

    private func prewarmReviewReactionLottieAssets(context: @escaping ReviewReactionPlaybackContextReader) {
        guard self.canPlayReviewReactions(context: context()) else {
            return
        }
        guard self.reviewReactionLottiePrewarmTask == nil else {
            return
        }
        let pendingVariants: Set<ReviewReactionVariant> = self.reviewReactionLottieAssetStore.pendingVariants
        guard pendingVariants.isEmpty == false else {
            return
        }

        let prewarmId = UUID()
        self.reviewReactionLottiePrewarmId = prewarmId
        self.reviewReactionLottiePrewarmTask = startReviewReactionLottieAssetPrewarm(
            pendingVariants: pendingVariants,
            onLoadResult: { loadResult in
                guard self.reviewReactionLottiePrewarmId == prewarmId else { return }
                if case .failed(let failure) = loadResult,
                   self.reviewReactionLottieAssetStore.failedAssets[failure.variant] == nil {
                    FlashcardsObservability.captureReviewReactionFailure(failure: failure, source: .review)
                }
                self.reviewReactionLottieAssetStore = self.reviewReactionLottieAssetStore.recordingLoadResult(
                    loadResult: loadResult
                )
                self.prepareReviewReactions(context: context)
            },
            onCompletion: {
                self.finishReviewReactionLottiePrewarm(prewarmId: prewarmId)
            }
        )
    }

    private func cancelReviewReactionLottiePrewarm() {
        self.reviewReactionLottiePrewarmTask?.cancel()
        self.reviewReactionLottiePrewarmTask = nil
        self.reviewReactionLottiePrewarmId = nil
    }

    private func finishReviewReactionLottiePrewarm(prewarmId: UUID) {
        guard self.reviewReactionLottiePrewarmId == prewarmId else {
            return
        }

        self.reviewReactionLottiePrewarmTask = nil
        self.reviewReactionLottiePrewarmId = nil
    }

    private func canPlayReviewReactions(context: ReviewReactionPlaybackContext) -> Bool {
        self.isScreenVisible && context.areAnimationsEnabled && context.scenePhase == .active
    }

    /// Queues every fully loaded rating without an unplayed prepared reaction. Runs on appear, enable, scene
    /// activation and asset loads, never on a rating; the queue builds one reaction per display refresh.
    private func prepareReviewReactions(context: @escaping ReviewReactionPlaybackContextReader) {
        guard self.canPlayReviewReactions(context: context()) else { return }
        let pendingVariants: Set<ReviewReactionVariant> = self.reviewReactionLottieAssetStore.pendingVariants
        let ratings: [ReviewReactionRating] = ReviewReactionRating.allCases.filter { rating in
            self.needsPreparedReviewReaction(rating: rating)
                && hasPendingReviewReactionVariant(rating: rating, pendingVariants: pendingVariants) == false
        }
        guard ratings.isEmpty == false else { return }
        self.reviewReactionRatingsToPrepare.formUnion(ratings)
        self.scheduleReviewReactionRefreshWork(context: context)
    }

    /// Marks the rating's reaction to start at the next display refresh, after the frame that shows the next card.
    /// A prepared reaction plays at most once; without an unplayed one, the refresh after that builds a fresh roll
    /// over the loaded variants and plays it slightly late. Every rating schedules the refresh work, so queued
    /// builds resume after its next card even when it plays nothing. Returns whether a reaction was scheduled.
    func scheduleReviewReaction(rating: ReviewRating, context: @escaping ReviewReactionPlaybackContextReader) -> Bool {
        guard self.canPlayReviewReactions(context: context()) else { return false }
        self.isReviewReactionNextCardRefreshPending = true
        self.scheduleReviewReactionRefreshWork(context: context)
        let reactionRating: ReviewReactionRating = makeReviewReactionRating(rating: rating)
        let unplayedReaction: ReviewReactionEvent? = self.preparedReviewReactions[reactionRating].flatMap { reaction in
            self.playedReviewReactionIds.contains(reaction.id) ? nil : reaction
        }
        if unplayedReaction == nil, reviewReactionReadyVariantTotalWeight(
            rating: reactionRating,
            readyVariants: self.reviewReactionLottieAssetStore.readyVariants
        ) == 0 {
            FlashcardsObservability.recordReviewReaction(
                action: .skip, variant: nil, source: .review, reason: "no_ready_asset"
            )
            return false
        }

        self.dismissActiveReviewReactions(reason: "replacement", context: context)
        if let unplayedReaction {
            self.playedReviewReactionIds.insert(unplayedReaction.id)
        }
        self.activeReviewReactionPlayback = ReviewReactionPlayback(
            id: UUID(), rating: reactionRating, reaction: unplayedReaction, isStarted: false
        )
        return true
    }

    /// Hides and pauses the playing reaction in this frame and queues its re-roll for a later refresh, so a tap's
    /// or key's action never waits for a Lottie build.
    func dismissActiveReviewReactions(reason: String, context: @escaping ReviewReactionPlaybackContextReader) {
        guard let playback = self.activeReviewReactionPlayback else { return }
        FlashcardsObservability.recordReviewReaction(
            action: .cancel, variant: playback.reaction?.variant, source: .review, reason: reason
        )
        self.activeReviewReactionPlayback = nil
        self.reviewReactionRatingsToPrepare.insert(playback.rating)
        self.resumeReviewReactionPreparation(context: context)
    }

    /// Runs after a stop and on touch-up: the next refresh builds nothing, so a build never shares the frame that
    /// commits the stop or the interaction's action.
    func resumeReviewReactionPreparation(context: @escaping ReviewReactionPlaybackContextReader) {
        guard self.reviewReactionRatingsToPrepare.isEmpty == false else { return }
        self.isReviewReactionNextCardRefreshPending = true
        self.scheduleReviewReactionRefreshWork(context: context)
    }

    private func releaseReviewReactions(reason: String, context: @escaping ReviewReactionPlaybackContextReader) {
        self.dismissActiveReviewReactions(reason: reason, context: context)
        self.preparedReviewReactions = [:]
        self.playedReviewReactionIds = []
        self.reviewReactionRatingsToPrepare = []
    }

    func finishReviewReactionPlayback(
        playbackId: UUID, action: ReviewReactionLifecycleAction, reason: String,
        context: @escaping ReviewReactionPlaybackContextReader
    ) {
        guard let playback = self.activeReviewReactionPlayback, playback.id == playbackId else { return }
        FlashcardsObservability.recordReviewReaction(
            action: action, variant: playback.reaction?.variant, source: .review, reason: reason
        )
        self.activeReviewReactionPlayback = nil
        self.reviewReactionRatingsToPrepare.insert(playback.rating)
        self.scheduleReviewReactionRefreshWork(context: context)
    }

    /// A rating's view is never replaced while its playback is pending or started.
    private func needsPreparedReviewReaction(rating: ReviewReactionRating) -> Bool {
        guard self.activeReviewReactionPlayback?.rating != rating else { return false }
        guard let reaction = self.preparedReviewReactions[rating] else { return true }
        return self.playedReviewReactionIds.contains(reaction.id)
    }

    private func scheduleReviewReactionRefreshWork(context: @escaping ReviewReactionPlaybackContextReader) {
        guard self.isReviewReactionRefreshWorkScheduled == false else { return }
        self.isReviewReactionRefreshWorkScheduled = true
        performOnNextDisplayRefresh {
            self.performReviewReactionRefreshWork(context: context)
        }
    }

    /// Does one unit of reaction work per display refresh, so building a Lottie view never shares a frame with a
    /// rating's update or with another build: the pending playback starts first, else one queued rating is built.
    /// The refresh that shows a rating's next card only starts a prepared reaction, so the next-card span ends
    /// before any build. While a touch is down nothing is built, so the tap's action never waits; touch-up resumes
    /// the queue.
    private func performReviewReactionRefreshWork(context: @escaping ReviewReactionPlaybackContextReader) {
        self.isReviewReactionRefreshWorkScheduled = false
        let canBuild: Bool = self.isReviewReactionNextCardRefreshPending == false
        self.isReviewReactionNextCardRefreshPending = false
        let currentContext: ReviewReactionPlaybackContext = context()
        guard self.canPlayReviewReactions(context: currentContext) else { return }
        if let playback = self.activeReviewReactionPlayback, playback.isStarted == false {
            if playback.reaction != nil || canBuild {
                self.startReviewReactionPlayback(playback: playback)
            }
        } else if canBuild, currentContext.isTouchDown == false {
            self.buildNextQueuedReviewReaction()
        }
        if self.activeReviewReactionPlayback?.isStarted == false
            || (self.reviewReactionRatingsToPrepare.isEmpty == false && currentContext.isTouchDown == false) {
            self.scheduleReviewReactionRefreshWork(context: context)
        }
    }

    private func startReviewReactionPlayback(playback: ReviewReactionPlayback) {
        let reaction: ReviewReactionEvent
        if let preparedReaction = playback.reaction {
            reaction = preparedReaction
        } else {
            guard let freshReaction = makePreparedReviewReaction(
                rating: playback.rating,
                readyVariants: self.reviewReactionLottieAssetStore.readyVariants
            ) else {
                FlashcardsObservability.recordReviewReaction(
                    action: .skip, variant: nil, source: .review, reason: "no_ready_asset"
                )
                self.activeReviewReactionPlayback = nil
                return
            }
            self.replacePreparedReviewReaction(rating: playback.rating, reaction: freshReaction)
            self.playedReviewReactionIds.insert(freshReaction.id)
            reaction = freshReaction
        }
        self.activeReviewReactionPlayback = ReviewReactionPlayback(
            id: playback.id, rating: playback.rating, reaction: reaction, isStarted: true
        )
    }

    private func buildNextQueuedReviewReaction() {
        let pendingVariants: Set<ReviewReactionVariant> = self.reviewReactionLottieAssetStore.pendingVariants
        for rating in ReviewReactionRating.allCases where self.reviewReactionRatingsToPrepare.contains(rating) {
            self.reviewReactionRatingsToPrepare.remove(rating)
            // A rating with variants still loading is queued again by the asset load that completes it.
            guard self.needsPreparedReviewReaction(rating: rating),
                  hasPendingReviewReactionVariant(rating: rating, pendingVariants: pendingVariants) == false else {
                continue
            }
            self.replacePreparedReviewReaction(
                rating: rating,
                reaction: makePreparedReviewReaction(
                    rating: rating,
                    readyVariants: self.reviewReactionLottieAssetStore.readyVariants
                )
            )
            return
        }
    }

    private func replacePreparedReviewReaction(rating: ReviewReactionRating, reaction: ReviewReactionEvent?) {
        if let previousReaction = self.preparedReviewReactions[rating] {
            self.playedReviewReactionIds.remove(previousReaction.id)
        }
        self.preparedReviewReactions[rating] = reaction
    }
}

/// Preparing ahead before every variant of a rating has loaded would favor the ones that load first; a rating with
/// no prepared reaction still rolls over the loaded ones.
private func hasPendingReviewReactionVariant(
    rating: ReviewReactionRating,
    pendingVariants: Set<ReviewReactionVariant>
) -> Bool {
    reviewReactionVariantDistributionEntries(rating: rating).contains { entry in
        pendingVariants.contains(entry.variant)
    }
}
