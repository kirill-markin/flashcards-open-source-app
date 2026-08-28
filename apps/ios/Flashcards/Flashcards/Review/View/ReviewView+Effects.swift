import SwiftUI

extension ReviewView {
    func prewarmReviewReactionLottieAssets() {
        guard self.areReviewReactionAnimationsEnabled else {
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
        let reactionRating = makeReviewReactionRating(rating: rating)
        let availableVariants: Set<ReviewReactionVariant> = self.reviewReactionLottieAssetStore.availableVariants
        let totalWeight: Int = reviewReactionAvailableVariantTotalWeight(
            rating: reactionRating,
            availableVariants: availableVariants
        )
        guard totalWeight > 0 else {
            return
        }
        guard let variant: ReviewReactionVariant = selectAvailableReviewReactionVariant(
            rating: reactionRating,
            availableVariants: availableVariants,
            roll: Int.random(in: 0..<totalWeight)
        ) else {
            return
        }

        let event = ReviewReactionEvent(
            id: UUID(),
            rating: reactionRating,
            variant: variant
        )
        self.activeReviewReactionEvents = appendReviewReactionEvent(
            events: self.activeReviewReactionEvents,
            event: event,
            maximumActiveEvents: reviewReactionMaximumActiveEvents
        )
    }

    func dismissActiveReviewReactions() {
        if self.activeReviewReactionEvents.isEmpty {
            return
        }

        self.activeReviewReactionEvents = []
    }

    func removeFinishedReviewReactionEvent(eventId: UUID) {
        self.activeReviewReactionEvents = self.activeReviewReactionEvents.filter { activeEvent in
            activeEvent.id != eventId
        }
    }

    func submitReview(cardId: String, rating: ReviewRating) {
        do {
            try store.enqueueReviewSubmission(cardId: cardId, rating: rating)
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
            let now = Date()
            let decksSnapshot = try store.loadDecksListSnapshot(now: now)
            let tagsSummary = try store.loadWorkspaceTagsSummary()
            self.reviewDeckSummaries = decksSnapshot.deckSummaries
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
