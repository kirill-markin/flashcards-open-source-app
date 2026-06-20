import Foundation

enum CloudSyncError: LocalizedError {
    case invalidBaseUrl(String)
    case invalidResponse(CloudApiErrorDetails, Int)

    var errorDescription: String? {
        switch self {
        case .invalidBaseUrl:
            return "Cloud sync is unavailable. Check the app configuration."
        case .invalidResponse(let details, _):
            return appendCloudRequestIdReference(
                message: details.message,
                requestId: details.requestId
            )
        }
    }

    var statusCode: Int? {
        switch self {
        case .invalidResponse(_, let statusCode):
            return statusCode
        case .invalidBaseUrl:
            return nil
        }
    }
}

struct CloudAccountSnapshot: Hashable {
    let userId: String
    let email: String?
    let workspaces: [CloudWorkspaceSummary]
    let preferences: AccountPreferences

    init(
        userId: String,
        email: String?,
        workspaces: [CloudWorkspaceSummary],
        preferences: AccountPreferences
    ) {
        self.userId = userId
        self.email = email
        self.workspaces = workspaces
        self.preferences = preferences
    }

    init(
        userId: String,
        email: String?,
        workspaces: [CloudWorkspaceSummary]
    ) {
        self.init(
            userId: userId,
            email: email,
            workspaces: workspaces,
            preferences: makeDefaultAccountPreferences()
        )
    }
}

struct CloudAccountContext: Hashable, Sendable {
    let userId: String
    let email: String?
    let preferences: AccountPreferences
}

private func makeCloudAccountContext(meResponse: MeResponse) -> CloudAccountContext {
    CloudAccountContext(
        userId: meResponse.userId,
        email: meResponse.profile.email,
        preferences: AccountPreferences(
            reviewReactionAnimationsEnabled: meResponse.preferences.reviewReactionAnimationsEnabled
        )
    )
}

final class CloudSyncService: @unchecked Sendable {
    private let database: LocalDatabase
    private let transport: CloudSyncTransport

    init(database: LocalDatabase, session: URLSession = .shared) {
        self.database = database
        self.transport = CloudSyncTransport(session: session)
    }

    func fetchCloudAccountContext(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> CloudAccountContext {
        let meResponse: MeResponse = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: "/me",
            method: "GET",
            body: Optional<String>.none
        )
        return makeCloudAccountContext(meResponse: meResponse)
    }

    func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot {
        try await self.fetchCloudAccount(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)"
        )
    }

    func fetchCloudAccount(apiBaseUrl: String, authorizationHeader: String) async throws -> CloudAccountSnapshot {
        logCloudFlowPhase(phase: .workspaceList, outcome: "start")
        async let meResponseTask: MeResponse = self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: "/me",
            method: "GET",
            body: Optional<String>.none
        )
        async let workspacesResponseTask = self.transport.listWorkspaces(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader
        )

        let meResponse = try await meResponseTask
        let workspacesResponse = try await workspacesResponseTask
        let selectedWorkspaceId = meResponse.selectedWorkspaceId
        let accountContext = makeCloudAccountContext(meResponse: meResponse)
        let workspaces = workspacesResponse.map { workspace in
            CloudWorkspaceSummary(
                workspaceId: workspace.workspaceId,
                name: workspace.name,
                createdAt: workspace.createdAt,
                isSelected: workspace.workspaceId == selectedWorkspaceId
            )
        }

        let snapshot = CloudAccountSnapshot(
            userId: accountContext.userId,
            email: accountContext.email,
            workspaces: workspaces,
            preferences: accountContext.preferences
        )
        logCloudFlowPhase(
            phase: .workspaceList,
            outcome: "success",
            changesCount: workspaces.count
        )
        return snapshot
    }

    func updateAccountPreferences(
        apiBaseUrl: String,
        authorizationHeader: String,
        preferences: AccountPreferences
    ) async throws -> AccountPreferences {
        let response: UpdateAccountPreferencesResponse = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: "/me/preferences",
            method: "PATCH",
            body: preferences
        )
        return response.preferences
    }

    func loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ) async throws -> UserProgressSummary {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: try self.transport.progressSummaryPath(timeZone: timeZone),
            method: "GET",
            body: Optional<String>.none
        )
    }

    func loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ) async throws -> UserProgressSeries {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: try self.transport.progressSeriesPath(timeZone: timeZone, from: from, to: to),
            method: "GET",
            body: Optional<String>.none
        )
    }

    func loadProgressReviewSchedule(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ) async throws -> UserReviewSchedule {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: try self.transport.progressReviewSchedulePath(timeZone: timeZone),
            method: "GET",
            body: Optional<String>.none
        )
    }

    func loadProgressLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> UserProgressLeaderboard {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: "/me/progress/leaderboard",
            method: "GET",
            body: Optional<String>.none
        )
    }

    func loadProgressStreakLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> UserProgressStreakLeaderboard {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: "/me/progress/leaderboards/streak",
            method: "GET",
            body: Optional<String>.none
        )
    }

    func loadCommunityPublicProfile(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> CommunityPublicProfile {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: "/me/community/profile",
            method: "GET",
            body: Optional<String>.none
        )
    }

    func updateCommunityLeaderboardParticipation(
        apiBaseUrl: String,
        authorizationHeader: String,
        isEnabled: Bool
    ) async throws -> CommunityPublicProfile {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: "/me/community/profile",
            method: "PATCH",
            body: CommunityProfilePatchRequest(leaderboardParticipationEnabled: isEnabled)
        )
    }

    func createFriendInvitation(
        apiBaseUrl: String,
        bearerToken: String,
        inviteeDisplayName: String
    ) async throws -> FriendInvitationCreateResponse {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/me/community/friend-invitations",
            method: "POST",
            body: FriendInvitationCreateRequest(inviteeDisplayName: inviteeDisplayName)
        )
    }

    func loadFeedbackState(
        apiBaseUrl: String,
        authorizationHeader: String
    ) async throws -> FeedbackState {
        let response: FeedbackStateEnvelope = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: "/feedback/state",
            method: "GET",
            body: Optional<String>.none
        )
        return response.feedbackState
    }

    func recordFeedbackPromptEvent(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: FeedbackPromptEventRequest
    ) async throws -> FeedbackState {
        let response: FeedbackStateEnvelope = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: "/feedback/prompt-events",
            method: "POST",
            body: request
        )
        return response.feedbackState
    }

    func submitFeedback(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: FeedbackSubmissionRequest
    ) async throws -> FeedbackState {
        let response: FeedbackStateEnvelope = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: "/feedback/submissions",
            method: "POST",
            body: request
        )
        return response.feedbackState
    }

    func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary {
        logCloudFlowPhase(phase: .workspaceCreate, outcome: "start", selection: "create_new")
        let response: WorkspaceEnvelope = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/workspaces",
            method: "POST",
            body: CreateWorkspaceRequest(name: name)
        )

        logCloudFlowPhase(
            phase: .workspaceCreate,
            outcome: "success",
            workspaceId: response.workspace.workspaceId,
            selection: "create_new"
        )
        return response.workspace
    }

    func renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ) async throws -> CloudWorkspaceSummary {
        let response: WorkspaceEnvelope = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/workspaces/\(workspaceId)/rename",
            method: "POST",
            body: CreateWorkspaceRequest(name: name)
        )
        return response.workspace
    }

    func loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceDeletePreview {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/workspaces/\(workspaceId)/delete-preview",
            method: "GET",
            body: Optional<String>.none
        )
    }

    func loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceResetProgressPreview {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/workspaces/\(workspaceId)/reset-progress-preview",
            method: "GET",
            body: Optional<String>.none
        )
    }

    func deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceDeleteResult {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/workspaces/\(workspaceId)/delete",
            method: "POST",
            body: DeleteAccountRequest(confirmationText: confirmationText)
        )
    }

    func resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceResetProgressResult {
        let response: CloudWorkspaceResetProgressResult = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/workspaces/\(workspaceId)/reset-progress",
            method: "POST",
            body: DeleteAccountRequest(confirmationText: confirmationText)
        )

        if response.ok == false {
            throw LocalStoreError.validation("Workspace progress reset did not return ok=true")
        }

        return response
    }

    func selectWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String) async throws -> CloudWorkspaceSummary {
        logCloudFlowPhase(
            phase: .workspaceSelect,
            outcome: "start",
            workspaceId: workspaceId,
            selection: "existing"
        )
        let response: WorkspaceEnvelope = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/workspaces/\(workspaceId)/select",
            method: "POST",
            body: Optional<String>.none
        )

        logCloudFlowPhase(
            phase: .workspaceSelect,
            outcome: "success",
            workspaceId: response.workspace.workspaceId,
            selection: "existing"
        )
        return response.workspace
    }

    /// Loads the long-lived bot connections associated with the signed-in user.
    func listAgentApiKeys(apiBaseUrl: String, bearerToken: String) async throws -> ([AgentApiKeyConnection], String) {
        var connections: [AgentApiKeyConnection] = []
        var nextCursor: String? = nil
        var instructions: String = ""

        repeat {
            let response: AgentApiKeyConnectionsEnvelope = try await self.transport.request(
                apiBaseUrl: apiBaseUrl,
                authorizationHeader: "Bearer \(bearerToken)",
                path: self.transport.paginatedPath(basePath: "/agent-api-keys", cursor: nextCursor),
                method: "GET",
                body: Optional<String>.none
            )
            connections.append(contentsOf: response.connections)
            instructions = response.instructions
            nextCursor = response.nextCursor
        } while nextCursor != nil

        return (connections, instructions)
    }

    /// Revokes one long-lived bot connection immediately by its connection identifier.
    func revokeAgentApiKey(apiBaseUrl: String, bearerToken: String, connectionId: String) async throws -> (AgentApiKeyConnection, String) {
        let response: AgentApiKeyRevokeEnvelope = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/agent-api-keys/\(connectionId)/revoke",
            method: "POST",
            body: Optional<String>.none
        )
        return (response.connection, response.instructions)
    }

    func isWorkspaceEmptyForBootstrap(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        installationId: String
    ) async throws -> Bool {
        let bootstrapEnvelope: RemoteBootstrapPullResponseEnvelope = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: "/workspaces/\(workspaceId)/sync/bootstrap",
            method: "POST",
            body: BootstrapPullRequest(
                mode: "pull",
                installationId: installationId,
                platform: "ios",
                appVersion: self.transport.appVersion(),
                cursor: nil,
                limit: 1
            )
        )

        return bootstrapEnvelope.remoteIsEmpty
    }

    func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws {
        let response: DeleteAccountResponse = try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/me/delete",
            method: "POST",
            body: DeleteAccountRequest(confirmationText: confirmationText)
        )

        if response.ok == false {
            throw LocalStoreError.validation("Cloud account deletion did not return ok=true")
        }
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        try await CloudSyncRunner(database: self.database, transport: self.transport).runLinkedSync(
            linkedSession: linkedSession
        )
    }

    func runGuestLocalRecoveryLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        try await CloudSyncRunner(database: self.database, transport: self.transport).runGuestLocalRecoveryLinkedSync(
            linkedSession: linkedSession
        )
    }
}
