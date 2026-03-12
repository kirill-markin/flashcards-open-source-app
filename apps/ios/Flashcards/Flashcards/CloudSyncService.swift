import Foundation

enum CloudSyncError: LocalizedError {
    case invalidBaseUrl(String)
    case invalidResponse(CloudApiErrorDetails, Int)

    var errorDescription: String? {
        switch self {
        case .invalidBaseUrl:
            return "Cloud sync is unavailable. Check the app configuration."
        case .invalidResponse(let details, _):
            return appendCloudRequestReference(
                message: "Cloud sync failed. Try again.",
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

private struct MeResponse: Decodable {
    struct Profile: Decodable {
        let email: String?
    }

    let userId: String
    let selectedWorkspaceId: String?
    let profile: Profile
}

private struct WorkspacesResponse: Decodable {
    let workspaces: [CloudWorkspaceSummary]
    let nextCursor: String?
}

private struct WorkspaceEnvelope: Decodable {
    let workspace: CloudWorkspaceSummary
}

private struct AgentApiKeyConnectionsEnvelope: Decodable {
    let connections: [AgentApiKeyConnection]
    let nextCursor: String?
    let instructions: String
}

private struct AgentApiKeyRevokeEnvelope: Decodable {
    let ok: Bool
    let connection: AgentApiKeyConnection
    let instructions: String
}

private struct CreateWorkspaceRequest: Encodable {
    let name: String
}

private struct DeleteAccountRequest: Encodable {
    let confirmationText: String
}

private struct DeleteAccountResponse: Decodable {
    let ok: Bool
}

private struct PushRequest: Encodable {
    let deviceId: String
    let platform: String
    let appVersion: String
    let operations: [SyncOperationEnvelope]
}

private struct PullRequest: Encodable {
    let deviceId: String
    let platform: String
    let appVersion: String
    let afterChangeId: Int64
    let limit: Int
}

private let collectionPageLimit: Int = 100

private struct SyncOperationEnvelope: Encodable {
    let operation: SyncOperation

    enum CodingKeys: String, CodingKey {
        case operationId
        case entityType
        case entityId
        case action
        case clientUpdatedAt
        case payload
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(operation.operationId, forKey: .operationId)
        try container.encode(operation.entityType, forKey: .entityType)
        try container.encode(operation.entityId, forKey: .entityId)
        try container.encode(operation.action, forKey: .action)
        try container.encode(operation.clientUpdatedAt, forKey: .clientUpdatedAt)

        switch operation.payload {
        case .card(let payload):
            try container.encode(payload, forKey: .payload)
        case .deck(let payload):
            try container.encode(payload, forKey: .payload)
        case .workspaceSchedulerSettings(let payload):
            try container.encode(payload, forKey: .payload)
        case .reviewEvent(let payload):
            try container.encode(payload, forKey: .payload)
        }
    }
}

private struct RemoteCardChangePayload: Decodable {
    let cardId: String
    let frontText: String
    let backText: String
    let tags: [String]
    let effortLevel: EffortLevel
    let dueAt: String?
    let reps: Int
    let lapses: Int
    let fsrsCardState: FsrsCardState
    let fsrsStepIndex: Int?
    let fsrsStability: Double?
    let fsrsDifficulty: Double?
    let fsrsLastReviewedAt: String?
    let fsrsScheduledDays: Int?
    let clientUpdatedAt: String
    let lastModifiedByDeviceId: String
    let lastOperationId: String
    let updatedAt: String
    let deletedAt: String?
}

private struct RemoteDeckChangePayload: Decodable {
    let deckId: String
    let name: String
    let filterDefinition: DeckFilterDefinition
    let createdAt: String
    let clientUpdatedAt: String
    let lastModifiedByDeviceId: String
    let lastOperationId: String
    let updatedAt: String
    let deletedAt: String?
}

private struct RemoteWorkspaceSchedulerSettingsChangePayload: Decodable {
    let algorithm: String
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
    let clientUpdatedAt: String
    let lastModifiedByDeviceId: String
    let lastOperationId: String
    let updatedAt: String
}

private struct RemoteReviewEventChangePayload: Decodable {
    let reviewEventId: String
    let cardId: String
    let deviceId: String
    let clientEventId: String
    let rating: ReviewRating
    let reviewedAtClient: String
    let reviewedAtServer: String
}

private enum RemoteSyncChangePayload {
    case card(RemoteCardChangePayload)
    case deck(RemoteDeckChangePayload)
    case workspaceSchedulerSettings(RemoteWorkspaceSchedulerSettingsChangePayload)
    case reviewEvent(RemoteReviewEventChangePayload)
}

private struct RemoteSyncChangeEnvelope: Decodable {
    let changeId: Int64
    let entityType: SyncEntityType
    let entityId: String
    let action: SyncAction
    let payload: RemoteSyncChangePayload

    enum CodingKeys: String, CodingKey {
        case changeId
        case entityType
        case entityId
        case action
        case payload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.changeId = try container.decode(Int64.self, forKey: .changeId)
        self.entityType = try container.decode(SyncEntityType.self, forKey: .entityType)
        self.entityId = try container.decode(String.self, forKey: .entityId)
        self.action = try container.decode(SyncAction.self, forKey: .action)

        switch self.entityType {
        case .card:
            self.payload = .card(try container.decode(RemoteCardChangePayload.self, forKey: .payload))
        case .deck:
            self.payload = .deck(try container.decode(RemoteDeckChangePayload.self, forKey: .payload))
        case .workspaceSchedulerSettings:
            self.payload = .workspaceSchedulerSettings(
                try container.decode(RemoteWorkspaceSchedulerSettingsChangePayload.self, forKey: .payload)
            )
        case .reviewEvent:
            self.payload = .reviewEvent(
                try container.decode(RemoteReviewEventChangePayload.self, forKey: .payload)
            )
        }
    }
}

private struct RemotePullResponseEnvelope: Decodable {
    let changes: [RemoteSyncChangeEnvelope]
    let nextChangeId: Int64
    let hasMore: Bool
}

private func makeCard(workspaceId: String, payload: RemoteCardChangePayload) -> Card {
    Card(
        cardId: payload.cardId,
        workspaceId: workspaceId,
        frontText: payload.frontText,
        backText: payload.backText,
        tags: payload.tags,
        effortLevel: payload.effortLevel,
        dueAt: payload.dueAt,
        reps: payload.reps,
        lapses: payload.lapses,
        fsrsCardState: payload.fsrsCardState,
        fsrsStepIndex: payload.fsrsStepIndex,
        fsrsStability: payload.fsrsStability,
        fsrsDifficulty: payload.fsrsDifficulty,
        fsrsLastReviewedAt: payload.fsrsLastReviewedAt,
        fsrsScheduledDays: payload.fsrsScheduledDays,
        clientUpdatedAt: payload.clientUpdatedAt,
        lastModifiedByDeviceId: payload.lastModifiedByDeviceId,
        lastOperationId: payload.lastOperationId,
        updatedAt: payload.updatedAt,
        deletedAt: payload.deletedAt
    )
}

private func makeDeck(workspaceId: String, payload: RemoteDeckChangePayload) -> Deck {
    Deck(
        deckId: payload.deckId,
        workspaceId: workspaceId,
        name: payload.name,
        filterDefinition: payload.filterDefinition,
        createdAt: payload.createdAt,
        clientUpdatedAt: payload.clientUpdatedAt,
        lastModifiedByDeviceId: payload.lastModifiedByDeviceId,
        lastOperationId: payload.lastOperationId,
        updatedAt: payload.updatedAt,
        deletedAt: payload.deletedAt
    )
}

private func makeWorkspaceSchedulerSettings(
    payload: RemoteWorkspaceSchedulerSettingsChangePayload
) -> WorkspaceSchedulerSettings {
    WorkspaceSchedulerSettings(
        algorithm: payload.algorithm,
        desiredRetention: payload.desiredRetention,
        learningStepsMinutes: payload.learningStepsMinutes,
        relearningStepsMinutes: payload.relearningStepsMinutes,
        maximumIntervalDays: payload.maximumIntervalDays,
        enableFuzz: payload.enableFuzz,
        clientUpdatedAt: payload.clientUpdatedAt,
        lastModifiedByDeviceId: payload.lastModifiedByDeviceId,
        lastOperationId: payload.lastOperationId,
        updatedAt: payload.updatedAt
    )
}

private func makeReviewEvent(workspaceId: String, payload: RemoteReviewEventChangePayload) -> ReviewEvent {
    ReviewEvent(
        reviewEventId: payload.reviewEventId,
        workspaceId: workspaceId,
        cardId: payload.cardId,
        deviceId: payload.deviceId,
        clientEventId: payload.clientEventId,
        rating: payload.rating,
        reviewedAtClient: payload.reviewedAtClient,
        reviewedAtServer: payload.reviewedAtServer
    )
}

private func makeSyncChange(workspaceId: String, change: RemoteSyncChangeEnvelope) -> SyncChange {
    switch change.payload {
    case .card(let payload):
        return SyncChange(
            changeId: change.changeId,
            entityType: change.entityType,
            entityId: change.entityId,
            action: change.action,
            payload: .card(makeCard(workspaceId: workspaceId, payload: payload))
        )
    case .deck(let payload):
        return SyncChange(
            changeId: change.changeId,
            entityType: change.entityType,
            entityId: change.entityId,
            action: change.action,
            payload: .deck(makeDeck(workspaceId: workspaceId, payload: payload))
        )
    case .workspaceSchedulerSettings(let payload):
        return SyncChange(
            changeId: change.changeId,
            entityType: change.entityType,
            entityId: change.entityId,
            action: change.action,
            payload: .workspaceSchedulerSettings(makeWorkspaceSchedulerSettings(payload: payload))
        )
    case .reviewEvent(let payload):
        return SyncChange(
            changeId: change.changeId,
            entityType: change.entityType,
            entityId: change.entityId,
            action: change.action,
            payload: .reviewEvent(makeReviewEvent(workspaceId: workspaceId, payload: payload))
        )
    }
}

final class CloudSyncService: @unchecked Sendable {
    private let database: LocalDatabase
    private let session: URLSession

    init(database: LocalDatabase, session: URLSession = .shared) {
        self.database = database
        self.session = session
    }

    func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot {
        logCloudPhase(phase: .workspaceList, outcome: "start")
        async let meResponseTask: MeResponse = self.request(
            apiBaseUrl: apiBaseUrl,
            bearerToken: bearerToken,
            path: "/me",
            method: "GET",
            body: Optional<String>.none
        )
        async let workspacesResponseTask = self.listWorkspaces(apiBaseUrl: apiBaseUrl, bearerToken: bearerToken)

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
        logCloudPhase(
            phase: .workspaceList,
            outcome: "success",
            changesCount: workspaces.count
        )
        return snapshot
    }

    func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary {
        logCloudPhase(phase: .workspaceCreate, outcome: "start", selection: "create_new")
        let response: WorkspaceEnvelope = try await self.request(
            apiBaseUrl: apiBaseUrl,
            bearerToken: bearerToken,
            path: "/workspaces",
            method: "POST",
            body: CreateWorkspaceRequest(name: name)
        )

        logCloudPhase(
            phase: .workspaceCreate,
            outcome: "success",
            workspaceId: response.workspace.workspaceId,
            selection: "create_new"
        )
        return response.workspace
    }

    func selectWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String) async throws -> CloudWorkspaceSummary {
        logCloudPhase(
            phase: .workspaceSelect,
            outcome: "start",
            workspaceId: workspaceId,
            selection: "existing"
        )
        let response: WorkspaceEnvelope = try await self.request(
            apiBaseUrl: apiBaseUrl,
            bearerToken: bearerToken,
            path: "/workspaces/\(workspaceId)/select",
            method: "POST",
            body: Optional<String>.none
        )

        logCloudPhase(
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
            let response: AgentApiKeyConnectionsEnvelope = try await self.request(
                apiBaseUrl: apiBaseUrl,
                bearerToken: bearerToken,
                path: self.paginatedPath(basePath: "/agent-api-keys", cursor: nextCursor),
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
        let response: AgentApiKeyRevokeEnvelope = try await self.request(
            apiBaseUrl: apiBaseUrl,
            bearerToken: bearerToken,
            path: "/agent-api-keys/\(connectionId)/revoke",
            method: "POST",
            body: Optional<String>.none
        )
        return (response.connection, response.instructions)
    }

    func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws {
        let response: DeleteAccountResponse = try await self.request(
            apiBaseUrl: apiBaseUrl,
            bearerToken: bearerToken,
            path: "/me/delete",
            method: "POST",
            body: DeleteAccountRequest(confirmationText: confirmationText)
        )

        if response.ok == false {
            throw LocalStoreError.validation("Cloud account deletion did not return ok=true")
        }
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws {
        let cloudSettings = try self.database.loadStateSnapshot().cloudSettings
        let workspaceId = linkedSession.workspaceId
        let syncBasePath = "/workspaces/\(workspaceId)/sync"

        while true {
            let removedReviewEventCount = try self.database.deleteStaleReviewEventOutboxEntries(workspaceId: workspaceId)
            if removedReviewEventCount > 0 {
                logCloudPhase(
                    phase: .initialPush,
                    outcome: "self_heal",
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationsCount: removedReviewEventCount
                )
            }

            let outboxEntries = try self.database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
            if outboxEntries.isEmpty {
                break
            }

            do {
                logCloudPhase(
                    phase: .initialPush,
                    outcome: "start",
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationsCount: outboxEntries.count
                )
                let pushResponse: SyncPushResponse = try await self.request(
                    apiBaseUrl: linkedSession.apiBaseUrl,
                    bearerToken: linkedSession.bearerToken,
                    path: "\(syncBasePath)/push",
                    method: "POST",
                    body: PushRequest(
                        deviceId: cloudSettings.deviceId,
                        platform: "ios",
                        appVersion: self.appVersion(),
                        operations: outboxEntries.map { entry in
                            SyncOperationEnvelope(operation: entry.operation)
                        }
                    )
                )

                try self.database.deleteOutboxEntries(
                    operationIds: pushResponse.operations.map { result in
                        result.operationId
                    }
                )
                logCloudPhase(
                    phase: .initialPush,
                    outcome: "success",
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationsCount: pushResponse.operations.count
                )
            } catch {
                try self.database.markOutboxEntriesFailed(
                    operationIds: outboxEntries.map { entry in
                        entry.operationId
                    },
                    message: error.localizedDescription
                )
                logCloudPhase(
                    phase: .initialPush,
                    outcome: "failure",
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationsCount: outboxEntries.count,
                    errorMessage: localizedMessage(error: error)
                )
                throw error
            }
        }

        var afterChangeId = try self.database.loadLastAppliedChangeId(workspaceId: workspaceId)
        while true {
            logCloudPhase(
                phase: .initialPull,
                outcome: "start",
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId
            )
            let pullEnvelope: RemotePullResponseEnvelope = try await self.request(
                apiBaseUrl: linkedSession.apiBaseUrl,
                bearerToken: linkedSession.bearerToken,
                path: "\(syncBasePath)/pull",
                method: "POST",
                body: PullRequest(
                    deviceId: cloudSettings.deviceId,
                    platform: "ios",
                    appVersion: self.appVersion(),
                    afterChangeId: afterChangeId,
                    limit: 200
                )
            )

            for change in pullEnvelope.changes {
                try self.database.applySyncChange(
                    workspaceId: workspaceId,
                    change: makeSyncChange(workspaceId: workspaceId, change: change)
                )
            }

            afterChangeId = pullEnvelope.nextChangeId
            try self.database.setLastAppliedChangeId(workspaceId: workspaceId, changeId: afterChangeId)
            logCloudPhase(
                phase: .initialPull,
                outcome: "success",
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                changesCount: pullEnvelope.changes.count
            )

            if pullEnvelope.hasMore == false {
                break
            }
        }
    }

    private func appVersion() -> String {
        let shortVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return shortVersion ?? "0.1.0"
    }

    private func makeUrl(apiBaseUrl: String, path: String) throws -> URL {
        let trimmedBaseUrl = apiBaseUrl.hasSuffix("/") ? String(apiBaseUrl.dropLast()) : apiBaseUrl
        guard let url = URL(string: "\(trimmedBaseUrl)\(path)") else {
            throw CloudSyncError.invalidBaseUrl(apiBaseUrl)
        }

        return url
    }

    private func paginatedPath(basePath: String, cursor: String?) -> String {
        guard var components = URLComponents(string: basePath) else {
            return "\(basePath)?limit=\(collectionPageLimit)"
        }

        var queryItems = [
            URLQueryItem(name: "limit", value: String(collectionPageLimit))
        ]
        if let cursor {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        components.queryItems = queryItems
        return components.string ?? "\(basePath)?limit=\(collectionPageLimit)"
    }

    private func listWorkspaces(apiBaseUrl: String, bearerToken: String) async throws -> [CloudWorkspaceSummary] {
        var workspaces: [CloudWorkspaceSummary] = []
        var nextCursor: String? = nil

        repeat {
            let response: WorkspacesResponse = try await self.request(
                apiBaseUrl: apiBaseUrl,
                bearerToken: bearerToken,
                path: self.paginatedPath(basePath: "/workspaces", cursor: nextCursor),
                method: "GET",
                body: Optional<String>.none
            )
            workspaces.append(contentsOf: response.workspaces)
            nextCursor = response.nextCursor
        } while nextCursor != nil

        return workspaces
    }

    private func request<Response: Decodable, Body: Encodable>(
        apiBaseUrl: String,
        bearerToken: String,
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: try self.makeUrl(apiBaseUrl: apiBaseUrl, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")

        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await self.session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LocalStoreError.database("Cloud sync did not receive an HTTP response")
        }

        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")
            let errorDetails = parseCloudApiErrorDetails(data: data, requestId: requestId)
            logCloudPhase(
                phase: self.phase(for: path),
                outcome: "failure",
                requestId: errorDetails.requestId,
                code: errorDetails.code,
                statusCode: httpResponse.statusCode
            )
            throw CloudSyncError.invalidResponse(errorDetails, httpResponse.statusCode)
        }

        logCloudPhase(phase: self.phase(for: path), outcome: "success")

        return try JSONDecoder().decode(Response.self, from: data)
    }

    private func phase(for path: String) -> CloudFlowPhase {
        if path == "/workspaces" {
            return .workspaceCreate
        }

        if path.hasPrefix("/workspaces/") && path.hasSuffix("/select") {
            return .workspaceSelect
        }

        if path.hasSuffix("/sync/push") {
            return .initialPush
        }

        if path.hasSuffix("/sync/pull") {
            return .initialPull
        }

        return .workspaceList
    }
}
