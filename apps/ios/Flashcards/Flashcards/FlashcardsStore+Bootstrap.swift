import Foundation

@MainActor
extension FlashcardsStore {
    func reload() throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        let snapshot = try database.loadStateSnapshot()
        self.applyLoadedSnapshot(snapshot: snapshot, now: Date())
    }

    var localDatabaseURL: URL? {
        self.database?.databaseURL
    }

    func applyExternalSnapshot(snapshot: AppStateSnapshot) {
        self.applyLoadedSnapshot(snapshot: snapshot, now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func applyLoadedSnapshot(snapshot: AppStateSnapshot, now: Date) {
        self.workspace = snapshot.workspace
        self.userSettings = snapshot.userSettings
        self.schedulerSettings = snapshot.schedulerSettings
        self.cloudSettings = snapshot.cloudSettings
        self.applyLocalState(cards: snapshot.cards, decks: snapshot.decks, now: now)
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

    func applyCardMutation(card: Card, now: Date) {
        self.applyLocalState(
            cards: applyingCardMutation(cards: self.cards, card: card),
            decks: self.decks,
            now: now
        )
    }

    func applyDeckMutation(deck: Deck, now: Date) {
        self.applyLocalState(
            cards: self.cards,
            decks: applyingDeckMutation(decks: self.decks, deck: deck),
            now: now
        )
    }

    func applyLocalState(cards: [Card], decks: [Deck], now: Date) {
        self.cards = cards
        self.decks = decks
        self.deckItems = makeDeckListItems(decks: decks, cards: cards, now: now)
        self.refreshReviewState(now: now)
        self.homeSnapshot = makeHomeSnapshot(cards: cards, deckCount: decks.count, now: now)
        self.globalErrorMessage = ""
        self.localReadVersion += 1
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
        let workspaceRuntime: any AIToolExecuting & AIChatSnapshotLoading
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
            snapshotLoader: workspaceRuntime,
            voiceRecorder: AIChatVoiceRecorder(),
            audioTranscriber: AIChatTranscriptionService(
                session: URLSession.shared,
                decoder: self.decoder
            )
        )
    }
}
