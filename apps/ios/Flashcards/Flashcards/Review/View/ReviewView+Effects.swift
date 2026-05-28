import SwiftUI

extension ReviewView {
    func prewarmReviewReactionLottieAssets() {
        if self.hasStartedReviewReactionLottiePrewarm {
            return
        }

        self.hasStartedReviewReactionLottiePrewarm = true
        startReviewReactionLottieAssetPrewarm { loadResult in
            self.reviewReactionLottieAssetStore = self.reviewReactionLottieAssetStore.recordingLoadResult(
                loadResult: loadResult
            )
        }
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
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
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
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
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

        let nextPreparedRevealState = currentCard.map { card in
            makePreparedReviewRevealState(
                card: card,
                schedulerSettings: store.schedulerSettings,
                now: now
            )
        }
        let nextPreparedNextRevealState = nextCard.map { card in
            makePreparedReviewRevealState(
                card: card,
                schedulerSettings: store.schedulerSettings,
                now: now
            )
        }
        if Task.isCancelled {
            return
        }

        self.preparedRevealState = nextPreparedRevealState
        self.preparedNextRevealState = nextPreparedNextRevealState
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
