import Foundation

enum SyncEntityType: String, Codable, Hashable {
    case card
    case deck
    case workspaceSchedulerSettings = "workspace_scheduler_settings"
    case reviewEvent = "review_event"
}

enum SyncAction: String, Codable, Hashable {
    case upsert
    case append
}

enum SyncStatus: Hashable {
    case idle
    case syncing
    case blocked(message: String)
    case failed(message: String)
}

enum CloudSyncTriggerSource: Hashable, Sendable {
    case appLaunch
    case appForeground
    case reviewTabSelected
    case cardsTabSelected
    case polling
    case localMutation
    case manualSyncNow

    var usesImmediateStartDebounce: Bool {
        switch self {
        case .appLaunch, .appForeground, .reviewTabSelected, .cardsTabSelected:
            return true
        case .polling, .localMutation, .manualSyncNow:
            return false
        }
    }
}

struct CloudSyncTrigger: Hashable, Sendable {
    let source: CloudSyncTriggerSource
    let now: Date
    let extendsFastPolling: Bool
    let allowsVisibleChangeBanner: Bool
    let surfacesGlobalErrorMessage: Bool
}

struct CloudSyncResult: Hashable, Sendable {
    let appliedPullChangeCount: Int
    let reviewScheduleImpactingPullChangeCount: Int
    let changedEntityTypes: Set<SyncEntityType>
    let localIdRepairEntityTypes: Set<SyncEntityType>
    let acknowledgedOperationCount: Int
    let acknowledgedReviewEventOperationCount: Int
    let acknowledgedReviewScheduleImpactingOperationCount: Int
    let cleanedUpOperationCount: Int
    let cleanedUpReviewEventOperationCount: Int
    let cleanedUpReviewScheduleImpactingOperationCount: Int

    static let noChanges = CloudSyncResult(
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

    var appliedPullChanges: Bool {
        self.appliedPullChangeCount > 0
    }

    var reviewDataChanged: Bool {
        self.changedEntityTypes.contains(.card)
            || self.changedEntityTypes.contains(.deck)
            || self.changedEntityTypes.contains(.workspaceSchedulerSettings)
            || self.changedEntityTypes.contains(.reviewEvent)
    }

    var repairedLocalDeckId: Bool {
        self.localIdRepairEntityTypes.contains(.deck)
    }

    var reviewProgressDataChanged: Bool {
        self.changedEntityTypes.contains(.reviewEvent)
            || self.acknowledgedReviewEventOperationCount > 0
            || self.cleanedUpReviewEventOperationCount > 0
    }

    var reviewScheduleDataChanged: Bool {
        self.reviewScheduleImpactingPullChangeCount > 0
            || self.acknowledgedReviewScheduleImpactingOperationCount > 0
            || self.cleanedUpReviewScheduleImpactingOperationCount > 0
    }

    var technicalChangesOnly: Bool {
        self.reviewDataChanged == false
            && (self.acknowledgedOperationCount > 0 || self.cleanedUpOperationCount > 0)
    }

    func merging(_ other: CloudSyncResult) -> CloudSyncResult {
        CloudSyncResult(
            appliedPullChangeCount: self.appliedPullChangeCount + other.appliedPullChangeCount,
            reviewScheduleImpactingPullChangeCount: self.reviewScheduleImpactingPullChangeCount + other.reviewScheduleImpactingPullChangeCount,
            changedEntityTypes: self.changedEntityTypes.union(other.changedEntityTypes),
            localIdRepairEntityTypes: self.localIdRepairEntityTypes.union(other.localIdRepairEntityTypes),
            acknowledgedOperationCount: self.acknowledgedOperationCount + other.acknowledgedOperationCount,
            acknowledgedReviewEventOperationCount: self.acknowledgedReviewEventOperationCount + other.acknowledgedReviewEventOperationCount,
            acknowledgedReviewScheduleImpactingOperationCount: self.acknowledgedReviewScheduleImpactingOperationCount + other.acknowledgedReviewScheduleImpactingOperationCount,
            cleanedUpOperationCount: self.cleanedUpOperationCount + other.cleanedUpOperationCount,
            cleanedUpReviewEventOperationCount: self.cleanedUpReviewEventOperationCount + other.cleanedUpReviewEventOperationCount,
            cleanedUpReviewScheduleImpactingOperationCount: self.cleanedUpReviewScheduleImpactingOperationCount + other.cleanedUpReviewScheduleImpactingOperationCount
        )
    }
}

struct CardSyncPayload: Codable, Hashable {
    let cardId: String
    let frontText: String
    let backText: String
    let tags: [String]
    let effortLevel: String
    let dueAt: String?
    let createdAt: String
    let reps: Int
    let lapses: Int
    let fsrsCardState: String
    let fsrsStepIndex: Int?
    let fsrsStability: Double?
    let fsrsDifficulty: Double?
    let fsrsLastReviewedAt: String?
    let fsrsScheduledDays: Int?
    let deletedAt: String?

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
        case deletedAt
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.cardId, forKey: .cardId)
        try container.encode(self.frontText, forKey: .frontText)
        try container.encode(self.backText, forKey: .backText)
        try container.encode(self.tags, forKey: .tags)
        try container.encode(self.effortLevel, forKey: .effortLevel)

        if let dueAt = try canonicalIsoTimestampForSync(cardId: self.cardId, dueAt: self.dueAt) {
            try container.encode(dueAt, forKey: .dueAt)
        } else {
            try container.encodeNil(forKey: .dueAt)
        }

        try container.encode(self.createdAt, forKey: .createdAt)
        try container.encode(self.reps, forKey: .reps)
        try container.encode(self.lapses, forKey: .lapses)
        try container.encode(self.fsrsCardState, forKey: .fsrsCardState)

        if let fsrsStepIndex = self.fsrsStepIndex {
            try container.encode(fsrsStepIndex, forKey: .fsrsStepIndex)
        } else {
            try container.encodeNil(forKey: .fsrsStepIndex)
        }

        if let fsrsStability = self.fsrsStability {
            try container.encode(fsrsStability, forKey: .fsrsStability)
        } else {
            try container.encodeNil(forKey: .fsrsStability)
        }

        if let fsrsDifficulty = self.fsrsDifficulty {
            try container.encode(fsrsDifficulty, forKey: .fsrsDifficulty)
        } else {
            try container.encodeNil(forKey: .fsrsDifficulty)
        }

        if let fsrsLastReviewedAt = self.fsrsLastReviewedAt {
            try container.encode(fsrsLastReviewedAt, forKey: .fsrsLastReviewedAt)
        } else {
            try container.encodeNil(forKey: .fsrsLastReviewedAt)
        }

        if let fsrsScheduledDays = self.fsrsScheduledDays {
            try container.encode(fsrsScheduledDays, forKey: .fsrsScheduledDays)
        } else {
            try container.encodeNil(forKey: .fsrsScheduledDays)
        }

        if let deletedAt = self.deletedAt {
            try container.encode(deletedAt, forKey: .deletedAt)
        } else {
            try container.encodeNil(forKey: .deletedAt)
        }
    }
}

extension CardSyncPayload {
    init(card: Card) {
        self.cardId = card.cardId
        self.frontText = card.frontText
        self.backText = card.backText
        self.tags = card.tags
        self.effortLevel = card.effortLevel.rawValue
        self.dueAt = card.dueAt
        self.createdAt = card.createdAt
        self.reps = card.reps
        self.lapses = card.lapses
        self.fsrsCardState = card.fsrsCardState.rawValue
        self.fsrsStepIndex = card.fsrsStepIndex
        self.fsrsStability = card.fsrsStability
        self.fsrsDifficulty = card.fsrsDifficulty
        self.fsrsLastReviewedAt = card.fsrsLastReviewedAt
        self.fsrsScheduledDays = card.fsrsScheduledDays
        self.deletedAt = card.deletedAt
    }
}

struct DeckSyncPayload: Codable, Hashable {
    let deckId: String
    let name: String
    let filterDefinition: DeckFilterDefinition
    let createdAt: String
    let deletedAt: String?

    enum CodingKeys: String, CodingKey {
        case deckId
        case name
        case filterDefinition
        case createdAt
        case deletedAt
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.deckId, forKey: .deckId)
        try container.encode(self.name, forKey: .name)
        try container.encode(self.filterDefinition, forKey: .filterDefinition)
        try container.encode(self.createdAt, forKey: .createdAt)

        if let deletedAt = self.deletedAt {
            try container.encode(deletedAt, forKey: .deletedAt)
        } else {
            try container.encodeNil(forKey: .deletedAt)
        }
    }
}

extension DeckSyncPayload {
    init(deck: Deck) {
        self.deckId = deck.deckId
        self.name = deck.name
        self.filterDefinition = deck.filterDefinition
        self.createdAt = deck.createdAt
        self.deletedAt = deck.deletedAt
    }
}

struct WorkspaceSchedulerSettingsSyncPayload: Codable, Hashable {
    let algorithm: String
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
}

extension WorkspaceSchedulerSettingsSyncPayload {
    init(settings: WorkspaceSchedulerSettings) {
        self.algorithm = settings.algorithm
        self.desiredRetention = settings.desiredRetention
        self.learningStepsMinutes = settings.learningStepsMinutes
        self.relearningStepsMinutes = settings.relearningStepsMinutes
        self.maximumIntervalDays = settings.maximumIntervalDays
        self.enableFuzz = settings.enableFuzz
    }
}

struct ReviewEventSyncPayload: Codable, Hashable {
    let reviewEventId: String
    let cardId: String
    let installationId: String
    let clientEventId: String
    let rating: Int
    let reviewedAtClient: String

    enum CodingKeys: String, CodingKey {
        case reviewEventId
        case cardId
        case installationId
        case clientEventId
        case rating
        case reviewedAtClient
    }

    init(
        reviewEventId: String,
        cardId: String,
        installationId: String,
        clientEventId: String,
        rating: Int,
        reviewedAtClient: String
    ) {
        self.reviewEventId = reviewEventId
        self.cardId = cardId
        self.installationId = installationId
        self.clientEventId = clientEventId
        self.rating = rating
        self.reviewedAtClient = reviewedAtClient
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.reviewEventId = try container.decode(String.self, forKey: .reviewEventId)
        self.cardId = try container.decode(String.self, forKey: .cardId)
        self.installationId = try container.decode(String.self, forKey: .installationId)
        self.clientEventId = try container.decode(String.self, forKey: .clientEventId)
        self.rating = try container.decode(Int.self, forKey: .rating)
        self.reviewedAtClient = try container.decode(String.self, forKey: .reviewedAtClient)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.reviewEventId, forKey: .reviewEventId)
        try container.encode(self.cardId, forKey: .cardId)
        try container.encode(self.clientEventId, forKey: .clientEventId)
        try container.encode(self.rating, forKey: .rating)
        try container.encode(self.reviewedAtClient, forKey: .reviewedAtClient)
    }
}

enum SyncOperationPayload: Hashable {
    case card(CardSyncPayload)
    case deck(DeckSyncPayload)
    case workspaceSchedulerSettings(WorkspaceSchedulerSettingsSyncPayload)
    case reviewEvent(ReviewEventSyncPayload)
}

struct SyncOperation: Hashable {
    let operationId: String
    let entityType: SyncEntityType
    let entityId: String
    let action: SyncAction
    let clientUpdatedAt: String
    let payload: SyncOperationPayload
}

/// Mirrors one `/sync/push` operation result from `apps/backend/src/sync.ts`.
struct SyncOperationResult: Codable, Hashable {
    let operationId: String
    let entityType: SyncEntityType
    let entityId: String
    let status: String
    let resultingHotChangeId: Int64?
    let error: String?
}

/// Mirrors the `/sync/push` response from `apps/backend/src/sync.ts`.
struct SyncPushResponse: Codable, Hashable {
    let operations: [SyncOperationResult]
}

/// Local hot-state bootstrap entry derived from backend bootstrap responses.
enum SyncBootstrapEntryPayload: Hashable {
    case card(Card)
    case deck(Deck)
    case workspaceSchedulerSettings(WorkspaceSchedulerSettings)
}

/// Local hot-state bootstrap entry derived from `/sync/bootstrap`.
struct SyncBootstrapEntry: Hashable {
    let entityType: SyncEntityType
    let entityId: String
    let action: SyncAction
    let payload: SyncBootstrapEntryPayload
}

/// Local hot-state delta payload derived from `/sync/pull`.
enum SyncChangePayload: Hashable {
    case card(Card)
    case deck(Deck)
    case workspaceSchedulerSettings(WorkspaceSchedulerSettings)
}

/// Local hot-state delta derived from `/sync/pull`.
struct SyncChange: Hashable {
    let changeId: Int64
    let entityType: SyncEntityType
    let entityId: String
    let action: SyncAction
    let payload: SyncChangePayload
}

/// Local representation of the `/sync/pull` response.
struct SyncPullResponse: Hashable {
    let changes: [SyncChange]
    let nextHotChangeId: Int64
    let hasMore: Bool
}

/// Local representation of the `/sync/bootstrap` pull response.
struct SyncBootstrapPullResponse: Hashable {
    let entries: [SyncBootstrapEntry]
    let nextCursor: String?
    let hasMore: Bool
    let bootstrapHotChangeId: Int64
    let remoteIsEmpty: Bool
}

/// Local representation of the `/sync/bootstrap` push response.
struct SyncBootstrapPushResponse: Codable, Hashable {
    let appliedEntriesCount: Int
    let bootstrapHotChangeId: Int64?
}

/// Local representation of the `/sync/review-history/pull` response.
struct SyncReviewHistoryPullResponse: Hashable {
    let reviewEvents: [ReviewEvent]
    let nextReviewSequenceId: Int64
    let hasMore: Bool
}

/// Local representation of the `/sync/review-history/import` response.
struct SyncReviewHistoryImportResponse: Codable, Hashable {
    let importedCount: Int
    let duplicateCount: Int
    let nextReviewSequenceId: Int64?
}

struct PersistedOutboxEntry: Hashable {
    let operationId: String
    let workspaceId: String
    let createdAt: String
    let attemptCount: Int
    let lastError: String
    let reviewScheduleImpact: Bool
    let operation: SyncOperation
}
