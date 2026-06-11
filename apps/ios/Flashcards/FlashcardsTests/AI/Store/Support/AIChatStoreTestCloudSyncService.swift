import XCTest
@testable import Flashcards


extension AIChatStoreTestSupport {
    struct WorkspaceBootstrapEmptinessRequest: Equatable {
        let apiBaseUrl: String
        let authorizationHeader: String
        let workspaceId: String
        let installationId: String
    }

    struct ProgressSummaryRequest: Equatable {
        let apiBaseUrl: String
        let authorizationHeader: String
        let timeZone: String
    }

    struct ProgressSeriesRequest: Equatable {
        let apiBaseUrl: String
        let authorizationHeader: String
        let timeZone: String
        let from: String
        let to: String
    }

    struct ProgressReviewScheduleRequest: Equatable {
        let apiBaseUrl: String
        let authorizationHeader: String
        let timeZone: String
    }

    @MainActor
    final class CloudSyncService: CloudSyncServing {
        var runLinkedSyncCallCount: Int
        var syncExpectation: XCTestExpectation?
        var runLinkedSyncErrors: [Error]
        var runLinkedSyncGate: AsyncGate?
        var isWorkspaceEmptyForBootstrapResult: Bool
        var isWorkspaceEmptyForBootstrapRequests: [WorkspaceBootstrapEmptinessRequest]
        var progressSummaryRequests: [ProgressSummaryRequest]
        var progressSeriesRequests: [ProgressSeriesRequest]
        var progressReviewScheduleRequests: [ProgressReviewScheduleRequest]

        init() {
            self.runLinkedSyncCallCount = 0
            self.syncExpectation = nil
            self.runLinkedSyncErrors = []
            self.runLinkedSyncGate = nil
            self.isWorkspaceEmptyForBootstrapResult = true
            self.isWorkspaceEmptyForBootstrapRequests = []
            self.progressSummaryRequests = []
            self.progressSeriesRequests = []
            self.progressReviewScheduleRequests = []
        }

        func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot {
            _ = apiBaseUrl
            _ = bearerToken
            return CloudAccountSnapshot(
                userId: "user-1",
                email: "user@example.com",
                workspaces: [
                    CloudWorkspaceSummary(
                        workspaceId: "workspace-1",
                        name: "Workspace",
                        createdAt: "2026-04-08T10:00:00Z",
                        isSelected: true
                    )
                ]
            )
        }

        func loadProgressSummary(
            apiBaseUrl: String,
            authorizationHeader: String,
            timeZone: String
        ) async throws -> UserProgressSummary {
            self.progressSummaryRequests.append(
                ProgressSummaryRequest(
                    apiBaseUrl: apiBaseUrl,
                    authorizationHeader: authorizationHeader,
                    timeZone: timeZone
                )
            )
            return UserProgressSummary(
                timeZone: timeZone,
                summary: ProgressSummary(
                    currentStreakDays: 0,
                    hasReviewedToday: false,
                    lastReviewedOn: nil,
                    activeReviewDays: 0
                ),
                generatedAt: "2026-04-25T00:00:00.000Z",
                reviewHistoryWatermarks: []
            )
        }

        func loadProgressSeries(
            apiBaseUrl: String,
            authorizationHeader: String,
            timeZone: String,
            from: String,
            to: String
        ) async throws -> UserProgressSeries {
            self.progressSeriesRequests.append(
                ProgressSeriesRequest(
                    apiBaseUrl: apiBaseUrl,
                    authorizationHeader: authorizationHeader,
                    timeZone: timeZone,
                    from: from,
                    to: to
                )
            )
            return UserProgressSeries(
                timeZone: timeZone,
                from: from,
                to: to,
                dailyReviews: [],
                summary: ProgressSummary(
                    currentStreakDays: 0,
                    hasReviewedToday: false,
                    lastReviewedOn: nil,
                    activeReviewDays: 0
                ),
                generatedAt: "2026-04-25T00:00:00.000Z",
                reviewHistoryWatermarks: []
            )
        }

        func loadProgressReviewSchedule(
            apiBaseUrl: String,
            authorizationHeader: String,
            timeZone: String
        ) async throws -> UserReviewSchedule {
            self.progressReviewScheduleRequests.append(
                ProgressReviewScheduleRequest(
                    apiBaseUrl: apiBaseUrl,
                    authorizationHeader: authorizationHeader,
                    timeZone: timeZone
                )
            )
            return makeReviewSchedule(
                timeZone: timeZone,
                generatedAt: "2026-04-25T00:00:00.000Z",
                reviewHistoryWatermarks: [],
                totalCards: 0,
                buckets: ReviewScheduleBucketKey.stableOrder.map { bucketKey in
                    ReviewScheduleBucket(key: bucketKey, count: 0)
                }
            )
        }

        func loadProgressLeaderboard(
            apiBaseUrl: String,
            authorizationHeader: String
        ) async throws -> UserProgressLeaderboard {
            _ = apiBaseUrl
            _ = authorizationHeader
            return makeNonReadyProgressLeaderboardForTests(status: .snapshotUnavailable)
        }

        func loadCommunityPublicProfile(
            apiBaseUrl: String,
            authorizationHeader: String
        ) async throws -> CommunityPublicProfile {
            _ = apiBaseUrl
            _ = authorizationHeader
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func updateCommunityLeaderboardParticipation(
            apiBaseUrl: String,
            authorizationHeader: String,
            isEnabled: Bool
        ) async throws -> CommunityPublicProfile {
            _ = apiBaseUrl
            _ = authorizationHeader
            _ = isEnabled
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func loadFeedbackState(
            apiBaseUrl: String,
            authorizationHeader: String
        ) async throws -> FeedbackState {
            _ = apiBaseUrl
            _ = authorizationHeader
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func recordFeedbackPromptEvent(
            apiBaseUrl: String,
            authorizationHeader: String,
            request: FeedbackPromptEventRequest
        ) async throws -> FeedbackState {
            _ = apiBaseUrl
            _ = authorizationHeader
            _ = request
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func submitFeedback(
            apiBaseUrl: String,
            authorizationHeader: String,
            request: FeedbackSubmissionRequest
        ) async throws -> FeedbackState {
            _ = apiBaseUrl
            _ = authorizationHeader
            _ = request
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary {
            _ = apiBaseUrl
            _ = bearerToken
            _ = name
            fatalError("Not used in AIChatStoreTestSupport.")
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
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func loadWorkspaceDeletePreview(
            apiBaseUrl: String,
            bearerToken: String,
            workspaceId: String
        ) async throws -> CloudWorkspaceDeletePreview {
            _ = apiBaseUrl
            _ = bearerToken
            _ = workspaceId
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func loadWorkspaceResetProgressPreview(
            apiBaseUrl: String,
            bearerToken: String,
            workspaceId: String
        ) async throws -> CloudWorkspaceResetProgressPreview {
            _ = apiBaseUrl
            _ = bearerToken
            _ = workspaceId
            fatalError("Not used in AIChatStoreTestSupport.")
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
            fatalError("Not used in AIChatStoreTestSupport.")
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
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func selectWorkspace(
            apiBaseUrl: String,
            bearerToken: String,
            workspaceId: String
        ) async throws -> CloudWorkspaceSummary {
            _ = apiBaseUrl
            _ = bearerToken
            _ = workspaceId
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func listAgentApiKeys(
            apiBaseUrl: String,
            bearerToken: String
        ) async throws -> ([AgentApiKeyConnection], String) {
            _ = apiBaseUrl
            _ = bearerToken
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func revokeAgentApiKey(
            apiBaseUrl: String,
            bearerToken: String,
            connectionId: String
        ) async throws -> (AgentApiKeyConnection, String) {
            _ = apiBaseUrl
            _ = bearerToken
            _ = connectionId
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func isWorkspaceEmptyForBootstrap(
            apiBaseUrl: String,
            authorizationHeader: String,
            workspaceId: String,
            installationId: String
        ) async throws -> Bool {
            self.isWorkspaceEmptyForBootstrapRequests.append(
                WorkspaceBootstrapEmptinessRequest(
                    apiBaseUrl: apiBaseUrl,
                    authorizationHeader: authorizationHeader,
                    workspaceId: workspaceId,
                    installationId: installationId
                )
            )
            return self.isWorkspaceEmptyForBootstrapResult
        }

        func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws {
            _ = apiBaseUrl
            _ = bearerToken
            _ = confirmationText
            fatalError("Not used in AIChatStoreTestSupport.")
        }

        func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
            _ = linkedSession
            self.runLinkedSyncCallCount += 1
            self.syncExpectation?.fulfill()
            if let runLinkedSyncGate = self.runLinkedSyncGate {
                await runLinkedSyncGate.wait()
                self.runLinkedSyncGate = nil
            }
            if self.runLinkedSyncErrors.isEmpty == false {
                let error = self.runLinkedSyncErrors.removeFirst()
                throw error
            }
            return CloudSyncResult(
                appliedPullChangeCount: 0,
                reviewScheduleImpactingPullChangeCount: 0,
                changedEntityTypes: [],
                localIdRepairEntityTypes: [],
                acknowledgedOperationCount: 0,
                acknowledgedReviewEventOperationCount: 0,
                acknowledgedReviewScheduleImpactingOperationCount: 0,
                cleanedUpOperationCount: 0,
                cleanedUpReviewEventOperationCount: 0,
                cleanedUpReviewScheduleImpactingOperationCount: 0
            )
        }

        func runGuestLocalRecoveryLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
            try await self.runLinkedSync(linkedSession: linkedSession)
        }
    }
}
