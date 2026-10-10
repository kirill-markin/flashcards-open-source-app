import SwiftUI

extension ReviewView {
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

    func emitReviewReaction(rating: ReviewRating) {
        guard self.isReviewReactionScreenVisible, self.areReviewReactionAnimationsEnabled, self.scenePhase == .active else { return }
        let reactionRating = makeReviewReactionRating(rating: rating)
        let readyVariants: Set<ReviewReactionVariant> = self.reviewReactionLottieAssetStore.readyVariants
        let totalWeight: Int = reviewReactionReadyVariantTotalWeight(
            rating: reactionRating,
            readyVariants: readyVariants
        )
        guard totalWeight > 0 else {
            FlashcardsObservability.recordReviewReaction(
                action: .skip, variant: nil, source: .review, reason: "no_ready_asset"
            )
            return
        }
        guard let variant: ReviewReactionVariant = selectReadyReviewReactionVariant(
            rating: reactionRating,
            readyVariants: readyVariants,
            roll: Int.random(in: 0..<totalWeight)
        ) else {
            return
        }

        let event = ReviewReactionEvent(
            id: UUID(),
            rating: reactionRating,
            variant: variant
        )
        self.dismissActiveReviewReactions(reason: "replacement")
        self.activeReviewReactionEvents = [event]
    }

    func dismissActiveReviewReactions(reason: String) {
        for event in self.activeReviewReactionEvents {
            FlashcardsObservability.recordReviewReaction(
                action: .cancel, variant: event.variant, source: .review, reason: reason
            )
        }
        self.activeReviewReactionEvents = []
    }

    func removeFinishedReviewReactionEvent(
        eventId: UUID, action: ReviewReactionLifecycleAction, reason: String
    ) {
        guard let event = self.activeReviewReactionEvents.first(where: { $0.id == eventId }) else { return }
        FlashcardsObservability.recordReviewReaction(
            action: action, variant: event.variant, source: .review, reason: reason
        )
        self.activeReviewReactionEvents.removeAll { $0.id == eventId }
    }

    func submitReview(cardId: String, rating: ReviewRating) {
        do {
            try store.enqueueReviewSubmission(cardId: cardId, rating: rating)
            // An enqueued rating ends this presentation, even if the card returns next.
            self.isAnswerVisible = false
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
            let tagsSummary = try store.loadWorkspaceTagsSummary()
            self.reviewTagSummaries = tagsSummary.tags
            self.totalCardsCount = tagsSummary.totalCards
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = ""
            store.presentTechnicalError(error)
        }
    }

    func refreshPreparedRevealStates(reviewQueue: [Card]) async {
        let now = Date()
        let currentCard = currentReviewCard(reviewQueue: reviewQueue)
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

        self.preparedRevealState = currentPreparedRevealStatePreparation?.state
        self.preparedNextRevealState = nextPreparedNextRevealStatePreparation?.state
        if let technicalError = currentPreparedRevealStatePreparation?.technicalError {
            store.presentTechnicalError(technicalError)
        }
    }

    func cachedPreparedRevealState(card: Card) -> PreparedReviewRevealState? {
        let preparedRevealStateId = makePreparedReviewRevealStateId(
            card: card,
            schedulerSettings: store.schedulerSettings
        )

        if let preparedRevealState, preparedRevealState.id == preparedRevealStateId {
            return preparedRevealState
        }
        if let preparedNextRevealState, preparedNextRevealState.id == preparedRevealStateId {
            return preparedNextRevealState
        }

        return nil
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
