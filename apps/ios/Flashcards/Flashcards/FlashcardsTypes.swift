import Foundation

/**
 FSRS-facing Swift types mirror the backend scheduler contract and the web
 transport types. The iOS scheduler implementation itself lives in
 `FsrsScheduler.swift`.

 Keep these FSRS-facing types aligned with:
 - apps/backend/src/schedule.ts
 - apps/backend/src/cards.ts
 - apps/backend/src/workspaceSchedulerSettings.ts
 - apps/web/src/types.ts
 - docs/fsrs-scheduling-logic.md
 */

enum AppTab: Hashable, CaseIterable, Sendable {
    case review
    case decks
    case cards
    case ai
    case settings
}

enum CardsPresentationRequest: Hashable, Sendable {
    case createCard
}

enum AIChatPresentationRequest: Hashable, Sendable {
    case createCard
}

let allCardsDeckLabel: String = "All cards"

enum EffortLevel: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
    case fast
    case medium
    case long

    var id: String {
        rawValue
    }

    var title: String {
        rawValue.capitalized
    }
}

enum ReviewRating: Int, CaseIterable, Codable, Hashable, Identifiable, Sendable {
    case again = 0
    case hard = 1
    case good = 2
    case easy = 3

    var id: Int {
        rawValue
    }

    var title: String {
        switch self {
        case .again:
            return "Again"
        case .hard:
            return "Hard"
        case .good:
            return "Good"
        case .easy:
            return "Easy"
        }
    }

    var symbolName: String {
        switch self {
        case .again:
            return "arrow.uturn.backward.circle.fill"
        case .hard:
            return "tortoise.circle.fill"
        case .good:
            return "checkmark.circle.fill"
        case .easy:
            return "sparkles"
        }
    }
}

// Keep in sync with apps/backend/src/schedule.ts::FsrsCardState and apps/web/src/types.ts::FsrsCardState.
enum FsrsCardState: String, Codable, CaseIterable, Hashable, Identifiable, Sendable {
    case new
    case learning
    case review
    case relearning

    var id: String {
        rawValue
    }
}

enum CloudAccountState: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
    case disconnected
    case linkingReady = "linking-ready"
    case linked

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .disconnected:
            return "Disconnected"
        case .linkingReady:
            return "Linking ready"
        case .linked:
            return "Linked"
        }
    }
}

struct DeckFilterDefinition: Codable, Hashable, Sendable {
    let version: Int
    let effortLevels: [EffortLevel]
    let tags: [String]
}

struct Workspace: Codable, Hashable, Sendable {
    let workspaceId: String
    let name: String
    let createdAt: String
}

struct UserSettings: Codable, Hashable, Sendable {
    let userId: String
    let workspaceId: String
    let email: String?
    let locale: String
    let createdAt: String
}

// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::WorkspaceSchedulerSettings and apps/web/src/types.ts::WorkspaceSchedulerSettings.
struct WorkspaceSchedulerSettings: Codable, Hashable, Sendable {
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

// Keep in sync with apps/backend/src/cards.ts::Card and apps/web/src/types.ts::Card.
struct Card: Codable, Identifiable, Hashable, Sendable {
    let cardId: String
    let workspaceId: String
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

    var id: String {
        cardId
    }
}

struct Deck: Codable, Identifiable, Hashable, Sendable {
    let deckId: String
    let workspaceId: String
    let name: String
    let filterDefinition: DeckFilterDefinition
    let createdAt: String
    let clientUpdatedAt: String
    let lastModifiedByDeviceId: String
    let lastOperationId: String
    let updatedAt: String
    let deletedAt: String?

    var id: String {
        deckId
    }
}

enum ReviewFilter: Hashable, Identifiable, Sendable {
    case allCards
    case deck(deckId: String)

    var id: String {
        switch self {
        case .allCards:
            return "system-all-cards"
        case .deck(let deckId):
            return deckId
        }
    }
}

struct ReviewEvent: Codable, Identifiable, Hashable, Sendable {
    let reviewEventId: String
    let workspaceId: String
    let cardId: String
    let deviceId: String
    let clientEventId: String
    let rating: ReviewRating
    let reviewedAtClient: String
    let reviewedAtServer: String

    var id: String {
        reviewEventId
    }
}

struct CloudLinkedSession: Hashable, Sendable {
    let userId: String
    let workspaceId: String
    let email: String?
    let apiBaseUrl: String
    let bearerToken: String
}

struct CloudWorkspaceSummary: Codable, Identifiable, Hashable, Sendable {
    let workspaceId: String
    let name: String
    let createdAt: String
    let isSelected: Bool

    var id: String {
        workspaceId
    }
}

struct CloudWorkspaceLinkContext: Hashable, Identifiable, Sendable {
    let userId: String
    let email: String?
    let apiBaseUrl: String
    let credentials: StoredCloudCredentials
    let workspaces: [CloudWorkspaceSummary]

    var id: String {
        userId
    }
}

struct CloudVerifiedAuthContext: Hashable {
    let apiBaseUrl: String
    let credentials: StoredCloudCredentials
}

enum CloudWorkspaceLinkSelection: Hashable, Sendable {
    case existing(workspaceId: String)
    case createNew
}

struct CloudServiceConfiguration: Hashable {
    let apiBaseUrl: String
    let authBaseUrl: String
}

struct CloudOtpChallenge: Hashable {
    let email: String
    let csrfToken: String
    let otpSessionToken: String
}

struct StoredCloudCredentials: Codable, Hashable {
    let refreshToken: String
    let idToken: String
    let idTokenExpiresAt: String
}

struct CloudIdentityToken: Hashable {
    let idToken: String
    let idTokenExpiresAt: String
}

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
    case failed(message: String)
}

struct CardSyncPayload: Codable, Hashable {
    let cardId: String
    let frontText: String
    let backText: String
    let tags: [String]
    let effortLevel: String
    let dueAt: String?
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

        if let dueAt = self.dueAt {
            try container.encode(dueAt, forKey: .dueAt)
        } else {
            try container.encodeNil(forKey: .dueAt)
        }

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

struct WorkspaceSchedulerSettingsSyncPayload: Codable, Hashable {
    let algorithm: String
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
}

struct ReviewEventSyncPayload: Codable, Hashable {
    let reviewEventId: String
    let cardId: String
    let deviceId: String
    let clientEventId: String
    let rating: Int
    let reviewedAtClient: String
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

struct SyncOperationResult: Codable, Hashable {
    let operationId: String
    let entityType: SyncEntityType
    let entityId: String
    let status: String
    let resultingChangeId: Int64?
}

struct SyncPushResponse: Codable, Hashable {
    let operations: [SyncOperationResult]
}

enum SyncChangePayload: Hashable {
    case card(Card)
    case deck(Deck)
    case workspaceSchedulerSettings(WorkspaceSchedulerSettings)
    case reviewEvent(ReviewEvent)
}

struct SyncChange: Hashable {
    let changeId: Int64
    let entityType: SyncEntityType
    let entityId: String
    let action: SyncAction
    let payload: SyncChangePayload
}

struct SyncPullResponse: Hashable {
    let changes: [SyncChange]
    let nextChangeId: Int64
    let hasMore: Bool
}

struct PersistedOutboxEntry: Hashable {
    let operationId: String
    let workspaceId: String
    let createdAt: String
    let attemptCount: Int
    let lastError: String
    let operation: SyncOperation
}

struct CloudSettings: Codable, Hashable, Sendable {
    let deviceId: String
    let cloudState: CloudAccountState
    let linkedUserId: String?
    let linkedWorkspaceId: String?
    let linkedEmail: String?
    let onboardingCompleted: Bool
    let updatedAt: String
}

struct AgentApiKeyConnection: Codable, Hashable, Identifiable, Sendable {
    let connectionId: String
    let label: String
    let createdAt: String
    let lastUsedAt: String?
    let revokedAt: String?

    var id: String {
        self.connectionId
    }
}

struct HomeSnapshot: Codable, Hashable, Sendable {
    let deckCount: Int
    let totalCards: Int
    let dueCount: Int
    let newCount: Int
    let reviewedCount: Int
}

struct DeckListItem: Identifiable, Hashable, Sendable {
    let deck: Deck
    let totalCards: Int
    let dueCards: Int
    let newCards: Int
    let reviewedCards: Int

    var id: String {
        deck.deckId
    }
}

struct DeckCardStats: Hashable, Sendable {
    let totalCards: Int
    let dueCards: Int
    let newCards: Int
    let reviewedCards: Int
}

struct AppStateSnapshot: Hashable, Sendable {
    let workspace: Workspace
    let userSettings: UserSettings
    let schedulerSettings: WorkspaceSchedulerSettings
    let cloudSettings: CloudSettings
    let cards: [Card]
    let decks: [Deck]
}

struct CardEditorInput: Hashable, Sendable {
    let frontText: String
    let backText: String
    let tags: [String]
    let effortLevel: EffortLevel
}

struct CardUpdateInput: Hashable, Sendable {
    let cardId: String
    let input: CardEditorInput
}

struct BulkDeleteCardsResult: Hashable, Sendable {
    let deletedCardIds: [String]
    let deletedCount: Int
}

struct DeckEditorInput: Hashable, Sendable {
    let name: String
    let filterDefinition: DeckFilterDefinition
}

struct DeckUpdateInput: Hashable, Sendable {
    let deckId: String
    let input: DeckEditorInput
}

struct BulkDeleteDecksResult: Hashable, Sendable {
    let deletedDeckIds: [String]
    let deletedCount: Int
}

struct ReviewSubmission: Hashable, Sendable {
    let cardId: String
    let rating: ReviewRating
    let reviewedAtClient: String
}

struct ReviewSchedule: Hashable {
    let dueAt: Date
    let reps: Int
    let lapses: Int
    let fsrsCardState: FsrsCardState
    let fsrsStepIndex: Int?
    let fsrsStability: Double
    let fsrsDifficulty: Double
    let fsrsLastReviewedAt: Date
    let fsrsScheduledDays: Int
}

enum LocalStoreError: LocalizedError {
    case database(String)
    case validation(String)
    case notFound(String)
    case uninitialized(String)

    var errorDescription: String? {
        switch self {
        case .database(let message):
            return message
        case .validation(let message):
            return message
        case .notFound(let message):
            return message
        case .uninitialized(let message):
            return message
        }
    }
}
