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
}

final class CloudSyncService: @unchecked Sendable {
    private let database: LocalDatabase
    private let transport: CloudSyncTransport

    init(database: LocalDatabase, session: URLSession = .shared) {
        self.database = database
        self.transport = CloudSyncTransport(session: session)
    }

    func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot {
        logCloudFlowPhase(phase: .workspaceList, outcome: "start")
        async let meResponseTask: MeResponse = self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/me",
            method: "GET",
            body: Optional<String>.none
        )
        async let workspacesResponseTask = self.transport.listWorkspaces(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)"
        )

        let meResponse = try await meResponseTask
        let workspacesResponse = try await workspacesResponseTask
        let selectedWorkspaceId = meResponse.selectedWorkspaceId
        let workspaces = workspacesResponse.map { workspace in
            CloudWorkspaceSummary(
                workspaceId: workspace.workspaceId,
                name: workspace.name,
                createdAt: workspace.createdAt,
                isSelected: workspace.workspaceId == selectedWorkspaceId
            )
        }

        let snapshot = CloudAccountSnapshot(
            userId: meResponse.userId,
            email: meResponse.profile.email,
            workspaces: workspaces
        )
        logCloudFlowPhase(
            phase: .workspaceList,
            outcome: "success",
            changesCount: workspaces.count
        )
        return snapshot
    }

    func loadProgress(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ) async throws -> UserProgressSeries {
        try await self.transport.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: try self.transport.progressPath(timeZone: timeZone, from: from, to: to),
            method: "GET",
            body: Optional<String>.none
        )
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
}
