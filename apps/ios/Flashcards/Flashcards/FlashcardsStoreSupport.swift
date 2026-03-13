import Foundation

@MainActor
protocol CloudAuthServing {
    func sendCode(email: String, authBaseUrl: String) async throws -> CloudOtpChallenge
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
    func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot
    func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary
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
    func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws
    func runLinkedSync(linkedSession: CloudLinkedSession) async throws
}

protocol CredentialStoring {
    func loadCredentials() throws -> StoredCloudCredentials?
    func saveCredentials(credentials: StoredCloudCredentials) throws
    func clearCredentials() throws
}

@MainActor
extension CloudAuthService: CloudAuthServing {}
@MainActor
extension CloudSyncService: CloudSyncServing {}
extension CloudCredentialStore: CredentialStoring {}

struct ReviewSubmissionRequest: Hashable, Sendable {
    let id: String
    let workspaceId: String
    let cardId: String
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

struct FlashcardsStoreDependencies {
    let cloudAuthService: any CloudAuthServing
    let cloudSyncService: (any CloudSyncServing)?
    let credentialStore: any CredentialStoring
    let reviewSubmissionExecutor: ReviewSubmissionExecuting?
    let reviewHeadLoader: ReviewHeadLoader
    let reviewCountsLoader: ReviewCountsLoader
    let reviewQueueChunkLoader: ReviewQueueChunkLoader
    let reviewTimelinePageLoader: ReviewTimelinePageLoader
}

struct LocalMutationContext {
    let database: LocalDatabase
    let workspaceId: String
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
