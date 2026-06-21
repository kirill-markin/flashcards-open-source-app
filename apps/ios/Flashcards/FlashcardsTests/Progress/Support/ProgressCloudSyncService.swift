import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class ProgressCloudAuthService: CloudAuthServing {
    let refreshedToken: CloudIdentityToken
    private(set) var refreshIdTokenCallCount: Int
    private(set) var lastRefreshToken: String?
    private(set) var lastAuthBaseUrl: String?

    init(refreshedToken: CloudIdentityToken) {
        self.refreshedToken = refreshedToken
        self.refreshIdTokenCallCount = 0
        self.lastRefreshToken = nil
        self.lastAuthBaseUrl = nil
    }

    func sendCode(email: String, authBaseUrl: String) async throws -> CloudSendCodeResult {
        _ = email
        _ = authBaseUrl
        fatalError("Not used in progress tests.")
    }

    func verifyCode(
        challenge: CloudOtpChallenge,
        code: String,
        authBaseUrl: String
    ) async throws -> StoredCloudCredentials {
        _ = challenge
        _ = code
        _ = authBaseUrl
        fatalError("Not used in progress tests.")
    }

    func refreshIdToken(refreshToken: String, authBaseUrl: String) async throws -> CloudIdentityToken {
        self.refreshIdTokenCallCount += 1
        self.lastRefreshToken = refreshToken
        self.lastAuthBaseUrl = authBaseUrl
        return self.refreshedToken
    }

    func resetChallengeSession() {}
}

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
    var serverProgressLeaderboard: UserProgressLeaderboard
    var serverProgressStreakLeaderboard: UserProgressStreakLeaderboard
    var serverProgressLeaderboardProfile: UserProgressLeaderboardProfile
    var serverCommunityPublicProfile: CommunityPublicProfile
    var updatedCommunityPublicProfile: CommunityPublicProfile
    var loadProgressSummaryError: Error?
    var loadProgressSeriesError: Error?
    var loadProgressReviewScheduleError: Error?
    var loadProgressLeaderboardError: Error?
    var loadProgressStreakLeaderboardError: Error?
    var loadProgressLeaderboardProfileError: Error?
    var loadCommunityPublicProfileError: Error?
    var updateCommunityLeaderboardParticipationError: Error?
    private(set) var lastLoadProgressSummaryRequest: ProgressSummaryLoadRequest?
    private(set) var lastLoadProgressSeriesRequest: ProgressSeriesLoadRequest?
    private(set) var lastLoadProgressReviewScheduleRequest: ProgressReviewScheduleLoadRequest?
    private(set) var recordedOperations: [ProgressCloudOperation]
    private(set) var loadProgressSummaryCallCount: Int
    private(set) var loadProgressSeriesCallCount: Int
    private(set) var loadProgressReviewScheduleCallCount: Int
    private(set) var loadProgressLeaderboardCallCount: Int
    private(set) var loadProgressStreakLeaderboardCallCount: Int
    private(set) var loadProgressLeaderboardProfileCallCount: Int
    private(set) var loadCommunityPublicProfileCallCount: Int
    private(set) var updateCommunityLeaderboardParticipationCallCount: Int
    private(set) var lastUpdateCommunityLeaderboardParticipationEnabled: Bool?

    init(
        serverSummary: UserProgressSummary,
        serverSeries: UserProgressSeries,
        loadProgressSummaryError: Error?,
        loadProgressSeriesError: Error?
    ) {
        self.serverSummary = serverSummary
        self.serverSeries = serverSeries
        self.serverReviewSchedule = makeEmptyReviewScheduleForTests(timeZone: serverSeries.timeZone)
        self.serverProgressLeaderboard = makeNonReadyProgressLeaderboardForTests(status: .snapshotUnavailable)
        self.serverProgressStreakLeaderboard = makeNonReadyProgressStreakLeaderboardForTests(status: .snapshotUnavailable)
        self.serverProgressLeaderboardProfile = UserProgressLeaderboardProfile(status: .profileUnavailable, readyPayload: nil)
        self.serverCommunityPublicProfile = makeCommunityPublicProfileForProgressTests(
            leaderboardParticipationEnabled: true
        )
        self.updatedCommunityPublicProfile = makeCommunityPublicProfileForProgressTests(
            leaderboardParticipationEnabled: true
        )
        self.loadProgressSummaryError = loadProgressSummaryError
        self.loadProgressSeriesError = loadProgressSeriesError
        self.loadProgressReviewScheduleError = nil
        self.loadProgressLeaderboardError = nil
        self.loadProgressStreakLeaderboardError = nil
        self.loadProgressLeaderboardProfileError = nil
        self.loadCommunityPublicProfileError = nil
        self.updateCommunityLeaderboardParticipationError = nil
        self.lastLoadProgressSummaryRequest = nil
        self.lastLoadProgressSeriesRequest = nil
        self.lastLoadProgressReviewScheduleRequest = nil
        self.recordedOperations = []
        self.loadProgressSummaryCallCount = 0
        self.loadProgressSeriesCallCount = 0
        self.loadProgressReviewScheduleCallCount = 0
        self.loadProgressLeaderboardCallCount = 0
        self.loadProgressStreakLeaderboardCallCount = 0
        self.loadProgressLeaderboardProfileCallCount = 0
        self.loadCommunityPublicProfileCallCount = 0
        self.updateCommunityLeaderboardParticipationCallCount = 0
        self.lastUpdateCommunityLeaderboardParticipationEnabled = nil
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
        self.serverProgressLeaderboard = makeNonReadyProgressLeaderboardForTests(status: .snapshotUnavailable)
        self.serverProgressStreakLeaderboard = makeNonReadyProgressStreakLeaderboardForTests(status: .snapshotUnavailable)
        self.serverProgressLeaderboardProfile = UserProgressLeaderboardProfile(status: .profileUnavailable, readyPayload: nil)
        self.serverCommunityPublicProfile = makeCommunityPublicProfileForProgressTests(
            leaderboardParticipationEnabled: true
        )
        self.updatedCommunityPublicProfile = makeCommunityPublicProfileForProgressTests(
            leaderboardParticipationEnabled: true
        )
        self.loadProgressSummaryError = loadProgressSummaryError
        self.loadProgressSeriesError = loadProgressSeriesError
        self.loadProgressReviewScheduleError = loadProgressReviewScheduleError
        self.loadProgressLeaderboardError = nil
        self.loadProgressStreakLeaderboardError = nil
        self.loadProgressLeaderboardProfileError = nil
        self.loadCommunityPublicProfileError = nil
        self.updateCommunityLeaderboardParticipationError = nil
        self.lastLoadProgressSummaryRequest = nil
        self.lastLoadProgressSeriesRequest = nil
        self.lastLoadProgressReviewScheduleRequest = nil
        self.recordedOperations = []
        self.loadProgressSummaryCallCount = 0
        self.loadProgressSeriesCallCount = 0
        self.loadProgressReviewScheduleCallCount = 0
        self.loadProgressLeaderboardCallCount = 0
        self.loadProgressStreakLeaderboardCallCount = 0
        self.loadProgressLeaderboardProfileCallCount = 0
        self.loadCommunityPublicProfileCallCount = 0
        self.updateCommunityLeaderboardParticipationCallCount = 0
        self.lastUpdateCommunityLeaderboardParticipationEnabled = nil
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

    // Leaderboard calls are tracked with dedicated counters and intentionally do
    // not append to recordedOperations, so existing operation-sequence assertions
    // for summary/series/schedule stay stable.
    func loadProgressLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> UserProgressLeaderboard {
        _ = apiBaseUrl
        _ = authorizationHeader
        self.loadProgressLeaderboardCallCount += 1
        if let loadProgressLeaderboardError {
            throw loadProgressLeaderboardError
        }

        return self.serverProgressLeaderboard
    }

    func loadProgressStreakLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> UserProgressStreakLeaderboard {
        _ = apiBaseUrl
        _ = authorizationHeader
        self.loadProgressStreakLeaderboardCallCount += 1
        if let loadProgressStreakLeaderboardError {
            throw loadProgressStreakLeaderboardError
        }

        return self.serverProgressStreakLeaderboard
    }

    func loadProgressLeaderboardProfile(
        apiBaseUrl: String,
        authorizationHeader: String,
        publicProfileId: String
    ) async throws -> UserProgressLeaderboardProfile {
        _ = apiBaseUrl
        _ = authorizationHeader
        _ = publicProfileId
        self.loadProgressLeaderboardProfileCallCount += 1
        if let loadProgressLeaderboardProfileError {
            throw loadProgressLeaderboardProfileError
        }

        return self.serverProgressLeaderboardProfile
    }

    func loadCommunityPublicProfile(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> CommunityPublicProfile {
        _ = apiBaseUrl
        _ = authorizationHeader
        self.loadCommunityPublicProfileCallCount += 1
        if let loadCommunityPublicProfileError {
            throw loadCommunityPublicProfileError
        }

        return self.serverCommunityPublicProfile
    }

    func updateCommunityLeaderboardParticipation(
        apiBaseUrl: String,
        authorizationHeader: String,
        isEnabled: Bool
    ) async throws -> CommunityPublicProfile {
        _ = apiBaseUrl
        _ = authorizationHeader
        self.updateCommunityLeaderboardParticipationCallCount += 1
        self.lastUpdateCommunityLeaderboardParticipationEnabled = isEnabled
        if let updateCommunityLeaderboardParticipationError {
            throw updateCommunityLeaderboardParticipationError
        }

        return CommunityPublicProfile(
            publicProfileId: self.updatedCommunityPublicProfile.publicProfileId,
            anonymousDisplayName: self.updatedCommunityPublicProfile.anonymousDisplayName,
            leaderboardParticipationEnabled: isEnabled,
            linkedAccountRequiredForLeaderboard: self.updatedCommunityPublicProfile.linkedAccountRequiredForLeaderboard
        )
    }

    func loadFeedbackState(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> FeedbackState {
        _ = apiBaseUrl
        _ = authorizationHeader
        fatalError("Not used in progress tests.")
    }

    func recordFeedbackPromptEvent(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: FeedbackPromptEventRequest
    ) async throws -> FeedbackState {
        _ = apiBaseUrl
        _ = authorizationHeader
        _ = request
        fatalError("Not used in progress tests.")
    }

    func submitFeedback(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: FeedbackSubmissionRequest
    ) async throws -> FeedbackState {
        _ = apiBaseUrl
        _ = authorizationHeader
        _ = request
        fatalError("Not used in progress tests.")
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

    func runGuestLocalRecoveryLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        _ = linkedSession
        fatalError("Progress refresh should not trigger guest local recovery sync in progress tests.")
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
