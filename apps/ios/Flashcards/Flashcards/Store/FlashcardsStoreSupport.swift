import Foundation

@MainActor
protocol CloudAuthServing {
    func sendCode(email: String, authBaseUrl: String) async throws -> CloudSendCodeResult
    func verifyCode(
        challenge: CloudOtpChallenge,
        code: String,
        authBaseUrl: String
    ) async throws -> StoredCloudCredentials
    func refreshIdToken(refreshToken: String, authBaseUrl: String) async throws -> CloudIdentityToken
    func resetChallengeSession()
}

@MainActor
protocol CloudSyncServing {
    func fetchCloudAccountContext(apiBaseUrl: String, authorizationHeader: String) async throws -> CloudAccountContext
    func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot
    func fetchCloudAccount(apiBaseUrl: String, authorizationHeader: String) async throws -> CloudAccountSnapshot
    func updateAccountPreferences(
        apiBaseUrl: String,
        authorizationHeader: String,
        preferences: AccountPreferences
    ) async throws -> AccountPreferences
    func loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ) async throws -> UserProgressSummary
    func loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ) async throws -> UserProgressSeries
    func loadProgressReviewSchedule(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ) async throws -> UserReviewSchedule
    func loadProgressLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> UserProgressLeaderboard
    func loadCommunityPublicProfile(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> CommunityPublicProfile
    func updateCommunityLeaderboardParticipation(
        apiBaseUrl: String,
        authorizationHeader: String,
        isEnabled: Bool
    ) async throws -> CommunityPublicProfile
    func createFriendInvitation(
        apiBaseUrl: String,
        bearerToken: String,
        inviteeDisplayName: String
    ) async throws -> FriendInvitationCreateResponse
    func loadFeedbackState(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> FeedbackState
    func recordFeedbackPromptEvent(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: FeedbackPromptEventRequest
    ) async throws -> FeedbackState
    func submitFeedback(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: FeedbackSubmissionRequest
    ) async throws -> FeedbackState
    func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary
    func renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ) async throws -> CloudWorkspaceSummary
    func loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceDeletePreview
    func loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceResetProgressPreview
    func deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceDeleteResult
    func resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceResetProgressResult
    func selectWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceSummary
    func listAgentApiKeys(
        apiBaseUrl: String,
        bearerToken: String
    ) async throws -> ([AgentApiKeyConnection], String)
    func revokeAgentApiKey(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ) async throws -> (AgentApiKeyConnection, String)
    func isWorkspaceEmptyForBootstrap(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        installationId: String
    ) async throws -> Bool
    func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws
    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult
    func runGuestLocalRecoveryLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult
}

@MainActor
extension CloudSyncServing {
    func fetchCloudAccountContext(apiBaseUrl: String, authorizationHeader: String) async throws -> CloudAccountContext {
        let account = try await self.fetchCloudAccount(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader
        )
        return CloudAccountContext(
            userId: account.userId,
            email: account.email,
            preferences: account.preferences
        )
    }

    func fetchCloudAccount(apiBaseUrl: String, authorizationHeader: String) async throws -> CloudAccountSnapshot {
        let bearerPrefix = "Bearer "
        guard authorizationHeader.hasPrefix(bearerPrefix) else {
            throw LocalStoreError.validation("Cloud account fetch is unavailable for this authorization transport")
        }

        let bearerToken = String(authorizationHeader.dropFirst(bearerPrefix.count))
        return try await self.fetchCloudAccount(apiBaseUrl: apiBaseUrl, bearerToken: bearerToken)
    }

    func updateAccountPreferences(
        apiBaseUrl: String,
        authorizationHeader: String,
        preferences: AccountPreferences
    ) async throws -> AccountPreferences {
        _ = apiBaseUrl
        _ = authorizationHeader
        _ = preferences
        throw LocalStoreError.validation("Account preferences update is unavailable")
    }

    func createFriendInvitation(
        apiBaseUrl: String,
        bearerToken: String,
        inviteeDisplayName: String
    ) async throws -> FriendInvitationCreateResponse {
        _ = apiBaseUrl
        _ = bearerToken
        _ = inviteeDisplayName
        throw LocalStoreError.validation("Friend invitation creation is unavailable")
    }
}

protocol CredentialStoring {
    func loadCredentials() throws -> StoredCloudCredentials?
    func saveCredentials(credentials: StoredCloudCredentials) throws
    func clearCredentials() throws
}

protocol GuestCredentialStoring {
    func loadGuestSession() throws -> StoredGuestCloudSession?
    func saveGuestSession(session: StoredGuestCloudSession) throws
    func clearGuestSession() throws
}

@MainActor
protocol GuestCloudAuthServing {
    func createGuestSession(
        apiBaseUrl: String,
        configurationMode: CloudServiceConfigurationMode
    ) async throws -> StoredGuestCloudSession
    func deleteGuestSession(
        apiBaseUrl: String,
        guestToken: String
    ) async throws
    func prepareGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String
    ) async throws -> CloudGuestUpgradeMode
    func completeGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String,
        selection: CloudGuestUpgradeSelection,
        supportsDroppedEntities: Bool,
        guestWorkspaceSyncedAndOutboxDrained: Bool
    ) async throws -> CloudWorkspaceSummary
}

@MainActor
protocol CloudServiceConfigurationValidating {
    func validate(configuration: CloudServiceConfiguration) async throws
}

@MainActor
extension CloudAuthService: CloudAuthServing {}
@MainActor
extension CloudSyncService: CloudSyncServing {}
extension CloudCredentialStore: CredentialStoring {}
extension GuestCloudCredentialStore: GuestCredentialStoring {}
@MainActor
extension GuestCloudAuthService: GuestCloudAuthServing {}
extension CloudServiceConfigurationValidator: CloudServiceConfigurationValidating {}

struct ReviewSubmissionContext: Hashable, Sendable {
    let selectedReviewFilter: ReviewFilter
    let reviewQueryDefinition: ReviewQueryDefinition
}

struct ReviewSubmissionRequest: Hashable, Sendable {
    let id: String
    let workspaceId: String
    let cardId: String
    let reviewContext: ReviewSubmissionContext
    let reviewSessionSignature: ReviewSessionSignature
    let cardSnapshot: Card
    let rating: ReviewRating
    let reviewedAtClient: String
}

struct ReviewSubmissionFailure: Identifiable, Hashable, Sendable {
    let id: String
    let message: String
}

struct AIChatSessionPreparationState {
    let id: String
    let task: Task<CloudLinkedSession, Error>
}

struct GuestCloudSessionRestoreResult {
    let session: CloudLinkedSession
    let didRunSync: Bool
}

struct GuestCloudSessionPreparationState {
    let id: String
    let task: Task<GuestCloudSessionRestoreResult, Error>
}

struct CloudLinkTransitionState {
    let id: String
    let task: Task<Void, Error>
}

struct CloudWorkspaceCompletionState {
    let id: String
    let task: Task<CloudWorkspaceSummary, Error>
}

struct FlashcardsStoreDependencies {
    let cloudAuthService: any CloudAuthServing
    let cloudSyncService: (any CloudSyncServing)?
    let credentialStore: any CredentialStoring
    let guestCloudAuthService: any GuestCloudAuthServing
    let guestCredentialStore: any GuestCredentialStoring
    let reviewSubmissionExecutor: ReviewSubmissionExecuting?
    let reviewHeadLoader: ReviewHeadLoader
    let reviewCountsLoader: ReviewCountsLoader
    let reviewQueueChunkLoader: ReviewQueueChunkLoader
    let reviewQueueWindowLoader: ReviewQueueWindowLoader
    let reviewTimelinePageLoader: ReviewTimelinePageLoader
}

struct LocalMutationContext {
    let database: LocalDatabase
    let workspaceId: String
}

func applyingCardMutation(cards: [Card], card: Card) -> [Card] {
    let remainingCards = cards.filter { existingCard in
        existingCard.cardId != card.cardId
    }

    if card.deletedAt != nil {
        return remainingCards
    }

    return [card] + remainingCards
}

func applyingDeckMutation(decks: [Deck], deck: Deck) -> [Deck] {
    let remainingDecks = decks.filter { existingDeck in
        existingDeck.deckId != deck.deckId
    }

    if deck.deletedAt != nil {
        return remainingDecks
    }

    return [deck] + remainingDecks
}

func requireLocalDatabase(database: LocalDatabase?) throws -> LocalDatabase {
    guard let database else {
        throw LocalStoreError.uninitialized("Local database is unavailable")
    }

    return database
}

func requireWorkspaceId(workspace: Workspace?) throws -> String {
    guard let workspaceId = workspace?.workspaceId else {
        throw LocalStoreError.uninitialized("Workspace is unavailable")
    }

    return workspaceId
}

func requireLocalMutationContext(database: LocalDatabase?, workspace: Workspace?) throws -> LocalMutationContext {
    LocalMutationContext(
        database: try requireLocalDatabase(database: database),
        workspaceId: try requireWorkspaceId(workspace: workspace)
    )
}

func requireCloudSyncService(cloudSyncService: (any CloudSyncServing)?) throws -> any CloudSyncServing {
    guard let cloudSyncService else {
        throw LocalStoreError.uninitialized("Cloud sync service is unavailable")
    }

    return cloudSyncService
}

func requireCloudSettings(cloudSettings: CloudSettings?) throws -> CloudSettings {
    guard let cloudSettings else {
        throw LocalStoreError.uninitialized("Cloud settings are unavailable")
    }

    return cloudSettings
}

func requireCustomOrigin(configuration: CloudServiceConfiguration) throws -> String {
    guard let customOrigin = configuration.customOrigin, customOrigin.isEmpty == false else {
        throw LocalStoreError.validation("Custom server origin is unavailable")
    }

    return customOrigin
}
