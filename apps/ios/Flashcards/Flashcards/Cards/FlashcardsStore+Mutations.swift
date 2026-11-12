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
            surfacesGlobalErrorMessage: false,
            capturesTechnicalFailures: false
        )
    }

    /// An edit shows at once, also on the shown and prepared next Review cards, instead of after the background
    /// rebuild. That rebuild then finds these cards unchanged, so the loads the edit invalidated resume and other
    /// screens reread here; a card the edit takes out of review leaves through that rebuild.
    /// See docs/fsrs-scheduling-logic.md#non-blocking-review.
    private func replaceEditedCardsInMemory(editedCards: [Card], now: Date) {
        let editedCardsById = Dictionary(uniqueKeysWithValues: editedCards.map { card in (card.cardId, card) })
        func editedCard(card: Card) -> Card {
            editedCardsById[card.cardId] ?? card
        }
        self.cards = self.cards.map(editedCard)
        let currentReviewState = self.currentReviewPublishedState()
        self.applyReviewPublishedState(
            reviewState: ReviewQueuePublishedState(
                selectedReviewFilter: currentReviewState.selectedReviewFilter,
                reviewQueue: currentReviewState.reviewQueue.map(editedCard),
                presentedReviewCard: currentReviewState.presentedReviewCard.map(editedCard),
                reviewCounts: currentReviewState.reviewCounts,
                isReviewHeadLoading: currentReviewState.isReviewHeadLoading,
                isReviewCountsLoading: currentReviewState.isReviewCountsLoading,
                isReviewQueueChunkLoading: currentReviewState.isReviewQueueChunkLoading,
                pendingReviewCardIds: currentReviewState.pendingReviewCardIds,
                reviewSubmissionFailure: currentReviewState.reviewSubmissionFailure
            )
        )
        self.resumeReviewLoadsInvalidatedBySourceChange(now: now)
        self.localReadVersion += 1
    }

    @discardableResult
    func saveCard(
        input: CardEditorInput,
        editingCardId: String?,
        mediaAssetIdsReadyForUpload: Set<String>
    ) throws -> Card {
        try self.saveCard(
            input: input,
            editingCardId: editingCardId,
            observedTags: nil,
            mediaAssetIdsReadyForUpload: mediaAssetIdsReadyForUpload
        )
    }

    @discardableResult
    func saveCard(
        input: CardEditorInput,
        editingCardId: String?,
        observedTags: [String]?,
        mediaAssetIdsReadyForUpload: Set<String>
    ) throws -> Card {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        let savedCard = try context.database.saveCard(
            workspaceId: context.workspaceId,
            input: input,
            cardId: editingCardId,
            observedTags: observedTags,
            mediaAssetIdsReadyForUpload: mediaAssetIdsReadyForUpload
        )
        self.reviewRuntime.invalidateReviewSource()
        if editingCardId == nil {
            self.handleReviewScheduleLocalCardStateDidChange(now: now)
        } else {
            self.replaceEditedCardsInMemory(editedCards: [savedCard], now: now)
        }
        try self.rebuildReviewData(reason: .localCardsChanged, now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
        return savedCard
    }

    func authorCardEditorManagedImage(
        preparedImage: PreparedManagedImage,
        altText: String
    ) throws -> ManagedImageAuthoringResult {
        let context = try self.requireLocalOutboxMutationContext()
        let cloudSettings = try requireCloudSettings(cloudSettings: self.cloudSettings)
        let result = try authorManagedImage(
            database: context.database,
            workspaceId: context.workspaceId,
            installationId: cloudSettings.installationId,
            preparedImage: preparedImage,
            altText: altText
        )
        return result
    }

    var spreadsheetImportScope: SpreadsheetImportScope? {
        guard let workspaceId = self.workspace?.workspaceId, let cloudSettings = self.cloudSettings else {
            return nil
        }
        return SpreadsheetImportScope(workspaceId: workspaceId, cloudSettings: cloudSettings)
    }

    func createSpreadsheetImportCards(
        scope: SpreadsheetImportScope,
        cards: [WorkspaceSpreadsheetCard],
        tags: [String]
    ) async throws -> Int {
        let context = try self.requireLocalOutboxMutationContext()
        guard self.spreadsheetImportScope == scope else {
            throw SpreadsheetImportScope.changedError()
        }
        guard self.activeSpreadsheetImportTask == nil else {
            throw LocalStoreError.validation("A spreadsheet import is already in progress. Try again when it finishes.")
        }
        let databaseURL = context.database.databaseURL
        let task = Task.detached(priority: .userInitiated) {
            let inputs = cards.map { $0.makeEditorInput(tags: tags) }
            let database = try LocalDatabase(existingWritableDatabaseURL: databaseURL)
            return try database.createSpreadsheetImportCards(scope: scope, inputs: inputs)
        }
        self.activeSpreadsheetImportTask = task
        defer { self.activeSpreadsheetImportTask = nil }

        let createdCount = try await task.value
        if self.spreadsheetImportScope == scope, self.localDatabaseURL == databaseURL {
            let now = Date()
            self.reviewRuntime.invalidateReviewSource()
            self.handleReviewScheduleLocalCardStateDidChange(now: now)
            self.rebuildReviewDataReportingFailure(reason: .localCardsChanged, now: now)
            self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
        }
        return createdCount
    }

    func deleteCard(cardId: String) throws {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        _ = try context.database.deleteCard(workspaceId: context.workspaceId, cardId: cardId)
        self.reviewRuntime.invalidateReviewSource()
        self.handleReviewScheduleLocalCardStateDidChange(now: now)
        try self.rebuildReviewData(reason: .localCardsChanged, now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
    }

    func updateCards(updates: [CardUpdateInput]) throws -> [Card] {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        let updatedCards = try context.database.updateCards(workspaceId: context.workspaceId, updates: updates)
        self.reviewRuntime.invalidateReviewSource()
        self.replaceEditedCardsInMemory(editedCards: updatedCards, now: now)
        try self.rebuildReviewData(reason: .localCardsChanged, now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
        return updatedCards
    }

    func deleteCards(cardIds: [String]) throws -> BulkDeleteCardsResult {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        let result = try context.database.deleteCards(workspaceId: context.workspaceId, cardIds: cardIds)
        self.reviewRuntime.invalidateReviewSource()
        self.handleReviewScheduleLocalCardStateDidChange(now: now)
        try self.rebuildReviewData(reason: .localCardsChanged, now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
        return result
    }

    func createDeck(input: DeckEditorInput) throws -> Deck {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        let createdDeck = try context.database.createDeck(workspaceId: context.workspaceId, input: input)
        self.reviewRuntime.invalidateReviewSource()
        try self.rebuildReviewData(reason: .localCardsChanged, now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
        return createdDeck
    }

    func updateDeck(deckId: String, input: DeckEditorInput, observedTags: [String]) throws {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        _ = try context.database.updateDeck(
            workspaceId: context.workspaceId,
            deckId: deckId,
            input: input,
            observedTags: observedTags
        )
        self.reviewRuntime.invalidateReviewSource()
        try self.rebuildReviewData(reason: .localCardsChanged, now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
    }

    func deleteDeck(deckId: String) throws {
        let context = try self.requireLocalOutboxMutationContext()
        let now = Date()
        _ = try context.database.deleteDeck(workspaceId: context.workspaceId, deckId: deckId)
        self.reviewRuntime.invalidateReviewSource()
        try self.rebuildReviewData(reason: .localCardsChanged, now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
    }

    func enqueueReviewSubmission(cardId: String, rating: ReviewRating) throws {
        guard self.dependencies.reviewSubmissionExecutor != nil else {
            throw self.reviewRuntime.reviewSubmissionExecutorUnavailableError()
        }
        try self.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade()

        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        try requireLocalDatabase(database: self.database).outboxStore
            .assertCardMaintenanceAllowsSnapshotWrites(workspaceId: workspaceId)
        let currentReviewState = self.currentReviewPublishedState()
        let reviewContext = makeReviewSubmissionContext(
            selectedReviewFilter: currentReviewState.selectedReviewFilter,
            decks: self.decks,
            cards: self.cards
        )
        let nextReviewState = try self.reviewRuntime.enqueueReviewSubmission(
            publishedState: currentReviewState,
            workspaceId: workspaceId,
            cardId: cardId,
            rating: rating,
            reviewContext: reviewContext,
            schedulerSettings: self.schedulerSettings
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
        let now = Date()
        self.reviewRuntime.invalidateReviewSource()
        try self.rebuildReviewData(reason: .localCardsChanged, now: now)
        self.triggerCloudSyncIfLinked(trigger: self.localMutationCloudSyncTrigger(now: now))
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
        let requestedReviewFilter = self.selectedReviewFilter
        let reviewSourceVersion = self.reviewRuntime.currentReviewSourceVersion()
        let resolvedReviewQuery = try requireLocalDatabase(database: self.database).loadResolvedReviewQuery(
            workspaceId: workspaceId,
            reviewFilter: requestedReviewFilter
        )
        guard resolvedReviewQuery.reviewFilter == requestedReviewFilter else {
            self.rebuildReviewDataReportingFailure(reason: .filterChanged(requestedReviewFilter), now: Date())
            throw CancellationError()
        }

        let reviewTimelinePage = try await self.dependencies.reviewTimelinePageLoader(
            databaseURL,
            workspaceId,
            resolvedReviewQuery.queryDefinition,
            Date(),
            limit,
            offset
        )
        guard workspaceId == self.workspace?.workspaceId else {
            throw CancellationError()
        }
        guard requestedReviewFilter == self.selectedReviewFilter else {
            throw CancellationError()
        }
        guard self.reviewRuntime.reviewSourceVersionMatches(sourceVersion: reviewSourceVersion) else {
            self.restartReviewLoadKeepingShownCard(now: Date())
            throw CancellationError()
        }
        return reviewTimelinePage
    }
}
