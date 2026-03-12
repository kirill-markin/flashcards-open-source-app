import Foundation

private enum PersistedReviewFilterKind: String, Codable {
    case allCards
    case deck
    case tag
}

private struct PersistedReviewFilter: Codable, Hashable {
    let kind: PersistedReviewFilterKind
    let deckId: String?
    let tag: String?
}

private let selectedReviewFilterUserDefaultsKey: String = "selected-review-filter"

private func makePersistedReviewFilter(reviewFilter: ReviewFilter) -> PersistedReviewFilter {
    switch reviewFilter {
    case .allCards:
        return PersistedReviewFilter(kind: .allCards, deckId: nil, tag: nil)
    case .deck(let deckId):
        return PersistedReviewFilter(kind: .deck, deckId: deckId, tag: nil)
    case .tag(let tag):
        return PersistedReviewFilter(kind: .tag, deckId: nil, tag: tag)
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
    case .tag:
        guard let tag = persistedReviewFilter.tag, tag.isEmpty == false else {
            throw LocalStoreError.validation("Persisted review filter is missing tag")
        }

        return .tag(tag: tag)
    }
}

private func applyingCardMutation(cards: [Card], card: Card) -> [Card] {
    let remainingCards = cards.filter { existingCard in
        existingCard.cardId != card.cardId
    }

    if card.deletedAt != nil {
        return remainingCards
    }

    return [card] + remainingCards
}

private func applyingDeckMutation(decks: [Deck], deck: Deck) -> [Deck] {
    let remainingDecks = decks.filter { existingDeck in
        existingDeck.deckId != deck.deckId
    }

    if deck.deletedAt != nil {
        return remainingDecks
    }

    return [deck] + remainingDecks
}

/// Immutable payload for one pending optimistic review submission.
private struct ReviewSubmissionRequest: Hashable, Sendable {
    let id: String
    let workspaceId: String
    let cardId: String
    let rating: ReviewRating
    let reviewedAtClient: String
}

/// Represents one failed optimistic review submission shown in the Review alert.
struct ReviewSubmissionFailure: Identifiable, Hashable, Sendable {
    let id: String
    let message: String
}

struct TabSelectionRequest: Equatable, Sendable {
    let id: String
    let tab: AppTab
}

private struct AIChatSessionPreparationState {
    let id: String
    let task: Task<CloudLinkedSession, Error>
}

typealias ReviewHeadLoader = @Sendable (
    _ reviewFilter: ReviewFilter,
    _ decks: [Deck],
    _ cards: [Card],
    _ now: Date,
    _ seedQueueSize: Int
) async throws -> ReviewHeadLoadState

typealias ReviewStateLoader = @Sendable (
    _ reviewFilter: ReviewFilter,
    _ decks: [Deck],
    _ cards: [Card],
    _ now: Date
) async throws -> ReviewComputedState

private let reviewSeedQueueSize: Int = 8

private func defaultReviewHeadLoader(
    reviewFilter: ReviewFilter,
    decks: [Deck],
    cards: [Card],
    now: Date,
    seedQueueSize: Int
) async throws -> ReviewHeadLoadState {
    try await Task.detached(priority: .userInitiated) {
        try Task.checkCancellation()
        return makeReviewHeadLoadState(
            reviewFilter: reviewFilter,
            decks: decks,
            cards: cards,
            now: now,
            seedQueueSize: seedQueueSize
        )
    }.value
}

private func defaultReviewStateLoader(
    reviewFilter: ReviewFilter,
    decks: [Deck],
    cards: [Card],
    now: Date
) async throws -> ReviewComputedState {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return makeReviewComputedState(
            reviewFilter: reviewFilter,
            decks: decks,
            cards: cards,
            now: now
        )
    }.value
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
    @Published private(set) var reviewTimeline: [Card]
    @Published private(set) var isReviewHeadLoading: Bool
    @Published private(set) var isReviewTimelineLoading: Bool
    @Published private(set) var homeSnapshot: HomeSnapshot
    @Published private(set) var globalErrorMessage: String
    @Published private(set) var syncStatus: SyncStatus
    @Published private(set) var lastSuccessfulCloudSyncAt: String?
    @Published private(set) var tabSelectionRequest: TabSelectionRequest?
    @Published private(set) var cardsPresentationRequest: CardsPresentationRequest?
    @Published private(set) var aiChatPresentationRequest: AIChatPresentationRequest?
    @Published private(set) var settingsPresentationRequest: SettingsNavigationDestination?
    @Published private(set) var pendingReviewCardIds: Set<String>
    @Published private(set) var reviewSubmissionFailure: ReviewSubmissionFailure?

    private let database: LocalDatabase?
    private let cloudAuthService: CloudAuthService
    private let cloudSyncService: CloudSyncService?
    private let credentialStore: CloudCredentialStore
    private let reviewSubmissionExecutor: ReviewSubmissionExecuting?
    private let reviewHeadLoader: ReviewHeadLoader
    private let reviewStateLoader: ReviewStateLoader
    private let userDefaults: UserDefaults
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private(set) var selectedTab: AppTab
    private var activeCloudSession: CloudLinkedSession?
    private var activeCloudSyncTask: Task<Void, Error>?
    private var activeAIChatSessionPreparation: AIChatSessionPreparationState?
    private var activeReviewLoadTask: Task<Void, Never>?
    private var activeReviewLoadRequestId: String?
    private var pendingCloudResync: Bool
    private var pendingReviewRequests: [ReviewSubmissionRequest]
    private var isReviewProcessorRunning: Bool
    private var reviewSourceVersion: Int
    lazy var aiChatStore: AIChatStore = self.makeAIChatStore()

    convenience init() {
        let userDefaults = UserDefaults.standard
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let cloudAuthService = CloudAuthService()
        let credentialStore = CloudCredentialStore()
        let database: LocalDatabase?
        let initialGlobalErrorMessage: String

        do {
            database = try LocalDatabase()
            initialGlobalErrorMessage = ""
        } catch {
            database = nil
            initialGlobalErrorMessage = localizedMessage(error: error)
        }

        self.init(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: cloudAuthService,
            credentialStore: credentialStore,
            initialGlobalErrorMessage: initialGlobalErrorMessage
        )
    }

    convenience init(
        userDefaults: UserDefaults,
        encoder: JSONEncoder,
        decoder: JSONDecoder,
        database: LocalDatabase?,
        cloudAuthService: CloudAuthService,
        credentialStore: CloudCredentialStore,
        initialGlobalErrorMessage: String
    ) {
        let reviewSubmissionExecutor: ReviewSubmissionExecuting? = database.map { initializedDatabase in
            ReviewSubmissionExecutor(databaseURL: initializedDatabase.databaseURL)
        }
        self.init(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: cloudAuthService,
            credentialStore: credentialStore,
            reviewSubmissionExecutor: reviewSubmissionExecutor,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewStateLoader: defaultReviewStateLoader,
            initialGlobalErrorMessage: initialGlobalErrorMessage
        )
    }

    init(
        userDefaults: UserDefaults,
        encoder: JSONEncoder,
        decoder: JSONDecoder,
        database: LocalDatabase?,
        cloudAuthService: CloudAuthService,
        credentialStore: CloudCredentialStore,
        reviewSubmissionExecutor: ReviewSubmissionExecuting?,
        reviewHeadLoader: @escaping ReviewHeadLoader,
        reviewStateLoader: @escaping ReviewStateLoader,
        initialGlobalErrorMessage: String
    ) {
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
        self.reviewTimeline = []
        self.isReviewHeadLoading = false
        self.isReviewTimelineLoading = false
        self.homeSnapshot = HomeSnapshot(
            deckCount: 0,
            totalCards: 0,
            dueCount: 0,
            newCount: 0,
            reviewedCount: 0
        )
        self.globalErrorMessage = initialGlobalErrorMessage
        self.syncStatus = .idle
        self.lastSuccessfulCloudSyncAt = nil
        self.selectedTab = .review
        self.tabSelectionRequest = nil
        self.cardsPresentationRequest = nil
        self.aiChatPresentationRequest = nil
        self.settingsPresentationRequest = nil
        self.pendingReviewCardIds = []
        self.reviewSubmissionFailure = nil
        self.database = database
        self.cloudAuthService = cloudAuthService
        self.cloudSyncService = database.map { initializedDatabase in
            CloudSyncService(database: initializedDatabase)
        }
        self.credentialStore = credentialStore
        self.reviewSubmissionExecutor = reviewSubmissionExecutor
        self.reviewHeadLoader = reviewHeadLoader
        self.reviewStateLoader = reviewStateLoader
        self.userDefaults = userDefaults
        self.encoder = encoder
        self.decoder = decoder
        self.activeCloudSession = nil
        self.activeCloudSyncTask = nil
        self.activeAIChatSessionPreparation = nil
        self.activeReviewLoadTask = nil
        self.activeReviewLoadRequestId = nil
        self.pendingCloudResync = false
        self.pendingReviewRequests = []
        self.isReviewProcessorRunning = false
        self.reviewSourceVersion = 0

        if database != nil && initialGlobalErrorMessage.isEmpty {
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
        self.applyLoadedSnapshot(snapshot: snapshot, now: Date())
    }

    var localDatabaseURL: URL? {
        self.database?.databaseURL
    }

    func applyExternalSnapshot(snapshot: AppStateSnapshot) {
        self.applyLoadedSnapshot(snapshot: snapshot, now: Date())
        self.triggerCloudSyncIfLinked()
    }

    var selectedReviewFilterTitle: String {
        reviewFilterTitle(reviewFilter: self.selectedReviewFilter, decks: self.decks, cards: self.cards)
    }

    var reviewTotalCount: Int {
        self.reviewTimeline.count
    }

    /// Review queue visible to UI after optimistic removals are applied.
    var effectiveReviewQueue: [Card] {
        self.reviewQueue.filter { card in
            self.pendingReviewCardIds.contains(card.cardId) == false
        }
    }

    func selectTab(tab: AppTab) {
        self.selectedTab = tab
    }

    func selectReviewFilter(reviewFilter: ReviewFilter) {
        self.startReviewLoad(reviewFilter: reviewFilter, now: Date())
    }

    func openReview(reviewFilter: ReviewFilter) {
        self.startReviewLoad(reviewFilter: reviewFilter, now: Date())
        self.requestTabSelection(tab: .review)
    }

    func openCardCreation() {
        self.requestTabSelection(tab: .cards)
        self.cardsPresentationRequest = .createCard
    }

    func openAICardCreation() {
        self.requestTabSelection(tab: .ai)
        self.aiChatPresentationRequest = .createCard
    }

    func openDeckManagement() {
        self.requestTabSelection(tab: .settings)
        self.settingsPresentationRequest = .decks
    }

    func clearCardsPresentationRequest() {
        self.cardsPresentationRequest = nil
    }

    func clearAIChatPresentationRequest() {
        self.aiChatPresentationRequest = nil
    }

    func clearSettingsPresentationRequest() {
        self.settingsPresentationRequest = nil
    }

    func saveCard(input: CardEditorInput, editingCardId: String?) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let persistedCard = try database.saveCard(workspaceId: workspaceId, input: input, cardId: editingCardId)
        self.applyCardMutation(card: persistedCard, now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func createCards(inputs: [CardEditorInput]) throws -> [Card] {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let createdCards = try database.createCards(workspaceId: workspaceId, inputs: inputs)
        try self.reload()
        self.triggerCloudSyncIfLinked()
        return createdCards
    }

    func deleteCard(cardId: String) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let deletedCard = try database.deleteCard(workspaceId: workspaceId, cardId: cardId)
        self.applyCardMutation(card: deletedCard, now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func updateCards(updates: [CardUpdateInput]) throws -> [Card] {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let updatedCards = try database.updateCards(workspaceId: workspaceId, updates: updates)
        try self.reload()
        self.triggerCloudSyncIfLinked()
        return updatedCards
    }

    func deleteCards(cardIds: [String]) throws -> BulkDeleteCardsResult {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let result = try database.deleteCards(workspaceId: workspaceId, cardIds: cardIds)
        try self.reload()
        self.triggerCloudSyncIfLinked()
        return result
    }

    func createDeck(input: DeckEditorInput) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let createdDeck = try database.createDeck(workspaceId: workspaceId, input: input)
        self.applyDeckMutation(deck: createdDeck, now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func updateDeck(deckId: String, input: DeckEditorInput) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let updatedDeck = try database.updateDeck(workspaceId: workspaceId, deckId: deckId, input: input)
        self.applyDeckMutation(deck: updatedDeck, now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func deleteDeck(deckId: String) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let deletedDeck = try database.deleteDeck(workspaceId: workspaceId, deckId: deckId)
        self.applyDeckMutation(deck: deletedDeck, now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func submitReview(cardId: String, rating: ReviewRating) throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let updatedCard = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: rating,
                reviewedAtClient: currentIsoTimestamp()
            )
        )
        self.applyCardMutation(card: updatedCard, now: Date())
        self.triggerCloudSyncIfLinked()
    }

    /// Optimistically removes a card from the review queue and schedules submit in background.
    func enqueueReviewSubmission(cardId: String, rating: ReviewRating) throws {
        guard self.reviewSubmissionExecutor != nil else {
            throw LocalStoreError.uninitialized("Review submission executor is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }
        guard self.cards.contains(where: { card in
            card.cardId == cardId && card.deletedAt == nil
        }) else {
            throw LocalStoreError.notFound("Card not found")
        }
        guard self.pendingReviewCardIds.contains(cardId) == false else {
            throw LocalStoreError.validation("Review submission is already pending for this card")
        }

        let request = ReviewSubmissionRequest(
            id: UUID().uuidString.lowercased(),
            workspaceId: workspaceId,
            cardId: cardId,
            rating: rating,
            reviewedAtClient: currentIsoTimestamp()
        )
        self.pendingReviewCardIds.insert(cardId)
        self.pendingReviewRequests.append(request)
        self.reviewSubmissionFailure = nil
        self.startReviewProcessorIfNeeded()
    }

    /// Returns `true` while one review submission for this card is still being processed.
    func isReviewPending(cardId: String) -> Bool {
        self.pendingReviewCardIds.contains(cardId)
    }

    /// Clears the currently presented review submission failure alert.
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
        self.triggerCloudSyncIfLinked()
    }

    func sendCloudSignInCode(email: String) async throws -> CloudOtpChallenge {
        let configuration = try loadCloudServiceConfiguration()
        let challenge = try await self.cloudAuthService.sendCode(
            email: email,
            authBaseUrl: configuration.authBaseUrl
        )
        self.globalErrorMessage = ""
        return challenge
    }

    func verifyCloudOtp(challenge: CloudOtpChallenge, code: String) async throws -> CloudVerifiedAuthContext {
        let configuration = try loadCloudServiceConfiguration()
        let credentials = try await self.cloudAuthService.verifyCode(
            challenge: challenge,
            code: code,
            authBaseUrl: configuration.authBaseUrl
        )

        self.globalErrorMessage = ""
        return CloudVerifiedAuthContext(
            apiBaseUrl: configuration.apiBaseUrl,
            credentials: credentials
        )
    }

    func prepareCloudLink(verifiedContext: CloudVerifiedAuthContext) async throws -> CloudWorkspaceLinkContext {
        guard let cloudSyncService else {
            throw LocalStoreError.uninitialized("Cloud sync service is unavailable")
        }

        let account = try await cloudSyncService.fetchCloudAccount(
            apiBaseUrl: verifiedContext.apiBaseUrl,
            bearerToken: verifiedContext.credentials.idToken
        )

        self.globalErrorMessage = ""
        return CloudWorkspaceLinkContext(
            userId: account.userId,
            email: account.email,
            apiBaseUrl: verifiedContext.apiBaseUrl,
            credentials: verifiedContext.credentials,
            workspaces: account.workspaces
        )
    }

    func completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) async throws {
        guard let cloudSyncService else {
            throw LocalStoreError.uninitialized("Cloud sync service is unavailable")
        }
        guard let workspace else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let linkedWorkspace: CloudWorkspaceSummary
        switch selection {
        case .existing(let workspaceId):
            // Workspace choice is explicit now so future device-side workspace
            // switching can reuse the same linking surface.
            logCloudPhase(
                phase: .workspaceSelect,
                outcome: "start",
                workspaceId: workspaceId,
                selection: "existing"
            )
            linkedWorkspace = try await cloudSyncService.selectWorkspace(
                apiBaseUrl: linkContext.apiBaseUrl,
                bearerToken: linkContext.credentials.idToken,
                workspaceId: workspaceId
            )
        case .createNew:
            logCloudPhase(
                phase: .workspaceCreate,
                outcome: "start",
                selection: "create_new"
            )
            linkedWorkspace = try await cloudSyncService.createWorkspace(
                apiBaseUrl: linkContext.apiBaseUrl,
                bearerToken: linkContext.credentials.idToken,
                name: workspace.name
            )
        }

        try self.credentialStore.saveCredentials(credentials: linkContext.credentials)
        try await self.finishCloudLink(
            linkedSession: CloudLinkedSession(
                userId: linkContext.userId,
                workspaceId: linkedWorkspace.workspaceId,
                email: linkContext.email,
                apiBaseUrl: linkContext.apiBaseUrl,
                bearerToken: linkContext.credentials.idToken
            )
        )
        self.globalErrorMessage = ""
    }

    func disconnectCloudAccount() throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        self.cloudAuthService.resetChallengeSession()
        try self.credentialStore.clearCredentials()
        try database.updateCloudSettings(
            cloudState: .disconnected,
            linkedUserId: nil,
            linkedWorkspaceId: nil,
            linkedEmail: nil
        )
        self.syncStatus = .idle
        self.lastSuccessfulCloudSyncAt = nil
        self.activeCloudSession = nil
        self.globalErrorMessage = ""
        try self.reload()
    }

    private func finishCloudLink(linkedSession: CloudLinkedSession) async throws {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let localWorkspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        self.syncStatus = .syncing
        do {
            let needsBootstrap = self.cloudSettings?.cloudState != .linked
                || self.cloudSettings?.linkedWorkspaceId != linkedSession.workspaceId

            logCloudPhase(
                phase: .linkLocalWorkspace,
                outcome: "start",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId
            )
            try database.relinkWorkspace(localWorkspaceId: localWorkspaceId, linkedSession: linkedSession)
            if needsBootstrap {
                try database.bootstrapOutbox(workspaceId: linkedSession.workspaceId)
            }

            self.activeCloudSession = linkedSession
            try self.reload()
            try await self.runLinkedSync(linkedSession: linkedSession)
            self.lastSuccessfulCloudSyncAt = currentIsoTimestamp()
            self.syncStatus = .idle
            self.globalErrorMessage = ""
            logCloudPhase(
                phase: .linkedSync,
                outcome: "success",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId
            )
            try self.reload()
        } catch {
            logCloudPhase(
                phase: .linkedSync,
                outcome: "failure",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId,
                errorMessage: localizedMessage(error: error)
            )
            self.syncStatus = .failed(message: localizedMessage(error: error))
            self.globalErrorMessage = localizedMessage(error: error)
            throw error
        }
    }

    func syncCloudNow() async throws {
        if self.activeCloudSession == nil {
            try await self.restoreCloudLinkFromStoredCredentials()
            return
        }

        self.syncStatus = .syncing
        do {
            let linkedSession = try await self.withAuthenticatedCloudSession { session in
                try await self.runLinkedSync(linkedSession: session)
                return session
            }
            self.activeCloudSession = linkedSession
            self.lastSuccessfulCloudSyncAt = currentIsoTimestamp()
            self.syncStatus = .idle
            self.globalErrorMessage = ""
            try self.reload()
        } catch {
            self.syncStatus = self.cloudSettings?.cloudState == .linked
                ? .failed(message: localizedMessage(error: error))
                : .idle
            self.globalErrorMessage = localizedMessage(error: error)
            throw error
        }
    }

    func syncCloudIfLinked() async {
        do {
            let hasStoredCredentials = try self.credentialStore.loadCredentials() != nil
            if self.activeCloudSession == nil && hasStoredCredentials == false {
                if self.cloudSettings?.cloudState == .linked {
                    try self.disconnectCloudAccount()
                }

                return
            }

            try await self.syncCloudNow()
        } catch {
            self.globalErrorMessage = localizedMessage(error: error)
        }
    }

    func authenticatedCloudSessionForAI() async throws -> CloudLinkedSession {
        try await self.prepareAuthenticatedCloudSessionForAI()
    }

    func warmUpAuthenticatedCloudSessionForAI() async {
        guard self.cloudSettings?.cloudState == .linked else {
            return
        }

        do {
            _ = try await self.prepareAuthenticatedCloudSessionForAI()
        } catch {
            logFlashcardsError(
                domain: "chat",
                action: "ai_chat_session_warmup_failed",
                metadata: [
                    "message": localizedMessage(error: error),
                    "selectedTab": String(describing: self.selectedTab),
                ]
            )
        }
    }

    func loadAIReviewHistory(limit: Int, cardId: String?) throws -> [ReviewEvent] {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let events = try database.loadReviewEvents(workspaceId: workspaceId)
        let filteredEvents = cardId == nil
            ? events
            : events.filter { event in
                event.cardId == cardId
            }

        return Array(filteredEvents.prefix(limit))
    }

    func loadAIOutboxEntries(limit: Int) throws -> [PersistedOutboxEntry] {
        guard let database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        return try database.loadOutboxEntries(workspaceId: workspaceId, limit: limit)
    }

    /// Lists long-lived remote bot connections for the linked cloud account.
    func listAgentApiKeys() async throws -> (connections: [AgentApiKeyConnection], instructions: String) {
        guard let cloudSyncService else {
            throw LocalStoreError.uninitialized("Cloud sync service is unavailable")
        }

        return try await self.withAuthenticatedCloudSession { session in
            try await cloudSyncService.listAgentApiKeys(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken
            )
        }
    }

    /// Revokes one long-lived remote bot connection for the linked cloud account.
    func revokeAgentApiKey(connectionId: String) async throws -> (connection: AgentApiKeyConnection, instructions: String) {
        guard let cloudSyncService else {
            throw LocalStoreError.uninitialized("Cloud sync service is unavailable")
        }

        return try await self.withAuthenticatedCloudSession { session in
            try await cloudSyncService.revokeAgentApiKey(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                connectionId: connectionId
            )
        }
    }

    private func applyLoadedSnapshot(snapshot: AppStateSnapshot, now: Date) {
        self.workspace = snapshot.workspace
        self.userSettings = snapshot.userSettings
        self.schedulerSettings = snapshot.schedulerSettings
        self.cloudSettings = snapshot.cloudSettings
        self.applyLocalState(cards: snapshot.cards, decks: snapshot.decks, now: now)
    }

    func cardsMatchingDeck(deck: Deck) -> [Card] {
        matchingCardsForDeck(deck: deck, cards: self.cards)
    }

    private func startReviewLoad(reviewFilter: ReviewFilter, now: Date) {
        self.cancelActiveReviewLoad()

        let requestId = UUID().uuidString.lowercased()
        let sourceVersion = self.reviewSourceVersion
        let cards = self.cards
        let decks = self.decks

        self.selectedReviewFilter = reviewFilter
        self.persistSelectedReviewFilter(reviewFilter: reviewFilter)
        self.reviewQueue = []
        self.reviewTimeline = []
        self.isReviewHeadLoading = true
        self.isReviewTimelineLoading = true
        self.activeReviewLoadRequestId = requestId
        self.globalErrorMessage = ""

        self.activeReviewLoadTask = Task { @MainActor in
            do {
                let reviewHeadState = try await self.reviewHeadLoader(
                    reviewFilter,
                    decks,
                    cards,
                    now,
                    reviewSeedQueueSize
                )
                guard self.shouldApplyReviewLoadResult(
                    requestId: requestId,
                    sourceVersion: sourceVersion
                ) else {
                    return
                }

                self.selectedReviewFilter = reviewHeadState.resolvedReviewFilter
                self.persistSelectedReviewFilter(reviewFilter: reviewHeadState.resolvedReviewFilter)
                self.reviewQueue = reviewHeadState.seedReviewQueue
                self.isReviewHeadLoading = false

                let reviewComputedState = try await self.reviewStateLoader(
                    reviewHeadState.resolvedReviewFilter,
                    decks,
                    cards,
                    now
                )
                guard self.shouldApplyReviewLoadResult(
                    requestId: requestId,
                    sourceVersion: sourceVersion
                ) else {
                    return
                }

                self.applyReviewComputedState(reviewState: reviewComputedState)
                self.isReviewTimelineLoading = false
                self.clearActiveReviewLoad(requestId: requestId)
            } catch is CancellationError {
                self.clearActiveReviewLoad(requestId: requestId)
            } catch {
                guard self.shouldApplyReviewLoadResult(
                    requestId: requestId,
                    sourceVersion: sourceVersion
                ) else {
                    return
                }

                self.isReviewHeadLoading = false
                self.isReviewTimelineLoading = false
                self.globalErrorMessage = localizedMessage(error: error)
                self.clearActiveReviewLoad(requestId: requestId)
            }
        }
    }

    private func refreshReviewState(now: Date) {
        self.applyReviewComputedState(
            reviewState: makeReviewComputedState(
                reviewFilter: self.selectedReviewFilter,
                decks: self.decks,
                cards: self.cards,
                now: now
            )
        )
        self.isReviewHeadLoading = false
        self.isReviewTimelineLoading = false
    }

    private func applyCardMutation(card: Card, now: Date) {
        self.applyLocalState(
            cards: applyingCardMutation(cards: self.cards, card: card),
            decks: self.decks,
            now: now
        )
    }

    private func applyDeckMutation(deck: Deck, now: Date) {
        self.applyLocalState(
            cards: self.cards,
            decks: applyingDeckMutation(decks: self.decks, deck: deck),
            now: now
        )
    }

    private func applyLocalState(cards: [Card], decks: [Deck], now: Date) {
        self.reviewSourceVersion += 1
        self.cancelActiveReviewLoad()
        self.cards = cards
        self.decks = decks
        self.deckItems = makeDeckListItems(decks: decks, cards: cards, now: now)
        self.refreshReviewState(now: now)
        self.homeSnapshot = makeHomeSnapshot(cards: cards, deckCount: decks.count, now: now)
        self.globalErrorMessage = ""
    }

    private func applyReviewComputedState(reviewState: ReviewComputedState) {
        self.selectedReviewFilter = reviewState.resolvedReviewFilter
        self.persistSelectedReviewFilter(reviewFilter: reviewState.resolvedReviewFilter)
        self.reviewQueue = reviewState.reviewQueue
        self.reviewTimeline = reviewState.reviewTimeline
    }

    private func shouldApplyReviewLoadResult(requestId: String, sourceVersion: Int) -> Bool {
        guard Task.isCancelled == false else {
            return false
        }
        guard self.activeReviewLoadRequestId == requestId else {
            return false
        }

        return self.reviewSourceVersion == sourceVersion
    }

    private func cancelActiveReviewLoad() {
        self.activeReviewLoadTask?.cancel()
        self.activeReviewLoadTask = nil
        self.activeReviewLoadRequestId = nil
    }

    private func clearActiveReviewLoad(requestId: String) {
        guard self.activeReviewLoadRequestId == requestId else {
            return
        }

        self.activeReviewLoadTask = nil
        self.activeReviewLoadRequestId = nil
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

    private func requestTabSelection(tab: AppTab) {
        self.selectedTab = tab
        self.tabSelectionRequest = TabSelectionRequest(
            id: UUID().uuidString.lowercased(),
            tab: tab
        )
    }

    private func makeAIChatStore() -> AIChatStore {
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
            snapshotLoader: workspaceRuntime
        )
    }

    private func triggerCloudSyncIfLinked() {
        Task { @MainActor in
            await self.syncCloudIfLinked()
        }
    }

    private func startReviewProcessorIfNeeded() {
        guard self.isReviewProcessorRunning == false else {
            return
        }

        self.isReviewProcessorRunning = true
        Task { @MainActor in
            await self.processPendingReviewRequests()
        }
    }

    /// Processes enqueued review submissions serially to preserve deterministic ordering.
    private func processPendingReviewRequests() async {
        defer {
            self.isReviewProcessorRunning = false
            // Enqueue can append while the processor is suspended on awaits.
            if self.pendingReviewRequests.isEmpty == false {
                self.startReviewProcessorIfNeeded()
            }
        }

        while self.pendingReviewRequests.isEmpty == false {
            let request = self.pendingReviewRequests.removeFirst()
            await self.processReviewSubmissionRequest(request: request)
        }
    }

    private func processReviewSubmissionRequest(request: ReviewSubmissionRequest) async {
        guard let reviewSubmissionExecutor else {
            self.handleReviewSubmissionFailure(
                request: request,
                submissionError: LocalStoreError.uninitialized("Review submission executor is unavailable")
            )
            return
        }

        do {
            let updatedCard = try await reviewSubmissionExecutor.submitReview(
                workspaceId: request.workspaceId,
                submission: ReviewSubmission(
                    cardId: request.cardId,
                    rating: request.rating,
                    reviewedAtClient: request.reviewedAtClient
                )
            )
            self.applyCardMutation(card: updatedCard, now: Date())
            self.pendingReviewCardIds.remove(request.cardId)
            self.triggerCloudSyncIfLinked()
        } catch {
            self.handleReviewSubmissionFailure(request: request, submissionError: error)
        }
    }

    /// Restores canonical queue state after a failed optimistic review submission.
    private func handleReviewSubmissionFailure(request: ReviewSubmissionRequest, submissionError: Error) {
        self.pendingReviewCardIds.remove(request.cardId)
        let submissionErrorMessage = localizedMessage(error: submissionError)
        do {
            try self.reload()
            self.reviewSubmissionFailure = ReviewSubmissionFailure(
                id: request.id,
                message: submissionErrorMessage
            )
        } catch {
            let reloadErrorMessage = localizedMessage(error: error)
            self.reviewSubmissionFailure = ReviewSubmissionFailure(
                id: request.id,
                message: "\(submissionErrorMessage)\n\nReload failed: \(reloadErrorMessage)"
            )
        }
    }

    private func refreshCloudCredentials(forceRefresh: Bool) async throws -> StoredCloudCredentials {
        let configuration = try loadCloudServiceConfiguration()
        guard let storedCredentials = try self.credentialStore.loadCredentials() else {
            throw LocalStoreError.uninitialized("Cloud credentials are unavailable")
        }

        if forceRefresh == false && shouldRefreshCloudIdToken(idTokenExpiresAt: storedCredentials.idTokenExpiresAt, now: Date()) == false {
            return storedCredentials
        }

        let refreshedToken = try await self.cloudAuthService.refreshIdToken(
            refreshToken: storedCredentials.refreshToken,
            authBaseUrl: configuration.authBaseUrl
        )
        let updatedCredentials = StoredCloudCredentials(
            refreshToken: storedCredentials.refreshToken,
            idToken: refreshedToken.idToken,
            idTokenExpiresAt: refreshedToken.idTokenExpiresAt
        )
        try self.credentialStore.saveCredentials(credentials: updatedCredentials)

        if let activeCloudSession {
            self.activeCloudSession = CloudLinkedSession(
                userId: activeCloudSession.userId,
                workspaceId: activeCloudSession.workspaceId,
                email: activeCloudSession.email,
                apiBaseUrl: activeCloudSession.apiBaseUrl,
                bearerToken: updatedCredentials.idToken
            )
        }

        return updatedCredentials
    }

    private func prepareAuthenticatedCloudSessionForAI() async throws -> CloudLinkedSession {
        if let activePreparation = self.activeAIChatSessionPreparation {
            return try await activePreparation.task.value
        }

        let preparation = AIChatSessionPreparationState(
            id: UUID().uuidString.lowercased(),
            task: Task { @MainActor in
                if self.activeCloudSession == nil {
                    try await self.restoreCloudLinkFromStoredCredentials()
                }

                return try await self.withAuthenticatedCloudSession { session in
                    session
                }
            }
        )
        self.activeAIChatSessionPreparation = preparation

        do {
            let session = try await preparation.task.value
            if self.activeAIChatSessionPreparation?.id == preparation.id {
                self.activeAIChatSessionPreparation = nil
            }
            return session
        } catch {
            if self.activeAIChatSessionPreparation?.id == preparation.id {
                self.activeAIChatSessionPreparation = nil
            }
            throw error
        }
    }

    private func restoreCloudLinkFromStoredCredentials() async throws {
        let configuration = try loadCloudServiceConfiguration()

        do {
            let credentials = try await self.refreshCloudCredentials(forceRefresh: false)
            try await self.finishCloudLink(
                linkedSession: try self.storedLinkedSession(
                    apiBaseUrl: configuration.apiBaseUrl,
                    bearerToken: credentials.idToken
                )
            )
            return
        } catch {
            if self.isCloudAuthorizationError(error) == false {
                throw error
            }
        }

        do {
            let refreshedCredentials = try await self.refreshCloudCredentials(forceRefresh: true)
            try await self.finishCloudLink(
                linkedSession: try self.storedLinkedSession(
                    apiBaseUrl: configuration.apiBaseUrl,
                    bearerToken: refreshedCredentials.idToken
                )
            )
        } catch {
            if self.isCloudAuthorizationError(error) {
                try self.disconnectCloudAccount()
            }

            throw error
        }
    }

    private func withAuthenticatedCloudSession<Result>(
        operation: (CloudLinkedSession) async throws -> Result
    ) async throws -> Result {
        do {
            let credentials = try await self.refreshCloudCredentials(forceRefresh: false)
            let linkedSession = try self.sessionWithUpdatedBearerToken(credentials: credentials)
            return try await operation(linkedSession)
        } catch {
            if self.isCloudAuthorizationError(error) == false {
                throw error
            }
        }

        do {
            let refreshedCredentials = try await self.refreshCloudCredentials(forceRefresh: true)
            let linkedSession = try self.sessionWithUpdatedBearerToken(credentials: refreshedCredentials)
            return try await operation(linkedSession)
        } catch {
            if self.isCloudAuthorizationError(error) {
                try self.disconnectCloudAccount()
            }

            throw error
        }
    }

    private func sessionWithUpdatedBearerToken(credentials: StoredCloudCredentials) throws -> CloudLinkedSession {
        guard let activeCloudSession else {
            throw LocalStoreError.uninitialized("Cloud session is unavailable")
        }

        let nextSession = CloudLinkedSession(
            userId: activeCloudSession.userId,
            workspaceId: activeCloudSession.workspaceId,
            email: activeCloudSession.email,
            apiBaseUrl: activeCloudSession.apiBaseUrl,
            bearerToken: credentials.idToken
        )
        self.activeCloudSession = nextSession
        return nextSession
    }

    private func storedLinkedSession(apiBaseUrl: String, bearerToken: String) throws -> CloudLinkedSession {
        guard let cloudSettings else {
            throw LocalStoreError.uninitialized("Cloud settings are unavailable")
        }
        guard cloudSettings.cloudState == .linked else {
            throw LocalStoreError.uninitialized("Cloud account is not linked")
        }
        guard let linkedUserId = cloudSettings.linkedUserId, linkedUserId.isEmpty == false else {
            throw LocalStoreError.uninitialized("Linked user is unavailable")
        }
        guard let linkedWorkspaceId = cloudSettings.linkedWorkspaceId, linkedWorkspaceId.isEmpty == false else {
            throw LocalStoreError.uninitialized("Linked workspace is unavailable")
        }

        let linkedSession = CloudLinkedSession(
            userId: linkedUserId,
            workspaceId: linkedWorkspaceId,
            email: cloudSettings.linkedEmail,
            apiBaseUrl: apiBaseUrl,
            bearerToken: bearerToken
        )
        self.activeCloudSession = linkedSession
        return linkedSession
    }

    private func isCloudAuthorizationError(_ error: Error) -> Bool {
        if let syncError = error as? CloudSyncError, syncError.statusCode == 401 {
            return true
        }

        if let authError = error as? CloudAuthError, authError.statusCode == 401 {
            return true
        }

        return false
    }

    private func runLinkedSync(linkedSession: CloudLinkedSession) async throws {
        guard let cloudSyncService else {
            throw LocalStoreError.uninitialized("Cloud sync service is unavailable")
        }

        if let activeCloudSyncTask {
            self.pendingCloudResync = true
            try await activeCloudSyncTask.value
            return
        }

        while true {
            self.pendingCloudResync = false
            let syncTask = Task {
                try await cloudSyncService.runLinkedSync(linkedSession: linkedSession)
            }
            self.activeCloudSyncTask = syncTask

            do {
                try await syncTask.value
                self.activeCloudSyncTask = nil
            } catch {
                self.activeCloudSyncTask = nil
                throw error
            }

            if self.pendingCloudResync == false {
                break
            }
        }
    }
}
