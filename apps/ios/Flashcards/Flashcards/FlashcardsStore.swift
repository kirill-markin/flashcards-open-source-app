import Foundation

private enum PersistedReviewFilterKind: String, Codable {
    case allCards
    case deck
}

private struct PersistedReviewFilter: Codable, Hashable {
    let kind: PersistedReviewFilterKind
    let deckId: String?
}

private let selectedReviewFilterUserDefaultsKey: String = "selected-review-filter"

private func makePersistedReviewFilter(reviewFilter: ReviewFilter) -> PersistedReviewFilter {
    switch reviewFilter {
    case .allCards:
        return PersistedReviewFilter(kind: .allCards, deckId: nil)
    case .deck(let deckId):
        return PersistedReviewFilter(kind: .deck, deckId: deckId)
    }
}

private func makeReviewFilter(persistedReviewFilter: PersistedReviewFilter) throws -> ReviewFilter {
    switch persistedReviewFilter.kind {
    case .allCards:
        return .allCards
    case .deck:
        guard let deckId = persistedReviewFilter.deckId, deckId.isEmpty == false else {
            throw LocalStoreError.validation("Persisted review filter is missing deckId")
        }

        return .deck(deckId: deckId)
    }
}

@MainActor
final class FlashcardsStore: ObservableObject {
    @Published private(set) var workspace: Workspace?
    @Published private(set) var userSettings: UserSettings?
    @Published private(set) var schedulerSettings: WorkspaceSchedulerSettings?
    @Published private(set) var cloudSettings: CloudSettings?
    @Published private(set) var cards: [Card]
    @Published private(set) var decks: [Deck]
    @Published private(set) var deckItems: [DeckListItem]
    @Published private(set) var selectedReviewFilter: ReviewFilter
    @Published private(set) var reviewQueue: [Card]
    @Published private(set) var homeSnapshot: HomeSnapshot
    @Published private(set) var globalErrorMessage: String
    @Published private(set) var selectedTab: AppTab
    @Published private(set) var cardsPresentationRequest: CardsPresentationRequest?

    private let database: LocalDatabase?
    private let userDefaults: UserDefaults
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init() {
        let userDefaults = UserDefaults.standard
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        self.workspace = nil
        self.userSettings = nil
        self.schedulerSettings = nil
        self.cloudSettings = nil
        self.cards = []
        self.decks = []
        self.deckItems = []
        self.selectedReviewFilter = FlashcardsStore.loadSelectedReviewFilter(
            userDefaults: userDefaults,
            decoder: decoder
        )
        self.reviewQueue = []
        self.homeSnapshot = HomeSnapshot(
            deckCount: 0,
            totalCards: 0,
            dueCount: 0,
            newCount: 0,
            reviewedCount: 0
        )
        self.globalErrorMessage = ""
        self.selectedTab = .review
        self.cardsPresentationRequest = nil
        self.userDefaults = userDefaults
        self.encoder = encoder
        self.decoder = decoder

        let database: LocalDatabase?
        do {
            database = try LocalDatabase()
        } catch {
            database = nil
            self.globalErrorMessage = localizedMessage(error: error)
        }

        self.database = database

        if database != nil {
            do {
                try self.reload()
            } catch {
                self.globalErrorMessage = localizedMessage(error: error)
            }
        }
    }

    func reload() throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        let snapshot = try database.loadStateSnapshot()
        let now = Date()
        self.workspace = snapshot.workspace
        self.userSettings = snapshot.userSettings
        self.schedulerSettings = snapshot.schedulerSettings
        self.cloudSettings = snapshot.cloudSettings
        self.cards = snapshot.cards
        self.decks = snapshot.decks
        self.deckItems = makeDeckListItems(decks: snapshot.decks, cards: snapshot.cards, now: now)
        self.refreshReviewState(now: now)
        self.homeSnapshot = makeHomeSnapshot(cards: snapshot.cards, deckCount: snapshot.decks.count, now: now)
        self.globalErrorMessage = ""
    }

    var selectedReviewFilterTitle: String {
        reviewFilterTitle(reviewFilter: self.selectedReviewFilter, decks: self.decks)
    }

    func selectTab(tab: AppTab) {
        self.selectedTab = tab
    }

    func selectReviewFilter(reviewFilter: ReviewFilter) {
        self.selectedReviewFilter = reviewFilter
        self.refreshReviewState(now: Date())
    }

    func openReview(reviewFilter: ReviewFilter) {
        self.selectReviewFilter(reviewFilter: reviewFilter)
        self.selectTab(tab: .review)
    }

    func openCardCreation() {
        self.selectTab(tab: .cards)
        self.cardsPresentationRequest = .createCard
    }

    func clearCardsPresentationRequest() {
        self.cardsPresentationRequest = nil
    }

    func saveCard(input: CardEditorInput, editingCardId: String?) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.saveCard(workspaceId: workspaceId, input: input, cardId: editingCardId)
        try self.reload()
    }

    func deleteCard(cardId: String) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.deleteCard(workspaceId: workspaceId, cardId: cardId)
        try self.reload()
    }

    func createDeck(input: DeckEditorInput) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.createDeck(workspaceId: workspaceId, input: input)
        try self.reload()
    }

    func updateDeck(deckId: String, input: DeckEditorInput) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.updateDeck(workspaceId: workspaceId, deckId: deckId, input: input)
        try self.reload()
    }

    func deleteDeck(deckId: String) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.deleteDeck(workspaceId: workspaceId, deckId: deckId)
        try self.reload()
    }

    func submitReview(cardId: String, rating: ReviewRating) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: rating,
                reviewedAtClient: currentIsoTimestamp()
            )
        )
        try self.reload()
    }

    func updateSchedulerSettings(
        desiredRetention: Double,
        learningStepsMinutes: [Int],
        relearningStepsMinutes: [Int],
        maximumIntervalDays: Int,
        enableFuzz: Bool
    ) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.updateWorkspaceSchedulerSettings(
            workspaceId: workspaceId,
            desiredRetention: desiredRetention,
            learningStepsMinutes: learningStepsMinutes,
            relearningStepsMinutes: relearningStepsMinutes,
            maximumIntervalDays: maximumIntervalDays,
            enableFuzz: enableFuzz
        )
        try self.reload()
    }

    func prepareCloudLink() throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        try database.updateCloudSettings(
            cloudState: .linkingReady,
            linkedUserId: nil,
            linkedWorkspaceId: nil,
            linkedEmail: nil
        )
        try self.reload()
    }

    func previewLinkedCloudAccount() throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspace = self.workspace else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        try database.updateCloudSettings(
            cloudState: .linked,
            linkedUserId: "preview-user",
            linkedWorkspaceId: workspace.workspaceId,
            linkedEmail: "preview@flashcards-open-source-app.com"
        )
        try self.reload()
    }

    func disconnectCloudAccount() throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        try database.updateCloudSettings(
            cloudState: .disconnected,
            linkedUserId: nil,
            linkedWorkspaceId: nil,
            linkedEmail: nil
        )
        try self.reload()
    }

    func cardsMatchingDeck(deck: Deck) -> [Card] {
        matchingCardsForDeck(deck: deck, cards: self.cards)
    }

    private func refreshReviewState(now: Date) {
        let resolvedReviewFilter = resolveReviewFilter(reviewFilter: self.selectedReviewFilter, decks: self.decks)
        self.selectedReviewFilter = resolvedReviewFilter
        self.persistSelectedReviewFilter(reviewFilter: resolvedReviewFilter)
        self.reviewQueue = makeReviewQueue(
            reviewFilter: resolvedReviewFilter,
            decks: self.decks,
            cards: self.cards,
            now: now
        )
    }

    private func persistSelectedReviewFilter(reviewFilter: ReviewFilter) {
        do {
            let persistedReviewFilter = makePersistedReviewFilter(reviewFilter: reviewFilter)
            let data = try self.encoder.encode(persistedReviewFilter)
            self.userDefaults.set(data, forKey: selectedReviewFilterUserDefaultsKey)
        } catch {
            self.userDefaults.removeObject(forKey: selectedReviewFilterUserDefaultsKey)
        }
    }

    private static func loadSelectedReviewFilter(userDefaults: UserDefaults, decoder: JSONDecoder) -> ReviewFilter {
        guard let data = userDefaults.data(forKey: selectedReviewFilterUserDefaultsKey) else {
            return .allCards
        }

        do {
            let persistedReviewFilter = try decoder.decode(PersistedReviewFilter.self, from: data)
            return try makeReviewFilter(persistedReviewFilter: persistedReviewFilter)
        } catch {
            userDefaults.removeObject(forKey: selectedReviewFilterUserDefaultsKey)
            return .allCards
        }
    }
}
