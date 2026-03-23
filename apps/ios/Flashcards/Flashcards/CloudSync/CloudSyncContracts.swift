/*
 Keep sync wire contracts aligned with:
 - apps/backend/src/sync.ts
 - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/CloudRemoteService.kt
 */

struct MeResponse: Decodable {
    struct Profile: Decodable {
        let email: String?
    }

    let userId: String
    let selectedWorkspaceId: String?
    let profile: Profile
}

struct WorkspacesResponse: Decodable {
    let workspaces: [CloudWorkspaceSummary]
    let nextCursor: String?
}

struct WorkspaceEnvelope: Decodable {
    let workspace: CloudWorkspaceSummary
}

struct AgentApiKeyConnectionsEnvelope: Decodable {
    let connections: [AgentApiKeyConnection]
    let nextCursor: String?
    let instructions: String
}

struct AgentApiKeyRevokeEnvelope: Decodable {
    let ok: Bool
    let connection: AgentApiKeyConnection
    let instructions: String
}

struct CreateWorkspaceRequest: Encodable {
    let name: String
}

struct DeleteAccountRequest: Encodable {
    let confirmationText: String
}

struct DeleteAccountResponse: Decodable {
    let ok: Bool
}

/// Wire contract for `POST /sync/push`.
///
/// Keep this request aligned with `apps/backend/src/sync.ts`
/// `syncPushInputSchema` and `apps/backend/src/sync.test.ts`.
struct PushRequest: Encodable {
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
struct PullRequest: Encodable {
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
struct BootstrapPullRequest: Encodable {
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
struct BootstrapPushRequest: Encodable {
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
struct ReviewHistoryPullRequest: Encodable {
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
struct ReviewHistoryImportRequest: Encodable {
    let deviceId: String
    let platform: String
    let appVersion: String
    let reviewEvents: [ReviewEvent]
}

/// Encodes one `/sync/push` operation using the shared backend field names.
///
/// If you change this envelope, update `apps/backend/src/sync.ts` and the sync
/// contract tests in `apps/ios/Flashcards/FlashcardsTests/CloudSupportTests.swift`.
struct SyncOperationEnvelope: Encodable {
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
        try container.encode(self.operation.operationId, forKey: .operationId)
        try container.encode(self.operation.entityType, forKey: .entityType)
        try container.encode(self.operation.entityId, forKey: .entityId)
        try container.encode(self.operation.action, forKey: .action)
        try container.encode(self.operation.clientUpdatedAt, forKey: .clientUpdatedAt)

        switch self.operation.payload {
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
struct SyncBootstrapEntryEnvelope: Encodable {
    let entry: SyncBootstrapEntry

    enum CodingKeys: String, CodingKey {
        case entityType
        case entityId
        case action
        case payload
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.entry.entityType, forKey: .entityType)
        try container.encode(self.entry.entityId, forKey: .entityId)
        try container.encode(self.entry.action, forKey: .action)

        switch self.entry.payload {
        case .card(let payload):
            try container.encode(payload, forKey: .payload)
        case .deck(let payload):
            try container.encode(payload, forKey: .payload)
        case .workspaceSchedulerSettings(let payload):
            try container.encode(payload, forKey: .payload)
        }
    }
}

struct RemoteCardChangePayload: Decodable {
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

struct RemoteDeckChangePayload: Decodable {
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

struct RemoteWorkspaceSchedulerSettingsChangePayload: Decodable {
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

struct RemoteReviewEventChangePayload: Decodable {
    let reviewEventId: String
    let cardId: String
    let deviceId: String
    let clientEventId: String
    let rating: ReviewRating
    let reviewedAtClient: String
    let reviewedAtServer: String
}

enum RemoteSyncBootstrapEntryPayload {
    case card(RemoteCardChangePayload)
    case deck(RemoteDeckChangePayload)
    case workspaceSchedulerSettings(RemoteWorkspaceSchedulerSettingsChangePayload)
}

struct RemoteSyncBootstrapEntryEnvelope: Decodable {
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

struct RemoteSyncChangeEnvelope: Decodable {
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
struct RemotePullResponseEnvelope: Decodable {
    let changes: [RemoteSyncChangeEnvelope]
    let nextHotChangeId: Int64
    let hasMore: Bool
}

/// Decodes `/sync/bootstrap` pull responses returned by `apps/backend/src/sync.ts`.
struct RemoteBootstrapPullResponseEnvelope: Decodable {
    let entries: [RemoteSyncBootstrapEntryEnvelope]
    let nextCursor: String?
    let hasMore: Bool
    let bootstrapHotChangeId: Int64
    let remoteIsEmpty: Bool
}

/// Decodes `/sync/bootstrap` push responses returned by `apps/backend/src/sync.ts`.
struct RemoteBootstrapPushResponseEnvelope: Decodable {
    let appliedEntriesCount: Int
    let bootstrapHotChangeId: Int64?
}

/// Decodes `/sync/review-history/pull` responses returned by `apps/backend/src/sync.ts`.
struct RemoteReviewHistoryPullResponseEnvelope: Decodable {
    let reviewEvents: [RemoteReviewEventEnvelope]
    let nextReviewSequenceId: Int64
    let hasMore: Bool
}

/// Decodes `/sync/review-history/import` responses returned by `apps/backend/src/sync.ts`.
struct RemoteReviewHistoryImportResponseEnvelope: Decodable {
    let importedCount: Int
    let duplicateCount: Int
    let nextReviewSequenceId: Int64?
}

struct RemoteReviewEventEnvelope: Decodable {
    let reviewEventId: String
    let workspaceId: String
    let cardId: String
    let deviceId: String
    let clientEventId: String
    let rating: ReviewRating
    let reviewedAtClient: String
    let reviewedAtServer: String
}
