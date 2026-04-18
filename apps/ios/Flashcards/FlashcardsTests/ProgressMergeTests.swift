import Foundation
import XCTest
@testable import Flashcards

final class ProgressMergeTests: XCTestCase {
    private var databaseURL: URL?
    private var database: LocalDatabase?

    override func tearDownWithError() throws {
        if let database {
            try database.close()
        }
        if let databaseURL {
            try? FileManager.default.removeItem(at: databaseURL)
        }

        self.database = nil
        self.databaseURL = nil
        try super.tearDownWithError()
    }

    func testLoadPendingReviewEventPayloadsReturnsOnlyUnsyncedReviewEvents() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let card = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )

        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )

        let pendingBeforeDelete = try database.loadPendingReviewEventPayloads(
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId
        )

        XCTAssertEqual(1, pendingBeforeDelete.count)
        XCTAssertEqual("2026-04-02T15:50:57.000Z", pendingBeforeDelete.first?.reviewedAtClient)

        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let pendingAfterDelete = try database.loadPendingReviewEventPayloads(
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId
        )

        XCTAssertTrue(pendingAfterDelete.isEmpty)
        XCTAssertEqual(1, try database.loadReviewEvents(workspaceId: workspace.workspaceId).count)
    }

    @MainActor
    func testLoadRecentProgressRunsSyncBeforeLoadingProgressAndReturnsServerSeries() async throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let card = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )

        let serverSeries = UserProgressSeries(
            timeZone: "UTC",
            from: "2026-04-01",
            to: "2026-04-03",
            dailyReviews: [
                ProgressDay(date: "2026-04-01", reviewCount: 2)
            ]
        )
        let context = try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId,
            serverSeries: serverSeries
        )
        defer { context.tearDown() }

        let mergedSeries = try await context.store.loadRecentProgress()

        let loadProgressRequest = try XCTUnwrap(context.cloudSyncService.lastLoadProgressRequest)
        XCTAssertEqual(context.apiBaseUrl, loadProgressRequest.apiBaseUrl)
        XCTAssertEqual("Guest guest-token-1", loadProgressRequest.authorizationHeader)
        XCTAssertEqual(TimeZone.current.identifier, loadProgressRequest.timeZone)
        XCTAssertFalse(loadProgressRequest.from.isEmpty)
        XCTAssertFalse(loadProgressRequest.to.isEmpty)
        XCTAssertEqual(
            [
                .runLinkedSync,
                .loadProgress
            ],
            context.cloudSyncService.recordedOperations
        )
        XCTAssertEqual(
            [
                ProgressDay(date: "2026-04-01", reviewCount: 2)
            ],
            mergedSeries.dailyReviews
        )
        XCTAssertEqual(.idle, context.store.syncStatus)
    }

    private func makeDatabase() throws -> LocalDatabase {
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
            .appendingPathComponent("flashcards.sqlite", isDirectory: false)
        let database = try LocalDatabase(databaseURL: databaseURL)
        self.databaseURL = databaseURL
        self.database = database
        return database
    }

    @MainActor
    private func makeProgressStoreContext(
        database: LocalDatabase,
        workspaceId: String,
        installationId: String,
        serverSeries: UserProgressSeries
    ) throws -> ProgressStoreTestContext {
        let suiteName = "progress-merge-\(UUID().uuidString.lowercased())"
        let userDefaults = UserDefaults(suiteName: suiteName)!
        let cloudSyncService = ProgressCloudSyncService(serverSeries: serverSeries)
        let credentialStore = CloudCredentialStore(service: "tests-\(suiteName)-cloud-auth")
        let guestCredentialStore = GuestCloudCredentialStore(
            service: "tests-\(suiteName)-guest-auth",
            bundle: .main,
            userDefaults: userDefaults
        )
        let store = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: database,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: cloudSyncService,
            credentialStore: credentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
        let configuration = try store.currentCloudServiceConfiguration()
        let guestSession = StoredGuestCloudSession(
            guestToken: "guest-token-1",
            userId: "guest-user-1",
            workspaceId: workspaceId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        try guestCredentialStore.saveGuestSession(session: guestSession)
        store.workspace = Workspace(
            workspaceId: workspaceId,
            name: "Workspace",
            createdAt: "2026-04-01T00:00:00Z"
        )
        store.cloudSettings = CloudSettings(
            installationId: installationId,
            cloudState: .guest,
            linkedUserId: guestSession.userId,
            linkedWorkspaceId: guestSession.workspaceId,
            activeWorkspaceId: guestSession.workspaceId,
            linkedEmail: nil,
            onboardingCompleted: true,
            updatedAt: "2026-04-01T00:00:00Z"
        )
        store.cloudRuntime.setActiveCloudSession(
            linkedSession: CloudLinkedSession(
                userId: guestSession.userId,
                workspaceId: guestSession.workspaceId,
                email: nil,
                configurationMode: guestSession.configurationMode,
                apiBaseUrl: guestSession.apiBaseUrl,
                authorization: .guest(guestSession.guestToken)
            )
        )

        return ProgressStoreTestContext(
            suiteName: suiteName,
            userDefaults: userDefaults,
            apiBaseUrl: configuration.apiBaseUrl,
            cloudSyncService: cloudSyncService,
            credentialStore: credentialStore,
            guestCredentialStore: guestCredentialStore,
            store: store
        )
    }
}

private struct ProgressLoadRequest: Equatable {
    let apiBaseUrl: String
    let authorizationHeader: String
    let timeZone: String
    let from: String
    let to: String
}

private enum ProgressCloudOperation: Equatable {
    case runLinkedSync
    case loadProgress
}

@MainActor
private final class ProgressCloudSyncService: CloudSyncServing {
    private let serverSeries: UserProgressSeries
    private(set) var lastLoadProgressRequest: ProgressLoadRequest?
    private(set) var recordedOperations: [ProgressCloudOperation]

    init(serverSeries: UserProgressSeries) {
        self.serverSeries = serverSeries
        self.lastLoadProgressRequest = nil
        self.recordedOperations = []
    }

    func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot {
        _ = apiBaseUrl
        _ = bearerToken
        fatalError("Not used in ProgressMergeTests.")
    }

    func loadProgress(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ) async throws -> UserProgressSeries {
        self.recordedOperations.append(.loadProgress)
        self.lastLoadProgressRequest = ProgressLoadRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            timeZone: timeZone,
            from: from,
            to: to
        )
        return self.serverSeries
    }

    func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = name
        fatalError("Not used in ProgressMergeTests.")
    }

    func renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = name
        fatalError("Not used in ProgressMergeTests.")
    }

    func loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceDeletePreview {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in ProgressMergeTests.")
    }

    func loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceResetProgressPreview {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in ProgressMergeTests.")
    }

    func deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceDeleteResult {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = confirmationText
        fatalError("Not used in ProgressMergeTests.")
    }

    func resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceResetProgressResult {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = confirmationText
        fatalError("Not used in ProgressMergeTests.")
    }

    func selectWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in ProgressMergeTests.")
    }

    func listAgentApiKeys(
        apiBaseUrl: String,
        bearerToken: String
    ) async throws -> ([AgentApiKeyConnection], String) {
        _ = apiBaseUrl
        _ = bearerToken
        fatalError("Not used in ProgressMergeTests.")
    }

    func revokeAgentApiKey(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ) async throws -> (AgentApiKeyConnection, String) {
        _ = apiBaseUrl
        _ = bearerToken
        _ = connectionId
        fatalError("Not used in ProgressMergeTests.")
    }

    func isWorkspaceEmptyForBootstrap(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        installationId: String
    ) async throws -> Bool {
        _ = apiBaseUrl
        _ = authorizationHeader
        _ = workspaceId
        _ = installationId
        fatalError("Not used in ProgressMergeTests.")
    }

    func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws {
        _ = apiBaseUrl
        _ = bearerToken
        _ = confirmationText
        fatalError("Not used in ProgressMergeTests.")
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        _ = linkedSession
        self.recordedOperations.append(.runLinkedSync)
        return .noChanges
    }
}

@MainActor
private struct ProgressStoreTestContext {
    let suiteName: String
    let userDefaults: UserDefaults
    let apiBaseUrl: String
    let cloudSyncService: ProgressCloudSyncService
    let credentialStore: CloudCredentialStore
    let guestCredentialStore: GuestCloudCredentialStore
    let store: FlashcardsStore

    func tearDown() {
        self.store.shutdownForTests()
        try? self.credentialStore.clearCredentials()
        try? self.guestCredentialStore.clearGuestSession()
        self.userDefaults.removePersistentDomain(forName: self.suiteName)
    }
}
