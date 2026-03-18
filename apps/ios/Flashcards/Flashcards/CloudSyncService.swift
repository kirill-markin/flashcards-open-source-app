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

/// Wire contract for `POST /sync/push`.
///
/// Keep this request aligned with `apps/backend/src/sync.ts`
/// `syncPushInputSchema` and `apps/backend/src/sync.test.ts`.
private struct PushRequest: Encodable {
    let deviceId: String
    let platform: String
    let appVersion: String
    let operations: [SyncOperationEnvelope]
}

/// Wire contract for `POST /sync/pull`.
///
/// Keep this request aligned with `apps/backend/src/sync.ts`
/// `syncPullInputSchema` and the sync contract tests in
/// `apps/ios/Flashcards/FlashcardsTests/CloudSupportTests.swift`.
private struct PullRequest: Encodable {
    let deviceId: String
    let platform: String
    let appVersion: String
    let afterHotChangeId: Int64
    let limit: Int
}

/// Wire contract for `POST /sync/bootstrap` pull pages.
///
/// The backend parser in `apps/backend/src/sync.ts` expects the `cursor` key to
/// exist on every request. The first page must therefore send `"cursor": null`
/// instead of omitting the key entirely. Keep this struct aligned with:
/// - `apps/backend/src/sync.ts` `syncBootstrapPullInputSchema`
/// - `apps/ios/Flashcards/FlashcardsTests/CloudSupportTests.swift`
private struct BootstrapPullRequest: Encodable {
    let mode: String
    let deviceId: String
    let platform: String
    let appVersion: String
    let cursor: String?
    let limit: Int

    enum CodingKeys: String, CodingKey {
        case mode
        case deviceId
        case platform
        case appVersion
        case cursor
        case limit
    }

    /// Encodes `cursor` explicitly as JSON `null` on the first bootstrap page.
    ///
    /// If you change this payload shape, update the matching backend validator in
    /// `apps/backend/src/sync.ts` and the contract tests in
    /// `apps/ios/Flashcards/FlashcardsTests/CloudSupportTests.swift`.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.mode, forKey: .mode)
        try container.encode(self.deviceId, forKey: .deviceId)
        try container.encode(self.platform, forKey: .platform)
        try container.encode(self.appVersion, forKey: .appVersion)
        if let cursor = self.cursor {
            try container.encode(cursor, forKey: .cursor)
        } else {
            try container.encodeNil(forKey: .cursor)
        }
        try container.encode(self.limit, forKey: .limit)
    }
}

/// Wire contract for `POST /sync/bootstrap` when the client uploads the current
/// hot workspace winners into an empty remote workspace.
///
/// Keep this request aligned with `apps/backend/src/sync.ts`
/// `syncBootstrapPushInputSchema`.
private struct BootstrapPushRequest: Encodable {
    let mode: String
    let deviceId: String
    let platform: String
    let appVersion: String
    let entries: [SyncBootstrapEntryEnvelope]
}

/// Wire contract for `POST /sync/review-history/pull`.
///
/// Keep this request aligned with `apps/backend/src/sync.ts`
/// `syncReviewHistoryPullInputSchema`.
private struct ReviewHistoryPullRequest: Encodable {
    let deviceId: String
    let platform: String
    let appVersion: String
    let afterReviewSequenceId: Int64
    let limit: Int
}

/// Wire contract for `POST /sync/review-history/import`.
///
/// Keep this request aligned with `apps/backend/src/sync.ts`
/// `syncReviewHistoryImportInputSchema`.
private struct ReviewHistoryImportRequest: Encodable {
    let deviceId: String
    let platform: String
    let appVersion: String
    let reviewEvents: [ReviewEvent]
}

private let collectionPageLimit: Int = 100

/// Encodes one `/sync/push` operation using the shared backend field names.
///
/// If you change this envelope, update `apps/backend/src/sync.ts` and the sync
/// contract tests in `apps/ios/Flashcards/FlashcardsTests/CloudSupportTests.swift`.
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

/// Encodes one `/sync/bootstrap` push entry using the shared backend field names.
private struct SyncBootstrapEntryEnvelope: Encodable {
    let entry: SyncBootstrapEntry

    enum CodingKeys: String, CodingKey {
        case entityType
        case entityId
        case action
        case payload
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(entry.entityType, forKey: .entityType)
        try container.encode(entry.entityId, forKey: .entityId)
        try container.encode(entry.action, forKey: .action)

        switch entry.payload {
        case .card(let payload):
            try container.encode(payload, forKey: .payload)
        case .deck(let payload):
            try container.encode(payload, forKey: .payload)
        case .workspaceSchedulerSettings(let payload):
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
    let createdAt: String
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

private enum RemoteSyncBootstrapEntryPayload {
    case card(RemoteCardChangePayload)
    case deck(RemoteDeckChangePayload)
    case workspaceSchedulerSettings(RemoteWorkspaceSchedulerSettingsChangePayload)
}

private struct RemoteSyncBootstrapEntryEnvelope: Decodable {
    let entityType: SyncEntityType
    let entityId: String
    let action: SyncAction
    let payload: RemoteSyncBootstrapEntryPayload

    enum CodingKeys: String, CodingKey {
        case entityType
        case entityId
        case action
        case payload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
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
            throw LocalStoreError.validation("Hot-state sync payload unexpectedly contained review_event")
        }
    }
}

private struct RemoteSyncChangeEnvelope: Decodable {
    let changeId: Int64
    let entityType: SyncEntityType
    let entityId: String
    let action: SyncAction
    let payload: RemoteSyncBootstrapEntryPayload

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
            throw LocalStoreError.validation("Hot-state sync payload unexpectedly contained review_event")
        }
    }
}

/// Decodes `/sync/pull` responses returned by `apps/backend/src/sync.ts`.
private struct RemotePullResponseEnvelope: Decodable {
    let changes: [RemoteSyncChangeEnvelope]
    let nextHotChangeId: Int64
    let hasMore: Bool
}

/// Decodes `/sync/bootstrap` pull responses returned by `apps/backend/src/sync.ts`.
private struct RemoteBootstrapPullResponseEnvelope: Decodable {
    let entries: [RemoteSyncBootstrapEntryEnvelope]
    let nextCursor: String?
    let hasMore: Bool
    let bootstrapHotChangeId: Int64
    let remoteIsEmpty: Bool
}

/// Decodes `/sync/bootstrap` push responses returned by `apps/backend/src/sync.ts`.
private struct RemoteBootstrapPushResponseEnvelope: Decodable {
    let appliedEntriesCount: Int
    let bootstrapHotChangeId: Int64?
}

/// Decodes `/sync/review-history/pull` responses returned by `apps/backend/src/sync.ts`.
private struct RemoteReviewHistoryPullResponseEnvelope: Decodable {
    let reviewEvents: [RemoteReviewEventEnvelope]
    let nextReviewSequenceId: Int64
    let hasMore: Bool
}

/// Decodes `/sync/review-history/import` responses returned by `apps/backend/src/sync.ts`.
private struct RemoteReviewHistoryImportResponseEnvelope: Decodable {
    let importedCount: Int
    let duplicateCount: Int
    let nextReviewSequenceId: Int64?
}

private struct RemoteReviewEventEnvelope: Decodable {
    let reviewEventId: String
    let workspaceId: String
    let cardId: String
    let deviceId: String
    let clientEventId: String
    let rating: ReviewRating
    let reviewedAtClient: String
    let reviewedAtServer: String
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
        createdAt: payload.createdAt,
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

private func makeReviewEvent(payload: RemoteReviewEventEnvelope) -> ReviewEvent {
    ReviewEvent(
        reviewEventId: payload.reviewEventId,
        workspaceId: payload.workspaceId,
        cardId: payload.cardId,
        deviceId: payload.deviceId,
        clientEventId: payload.clientEventId,
        rating: payload.rating,
        reviewedAtClient: payload.reviewedAtClient,
        reviewedAtServer: payload.reviewedAtServer
    )
}

/// Maps one backend bootstrap entry into the local hot-state model.
///
/// Keep this converter aligned with `apps/backend/src/sync.ts`
/// `SyncBootstrapPullResult`.
private func makeSyncBootstrapEntry(
    workspaceId: String,
    entry: RemoteSyncBootstrapEntryEnvelope
) -> SyncBootstrapEntry {
    switch entry.payload {
    case .card(let payload):
        return SyncBootstrapEntry(
            entityType: entry.entityType,
            entityId: entry.entityId,
            action: entry.action,
            payload: .card(makeCard(workspaceId: workspaceId, payload: payload))
        )
    case .deck(let payload):
        return SyncBootstrapEntry(
            entityType: entry.entityType,
            entityId: entry.entityId,
            action: entry.action,
            payload: .deck(makeDeck(workspaceId: workspaceId, payload: payload))
        )
    case .workspaceSchedulerSettings(let payload):
        return SyncBootstrapEntry(
            entityType: entry.entityType,
            entityId: entry.entityId,
            action: entry.action,
            payload: .workspaceSchedulerSettings(makeWorkspaceSchedulerSettings(payload: payload))
        )
    }
}

/// Maps one backend hot pull change into the local hot-state model.
///
/// Hot pull must never contain review events. If that ever changes in the
/// backend, update both this function and `RemoteSyncChangeEnvelope`.
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
        logCloudFlowPhase(phase: .workspaceList, outcome: "start")
        async let meResponseTask: MeResponse = self.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/me",
            method: "GET",
            body: Optional<String>.none
        )
        async let workspacesResponseTask = self.listWorkspaces(
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

    func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary {
        logCloudFlowPhase(phase: .workspaceCreate, outcome: "start", selection: "create_new")
        let response: WorkspaceEnvelope = try await self.request(
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
        let response: WorkspaceEnvelope = try await self.request(
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
        try await self.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/workspaces/\(workspaceId)/delete-preview",
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
        try await self.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/workspaces/\(workspaceId)/delete",
            method: "POST",
            body: DeleteAccountRequest(confirmationText: confirmationText)
        )
    }

    func selectWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String) async throws -> CloudWorkspaceSummary {
        logCloudFlowPhase(
            phase: .workspaceSelect,
            outcome: "start",
            workspaceId: workspaceId,
            selection: "existing"
        )
        let response: WorkspaceEnvelope = try await self.request(
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
            let response: AgentApiKeyConnectionsEnvelope = try await self.request(
                apiBaseUrl: apiBaseUrl,
                authorizationHeader: "Bearer \(bearerToken)",
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
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/agent-api-keys/\(connectionId)/revoke",
            method: "POST",
            body: Optional<String>.none
        )
        return (response.connection, response.instructions)
    }

    func isWorkspaceEmptyForBootstrap(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        deviceId: String
    ) async throws -> Bool {
        let bootstrapEnvelope: RemoteBootstrapPullResponseEnvelope = try await self.request(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: "Bearer \(bearerToken)",
            path: "/workspaces/\(workspaceId)/sync/bootstrap",
            method: "POST",
            body: BootstrapPullRequest(
                mode: "pull",
                deviceId: deviceId,
                platform: "ios",
                appVersion: self.appVersion(),
                cursor: nil,
                limit: 1
            )
        )

        return bootstrapEnvelope.remoteIsEmpty
    }

    func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws {
        let response: DeleteAccountResponse = try await self.request(
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
        let cloudSettings = try self.database.loadBootstrapSnapshot().cloudSettings
        let workspaceId = linkedSession.workspaceId
        let syncBasePath = "/workspaces/\(workspaceId)/sync"
        var syncResult = CloudSyncResult.noChanges

        let removedReviewEventCount = try self.database.deleteStaleReviewEventOutboxEntries(workspaceId: workspaceId)
        if removedReviewEventCount > 0 {
            syncResult = syncResult.merging(
                CloudSyncResult(
                    appliedPullChangeCount: 0,
                    changedEntityTypes: [],
                    acknowledgedOperationCount: 0,
                    cleanedUpOperationCount: removedReviewEventCount
                )
            )
            logCloudFlowPhase(
                phase: .initialPush,
                outcome: "self_heal",
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationsCount: removedReviewEventCount
            )
        }

        if try self.database.hasHydratedHotState(workspaceId: workspaceId) == false {
            syncResult = syncResult.merging(
                try await self.performInitialHotStateSync(
                    linkedSession: linkedSession,
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    syncBasePath: syncBasePath
                )
            )
        }

        syncResult = syncResult.merging(
            try await self.pushOutboxBatches(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                syncBasePath: syncBasePath
            )
        )
        syncResult = syncResult.merging(
            try await self.pullHotChanges(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                syncBasePath: syncBasePath
            )
        )
        syncResult = syncResult.merging(
            try await self.pullReviewHistory(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                syncBasePath: syncBasePath
            )
        )

        return syncResult
    }

    /// Bootstraps the blocking mutable current state first.
    ///
    /// Every request to `\(syncBasePath)/bootstrap` must use the same explicit
    /// nullable `cursor` contract documented in `BootstrapPullRequest` above and
    /// accepted by `apps/backend/src/sync.ts`. Keep this flow aligned with:
    /// - `apps/backend/src/sync.ts` `syncBootstrapPullInputSchema`
    /// - `apps/ios/Flashcards/FlashcardsTests/CloudSupportTests.swift`
    ///
    /// If the remote workspace is empty, the local workspace becomes the source
    /// of truth through bootstrap push/import instead of replaying the entire
    /// outbox through normal sync/push.
    private func performInitialHotStateSync(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        deviceId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        let firstPage: RemoteBootstrapPullResponseEnvelope = try await self.request(
            apiBaseUrl: linkedSession.apiBaseUrl,
            authorizationHeader: linkedSession.authorization.headerValue,
            path: "\(syncBasePath)/bootstrap",
            method: "POST",
            body: BootstrapPullRequest(
                mode: "pull",
                deviceId: deviceId,
                platform: "ios",
                appVersion: self.appVersion(),
                cursor: nil,
                limit: 200
            )
        )

        if firstPage.remoteIsEmpty {
            return try await self.bootstrapEmptyRemoteWorkspace(
                linkedSession: linkedSession,
                workspaceId: workspaceId,
                deviceId: deviceId,
                syncBasePath: syncBasePath
            )
        }

        var appliedPullChangeCount = 0
        var changedEntityTypes = Set<SyncEntityType>()
        var currentPage = firstPage

        while true {
            for entry in currentPage.entries {
                try self.database.applySyncBootstrapEntry(
                    workspaceId: workspaceId,
                    entry: makeSyncBootstrapEntry(workspaceId: workspaceId, entry: entry)
                )
                appliedPullChangeCount += 1
                changedEntityTypes.insert(entry.entityType)
            }

            if currentPage.hasMore == false {
                try self.database.setLastAppliedHotChangeId(
                    workspaceId: workspaceId,
                    changeId: currentPage.bootstrapHotChangeId
                )
                try self.database.setHasHydratedHotState(
                    workspaceId: workspaceId,
                    hasHydratedHotState: true
                )
                return CloudSyncResult(
                    appliedPullChangeCount: appliedPullChangeCount,
                    changedEntityTypes: changedEntityTypes,
                    acknowledgedOperationCount: 0,
                    cleanedUpOperationCount: 0
                )
            }

            guard let nextCursor = currentPage.nextCursor else {
                throw LocalStoreError.database("Bootstrap cursor is missing while more bootstrap pages remain")
            }

            currentPage = try await self.request(
                apiBaseUrl: linkedSession.apiBaseUrl,
                authorizationHeader: linkedSession.authorization.headerValue,
                path: "\(syncBasePath)/bootstrap",
                method: "POST",
                body: BootstrapPullRequest(
                    mode: "pull",
                    deviceId: deviceId,
                    platform: "ios",
                    appVersion: self.appVersion(),
                    cursor: nextCursor,
                    limit: 200
                )
            )
        }
    }

    private func bootstrapEmptyRemoteWorkspace(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        deviceId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        let bootstrapEntries = try self.database.loadHotBootstrapEntries(workspaceId: workspaceId)
        let reviewEvents = try self.database.loadReviewEvents(workspaceId: workspaceId)
        let pendingOutboxCount = try self.database.loadOutboxEntries(workspaceId: workspaceId, limit: Int.max).count

        var bootstrapHotChangeId: Int64 = 0
        if bootstrapEntries.isEmpty == false {
            var startIndex = 0
            while startIndex < bootstrapEntries.count {
                let endIndex = min(startIndex + 200, bootstrapEntries.count)
                let response: RemoteBootstrapPushResponseEnvelope = try await self.request(
                    apiBaseUrl: linkedSession.apiBaseUrl,
                    authorizationHeader: linkedSession.authorization.headerValue,
                    path: "\(syncBasePath)/bootstrap",
                    method: "POST",
                    body: BootstrapPushRequest(
                        mode: "push",
                        deviceId: deviceId,
                        platform: "ios",
                        appVersion: self.appVersion(),
                        entries: bootstrapEntries[startIndex..<endIndex].map { entry in
                            SyncBootstrapEntryEnvelope(entry: entry)
                        }
                    )
                )
                guard let responseHotChangeId = response.bootstrapHotChangeId else {
                    throw LocalStoreError.validation("Bootstrap push response is missing bootstrapHotChangeId")
                }

                bootstrapHotChangeId = responseHotChangeId
                startIndex = endIndex
            }
        }

        var nextReviewSequenceId: Int64 = 0
        if reviewEvents.isEmpty == false {
            var startIndex = 0
            while startIndex < reviewEvents.count {
                let endIndex = min(startIndex + 200, reviewEvents.count)
                let response: RemoteReviewHistoryImportResponseEnvelope = try await self.request(
                    apiBaseUrl: linkedSession.apiBaseUrl,
                    authorizationHeader: linkedSession.authorization.headerValue,
                    path: "\(syncBasePath)/review-history/import",
                    method: "POST",
                    body: ReviewHistoryImportRequest(
                        deviceId: deviceId,
                        platform: "ios",
                        appVersion: self.appVersion(),
                        reviewEvents: Array(reviewEvents[startIndex..<endIndex])
                    )
                )
                guard let responseReviewSequenceId = response.nextReviewSequenceId else {
                    throw LocalStoreError.validation("Review history import response is missing nextReviewSequenceId")
                }

                nextReviewSequenceId = responseReviewSequenceId
                startIndex = endIndex
            }
        }

        try self.database.deleteAllOutboxEntries(workspaceId: workspaceId)
        try self.database.setLastAppliedHotChangeId(
            workspaceId: workspaceId,
            changeId: bootstrapHotChangeId
        )
        try self.database.setLastAppliedReviewSequenceId(
            workspaceId: workspaceId,
            reviewSequenceId: nextReviewSequenceId
        )
        try self.database.setHasHydratedHotState(workspaceId: workspaceId, hasHydratedHotState: true)
        try self.database.setHasHydratedReviewHistory(
            workspaceId: workspaceId,
            hasHydratedReviewHistory: true
        )

        var changedEntityTypes = Set<SyncEntityType>()
        if bootstrapEntries.isEmpty == false {
            changedEntityTypes.formUnion(bootstrapEntries.map(\.entityType))
        }
        if reviewEvents.isEmpty == false {
            changedEntityTypes.insert(.reviewEvent)
        }

        return CloudSyncResult(
            appliedPullChangeCount: 0,
            changedEntityTypes: changedEntityTypes,
            acknowledgedOperationCount: 0,
            cleanedUpOperationCount: pendingOutboxCount
        )
    }

    private func pushOutboxBatches(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        deviceId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        var acknowledgedOperationCount = 0

        while true {
            let outboxEntries = try self.database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
            if outboxEntries.isEmpty {
                return CloudSyncResult(
                    appliedPullChangeCount: 0,
                    changedEntityTypes: [],
                    acknowledgedOperationCount: acknowledgedOperationCount,
                    cleanedUpOperationCount: 0
                )
            }

            do {
                let pushResponse: SyncPushResponse = try await self.request(
                    apiBaseUrl: linkedSession.apiBaseUrl,
                    authorizationHeader: linkedSession.authorization.headerValue,
                    path: "\(syncBasePath)/push",
                    method: "POST",
                    body: PushRequest(
                        deviceId: deviceId,
                        platform: "ios",
                        appVersion: self.appVersion(),
                        operations: outboxEntries.map { entry in
                            SyncOperationEnvelope(operation: entry.operation)
                        }
                    )
                )

                let acknowledgedOperationIds = pushResponse.operations.compactMap { result -> String? in
                    switch result.status {
                    case "applied", "ignored", "duplicate":
                        return result.operationId
                    case "rejected":
                        return nil
                    default:
                        return nil
                    }
                }
                let rejectedResults = pushResponse.operations.filter { result in
                    result.status == "rejected"
                }

                if acknowledgedOperationIds.isEmpty == false {
                    try self.database.deleteOutboxEntries(operationIds: acknowledgedOperationIds)
                    acknowledgedOperationCount += acknowledgedOperationIds.count
                }

                if rejectedResults.isEmpty == false {
                    let rejectionMessage = rejectedResults.map { result in
                        let errorMessage = result.error ?? "Unknown rejection"
                        return "\(result.operationId): \(errorMessage)"
                    }.joined(separator: "; ")
                    try self.database.markOutboxEntriesFailed(
                        operationIds: rejectedResults.map(\.operationId),
                        message: rejectionMessage
                    )
                    throw LocalStoreError.validation("Cloud sync rejected one or more operations: \(rejectionMessage)")
                }
            } catch {
                try self.database.markOutboxEntriesFailed(
                    operationIds: outboxEntries.map(\.operationId),
                    message: error.localizedDescription
                )
                throw error
            }
        }
    }

    private func pullHotChanges(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        deviceId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        var afterHotChangeId = try self.database.loadLastAppliedHotChangeId(workspaceId: workspaceId)
        var appliedPullChangeCount = 0
        var changedEntityTypes = Set<SyncEntityType>()

        while true {
            let pullEnvelope: RemotePullResponseEnvelope = try await self.request(
                apiBaseUrl: linkedSession.apiBaseUrl,
                authorizationHeader: linkedSession.authorization.headerValue,
                path: "\(syncBasePath)/pull",
                method: "POST",
                body: PullRequest(
                    deviceId: deviceId,
                    platform: "ios",
                    appVersion: self.appVersion(),
                    afterHotChangeId: afterHotChangeId,
                    limit: 200
                )
            )

            for change in pullEnvelope.changes {
                try self.database.applySyncChange(
                    workspaceId: workspaceId,
                    change: makeSyncChange(workspaceId: workspaceId, change: change)
                )
                changedEntityTypes.insert(change.entityType)
            }

            appliedPullChangeCount += pullEnvelope.changes.count
            afterHotChangeId = pullEnvelope.nextHotChangeId
            try self.database.setLastAppliedHotChangeId(
                workspaceId: workspaceId,
                changeId: afterHotChangeId
            )

            if pullEnvelope.hasMore == false {
                return CloudSyncResult(
                    appliedPullChangeCount: appliedPullChangeCount,
                    changedEntityTypes: changedEntityTypes,
                    acknowledgedOperationCount: 0,
                    cleanedUpOperationCount: 0
                )
            }
        }
    }

    private func pullReviewHistory(
        linkedSession: CloudLinkedSession,
        workspaceId: String,
        deviceId: String,
        syncBasePath: String
    ) async throws -> CloudSyncResult {
        var afterReviewSequenceId = try self.database.loadLastAppliedReviewSequenceId(workspaceId: workspaceId)
        var appliedReviewEventCount = 0

        while true {
            let reviewHistoryEnvelope: RemoteReviewHistoryPullResponseEnvelope = try await self.request(
                apiBaseUrl: linkedSession.apiBaseUrl,
                authorizationHeader: linkedSession.authorization.headerValue,
                path: "\(syncBasePath)/review-history/pull",
                method: "POST",
                body: ReviewHistoryPullRequest(
                    deviceId: deviceId,
                    platform: "ios",
                    appVersion: self.appVersion(),
                    afterReviewSequenceId: afterReviewSequenceId,
                    limit: 200
                )
            )

            for reviewEvent in reviewHistoryEnvelope.reviewEvents {
                try self.database.applyReviewHistoryEvent(
                    workspaceId: workspaceId,
                    reviewEvent: makeReviewEvent(payload: reviewEvent)
                )
            }

            appliedReviewEventCount += reviewHistoryEnvelope.reviewEvents.count
            afterReviewSequenceId = reviewHistoryEnvelope.nextReviewSequenceId
            try self.database.setLastAppliedReviewSequenceId(
                workspaceId: workspaceId,
                reviewSequenceId: afterReviewSequenceId
            )

            if reviewHistoryEnvelope.hasMore == false {
                if try self.database.hasHydratedReviewHistory(workspaceId: workspaceId) == false {
                    try self.database.setHasHydratedReviewHistory(
                        workspaceId: workspaceId,
                        hasHydratedReviewHistory: true
                    )
                }

                return CloudSyncResult(
                    appliedPullChangeCount: appliedReviewEventCount,
                    changedEntityTypes: appliedReviewEventCount == 0 ? [] : [.reviewEvent],
                    acknowledgedOperationCount: 0,
                    cleanedUpOperationCount: 0
                )
            }
        }
    }

    private func appVersion() -> String {
        let shortVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return shortVersion ?? "1.0.0"
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

    private func listWorkspaces(apiBaseUrl: String, authorizationHeader: String) async throws -> [CloudWorkspaceSummary] {
        var workspaces: [CloudWorkspaceSummary] = []
        var nextCursor: String? = nil

        repeat {
            let response: WorkspacesResponse = try await self.request(
                apiBaseUrl: apiBaseUrl,
                authorizationHeader: authorizationHeader,
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
        authorizationHeader: String,
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: try self.makeUrl(apiBaseUrl: apiBaseUrl, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")

        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await self.session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LocalStoreError.database("Cloud sync did not receive an HTTP response")
        }

        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")
            let errorDetails = decodeCloudApiErrorDetails(data: data, requestId: requestId)
            logCloudFlowPhase(
                phase: self.phase(for: path),
                outcome: "failure",
                requestId: errorDetails.requestId,
                code: errorDetails.code,
                statusCode: httpResponse.statusCode
            )
            throw CloudSyncError.invalidResponse(errorDetails, httpResponse.statusCode)
        }

        logCloudFlowPhase(phase: self.phase(for: path), outcome: "success")

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

        if path.hasSuffix("/sync/bootstrap") {
            return .initialPull
        }

        if path.hasSuffix("/sync/review-history/import") {
            return .initialPush
        }

        if path.hasSuffix("/sync/review-history/pull") {
            return .initialPull
        }

        if path.hasSuffix("/sync/pull") {
            return .initialPull
        }

        return .workspaceList
    }
}
