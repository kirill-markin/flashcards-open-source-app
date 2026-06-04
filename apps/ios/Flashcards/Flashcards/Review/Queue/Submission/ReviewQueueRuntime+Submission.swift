import Foundation

struct ReviewSubmissionRollbackValidationContext: Hashable {
    let currentWorkspaceId: String
    let cards: [Card]
    let decks: [Deck]
    let schedulerSettings: WorkspaceSchedulerSettings?
    let now: Date
}

extension ReviewQueueRuntime {
    mutating func enqueueReviewSubmission(
        publishedState: ReviewQueuePublishedState,
        workspaceId: String,
        cardId: String,
        rating: ReviewRating,
        reviewContext: ReviewSubmissionContext,
        schedulerSettings: WorkspaceSchedulerSettings?
    ) throws -> ReviewQueuePublishedState {
        guard publishedState.pendingReviewCardIds.contains(cardId) == false else {
            throw LocalStoreError.validation("Review submission is already pending for this card")
        }
        guard let cardSnapshot = self.effectiveReviewQueue(publishedState: publishedState).first(where: { card in
            card.cardId == cardId
        }) else {
            throw LocalStoreError.validation("Review submission card is not available in the current review queue")
        }

        let request = ReviewSubmissionRequest(
            id: UUID().uuidString.lowercased(),
            workspaceId: workspaceId,
            cardId: cardId,
            reviewContext: reviewContext,
            reviewSessionSignature: self.makeReviewSubmissionSessionSignature(
                publishedState: publishedState,
                submittedCardId: cardId,
                schedulerSettings: schedulerSettings
            ),
            cardSnapshot: cardSnapshot,
            rating: rating,
            reviewedAtClient: nowIsoTimestamp()
        )
        self.state.pendingReviewRequests.append(request)

        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.insert(cardId)
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: pendingReviewCardIds,
            reviewSubmissionFailure: nil
        )
    }

    mutating func startReviewProcessorIfNeeded() -> Bool {
        guard self.state.isReviewProcessorRunning == false else {
            return false
        }

        self.state.isReviewProcessorRunning = true
        return true
    }

    mutating func finishReviewProcessor() -> Bool {
        self.state.activeReviewProcessorTask = nil
        self.state.isReviewProcessorRunning = false
        return self.state.pendingReviewRequests.isEmpty == false
    }

    mutating func setActiveReviewProcessorTask(task: Task<Void, Never>) {
        self.state.activeReviewProcessorTask = task
    }

    mutating func dequeuePendingReviewRequest() -> ReviewSubmissionRequest? {
        guard self.state.pendingReviewRequests.isEmpty == false else {
            return nil
        }

        return self.state.pendingReviewRequests.removeFirst()
    }

    func reviewSubmissionExecutorUnavailableError() -> Error {
        LocalStoreError.uninitialized("Review submission executor is unavailable")
    }

    func reviewSubmissionRequestMatchesCurrentContext(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> Bool {
        self.isStaleReviewSubmissionContext(
            publishedState: publishedState,
            request: request,
            validationContext: validationContext
        ) == false
    }

    mutating func completeReviewSubmission(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> ReviewQueuePublishedState {
        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.remove(request.cardId)
        if self.isStaleReviewSubmissionContext(
            publishedState: publishedState,
            request: request,
            validationContext: validationContext
        ) {
            return self.makeStaleReviewSubmissionState(
                publishedState: publishedState,
                pendingReviewCardIds: pendingReviewCardIds
            )
        }

        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func completeStaleReviewSubmission(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest
    ) -> ReviewQueuePublishedState {
        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.remove(request.cardId)
        return self.makeStaleReviewSubmissionState(
            publishedState: publishedState,
            pendingReviewCardIds: pendingReviewCardIds
        )
    }

    mutating func failReviewSubmission(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest,
        message: String,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> ReviewQueuePublishedState {
        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.remove(request.cardId)
        if self.isStaleReviewSubmissionContext(
            publishedState: publishedState,
            request: request,
            validationContext: validationContext
        ) {
            return self.makeStaleReviewSubmissionState(
                publishedState: publishedState,
                pendingReviewCardIds: pendingReviewCardIds
            )
        }

        let rollbackCard = validationContext.flatMap { context in
            self.validReviewSubmissionRollbackCard(
                request: request,
                currentWorkspaceId: context.currentWorkspaceId,
                selectedReviewFilter: request.reviewContext.selectedReviewFilter,
                cards: context.cards,
                decks: context.decks,
                pendingReviewCardIds: pendingReviewCardIds,
                now: context.now
            )
        }
        let nextReviewQueue = publishedState.reviewQueue.filter { card in
            card.cardId != request.cardId
        }
        let presentedReviewCard = self.resolvePresentedReviewCard(
            reviewQueue: nextReviewQueue,
            pendingReviewCardIds: pendingReviewCardIds,
            preferredPresentedReviewCard: rollbackCard
        )
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: nextReviewQueue,
            presentedReviewCard: presentedReviewCard,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: pendingReviewCardIds,
            reviewSubmissionFailure: ReviewSubmissionFailure(
                id: request.id,
                message: message
            )
        )
    }

    private func makeReviewSubmissionSessionSignature(
        publishedState: ReviewQueuePublishedState,
        submittedCardId: String,
        schedulerSettings: WorkspaceSchedulerSettings?
    ) -> ReviewSessionSignature {
        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.insert(submittedCardId)
        let postSubmissionState = ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )

        return makeReviewSessionSignature(
            selectedReviewFilter: postSubmissionState.selectedReviewFilter,
            reviewQueue: self.effectiveReviewQueue(publishedState: postSubmissionState),
            schedulerSettings: schedulerSettings,
            seedQueueSize: self.reviewSeedQueueSize
        )
    }

    private func isStaleReviewSubmissionContext(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> Bool {
        if let validationContext, request.workspaceId != validationContext.currentWorkspaceId {
            return true
        }
        guard request.reviewContext.selectedReviewFilter == publishedState.selectedReviewFilter else {
            return true
        }
        guard self.reviewSubmissionSessionMatchesCurrentState(
            publishedState: publishedState,
            request: request,
            validationContext: validationContext
        ) else {
            return true
        }
        guard let validationContext else {
            return false
        }

        let currentReviewContext = makeReviewSubmissionContext(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            decks: validationContext.decks,
            cards: validationContext.cards
        )
        return currentReviewContext != request.reviewContext
    }

    private func reviewSubmissionSessionMatchesCurrentState(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> Bool {
        let currentReviewSessionSignature = makeReviewSessionSignature(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: self.effectiveReviewQueue(publishedState: publishedState),
            schedulerSettings: validationContext?.schedulerSettings,
            seedQueueSize: self.reviewSeedQueueSize
        )
        guard request.reviewSessionSignature.selectedReviewFilter == currentReviewSessionSignature.selectedReviewFilter else {
            return false
        }
        let comparableRequestSeedQueue = self.makeComparableReviewSubmissionSeedQueue(
            request: request,
            pendingReviewCardIds: publishedState.pendingReviewCardIds
        )
        guard comparableRequestSeedQueue.isEmpty == false else {
            guard currentReviewSessionSignature.seedQueue.isEmpty else {
                return false
            }
            guard let validationContext else {
                return true
            }
            let currentSchedulerSettingsUpdatedAt = validationContext.schedulerSettings?.updatedAt ?? "no-scheduler-settings"
            return request.reviewSessionSignature.schedulerSettingsUpdatedAt == currentSchedulerSettingsUpdatedAt
        }
        guard currentReviewSessionSignature.seedQueue.starts(with: comparableRequestSeedQueue) else {
            return false
        }
        guard let validationContext else {
            return true
        }

        let currentSchedulerSettingsUpdatedAt = validationContext.schedulerSettings?.updatedAt ?? "no-scheduler-settings"
        return request.reviewSessionSignature.schedulerSettingsUpdatedAt == currentSchedulerSettingsUpdatedAt
    }

    private func makeComparableReviewSubmissionSeedQueue(
        request: ReviewSubmissionRequest,
        pendingReviewCardIds: Set<String>
    ) -> [ReviewSessionCardSignature] {
        var ignoredPendingCardIds: Set<String> = pendingReviewCardIds
        ignoredPendingCardIds.remove(request.cardId)
        guard ignoredPendingCardIds.isEmpty == false else {
            return request.reviewSessionSignature.seedQueue
        }

        return request.reviewSessionSignature.seedQueue.filter { cardSignature in
            ignoredPendingCardIds.contains(cardSignature.cardId) == false
        }
    }

    private func makeStaleReviewSubmissionState(
        publishedState: ReviewQueuePublishedState,
        pendingReviewCardIds: Set<String>
    ) -> ReviewQueuePublishedState {
        ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            presentedReviewCard: publishedState.presentedReviewCard,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    private func validReviewSubmissionRollbackCard(
        request: ReviewSubmissionRequest,
        currentWorkspaceId: String,
        selectedReviewFilter: ReviewFilter,
        cards: [Card],
        decks: [Deck],
        pendingReviewCardIds: Set<String>,
        now: Date
    ) -> Card? {
        guard request.workspaceId == currentWorkspaceId else {
            return nil
        }
        guard pendingReviewCardIds.contains(request.cardId) == false else {
            return nil
        }
        guard let currentCard = cards.first(where: { card in
            card.cardId == request.cardId && card.workspaceId == currentWorkspaceId
        }) else {
            return nil
        }
        guard currentCard.deletedAt == nil else {
            return nil
        }
        guard cardsMatchingReviewFilter(
            reviewFilter: selectedReviewFilter,
            decks: decks,
            cards: cards
        ).contains(where: { card in
            card.cardId == currentCard.cardId && card.workspaceId == currentWorkspaceId
        }) else {
            return nil
        }
        guard isActiveReviewOrderBucket(bucket: makeReviewOrderRank(card: currentCard, now: now).bucket) else {
            return nil
        }

        return currentCard
    }
}
