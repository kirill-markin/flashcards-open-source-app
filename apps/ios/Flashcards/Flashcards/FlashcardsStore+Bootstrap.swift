import Foundation

@MainActor
extension FlashcardsStore {
    private func resetReviewRuntimeForWorkspace(nextWorkspaceId: String) {
        let nextReviewFilter = FlashcardsStore.loadSelectedReviewFilter(
            userDefaults: self.userDefaults,
            decoder: self.decoder,
            workspaceId: nextWorkspaceId
        )
        self.reviewRuntime.cancelForAccountDeletion()
        self.reviewRuntime = ReviewQueueRuntime(
            initialSelectedReviewFilter: nextReviewFilter,
            reviewSeedQueueSize: reviewSeedQueueSize,
            reviewQueueReplenishmentThreshold: reviewQueueReplenishmentThreshold
        )
        self.applyReviewPublishedState(
            reviewState: ReviewQueueRuntime.makeInitialPublishedState(selectedReviewFilter: nextReviewFilter)
        )
        self.clearTransientBanners()
    }

    func prepareWorkspaceScopedStateForSwitch(nextWorkspaceId: String) {
        self.cachedAIChatStore?.prepareForWorkspaceChange()
        self.resetReviewRuntimeForWorkspace(nextWorkspaceId: nextWorkspaceId)
    }

    func reload() throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        self.applyLoadedBootstrapSnapshot(snapshot: bootstrapSnapshot, now: Date())
    }

    var localDatabaseURL: URL? {
        self.database?.databaseURL
    }

    func applyLoadedBootstrapSnapshot(snapshot: AppBootstrapSnapshot, now: Date) {
        let didSwitchWorkspace = self.workspace?.workspaceId != snapshot.workspace.workspaceId
        if didSwitchWorkspace {
            self.resetReviewRuntimeForWorkspace(nextWorkspaceId: snapshot.workspace.workspaceId)
        }

        self.workspace = snapshot.workspace
        self.userSettings = snapshot.userSettings
        self.schedulerSettings = snapshot.schedulerSettings
        self.cloudSettings = snapshot.cloudSettings
        self.cards = []
        self.decks = []
        self.deckItems = []
        self.homeSnapshot = HomeSnapshot(
            deckCount: 0,
            totalCards: 0,
            dueCount: 0,
            newCount: 0,
            reviewedCount: 0
        )
        if let database {
            do {
                let activeCards = try database.loadActiveCards(workspaceId: snapshot.workspace.workspaceId)
                let activeDecks = try database.loadActiveDecks(workspaceId: snapshot.workspace.workspaceId)
                let overviewSnapshot = try database.loadWorkspaceOverviewSnapshot(
                    workspaceId: snapshot.workspace.workspaceId,
                    workspaceName: snapshot.workspace.name,
                    now: now
                )
                self.cards = activeCards
                self.decks = activeDecks
                self.deckItems = makeDeckListItems(
                    decks: activeDecks,
                    cards: activeCards,
                    now: now
                )
                self.homeSnapshot = HomeSnapshot(
                    deckCount: overviewSnapshot.deckCount,
                    totalCards: overviewSnapshot.totalCards,
                    dueCount: overviewSnapshot.dueCount,
                    newCount: overviewSnapshot.newCount,
                    reviewedCount: overviewSnapshot.reviewedCount
                )
            } catch {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
        self.globalErrorMessage = ""
        self.reloadReviewNotificationsSettings()
        self.localReadVersion += 1
        if didSwitchWorkspace {
            self.cachedAIChatStore?.activateWorkspace()
        } else {
            self.cachedAIChatStore?.refreshAccessContextIfNeeded()
        }
        self.refreshReviewState(now: now)
        self.reconcileReviewNotifications(trigger: .workspaceChanged, now: now)
    }

    @discardableResult
    func refreshBootstrapSnapshotWithoutReset(now: Date) throws -> BootstrapSnapshotRefreshOutcome {
        let database = try requireLocalDatabase(database: self.database)
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()
        let nextCards = try database.loadActiveCards(workspaceId: bootstrapSnapshot.workspace.workspaceId)
        let nextDecks = try database.loadActiveDecks(workspaceId: bootstrapSnapshot.workspace.workspaceId)
        let nextDeckItems = makeDeckListItems(decks: nextDecks, cards: nextCards, now: now)
        let nextHomeSnapshot = try database.loadWorkspaceOverviewSnapshot(
            workspaceId: bootstrapSnapshot.workspace.workspaceId,
            workspaceName: bootstrapSnapshot.workspace.name,
            now: now
        )
        let resolvedHomeSnapshot = HomeSnapshot(
            deckCount: nextHomeSnapshot.deckCount,
            totalCards: nextHomeSnapshot.totalCards,
            dueCount: nextHomeSnapshot.dueCount,
            newCount: nextHomeSnapshot.newCount,
            reviewedCount: nextHomeSnapshot.reviewedCount
        )

        let workspaceChanged = self.workspace != bootstrapSnapshot.workspace
        let cardsChanged = self.cards != nextCards
        let didChange = workspaceChanged
            || self.userSettings != bootstrapSnapshot.userSettings
            || self.schedulerSettings != bootstrapSnapshot.schedulerSettings
            || self.cloudSettings != bootstrapSnapshot.cloudSettings
            || cardsChanged
            || self.decks != nextDecks
            || self.deckItems != nextDeckItems
            || self.homeSnapshot != resolvedHomeSnapshot
        let homeSnapshotChanged = self.homeSnapshot != resolvedHomeSnapshot

        self.workspace = bootstrapSnapshot.workspace
        self.userSettings = bootstrapSnapshot.userSettings
        self.schedulerSettings = bootstrapSnapshot.schedulerSettings
        self.cloudSettings = bootstrapSnapshot.cloudSettings
        self.cards = nextCards
        self.decks = nextDecks
        self.deckItems = nextDeckItems
        self.homeSnapshot = resolvedHomeSnapshot
        self.globalErrorMessage = ""
        self.reloadReviewNotificationsSettings()
        self.reconcileReviewNotifications(trigger: .workspaceChanged, now: now)

        return BootstrapSnapshotRefreshOutcome(
            didChange: didChange,
            workspaceChanged: workspaceChanged,
            cardsChanged: cardsChanged,
            homeSnapshotChanged: homeSnapshotChanged
        )
    }

    func applyReviewPublishedState(reviewState: ReviewQueuePublishedState) {
        self.selectedReviewFilter = reviewState.selectedReviewFilter
        self.reviewQueue = reviewState.reviewQueue
        self.reviewCounts = reviewState.reviewCounts
        self.isReviewHeadLoading = reviewState.isReviewHeadLoading
        self.isReviewCountsLoading = reviewState.isReviewCountsLoading
        self.isReviewQueueChunkLoading = reviewState.isReviewQueueChunkLoading
        self.pendingReviewCardIds = reviewState.pendingReviewCardIds
        self.reviewSubmissionFailure = reviewState.reviewSubmissionFailure
    }

    func currentReviewPublishedState() -> ReviewQueuePublishedState {
        ReviewQueuePublishedState(
            selectedReviewFilter: self.selectedReviewFilter,
            reviewQueue: self.reviewQueue,
            reviewCounts: self.reviewCounts,
            isReviewHeadLoading: self.isReviewHeadLoading,
            isReviewCountsLoading: self.isReviewCountsLoading,
            isReviewQueueChunkLoading: self.isReviewQueueChunkLoading,
            pendingReviewCardIds: self.pendingReviewCardIds,
            reviewSubmissionFailure: self.reviewSubmissionFailure
        )
    }

    func refreshLocalReadModels(now: Date) {
        do {
            try self.reload()
        } catch {
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    func loadWorkspaceTagsSummary() throws -> WorkspaceTagsSummary {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        return try database.loadWorkspaceTagsSummary(workspaceId: workspaceId)
    }

    func loadDecksListSnapshot(now: Date) throws -> DecksListSnapshot {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        return try database.loadDecksListSnapshot(workspaceId: workspaceId, now: now)
    }

    func loadDeck(deckId: String) throws -> Deck {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        return try database.loadDeck(workspaceId: workspaceId, deckId: deckId)
    }

    func loadCardsMatchingDeck(filterDefinition: DeckFilterDefinition) throws -> [Card] {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        return try database.loadCardsMatchingDeck(
            workspaceId: workspaceId,
            filterDefinition: filterDefinition
        )
    }

    func makeAIChatStore() -> AIChatStore {
        let historyStore = AIChatHistoryStore(
            userDefaults: self.userDefaults,
            encoder: self.encoder,
            decoder: self.decoder,
            workspaceId: self.workspace?.workspaceId
        )
        let chatService = AIChatService(
            session: URLSession.shared,
            encoder: self.encoder,
            decoder: self.decoder
        )
        let contextLoader: any AIChatContextLoading
        if let databaseURL = self.localDatabaseURL {
            contextLoader = AIChatContextLoader(databaseURL: databaseURL)
        } else {
            contextLoader = UnavailableAIChatContextLoader()
        }

        return AIChatStore(
            flashcardsStore: self,
            historyStore: historyStore,
            chatService: chatService,
            contextLoader: contextLoader,
            voiceRecorder: AIChatVoiceRecorder(),
            audioTranscriber: AIChatTranscriptionService(
                session: URLSession.shared,
                decoder: self.decoder
            )
        )
    }
}
