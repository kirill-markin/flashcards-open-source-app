import Foundation
import XCTest
@testable import Flashcards

class ProgressStoreTestCase: XCTestCase {
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

    func makeDatabase() throws -> LocalDatabase {
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
            .appendingPathComponent("flashcards.sqlite", isDirectory: false)
        let database = try LocalDatabase(databaseURL: databaseURL)
        self.databaseURL = databaseURL
        self.database = database
        return database
    }

    func addReviewedCard(
        database: LocalDatabase,
        workspaceId: String,
        reviewedAtClient: String
    ) throws {
        let card = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: reviewedAtClient
            )
        )
    }

    func insertWorkspace(
        database: LocalDatabase,
        name: String,
        createdAt: String
    ) throws -> Workspace {
        let workspaceId = UUID().uuidString.lowercased()
        let installationId = try database.workspaceSettingsStore.loadCloudSettings().installationId
        try database.core.inTransaction {
            try database.core.execute(
                sql: """
                INSERT INTO workspaces (
                    workspace_id,
                    name,
                    created_at,
                    fsrs_client_updated_at,
                    fsrs_last_modified_by_replica_id,
                    fsrs_last_operation_id,
                    fsrs_updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(workspaceId),
                    .text(name),
                    .text(createdAt),
                    .text(createdAt),
                    .text(installationId),
                    .text(UUID().uuidString.lowercased()),
                    .text(createdAt)
                ]
            )
            try database.core.execute(
                sql: """
                INSERT INTO sync_state (
                    workspace_id,
                    last_applied_hot_change_id,
                    last_applied_review_sequence_id,
                    has_hydrated_hot_state,
                    has_hydrated_review_history,
                    updated_at
                )
                VALUES (?, 0, 0, 0, 0, ?)
                """,
                values: [
                    .text(workspaceId),
                    .text(createdAt)
                ]
            )
        }

        return Workspace(
            workspaceId: workspaceId,
            name: name,
            createdAt: createdAt
        )
    }

    @MainActor
    func waitForProgressRefreshCallCounts(
        cloudSyncService: ProgressCloudSyncService,
        summaryCount: Int,
        seriesCount: Int
    ) async {
        for _ in 0..<20 {
            if cloudSyncService.loadProgressSummaryCallCount == summaryCount
                && cloudSyncService.loadProgressSeriesCallCount == seriesCount {
                return
            }

            await Task.yield()
        }

        XCTFail(
            """
            Timed out waiting for progress refresh calls. Expected summary=\(summaryCount), \
            series=\(seriesCount), received summary=\(cloudSyncService.loadProgressSummaryCallCount), \
            series=\(cloudSyncService.loadProgressSeriesCallCount).
            """
        )
    }

    @MainActor
    func makeProgressStoreContext(
        database: LocalDatabase,
        workspaceId: String,
        installationId: String,
        serverSummary: UserProgressSummary,
        serverSeries: UserProgressSeries,
        loadProgressSummaryError: Error?,
        loadProgressSeriesError: Error?,
        cloudState: CloudAccountState
    ) throws -> ProgressStoreTestContext {
        let suiteName = "progress-merge-\(UUID().uuidString.lowercased())"
        let userDefaults = UserDefaults(suiteName: suiteName)!
        return try self.makeProgressStoreContext(
            database: database,
            workspaceId: workspaceId,
            installationId: installationId,
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: loadProgressSummaryError,
            loadProgressSeriesError: loadProgressSeriesError,
            cloudState: cloudState,
            suiteName: suiteName,
            userDefaults: userDefaults
        )
    }

    @MainActor
    func makeProgressStoreContext(
        database: LocalDatabase,
        workspaceId: String,
        installationId: String,
        serverSummary: UserProgressSummary,
        serverSeries: UserProgressSeries,
        loadProgressSummaryError: Error?,
        loadProgressSeriesError: Error?,
        cloudState: CloudAccountState,
        suiteName: String,
        userDefaults: UserDefaults
    ) throws -> ProgressStoreTestContext {
        let cloudSyncService = ProgressCloudSyncService(
            serverSummary: serverSummary,
            serverSeries: serverSeries,
            loadProgressSummaryError: loadProgressSummaryError,
            loadProgressSeriesError: loadProgressSeriesError
        )
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
            reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate(),
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
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
            cloudState: cloudState,
            linkedUserId: guestSession.userId,
            linkedWorkspaceId: guestSession.workspaceId,
            activeWorkspaceId: guestSession.workspaceId,
            linkedEmail: nil,
            onboardingCompleted: true,
            updatedAt: "2026-04-01T00:00:00Z"
        )
        if cloudState == .guest {
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
        }

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
