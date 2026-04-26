import Foundation

@MainActor
extension FlashcardsStore {
    private func requireLocalOutboxMutationContext() throws -> LocalMutationContext {
        try self.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade()
        return try requireLocalMutationContext(database: self.database, workspace: self.workspace)
    }

    private func localMutationCloudSyncTrigger(now: Date) -> CloudSyncTrigger {
        CloudSyncTrigger(
            source: .localMutation,
            now: now,
            extendsFastPolling: true,
            allowsVisibleChangeBanner: false,
            surfacesGlobalErrorMessage: false
        )
    }

    func saveCard(input: CardEditorInput, editingCardId: String?) throws {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        _ = try context.database.saveCard(
            workspaceId: context.workspaceId,
            input: input,
            cardId: editingCardId
        )
        self.refreshLocalReadModels(now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
    }

    func createCards(inputs: [CardEditorInput]) throws -> [Card] {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        let createdCards = try context.database.createCards(workspaceId: context.workspaceId, inputs: inputs)
        try self.reload()
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
        return createdCards
    }

    func deleteCard(cardId: String) throws {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        _ = try context.database.deleteCard(workspaceId: context.workspaceId, cardId: cardId)
        self.refreshLocalReadModels(now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
    }

    func updateCards(updates: [CardUpdateInput]) throws -> [Card] {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        let updatedCards = try context.database.updateCards(workspaceId: context.workspaceId, updates: updates)
        try self.reload()
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
        return updatedCards
    }

    func deleteCards(cardIds: [String]) throws -> BulkDeleteCardsResult {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        let result = try context.database.deleteCards(workspaceId: context.workspaceId, cardIds: cardIds)
        try self.reload()
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
        return result
    }

    func createDeck(input: DeckEditorInput) throws {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        _ = try context.database.createDeck(workspaceId: context.workspaceId, input: input)
        self.refreshLocalReadModels(now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
    }

    func updateDeck(deckId: String, input: DeckEditorInput) throws {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        _ = try context.database.updateDeck(
            workspaceId: context.workspaceId,
            deckId: deckId,
            input: input
        )
        self.refreshLocalReadModels(now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
    }

    func deleteDeck(deckId: String) throws {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        _ = try context.database.deleteDeck(workspaceId: context.workspaceId, deckId: deckId)
        self.refreshLocalReadModels(now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
    }

    func submitReview(cardId: String, rating: ReviewRating) throws {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        _ = try context.database.submitReview(
            workspaceId: context.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: rating,
                reviewedAtClient: nowIsoTimestamp()
            )
        )
        self.refreshLocalReadModels(now: now)
        self.recordSuccessfulStrictReminderReview(reviewedAt: now, now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
    }

    func enqueueReviewSubmission(cardId: String, rating: ReviewRating) throws {
        guard self.dependencies.reviewSubmissionExecutor != nil else {
            throw self.reviewRuntime.reviewSubmissionExecutorUnavailableError()
        }
        try self.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade()

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
        let context = try self.requireLocalOutboxMutationContext()
        try context.database.updateWorkspaceSchedulerSettings(
            workspaceId: context.workspaceId,
            desiredRetention: desiredRetention,
            learningStepsMinutes: learningStepsMinutes,
            relearningStepsMinutes: relearningStepsMinutes,
            maximumIntervalDays: maximumIntervalDays,
            enableFuzz: enableFuzz
        )
        try self.reload()
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: Date()))
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
