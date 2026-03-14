import Foundation

@MainActor
extension FlashcardsStore {
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
                let overviewSnapshot = try database.loadWorkspaceOverviewSnapshot(
                    workspaceId: snapshot.workspace.workspaceId,
                    workspaceName: snapshot.workspace.name,
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
                self.globalErrorMessage = localizedMessage(error: error)
            }
        }
        self.globalErrorMessage = ""
        self.localReadVersion += 1
        self.refreshReviewState(now: now)
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
            self.globalErrorMessage = localizedMessage(error: error)
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
            userDefaults: UserDefaults.standard,
            encoder: self.encoder,
            decoder: self.decoder
        )
        let chatService = AIChatService(
            session: URLSession.shared,
            encoder: self.encoder,
            decoder: self.decoder
        )
        let workspaceRuntime: any AIToolExecuting & AIChatLocalContextLoading
        if let databaseURL = self.localDatabaseURL {
            workspaceRuntime = LocalAIToolExecutor(
                databaseURL: databaseURL,
                encoder: self.encoder,
                decoder: self.decoder
            )
        } else {
            workspaceRuntime = UnavailableAIToolExecutor()
        }

        return AIChatStore(
            flashcardsStore: self,
            historyStore: historyStore,
            chatService: chatService,
            toolExecutor: workspaceRuntime,
            localContextLoader: workspaceRuntime,
            voiceRecorder: AIChatVoiceRecorder(),
            audioTranscriber: AIChatTranscriptionService(
                session: URLSession.shared,
                decoder: self.decoder
            )
        )
    }
}
