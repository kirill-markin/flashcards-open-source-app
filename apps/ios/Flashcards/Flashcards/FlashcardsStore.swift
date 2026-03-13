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
private let accountDeletionPendingUserDefaultsKey: String = "account-deletion-pending"
let accountDeletionConfirmationText: String = "delete my account"

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

struct TabSelectionRequest: Equatable, Sendable {
    let id: String
    let tab: AppTab
}

enum AccountDeletionState: Equatable {
    case hidden
    case inProgress
    case failed(message: String)
}

typealias ReviewHeadLoader = @Sendable (
    _ reviewFilter: ReviewFilter,
    _ decks: [Deck],
    _ cards: [Card],
    _ now: Date,
    _ seedQueueSize: Int
) async throws -> ReviewHeadLoadState

typealias ReviewCountsLoader = @Sendable (
    _ databaseURL: URL,
    _ workspaceId: String,
    _ reviewQueryDefinition: ReviewQueryDefinition,
    _ now: Date
) async throws -> ReviewCounts

typealias ReviewQueueChunkLoader = @Sendable (
    _ reviewFilter: ReviewFilter,
    _ decks: [Deck],
    _ cards: [Card],
    _ excludedCardIds: Set<String>,
    _ now: Date,
    _ chunkSize: Int
) async throws -> ReviewQueueChunkLoadState

typealias ReviewTimelinePageLoader = @Sendable (
    _ databaseURL: URL,
    _ workspaceId: String,
    _ reviewQueryDefinition: ReviewQueryDefinition,
    _ now: Date,
    _ limit: Int,
    _ offset: Int
) async throws -> ReviewTimelinePage

private let reviewSeedQueueSize: Int = 8
private let reviewQueueReplenishmentThreshold: Int = 4

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

private func defaultReviewCountsLoader(
    databaseURL: URL,
    workspaceId: String,
    reviewQueryDefinition: ReviewQueryDefinition,
    now: Date
) async throws -> ReviewCounts {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        let database = try LocalDatabase(databaseURL: databaseURL)
        return try database.loadReviewCounts(
            workspaceId: workspaceId,
            reviewQueryDefinition: reviewQueryDefinition,
            now: now
        )
    }.value
}

private func defaultReviewQueueChunkLoader(
    reviewFilter: ReviewFilter,
    decks: [Deck],
    cards: [Card],
    excludedCardIds: Set<String>,
    now: Date,
    chunkSize: Int
) async throws -> ReviewQueueChunkLoadState {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return makeReviewQueueChunkLoadState(
            reviewFilter: reviewFilter,
            decks: decks,
            cards: cards,
            now: now,
            limit: chunkSize,
            excludedCardIds: excludedCardIds
        )
    }.value
}

private func defaultReviewTimelinePageLoader(
    databaseURL: URL,
    workspaceId: String,
    reviewQueryDefinition: ReviewQueryDefinition,
    now: Date,
    limit: Int,
    offset: Int
) async throws -> ReviewTimelinePage {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        let database = try LocalDatabase(databaseURL: databaseURL)
        return try database.loadReviewTimelinePage(
            workspaceId: workspaceId,
            reviewQueryDefinition: reviewQueryDefinition,
            now: now,
            limit: limit,
            offset: offset
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
    @Published private(set) var reviewCounts: ReviewCounts
    @Published private(set) var isReviewHeadLoading: Bool
    @Published private(set) var isReviewCountsLoading: Bool
    @Published private(set) var isReviewQueueChunkLoading: Bool
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
    @Published private(set) var accountDeletionState: AccountDeletionState
    @Published private(set) var accountDeletionSuccessMessage: String?

    private let database: LocalDatabase?
    private let dependencies: FlashcardsStoreDependencies
    private let userDefaults: UserDefaults
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private(set) var selectedTab: AppTab
    private var reviewRuntime: ReviewQueueRuntime
    private var cloudRuntime: CloudSessionRuntime
    private var isAccountDeletionRunning: Bool
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
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
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
        reviewCountsLoader: @escaping ReviewCountsLoader,
        reviewQueueChunkLoader: @escaping ReviewQueueChunkLoader,
        reviewTimelinePageLoader: @escaping ReviewTimelinePageLoader,
        initialGlobalErrorMessage: String
    ) {
        let initialSelectedReviewFilter = FlashcardsStore.loadSelectedReviewFilter(
            userDefaults: userDefaults,
            decoder: decoder
        )
        let initialReviewPublishedState = ReviewQueueRuntime.makeInitialPublishedState(
            selectedReviewFilter: initialSelectedReviewFilter
        )
        let dependencies = FlashcardsStoreDependencies(
            cloudAuthService: cloudAuthService,
            cloudSyncService: database.map { initializedDatabase in
                CloudSyncService(database: initializedDatabase)
            },
            credentialStore: credentialStore,
            reviewSubmissionExecutor: reviewSubmissionExecutor,
            reviewHeadLoader: reviewHeadLoader,
            reviewCountsLoader: reviewCountsLoader,
            reviewQueueChunkLoader: reviewQueueChunkLoader,
            reviewTimelinePageLoader: reviewTimelinePageLoader
        )

        self.workspace = nil
        self.userSettings = nil
        self.schedulerSettings = nil
        self.cloudSettings = nil
        self.cards = []
        self.decks = []
        self.deckItems = []
        self.selectedReviewFilter = initialReviewPublishedState.selectedReviewFilter
        self.reviewQueue = initialReviewPublishedState.reviewQueue
        self.reviewCounts = initialReviewPublishedState.reviewCounts
        self.isReviewHeadLoading = initialReviewPublishedState.isReviewHeadLoading
        self.isReviewCountsLoading = initialReviewPublishedState.isReviewCountsLoading
        self.isReviewQueueChunkLoading = initialReviewPublishedState.isReviewQueueChunkLoading
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
        self.pendingReviewCardIds = initialReviewPublishedState.pendingReviewCardIds
        self.reviewSubmissionFailure = initialReviewPublishedState.reviewSubmissionFailure
        self.accountDeletionState = .hidden
        self.accountDeletionSuccessMessage = nil
        self.database = database
        self.dependencies = dependencies
        self.userDefaults = userDefaults
        self.encoder = encoder
        self.decoder = decoder
        self.reviewRuntime = ReviewQueueRuntime(
            initialSelectedReviewFilter: initialSelectedReviewFilter,
            reviewSeedQueueSize: reviewSeedQueueSize,
            reviewQueueReplenishmentThreshold: reviewQueueReplenishmentThreshold
        )
        self.cloudRuntime = CloudSessionRuntime(
            cloudAuthService: dependencies.cloudAuthService,
            cloudSyncService: dependencies.cloudSyncService,
            credentialStore: dependencies.credentialStore
        )
        self.isAccountDeletionRunning = false

        if database != nil && initialGlobalErrorMessage.isEmpty {
            do {
                try self.reload()
            } catch {
                self.globalErrorMessage = localizedMessage(error: error)
            }
        }

        if self.userDefaults.bool(forKey: accountDeletionPendingUserDefaultsKey) {
            self.accountDeletionState = .inProgress
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
        self.reviewCounts.totalCount
    }

    var displayedReviewDueCount: Int {
        max(
            0,
            self.reviewCounts.dueCount - self.reviewRuntime.pendingReviewCount(
                publishedState: self.currentReviewPublishedState(),
                cards: self.cards,
                decks: self.decks
            )
        )
    }

    /// Review queue visible to UI after optimistic removals are applied.
    var effectiveReviewQueue: [Card] {
        self.reviewRuntime.effectiveReviewQueue(publishedState: self.currentReviewPublishedState())
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
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        let persistedCard = try context.database.saveCard(
            workspaceId: context.workspaceId,
            input: input,
            cardId: editingCardId
        )
        self.applyCardMutation(card: persistedCard, now: Date())
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
        let deletedCard = try context.database.deleteCard(workspaceId: context.workspaceId, cardId: cardId)
        self.applyCardMutation(card: deletedCard, now: Date())
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
        let createdDeck = try context.database.createDeck(workspaceId: context.workspaceId, input: input)
        self.applyDeckMutation(deck: createdDeck, now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func updateDeck(deckId: String, input: DeckEditorInput) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        let updatedDeck = try context.database.updateDeck(
            workspaceId: context.workspaceId,
            deckId: deckId,
            input: input
        )
        self.applyDeckMutation(deck: updatedDeck, now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func deleteDeck(deckId: String) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        let deletedDeck = try context.database.deleteDeck(workspaceId: context.workspaceId, deckId: deckId)
        self.applyDeckMutation(deck: deletedDeck, now: Date())
        self.triggerCloudSyncIfLinked()
    }

    func submitReview(cardId: String, rating: ReviewRating) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        let updatedCard = try context.database.submitReview(
            workspaceId: context.workspaceId,
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
        guard self.dependencies.reviewSubmissionExecutor != nil else {
            throw self.reviewRuntime.reviewSubmissionExecutorUnavailableError()
        }

        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        let nextReviewState = try self.reviewRuntime.enqueueReviewSubmission(
            publishedState: self.currentReviewPublishedState(),
            workspaceId: workspaceId,
            cardId: cardId,
            rating: rating,
            cards: self.cards
        )
        self.applyReviewPublishedState(reviewState: nextReviewState)
        self.startReviewQueueChunkLoadIfNeeded(now: Date())
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

    func sendCloudSignInCode(email: String) async throws -> CloudOtpChallenge {
        let configuration = try loadCloudServiceConfiguration()
        let challenge = try await self.cloudRuntime.sendCode(email: email, configuration: configuration)
        self.globalErrorMessage = ""
        return challenge
    }

    func verifyCloudOtp(challenge: CloudOtpChallenge, code: String) async throws -> CloudVerifiedAuthContext {
        let configuration = try loadCloudServiceConfiguration()
        self.globalErrorMessage = ""
        return try await self.cloudRuntime.verifyCode(
            challenge: challenge,
            code: code,
            configuration: configuration
        )
    }

    func prepareCloudLink(verifiedContext: CloudVerifiedAuthContext) async throws -> CloudWorkspaceLinkContext {
        let account = try await self.cloudRuntime.fetchCloudAccount(verifiedContext: verifiedContext)

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
        guard let workspace else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let linkedWorkspace = try await self.cloudRuntime.selectOrCreateWorkspace(
            linkContext: linkContext,
            selection: selection,
            localWorkspaceName: workspace.name
        )

        try self.cloudRuntime.saveCredentials(credentials: linkContext.credentials)
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
        let database = try requireLocalDatabase(database: self.database)
        self.cloudRuntime.cancelForAccountDeletion()
        try self.cloudRuntime.clearCredentials()
        try database.updateCloudSettings(
            cloudState: .disconnected,
            linkedUserId: nil,
            linkedWorkspaceId: nil,
            linkedEmail: nil
        )
        self.syncStatus = .idle
        self.lastSuccessfulCloudSyncAt = nil
        self.globalErrorMessage = ""
        try self.reload()
    }

    func beginAccountDeletion() {
        self.userDefaults.set(true, forKey: accountDeletionPendingUserDefaultsKey)
        self.accountDeletionState = .inProgress
        Task { @MainActor in
            await self.runPendingAccountDeletion()
        }
    }

    func retryPendingAccountDeletion() {
        self.accountDeletionState = .inProgress
        Task { @MainActor in
            await self.runPendingAccountDeletion()
        }
    }

    func resumePendingAccountDeletionIfNeeded() async {
        guard self.userDefaults.bool(forKey: accountDeletionPendingUserDefaultsKey) else {
            return
        }

        self.accountDeletionState = .inProgress
        await self.runPendingAccountDeletion()
    }

    func dismissAccountDeletionSuccessMessage() {
        self.accountDeletionSuccessMessage = nil
    }

    private func finishCloudLink(linkedSession: CloudLinkedSession) async throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)

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
            try context.database.relinkWorkspace(
                localWorkspaceId: context.workspaceId,
                linkedSession: linkedSession
            )
            if needsBootstrap {
                try context.database.bootstrapOutbox(workspaceId: linkedSession.workspaceId)
            }

            self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
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
        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials()
            return
        }

        self.syncStatus = .syncing
        do {
            let linkedSession = try await self.withAuthenticatedCloudSession { session in
                try await self.runLinkedSync(linkedSession: session)
                return session
            }
            _ = linkedSession
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
        if self.userDefaults.bool(forKey: accountDeletionPendingUserDefaultsKey) {
            await self.resumePendingAccountDeletionIfNeeded()
            return
        }

        do {
            let hasStoredCredentials = try self.cloudRuntime.loadCredentials() != nil
            if self.cloudRuntime.activeCloudSession() == nil && hasStoredCredentials == false {
                if self.cloudSettings?.cloudState == .linked {
                    try self.disconnectCloudAccount()
                }

                return
            }

            try await self.syncCloudNow()
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                return
            }

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

    /// Lists long-lived remote bot connections for the linked cloud account.
    func listAgentApiKeys() async throws -> (connections: [AgentApiKeyConnection], instructions: String) {
        return try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            return try await cloudSyncService.listAgentApiKeys(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken
            )
        }
    }

    /// Revokes one long-lived remote bot connection for the linked cloud account.
    func revokeAgentApiKey(connectionId: String) async throws -> (connection: AgentApiKeyConnection, instructions: String) {
        return try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            return try await cloudSyncService.revokeAgentApiKey(
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

    private func currentReviewPublishedState() -> ReviewQueuePublishedState {
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

    private func applyReviewPublishedState(reviewState: ReviewQueuePublishedState) {
        self.selectedReviewFilter = reviewState.selectedReviewFilter
        self.reviewQueue = reviewState.reviewQueue
        self.reviewCounts = reviewState.reviewCounts
        self.isReviewHeadLoading = reviewState.isReviewHeadLoading
        self.isReviewCountsLoading = reviewState.isReviewCountsLoading
        self.isReviewQueueChunkLoading = reviewState.isReviewQueueChunkLoading
        self.pendingReviewCardIds = reviewState.pendingReviewCardIds
        self.reviewSubmissionFailure = reviewState.reviewSubmissionFailure
    }

    func cardsMatchingDeck(deck: Deck) -> [Card] {
        matchingCardsForDeck(deck: deck, cards: self.cards)
    }

    /// Loads one sorted queue-preview page without blocking the main review screen.
    func loadReviewTimelinePage(limit: Int, offset: Int) async throws -> ReviewTimelinePage {
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }
        guard let databaseURL = self.localDatabaseURL else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        let resolvedReviewQuery = resolveReviewQuery(
            reviewFilter: self.selectedReviewFilter,
            decks: self.decks,
            cards: self.cards
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

    private func startReviewLoad(reviewFilter: ReviewFilter, now: Date) {
        let plan = self.reviewRuntime.startReviewLoad(
            publishedState: self.currentReviewPublishedState(),
            reviewFilter: reviewFilter,
            cards: self.cards,
            decks: self.decks,
            workspaceId: self.workspace?.workspaceId,
            databaseURL: self.localDatabaseURL,
            now: now
        )
        self.applyReviewPublishedState(reviewState: plan.publishedState)
        self.persistSelectedReviewFilter(reviewFilter: plan.publishedState.selectedReviewFilter)
        self.globalErrorMessage = ""

        if let countsRequest = plan.countsRequest {
            self.startReviewCountsLoad(request: countsRequest)
        }

        let headTask = Task { @MainActor in
            do {
                let reviewHeadState = try await self.dependencies.reviewHeadLoader(
                    plan.headRequest.reviewFilter,
                    plan.headRequest.decks,
                    plan.headRequest.cards,
                    plan.headRequest.now,
                    plan.headRequest.seedQueueSize
                )
                guard let nextReviewState = self.reviewRuntime.applyReviewHeadLoadSuccess(
                    publishedState: self.currentReviewPublishedState(),
                    reviewHeadState: reviewHeadState,
                    requestId: plan.headRequest.requestId,
                    sourceVersion: plan.headRequest.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
                self.persistSelectedReviewFilter(reviewFilter: nextReviewState.selectedReviewFilter)
                self.startReviewQueueChunkLoadIfNeeded(now: plan.headRequest.now)
            } catch is CancellationError {
                return
            } catch {
                guard let nextReviewState = self.reviewRuntime.applyReviewHeadLoadFailure(
                    publishedState: self.currentReviewPublishedState(),
                    requestId: plan.headRequest.requestId,
                    sourceVersion: plan.headRequest.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
                self.globalErrorMessage = localizedMessage(error: error)
            }
        }
        self.reviewRuntime.setActiveReviewLoadTask(
            task: headTask,
            requestId: plan.headRequest.requestId
        )
    }

    private func refreshReviewState(now: Date) {
        let reviewState = self.reviewRuntime.refreshPublishedState(
            publishedState: self.currentReviewPublishedState(),
            cards: self.cards,
            decks: self.decks,
            now: now
        )
        self.applyReviewPublishedState(reviewState: reviewState)
        self.persistSelectedReviewFilter(reviewFilter: reviewState.selectedReviewFilter)
        self.startReviewQueueChunkLoadIfNeeded(now: now)
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
        self.cards = cards
        self.decks = decks
        self.deckItems = makeDeckListItems(decks: decks, cards: cards, now: now)
        self.refreshReviewState(now: now)
        self.homeSnapshot = makeHomeSnapshot(cards: cards, deckCount: decks.count, now: now)
        self.globalErrorMessage = ""
    }

    private func startReviewCountsLoad(request: ReviewCountsLoadRequest) {
        self.reviewRuntime.startReviewCountsLoad(request: request)
        let countsTask = Task { @MainActor in
            do {
                let reviewCounts = try await self.dependencies.reviewCountsLoader(
                    request.databaseURL,
                    request.workspaceId,
                    request.reviewQueryDefinition,
                    request.now
                )
                guard let nextReviewState = self.reviewRuntime.applyReviewCountsLoadSuccess(
                    publishedState: self.currentReviewPublishedState(),
                    reviewCounts: reviewCounts,
                    requestId: request.requestId,
                    sourceVersion: request.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
            } catch is CancellationError {
                return
            } catch {
                guard let nextReviewState = self.reviewRuntime.applyReviewCountsLoadFailure(
                    publishedState: self.currentReviewPublishedState(),
                    requestId: request.requestId,
                    sourceVersion: request.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
                self.globalErrorMessage = localizedMessage(error: error)
            }
        }
        self.reviewRuntime.setActiveReviewCountsTask(task: countsTask, requestId: request.requestId)
    }

    /// Keeps review responsive by topping up only when the visible queue is running low.
    private func startReviewQueueChunkLoadIfNeeded(now: Date) {
        guard let request = self.reviewRuntime.makeReviewQueueChunkLoadRequestIfNeeded(
            publishedState: self.currentReviewPublishedState(),
            cards: self.cards,
            decks: self.decks,
            now: now
        ) else {
            return
        }

        let loadingReviewState = self.reviewRuntime.markReviewQueueChunkLoading(
            publishedState: self.currentReviewPublishedState(),
            requestId: request.requestId
        )
        self.applyReviewPublishedState(reviewState: loadingReviewState)
        let queueChunkTask = Task { @MainActor in
            do {
                let queueChunkLoadState = try await self.dependencies.reviewQueueChunkLoader(
                    request.reviewFilter,
                    request.decks,
                    request.cards,
                    request.excludedCardIds,
                    request.now,
                    request.chunkSize
                )
                guard let nextReviewState = self.reviewRuntime.applyReviewQueueChunkLoadSuccess(
                    publishedState: self.currentReviewPublishedState(),
                    queueChunkLoadState: queueChunkLoadState,
                    requestId: request.requestId,
                    sourceVersion: request.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
                self.startReviewQueueChunkLoadIfNeeded(now: request.now)
            } catch is CancellationError {
                return
            } catch {
                guard let nextReviewState = self.reviewRuntime.applyReviewQueueChunkLoadFailure(
                    publishedState: self.currentReviewPublishedState(),
                    requestId: request.requestId,
                    sourceVersion: request.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
                self.globalErrorMessage = localizedMessage(error: error)
            }
        }
        self.reviewRuntime.setActiveReviewQueueChunkTask(
            task: queueChunkTask,
            requestId: request.requestId
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
            snapshotLoader: workspaceRuntime,
            voiceRecorder: AIChatVoiceRecorder(),
            audioTranscriber: AIChatTranscriptionService(
                session: URLSession.shared,
                decoder: self.decoder
            )
        )
    }

    private func triggerCloudSyncIfLinked() {
        Task { @MainActor in
            await self.syncCloudIfLinked()
        }
    }

    private func startReviewProcessorIfNeeded() {
        guard self.reviewRuntime.startReviewProcessorIfNeeded() else {
            return
        }

        Task { @MainActor in
            await self.processPendingReviewRequests()
        }
    }

    /// Processes enqueued review submissions serially to preserve deterministic ordering.
    private func processPendingReviewRequests() async {
        defer {
            let shouldRestart = self.reviewRuntime.finishReviewProcessor()
            // Enqueue can append while the processor is suspended on awaits.
            if shouldRestart {
                self.startReviewProcessorIfNeeded()
            }
        }

        while let request = self.reviewRuntime.dequeuePendingReviewRequest() {
            await self.processReviewSubmissionRequest(request: request)
        }
    }

    private func processReviewSubmissionRequest(request: ReviewSubmissionRequest) async {
        guard let reviewSubmissionExecutor = self.dependencies.reviewSubmissionExecutor else {
            self.handleReviewSubmissionFailure(
                request: request,
                submissionError: self.reviewRuntime.reviewSubmissionExecutorUnavailableError()
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
            self.applyReviewPublishedState(
                reviewState: self.reviewRuntime.completeReviewSubmission(
                    publishedState: self.currentReviewPublishedState(),
                    request: request
                )
            )
            self.triggerCloudSyncIfLinked()
        } catch {
            self.handleReviewSubmissionFailure(request: request, submissionError: error)
        }
    }

    /// Restores canonical queue state after a failed optimistic review submission.
    private func handleReviewSubmissionFailure(request: ReviewSubmissionRequest, submissionError: Error) {
        let submissionErrorMessage = localizedMessage(error: submissionError)
        do {
            try self.reload()
            self.applyReviewPublishedState(
                reviewState: self.reviewRuntime.failReviewSubmission(
                    publishedState: self.currentReviewPublishedState(),
                    request: request,
                    message: submissionErrorMessage
                )
            )
        } catch {
            let reloadErrorMessage = localizedMessage(error: error)
            self.applyReviewPublishedState(
                reviewState: self.reviewRuntime.failReviewSubmission(
                    publishedState: self.currentReviewPublishedState(),
                    request: request,
                    message: "\(submissionErrorMessage)\n\nReload failed: \(reloadErrorMessage)"
                )
            )
        }
    }

    private func refreshCloudCredentials(forceRefresh: Bool) async throws -> StoredCloudCredentials {
        let configuration = try loadCloudServiceConfiguration()
        var cloudRuntime = self.cloudRuntime
        let credentials = try await cloudRuntime.refreshCloudCredentials(
            forceRefresh: forceRefresh,
            configuration: configuration,
            now: Date()
        )
        self.cloudRuntime = cloudRuntime
        return credentials
    }

    private func prepareAuthenticatedCloudSessionForAI() async throws -> CloudLinkedSession {
        var cloudRuntime = self.cloudRuntime
        let session = try await cloudRuntime.prepareAuthenticatedCloudSessionForAI(
            restoreCloudLink: { [weak self] in
                guard let self else {
                    throw LocalStoreError.uninitialized("Flashcards store is unavailable")
                }

                try await self.restoreCloudLinkFromStoredCredentials()
            },
            resolveSession: { [weak self] in
                guard let self else {
                    throw LocalStoreError.uninitialized("Flashcards store is unavailable")
                }

                return try await self.withAuthenticatedCloudSession { session in
                    session
                }
            }
        )
        self.cloudRuntime = cloudRuntime
        return session
    }

    private func restoreCloudLinkFromStoredCredentials() async throws {
        let configuration = try loadCloudServiceConfiguration()

        do {
            let credentials = try await self.refreshCloudCredentials(forceRefresh: false)
            try await self.finishCloudLink(
                linkedSession: try self.cloudRuntime.storedLinkedSession(
                    cloudSettings: self.cloudSettings,
                    apiBaseUrl: configuration.apiBaseUrl,
                    bearerToken: credentials.idToken
                )
            )
            return
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                return
            }

            if self.isCloudAuthorizationError(error) == false {
                throw error
            }
        }

        do {
            let refreshedCredentials = try await self.refreshCloudCredentials(forceRefresh: true)
            try await self.finishCloudLink(
                linkedSession: try self.cloudRuntime.storedLinkedSession(
                    cloudSettings: self.cloudSettings,
                    apiBaseUrl: configuration.apiBaseUrl,
                    bearerToken: refreshedCredentials.idToken
                )
            )
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                return
            }

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
            let linkedSession = try self.cloudRuntime.sessionWithUpdatedBearerToken(credentials: credentials)
            return try await operation(linkedSession)
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                throw error
            }

            if self.isCloudAuthorizationError(error) == false {
                throw error
            }
        }

        do {
            let refreshedCredentials = try await self.refreshCloudCredentials(forceRefresh: true)
            let linkedSession = try self.cloudRuntime.sessionWithUpdatedBearerToken(credentials: refreshedCredentials)
            return try await operation(linkedSession)
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                throw error
            }

            if self.isCloudAuthorizationError(error) {
                try self.disconnectCloudAccount()
            }

            throw error
        }
    }

    private func isCloudAuthorizationError(_ error: Error) -> Bool {
        self.cloudRuntime.isCloudAuthorizationError(error)
    }

    private func isCloudAccountDeletedError(_ error: Error) -> Bool {
        self.cloudRuntime.isCloudAccountDeletedError(error)
    }

    private func runPendingAccountDeletion() async {
        guard self.isAccountDeletionRunning == false else {
            return
        }

        self.isAccountDeletionRunning = true
        defer {
            self.isAccountDeletionRunning = false
        }

        do {
            try await self.performCloudAccountDeletion()
            try self.completeLocalAccountDeletion()
            self.accountDeletionState = .hidden
            self.accountDeletionSuccessMessage = "Your account has been deleted."
        } catch {
            if self.isCloudAccountDeletedError(error) {
                return
            }

            self.accountDeletionState = .failed(message: localizedMessage(error: error))
        }
    }

    private func performCloudAccountDeletion() async throws {
        try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            try await cloudSyncService.deleteAccount(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                confirmationText: accountDeletionConfirmationText
            )
        }
    }

    private func completeLocalAccountDeletion() throws {
        let database = try requireLocalDatabase(database: self.database)

        self.reviewRuntime.cancelForAccountDeletion()
        self.cloudRuntime.cancelForAccountDeletion()
        try self.cloudRuntime.clearCredentials()
        self.userDefaults.removeObject(forKey: selectedReviewFilterUserDefaultsKey)
        self.userDefaults.removeObject(forKey: accountDeletionPendingUserDefaultsKey)
        self.aiChatStore.clearHistory()
        try database.resetForAccountDeletion()
        self.syncStatus = .idle
        self.lastSuccessfulCloudSyncAt = nil
        self.globalErrorMessage = ""
        try self.reload()
    }

    private func handleRemoteAccountDeletedCleanup() {
        do {
            self.userDefaults.set(true, forKey: accountDeletionPendingUserDefaultsKey)
            try self.completeLocalAccountDeletion()
            self.accountDeletionState = .hidden
            self.accountDeletionSuccessMessage = "Your account has been deleted."
        } catch {
            self.accountDeletionState = .failed(message: localizedMessage(error: error))
        }
    }

    private func runLinkedSync(linkedSession: CloudLinkedSession) async throws {
        var cloudRuntime = self.cloudRuntime
        try await cloudRuntime.runLinkedSync(linkedSession: linkedSession)
        self.cloudRuntime = cloudRuntime
    }

}
