import Foundation

@MainActor
extension FlashcardsStore {
    func saveCard(input: CardEditorInput, editingCardId: String?) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        _ = try context.database.saveCard(
            workspaceId: context.workspaceId,
            input: input,
            cardId: editingCardId
        )
        self.refreshLocalReadModels(now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func createCards(inputs: [CardEditorInput]) throws -> [Card] {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        let createdCards = try context.database.createCards(workspaceId: context.workspaceId, inputs: inputs)
        try self.reload()
        self.triggerCloudSyncIfLinked()
        return createdCards
    }

    func deleteCard(cardId: String) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        _ = try context.database.deleteCard(workspaceId: context.workspaceId, cardId: cardId)
        self.refreshLocalReadModels(now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func updateCards(updates: [CardUpdateInput]) throws -> [Card] {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        let updatedCards = try context.database.updateCards(workspaceId: context.workspaceId, updates: updates)
        try self.reload()
        self.triggerCloudSyncIfLinked()
        return updatedCards
    }

    func deleteCards(cardIds: [String]) throws -> BulkDeleteCardsResult {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        let result = try context.database.deleteCards(workspaceId: context.workspaceId, cardIds: cardIds)
        try self.reload()
        self.triggerCloudSyncIfLinked()
        return result
    }

    func createDeck(input: DeckEditorInput) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        _ = try context.database.createDeck(workspaceId: context.workspaceId, input: input)
        self.refreshLocalReadModels(now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func updateDeck(deckId: String, input: DeckEditorInput) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        _ = try context.database.updateDeck(
            workspaceId: context.workspaceId,
            deckId: deckId,
            input: input
        )
        self.refreshLocalReadModels(now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func deleteDeck(deckId: String) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        _ = try context.database.deleteDeck(workspaceId: context.workspaceId, deckId: deckId)
        self.refreshLocalReadModels(now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func submitReview(cardId: String, rating: ReviewRating) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        _ = try context.database.submitReview(
            workspaceId: context.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: rating,
                reviewedAtClient: currentIsoTimestamp()
            )
        )
        self.refreshLocalReadModels(now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func enqueueReviewSubmission(cardId: String, rating: ReviewRating) throws {
        guard self.dependencies.reviewSubmissionExecutor != nil else {
            throw self.reviewRuntime.reviewSubmissionExecutorUnavailableError()
        }

        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        let nextReviewState = try self.reviewRuntime.enqueueReviewSubmission(
            publishedState: self.currentReviewPublishedState(),
            workspaceId: workspaceId,
            cardId: cardId,
            rating: rating
        )
        self.applyReviewPublishedState(reviewState: nextReviewState)
        self.startReviewQueueChunkLoadIfNeeded(now: Date())
        self.startReviewProcessorIfNeeded()
    }

    func isReviewPending(cardId: String) -> Bool {
        self.pendingReviewCardIds.contains(cardId)
    }

    func dismissReviewSubmissionFailure() {
        self.reviewSubmissionFailure = nil
    }

    func updateSchedulerSettings(
        desiredRetention: Double,
        learningStepsMinutes: [Int],
        relearningStepsMinutes: [Int],
        maximumIntervalDays: Int,
        enableFuzz: Bool
    ) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        try context.database.updateWorkspaceSchedulerSettings(
            workspaceId: context.workspaceId,
            desiredRetention: desiredRetention,
            learningStepsMinutes: learningStepsMinutes,
            relearningStepsMinutes: relearningStepsMinutes,
            maximumIntervalDays: maximumIntervalDays,
            enableFuzz: enableFuzz
        )
        try self.reload()
        self.triggerCloudSyncIfLinked()
    }

    func loadAIReviewHistory(limit: Int, cardId: String?) throws -> [ReviewEvent] {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        let events = try context.database.loadReviewEvents(workspaceId: context.workspaceId)
        let filteredEvents = cardId == nil
            ? events
            : events.filter { event in
                event.cardId == cardId
            }

        return Array(filteredEvents.prefix(limit))
    }

    func loadAIOutboxEntries(limit: Int) throws -> [PersistedOutboxEntry] {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        return try context.database.loadOutboxEntries(workspaceId: context.workspaceId, limit: limit)
    }
    func loadReviewTimelinePage(limit: Int, offset: Int) async throws -> ReviewTimelinePage {
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }
        guard let databaseURL = self.localDatabaseURL else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        let resolvedReviewQuery = try requireLocalDatabase(database: self.database).loadResolvedReviewQuery(
            workspaceId: workspaceId,
            reviewFilter: self.selectedReviewFilter
        )
        return try await self.dependencies.reviewTimelinePageLoader(
            databaseURL,
            workspaceId,
            resolvedReviewQuery.queryDefinition,
            Date(),
            limit,
            offset
        )
    }
}
