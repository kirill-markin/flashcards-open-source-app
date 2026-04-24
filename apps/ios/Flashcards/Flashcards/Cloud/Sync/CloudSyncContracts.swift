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
/// `syncPushInputSchema`.
struct PushRequest: Encodable {
    let installationId: String
    let platform: String
    let appVersion: String
    let operations: [SyncOperationEnvelope]
}

/// Wire contract for `POST /sync/pull`.
///
/// Keep this request aligned with `apps/backend/src/sync.ts`
/// `syncPullInputSchema` and the iOS sync tests that cover pull encoding.
struct PullRequest: Encodable {
    let installationId: String
    let platform: String
    let appVersion: String
    let afterHotChangeId: Int64
    let limit: Int
}

/// Wire contract for `POST /sync/bootstrap` pull pages.
///
/// The backend parser in `apps/backend/src/sync.ts` expects the `cursor` key to
/// exist on every request. The first page must therefore send `"cursor": null`
/// instead of omitting the key entirely. Keep this struct aligned with
/// `apps/backend/src/sync.ts` `syncBootstrapPullInputSchema`.
struct BootstrapPullRequest: Encodable {
    let mode: String
    let installationId: String
    let platform: String
    let appVersion: String
    let cursor: String?
    let limit: Int

    enum CodingKeys: String, CodingKey {
        case mode
        case installationId
        case platform
        case appVersion
        case cursor
        case limit
    }

    /// Encodes `cursor` explicitly as JSON `null` on the first bootstrap page.
    ///
    /// If you change this payload shape, update the matching backend validator in
    /// `apps/backend/src/sync.ts` and the iOS sync tests that cover bootstrap encoding.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.mode, forKey: .mode)
        try container.encode(self.installationId, forKey: .installationId)
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
    let installationId: String
    let platform: String
    let appVersion: String
    let entries: [SyncBootstrapEntryEnvelope]
}

private func encodeNullableBootstrapValue<Key: CodingKey, Value: Encodable>(
    _ value: Value?,
    forKey key: Key,
    in container: inout KeyedEncodingContainer<Key>
) throws {
    if let value {
        try container.encode(value, forKey: key)
    } else {
        try container.encodeNil(forKey: key)
    }
}

/// Wire contract for `POST /sync/review-history/pull`.
///
/// Keep this request aligned with `apps/backend/src/sync.ts`
/// `syncReviewHistoryPullInputSchema`.
struct ReviewHistoryPullRequest: Encodable {
    let installationId: String
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
    let installationId: String
    let platform: String
    let appVersion: String
    let reviewEvents: [ReviewEvent]
}

/// Encodes one `/sync/push` operation using the shared backend field names.
///
/// If you change this envelope, update `apps/backend/src/sync.ts` and the iOS
/// sync tests that cover push encoding.
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
            try container.encode(BootstrapCardPayload(card: payload), forKey: .payload)
        case .deck(let payload):
            try container.encode(BootstrapDeckPayload(deck: payload), forKey: .payload)
        case .workspaceSchedulerSettings(let payload):
            try container.encode(BootstrapWorkspaceSchedulerSettingsPayload(settings: payload), forKey: .payload)
        }
    }
}

/// Keep this encoder aligned with `apps/backend/src/sync/input.ts`
/// `cardBootstrapPushPayloadSchema`.
private struct BootstrapCardPayload: Encodable {
    let snapshot: CardSyncPayload
    let clientUpdatedAt: String
    let lastOperationId: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case cardId
        case frontText
        case backText
        case tags
        case effortLevel
        case dueAt
        case createdAt
        case reps
        case lapses
        case fsrsCardState
        case fsrsStepIndex
        case fsrsStability
        case fsrsDifficulty
        case fsrsLastReviewedAt
        case fsrsScheduledDays
        case clientUpdatedAt
        case lastOperationId
        case updatedAt
        case deletedAt
    }

    init(card: Card) {
        self.snapshot = CardSyncPayload(card: card)
        self.clientUpdatedAt = card.clientUpdatedAt
        self.lastOperationId = card.lastOperationId
        self.updatedAt = card.updatedAt
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.snapshot.cardId, forKey: .cardId)
        try container.encode(self.snapshot.frontText, forKey: .frontText)
        try container.encode(self.snapshot.backText, forKey: .backText)
        try container.encode(self.snapshot.tags, forKey: .tags)
        try container.encode(self.snapshot.effortLevel, forKey: .effortLevel)
        try encodeNullableBootstrapValue(self.snapshot.dueAt, forKey: .dueAt, in: &container)
        try container.encode(self.snapshot.createdAt, forKey: .createdAt)
        try container.encode(self.snapshot.reps, forKey: .reps)
        try container.encode(self.snapshot.lapses, forKey: .lapses)
        try container.encode(self.snapshot.fsrsCardState, forKey: .fsrsCardState)
        try encodeNullableBootstrapValue(self.snapshot.fsrsStepIndex, forKey: .fsrsStepIndex, in: &container)
        try encodeNullableBootstrapValue(self.snapshot.fsrsStability, forKey: .fsrsStability, in: &container)
        try encodeNullableBootstrapValue(self.snapshot.fsrsDifficulty, forKey: .fsrsDifficulty, in: &container)
        try encodeNullableBootstrapValue(
            self.snapshot.fsrsLastReviewedAt,
            forKey: .fsrsLastReviewedAt,
            in: &container
        )
        try encodeNullableBootstrapValue(
            self.snapshot.fsrsScheduledDays,
            forKey: .fsrsScheduledDays,
            in: &container
        )
        try container.encode(self.clientUpdatedAt, forKey: .clientUpdatedAt)
        try container.encode(self.lastOperationId, forKey: .lastOperationId)
        try container.encode(self.updatedAt, forKey: .updatedAt)
        try encodeNullableBootstrapValue(self.snapshot.deletedAt, forKey: .deletedAt, in: &container)
    }
}

/// Keep this encoder aligned with `apps/backend/src/sync/input.ts`
/// `deckBootstrapPushPayloadSchema`.
private struct BootstrapDeckPayload: Encodable {
    let snapshot: DeckSyncPayload
    let workspaceId: String
    let clientUpdatedAt: String
    let lastOperationId: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case deckId
        case workspaceId
        case name
        case filterDefinition
        case createdAt
        case clientUpdatedAt
        case lastOperationId
        case updatedAt
        case deletedAt
    }

    init(deck: Deck) {
        self.snapshot = DeckSyncPayload(deck: deck)
        self.workspaceId = deck.workspaceId
        self.clientUpdatedAt = deck.clientUpdatedAt
        self.lastOperationId = deck.lastOperationId
        self.updatedAt = deck.updatedAt
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.snapshot.deckId, forKey: .deckId)
        try container.encode(self.workspaceId, forKey: .workspaceId)
        try container.encode(self.snapshot.name, forKey: .name)
        try container.encode(self.snapshot.filterDefinition, forKey: .filterDefinition)
        try container.encode(self.snapshot.createdAt, forKey: .createdAt)
        try container.encode(self.clientUpdatedAt, forKey: .clientUpdatedAt)
        try container.encode(self.lastOperationId, forKey: .lastOperationId)
        try container.encode(self.updatedAt, forKey: .updatedAt)
        try encodeNullableBootstrapValue(self.snapshot.deletedAt, forKey: .deletedAt, in: &container)
    }
}

private struct BootstrapWorkspaceSchedulerSettingsPayload: Encodable {
    let algorithm: String
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
    let clientUpdatedAt: String
    let lastOperationId: String
    let updatedAt: String

    init(settings: WorkspaceSchedulerSettings) {
        let snapshot = WorkspaceSchedulerSettingsSyncPayload(settings: settings)
        self.algorithm = snapshot.algorithm
        self.desiredRetention = snapshot.desiredRetention
        self.learningStepsMinutes = snapshot.learningStepsMinutes
        self.relearningStepsMinutes = snapshot.relearningStepsMinutes
        self.maximumIntervalDays = snapshot.maximumIntervalDays
        self.enableFuzz = snapshot.enableFuzz
        self.clientUpdatedAt = settings.clientUpdatedAt
        self.lastOperationId = settings.lastOperationId
        self.updatedAt = settings.updatedAt
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
    let lastModifiedByReplicaId: String
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
    let lastModifiedByReplicaId: String
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
    let lastModifiedByReplicaId: String
    let lastOperationId: String
    let updatedAt: String
}

struct RemoteReviewEventChangePayload: Decodable {
    let reviewEventId: String
    let cardId: String
    let replicaId: String
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

/// Pulled review events are already stamped by the backend with immutable
/// workspace replica ids. The client must not invent or mutate these ids.
struct RemoteReviewEventEnvelope: Decodable {
    let reviewEventId: String
    let workspaceId: String
    let cardId: String
    let replicaId: String
    let clientEventId: String
    let rating: ReviewRating
    let reviewedAtClient: String
    let reviewedAtServer: String
}
