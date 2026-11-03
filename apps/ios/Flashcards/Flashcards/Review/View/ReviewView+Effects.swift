import SwiftUI

extension ReviewView {
    /// Shows at most one prompt: the first in the config `order` that its config settings and fixed
    /// code rules allow; see apps/backend/src/reviewPrompts/reviewPromptConfig.ts.
    func presentPromptAfterSavedReview(opportunity: SavedReviewPromptOpportunity) async {
        guard self.isSavedReviewPromptOpportunityCurrent(opportunity) else { return }
        let now = Date()
        let config = self.store.activeReviewPromptConfig
        let counters: ReviewPromptCounters
        do {
            counters = try self.store.loadReviewPromptCounters(now: now)
        } catch {
            self.store.captureReviewPromptFailure(error: error, stage: "load_counters")
            return
        }
        for promptId in reviewPromptWalk(config: config) {
            guard let settings = config.prompts[promptId.rawValue] else { continue }
            guard self.isSavedReviewPromptOpportunityCurrent(opportunity) else { return }
            let endsWalk = await self.presentReviewPromptIfDue(
                promptId: promptId,
                settings: settings,
                counters: counters,
                opportunity: opportunity,
                configVersion: config.version,
                now: now
            )
            if endsWalk { return }
        }
    }

    private func isSavedReviewPromptOpportunityCurrent(_ opportunity: SavedReviewPromptOpportunity) -> Bool {
        self.store.savedReviewPromptOpportunity?.id == opportunity.id
            && self.store.workspace?.workspaceId == opportunity.workspaceId
            && self.store.selectedReviewFilter == opportunity.reviewFilter
            && self.canPresentSavedReviewPrompt
    }

    /// `true` ends the walk: the prompt was shown, or its check failed and was reported.
    private func presentReviewPromptIfDue(
        promptId: ReviewPromptId,
        settings: ReviewPromptSettings,
        counters: ReviewPromptCounters,
        opportunity: SavedReviewPromptOpportunity,
        configVersion: String,
        now: Date
    ) async -> Bool {
        switch promptId {
        case .hardReminder:
            return self.store.presentReviewHardReminderIfDue(
                rating: opportunity.rating, settings: settings, counters: counters,
                configVersion: configVersion, now: now
            )
        case .paywallInitial:
            return self.presentReviewPaywallIfDue(
                trigger: .initial, settings: settings, counters: counters, configVersion: configVersion, now: now
            )
        case .paywallSecond:
            return self.presentReviewPaywallIfDue(
                trigger: .day3, settings: settings, counters: counters, configVersion: configVersion, now: now
            )
        case .paywallPeriodic:
            return self.presentReviewPaywallIfDue(
                trigger: .weekly, settings: settings, counters: counters, configVersion: configVersion, now: now
            )
        case .notificationsPrePrompt:
            guard let permissionStatus = await self.store.reviewNotificationPrePromptPermissionStatusIfDue(
                settings: settings, counters: counters, now: now
            ), self.isSavedReviewPromptOpportunityCurrent(opportunity) else { return false }
            self.store.presentReviewNotificationPrePrompt(
                permissionStatus: permissionStatus, configVersion: configVersion, now: now
            )
            return true
        case .ratingRequest:
            return self.store.prepareStoreReviewRequestAttemptIfDue(
                settings: settings, counters: counters, configVersion: configVersion, now: now
            )
        case .guestSignIn:
            return self.store.presentGuestSignInAfterReviewPromptIfDue(
                settings: settings, counters: counters, configVersion: configVersion, now: now
            )
        case .automaticFeedback:
            return self.store.presentAutomaticFeedbackPromptIfDue(settings: settings, counters: counters, now: now)
        }
    }

    private func presentReviewPaywallIfDue(
        trigger: ReviewPaywallTrigger,
        settings: ReviewPromptSettings,
        counters: ReviewPromptCounters,
        configVersion: String,
        now: Date
    ) -> Bool {
        do {
            guard try self.store.isReviewPaywallDue(
                trigger: trigger, settings: settings, counters: counters, now: now
            ) else { return false }
            self.premiumPresenter.present(
                reason: .review(trigger, reviewPromptConfigVersion: configVersion), analyticsEntryPoint: .review,
                entitlement: self.store.cloudEntitlement,
                identity: try self.store.appleSubscriptionIdentity()
            )
            self.store.isPremiumPresentationActive = self.premiumPresenter.request != nil
            return true
        } catch AppleSubscriptionError.accountUnavailable {
            // A local-only installation has no known account entitlement yet.
            return false
        } catch {
            self.store.capturePaywallStateFailure(error: error, stage: "review_eligibility")
            return true
        }
    }

    func prewarmReviewReactionLottieAssets() {
        guard self.isReviewReactionScreenVisible, self.areReviewReactionAnimationsEnabled, self.scenePhase == .active else {
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
                self.prepareReviewReactions()
            },
            onCompletion: {
                self.finishReviewReactionLottiePrewarm(prewarmId: prewarmId)
            }
        )
    }

    func cancelReviewReactionLottiePrewarm() {
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

    private var canPlayReviewReactions: Bool {
        self.isReviewReactionScreenVisible && self.areReviewReactionAnimationsEnabled && self.scenePhase == .active
    }

    /// Queues every fully loaded rating without an unplayed prepared reaction. Runs on appear, enable, scene
    /// activation and asset loads, never on a rating; the queue builds one reaction per display refresh.
    func prepareReviewReactions() {
        guard self.canPlayReviewReactions else { return }
        let pendingVariants: Set<ReviewReactionVariant> = self.reviewReactionLottieAssetStore.pendingVariants
        let ratings: [ReviewReactionRating] = ReviewReactionRating.allCases.filter { rating in
            self.needsPreparedReviewReaction(rating: rating)
                && hasPendingReviewReactionVariant(rating: rating, pendingVariants: pendingVariants) == false
        }
        guard ratings.isEmpty == false else { return }
        self.reviewReactionRatingsToPrepare.formUnion(ratings)
        self.scheduleReviewReactionRefreshWork()
    }

    /// Marks the rating's reaction to start at the next display refresh, after the frame that shows the next card.
    /// A prepared reaction plays at most once; without an unplayed one, the refresh after that builds a fresh roll
    /// over the loaded variants and plays it slightly late. Every rating schedules the refresh work, so queued
    /// builds resume after its next card even when it plays nothing. Returns whether a reaction was scheduled.
    func scheduleReviewReaction(rating: ReviewRating) -> Bool {
        guard self.canPlayReviewReactions else { return false }
        self.isReviewReactionNextCardRefreshPending = true
        self.scheduleReviewReactionRefreshWork()
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

        self.dismissActiveReviewReactions(reason: "replacement")
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
    func dismissActiveReviewReactions(reason: String) {
        guard let playback = self.activeReviewReactionPlayback else { return }
        FlashcardsObservability.recordReviewReaction(
            action: .cancel, variant: playback.reaction?.variant, source: .review, reason: reason
        )
        self.activeReviewReactionPlayback = nil
        self.reviewReactionRatingsToPrepare.insert(playback.rating)
        self.resumeReviewReactionPreparation()
    }

    /// Runs after a stop and on touch-up: the next refresh builds nothing, so a build never shares the frame that
    /// commits the stop or the interaction's action.
    func resumeReviewReactionPreparation() {
        guard self.reviewReactionRatingsToPrepare.isEmpty == false else { return }
        self.isReviewReactionNextCardRefreshPending = true
        self.scheduleReviewReactionRefreshWork()
    }

    func releaseReviewReactions(reason: String) {
        self.dismissActiveReviewReactions(reason: reason)
        self.preparedReviewReactions = [:]
        self.playedReviewReactionIds = []
        self.reviewReactionRatingsToPrepare = []
    }

    func finishReviewReactionPlayback(
        playbackId: UUID, action: ReviewReactionLifecycleAction, reason: String
    ) {
        guard let playback = self.activeReviewReactionPlayback, playback.id == playbackId else { return }
        FlashcardsObservability.recordReviewReaction(
            action: action, variant: playback.reaction?.variant, source: .review, reason: reason
        )
        self.activeReviewReactionPlayback = nil
        self.reviewReactionRatingsToPrepare.insert(playback.rating)
        self.scheduleReviewReactionRefreshWork()
    }

    /// A rating's view is never replaced while its playback is pending or started.
    private func needsPreparedReviewReaction(rating: ReviewReactionRating) -> Bool {
        guard self.activeReviewReactionPlayback?.rating != rating else { return false }
        guard let reaction = self.preparedReviewReactions[rating] else { return true }
        return self.playedReviewReactionIds.contains(reaction.id)
    }

    private func scheduleReviewReactionRefreshWork() {
        guard self.isReviewReactionRefreshWorkScheduled == false else { return }
        self.isReviewReactionRefreshWorkScheduled = true
        performOnNextDisplayRefresh {
            self.performReviewReactionRefreshWork()
        }
    }

    /// Does one unit of reaction work per display refresh, so building a Lottie view never shares a frame with a
    /// rating's update or with another build: the pending playback starts first, else one queued rating is built.
    /// The refresh that shows a rating's next card only starts a prepared reaction, so the next-card span ends
    /// before any build. While a touch is down nothing is built, so the tap's action never waits; touch-up resumes
    /// the queue.
    private func performReviewReactionRefreshWork() {
        self.isReviewReactionRefreshWorkScheduled = false
        let canBuild: Bool = self.isReviewReactionNextCardRefreshPending == false
        self.isReviewReactionNextCardRefreshPending = false
        guard self.canPlayReviewReactions else { return }
        if let playback = self.activeReviewReactionPlayback, playback.isStarted == false {
            if playback.reaction != nil || canBuild {
                self.startReviewReactionPlayback(playback: playback)
            }
        } else if canBuild, self.isReviewReactionTouchDown == false {
            self.buildNextQueuedReviewReaction()
        }
        if self.activeReviewReactionPlayback?.isStarted == false
            || (self.reviewReactionRatingsToPrepare.isEmpty == false && self.isReviewReactionTouchDown == false) {
            self.scheduleReviewReactionRefreshWork()
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

    func submitReview(cardId: String, rating: ReviewRating) {
        do {
            try store.enqueueReviewSubmission(cardId: cardId, rating: rating)
            // An enqueued rating ends this presentation, even if the card returns next.
            self.reviewScreen.endPresentation()
            self.screenErrorMessage = ""
        } catch {
            if let inlineErrorMessage = reviewSubmissionInlineErrorMessage(error: error) {
                self.screenErrorMessage = inlineErrorMessage
            } else {
                self.screenErrorMessage = ""
                store.presentTechnicalError(error)
            }
        }
    }

    func reloadReviewMetadata() async {
        do {
            let database = try requireLocalDatabase(database: store.database)
            let workspaceId = try requireWorkspaceId(workspace: store.workspace)
            // Reads every card tag, so it stays off the main thread; see docs/fsrs-scheduling-logic.md#non-blocking-review.
            let tagsSummary = try await loadWorkspaceTagsSummaryInBackground(
                databaseURL: database.databaseURL,
                workspaceId: workspaceId
            )
            // A newer reload replaced this one while the read ran.
            guard Task.isCancelled == false else {
                return
            }
            self.reviewTagSummaries = tagsSummary.tags
            self.totalCardsCount = tagsSummary.totalCards
            self.screenErrorMessage = ""
        } catch {
            guard Task.isCancelled == false else {
                return
            }
            self.screenErrorMessage = ""
            store.presentTechnicalError(error)
        }
    }

    func refreshPreparedRevealStates(reviewQueue: [Card], presentedCard: Card?) async {
        let now = Date()
        // The retained presentation can differ from the queue while submissions
        // and local edits reconcile. Prepare the same card the view renders.
        let currentCard = presentedCard
        // The card a rating shows is the visible queue head after this one, so this is the card to prepare;
        // every queue change re-prepares it. See docs/fsrs-scheduling-logic.md#non-blocking-review
        let nextCard = nextReviewCard(reviewQueue: reviewQueue)
        if currentCard != nil || nextCard != nil {
            await Task.yield()
        }
        if Task.isCancelled {
            return
        }

        let currentPreparedRevealStatePreparation = currentCard.map { card in
            makePreparedReviewRevealStatePreparation(
                card: card,
                schedulerSettings: store.schedulerSettings,
                now: now
            )
        }
        let nextPreparedNextRevealStatePreparation = nextCard.map { card in
            makePreparedReviewRevealStatePreparation(
                card: card,
                schedulerSettings: store.schedulerSettings,
                now: now
            )
        }
        if Task.isCancelled {
            return
        }

        self.reviewScreen.preparedRevealState = currentPreparedRevealStatePreparation?.state
        self.reviewScreen.preparedNextRevealState = nextPreparedNextRevealStatePreparation?.state
        if let technicalError = currentPreparedRevealStatePreparation?.technicalError {
            store.presentTechnicalError(technicalError)
        }

        // Images follow the text so a slow download never delays the next card's text and answer buttons.
        var currentSides: [ReviewImagePreparationSide] = []
        var imagePreparationSides: [ReviewImagePreparationSide] = []
        if let currentCard, let currentState = currentPreparedRevealStatePreparation?.state {
            let currentBackSide = ReviewImagePreparationSide(cardId: currentCard.cardId, content: currentState.backContent)
            currentSides = [
                ReviewImagePreparationSide(cardId: currentCard.cardId, content: currentState.frontContent),
                currentBackSide
            ]
            imagePreparationSides.append(currentBackSide)
        }
        if let nextCard, let nextState = nextPreparedNextRevealStatePreparation?.state {
            imagePreparationSides.append(ReviewImagePreparationSide(cardId: nextCard.cardId, content: nextState.frontContent))
            imagePreparationSides.append(ReviewImagePreparationSide(cardId: nextCard.cardId, content: nextState.backContent))
        }
        self.reviewScreen.preparedImageCache.retainPreparedImages(for: currentSides)
        self.reviewScreen.preparedImageCache.releaseImagesOutside(sides: currentSides + imagePreparationSides)
        await self.reviewScreen.preparedImageCache.prepareReviewImages(for: imagePreparationSides, store: store)
    }

    /// A card the task has not prepared yet, such as one an edit just changed, builds the same pure state inline
    /// so it never falls back to the loader and keeps its reveal and scroll state; the task still stores it and
    /// presents its technical error. See docs/fsrs-scheduling-logic.md#non-blocking-review.
    func displayedRevealState(card: Card) -> PreparedReviewRevealState {
        let preparedRevealStateId = makePreparedReviewRevealStateId(
            card: card,
            schedulerSettings: store.schedulerSettings
        )

        if let preparedRevealState = self.reviewScreen.preparedRevealState, preparedRevealState.id == preparedRevealStateId {
            return preparedRevealState
        }
        if let preparedNextRevealState = self.reviewScreen.preparedNextRevealState, preparedNextRevealState.id == preparedRevealStateId {
            return preparedNextRevealState
        }

        return makePreparedReviewRevealStatePreparation(
            card: card,
            schedulerSettings: store.schedulerSettings,
            now: Date()
        ).state
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

private func reviewSubmissionInlineErrorMessage(error: Error) -> String? {
    if let localStoreError = error as? LocalStoreError {
        switch localStoreError {
        case .validation:
            return Flashcards.errorMessage(error: error)
        case .database, .notFound, .uninitialized:
            return nil
        }
    }

    if error is PendingGuestUpgradeLocalMutationError {
        return Flashcards.errorMessage(error: error)
    }

    return nil
}
