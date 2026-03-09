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
    @Published private(set) var reviewTimeline: [Card]
    @Published private(set) var homeSnapshot: HomeSnapshot
    @Published private(set) var globalErrorMessage: String
    @Published private(set) var syncStatus: SyncStatus
    @Published private(set) var lastSuccessfulCloudSyncAt: String?
    @Published private(set) var selectedTab: AppTab
    @Published private(set) var cardsPresentationRequest: CardsPresentationRequest?

    private let database: LocalDatabase?
    private let cloudAuthService: CloudAuthService
    private let cloudSyncService: CloudSyncService?
    private let credentialStore: CloudCredentialStore
    private let userDefaults: UserDefaults
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var activeCloudSession: CloudLinkedSession?
    private var activeCloudSyncTask: Task<Void, Error>?
    private var pendingCloudResync: Bool

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

    init(
        userDefaults: UserDefaults,
        encoder: JSONEncoder,
        decoder: JSONDecoder,
        database: LocalDatabase?,
        cloudAuthService: CloudAuthService,
        credentialStore: CloudCredentialStore,
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
        self.cardsPresentationRequest = nil
        self.database = database
        self.cloudAuthService = cloudAuthService
        self.cloudSyncService = database.map { initializedDatabase in
            CloudSyncService(database: initializedDatabase)
        }
        self.credentialStore = credentialStore
        self.userDefaults = userDefaults
        self.encoder = encoder
        self.decoder = decoder
        self.activeCloudSession = nil
        self.activeCloudSyncTask = nil
        self.pendingCloudResync = false

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

    var reviewTotalCount: Int {
        self.reviewTimeline.count
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

        try database.deleteCard(workspaceId: workspaceId, cardId: cardId)
        try self.reload()
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

        try database.createDeck(workspaceId: workspaceId, input: input)
        try self.reload()
        self.triggerCloudSyncIfLinked()
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
        self.triggerCloudSyncIfLinked()
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
        self.triggerCloudSyncIfLinked()
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
        self.triggerCloudSyncIfLinked()
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
        if self.activeCloudSession == nil {
            try await self.restoreCloudLinkFromStoredCredentials()
        }

        return try await self.withAuthenticatedCloudSession { session in
            session
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
        self.reviewTimeline = makeReviewTimeline(
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

    private func triggerCloudSyncIfLinked() {
        Task { @MainActor in
            await self.syncCloudIfLinked()
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
            let syncTask = Task { @MainActor in
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
