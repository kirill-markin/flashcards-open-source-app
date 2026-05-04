import Foundation
import XCTest
@testable import Flashcards

struct ProgressSummaryLoadRequest: Equatable {
    let apiBaseUrl: String
    let authorizationHeader: String
    let timeZone: String
}

struct ProgressSeriesLoadRequest: Equatable {
    let apiBaseUrl: String
    let authorizationHeader: String
    let timeZone: String
    let from: String
    let to: String
}

struct ProgressReviewScheduleLoadRequest: Equatable {
    let apiBaseUrl: String
    let authorizationHeader: String
    let timeZone: String
}

enum ProgressCloudOperation: Equatable {
    case loadProgressSummary
    case loadProgressSeries
    case loadProgressReviewSchedule
}

@MainActor
final class ProgressCloudSyncService: CloudSyncServing {
    var serverSummary: UserProgressSummary
    var serverSeries: UserProgressSeries
    var serverReviewSchedule: UserReviewSchedule
    var loadProgressSummaryError: Error?
    var loadProgressSeriesError: Error?
    var loadProgressReviewScheduleError: Error?
    private(set) var lastLoadProgressSummaryRequest: ProgressSummaryLoadRequest?
    private(set) var lastLoadProgressSeriesRequest: ProgressSeriesLoadRequest?
    private(set) var lastLoadProgressReviewScheduleRequest: ProgressReviewScheduleLoadRequest?
    private(set) var recordedOperations: [ProgressCloudOperation]
    private(set) var loadProgressSummaryCallCount: Int
    private(set) var loadProgressSeriesCallCount: Int
    private(set) var loadProgressReviewScheduleCallCount: Int

    init(
        serverSummary: UserProgressSummary,
        serverSeries: UserProgressSeries,
        loadProgressSummaryError: Error?,
        loadProgressSeriesError: Error?
    ) {
        self.serverSummary = serverSummary
        self.serverSeries = serverSeries
        self.serverReviewSchedule = makeEmptyReviewScheduleForTests(timeZone: serverSeries.timeZone)
        self.loadProgressSummaryError = loadProgressSummaryError
        self.loadProgressSeriesError = loadProgressSeriesError
        self.loadProgressReviewScheduleError = nil
        self.lastLoadProgressSummaryRequest = nil
        self.lastLoadProgressSeriesRequest = nil
        self.lastLoadProgressReviewScheduleRequest = nil
        self.recordedOperations = []
        self.loadProgressSummaryCallCount = 0
        self.loadProgressSeriesCallCount = 0
        self.loadProgressReviewScheduleCallCount = 0
    }

    init(
        serverSummary: UserProgressSummary,
        serverSeries: UserProgressSeries,
        serverReviewSchedule: UserReviewSchedule,
        loadProgressSummaryError: Error?,
        loadProgressSeriesError: Error?,
        loadProgressReviewScheduleError: Error?
    ) {
        self.serverSummary = serverSummary
        self.serverSeries = serverSeries
        self.serverReviewSchedule = serverReviewSchedule
        self.loadProgressSummaryError = loadProgressSummaryError
        self.loadProgressSeriesError = loadProgressSeriesError
        self.loadProgressReviewScheduleError = loadProgressReviewScheduleError
        self.lastLoadProgressSummaryRequest = nil
        self.lastLoadProgressSeriesRequest = nil
        self.lastLoadProgressReviewScheduleRequest = nil
        self.recordedOperations = []
        self.loadProgressSummaryCallCount = 0
        self.loadProgressSeriesCallCount = 0
        self.loadProgressReviewScheduleCallCount = 0
    }

    func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot {
        _ = apiBaseUrl
        _ = bearerToken
        fatalError("Not used in progress tests.")
    }

    func loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ) async throws -> UserProgressSummary {
        self.recordedOperations.append(.loadProgressSummary)
        self.loadProgressSummaryCallCount += 1
        self.lastLoadProgressSummaryRequest = ProgressSummaryLoadRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            timeZone: timeZone
        )
        if let loadProgressSummaryError {
            throw loadProgressSummaryError
        }

        return self.serverSummary
    }

    func loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ) async throws -> UserProgressSeries {
        self.recordedOperations.append(.loadProgressSeries)
        self.loadProgressSeriesCallCount += 1
        self.lastLoadProgressSeriesRequest = ProgressSeriesLoadRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            timeZone: timeZone,
            from: from,
            to: to
        )
        if let loadProgressSeriesError {
            throw loadProgressSeriesError
        }

        return self.serverSeries
    }

    func loadProgressReviewSchedule(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ) async throws -> UserReviewSchedule {
        self.recordedOperations.append(.loadProgressReviewSchedule)
        self.loadProgressReviewScheduleCallCount += 1
        self.lastLoadProgressReviewScheduleRequest = ProgressReviewScheduleLoadRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            timeZone: timeZone
        )
        if let loadProgressReviewScheduleError {
            throw loadProgressReviewScheduleError
        }

        return self.serverReviewSchedule
    }

    func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = name
        fatalError("Not used in progress tests.")
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
        fatalError("Not used in progress tests.")
    }

    func loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceDeletePreview {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in progress tests.")
    }

    func loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceResetProgressPreview {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in progress tests.")
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
        fatalError("Not used in progress tests.")
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
        fatalError("Not used in progress tests.")
    }

    func selectWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in progress tests.")
    }

    func listAgentApiKeys(
        apiBaseUrl: String,
        bearerToken: String
    ) async throws -> ([AgentApiKeyConnection], String) {
        _ = apiBaseUrl
        _ = bearerToken
        fatalError("Not used in progress tests.")
    }

    func revokeAgentApiKey(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ) async throws -> (AgentApiKeyConnection, String) {
        _ = apiBaseUrl
        _ = bearerToken
        _ = connectionId
        fatalError("Not used in progress tests.")
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
        fatalError("Not used in progress tests.")
    }

    func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws {
        _ = apiBaseUrl
        _ = bearerToken
        _ = confirmationText
        fatalError("Not used in progress tests.")
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        _ = linkedSession
        fatalError("Progress refresh should not trigger sync in progress tests.")
    }
}

@MainActor
struct ProgressStoreTestContext {
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
