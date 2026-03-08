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

enum AppTab: Hashable {
    case review
    case decks
    case cards
    case settings
}

enum CardsPresentationRequest: Hashable {
    case createCard
}

let allCardsDeckLabel: String = "All cards"

enum EffortLevel: String, CaseIterable, Codable, Hashable, Identifiable {
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

enum ReviewRating: Int, CaseIterable, Hashable, Identifiable {
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
enum FsrsCardState: String, Codable, CaseIterable, Hashable, Identifiable {
    case new
    case learning
    case review
    case relearning

    var id: String {
        rawValue
    }
}

enum DeckCombineOperator: String, CaseIterable, Codable, Hashable, Identifiable {
    case and
    case or

    var id: String {
        rawValue
    }

    var title: String {
        rawValue.uppercased()
    }
}

enum DeckTagsOperator: String, CaseIterable, Codable, Hashable, Identifiable {
    case containsAny
    case containsAll

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .containsAny:
            return "Contains any"
        case .containsAll:
            return "Contains all"
        }
    }
}

enum CloudAccountState: String, CaseIterable, Codable, Hashable, Identifiable {
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

enum DeckPredicate: Codable, Hashable {
    case effortLevel(values: [EffortLevel])
    case tags(operatorName: DeckTagsOperator, values: [String])

    private enum CodingKeys: String, CodingKey {
        case field
        case `operator`
        case values
    }

    private enum FieldValue: String, Codable {
        case effortLevel
        case tags
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let field = try container.decode(FieldValue.self, forKey: .field)

        switch field {
        case .effortLevel:
            let operatorValue = try container.decode(String.self, forKey: .operator)
            guard operatorValue == "in" else {
                throw DecodingError.dataCorruptedError(
                    forKey: .operator,
                    in: container,
                    debugDescription: "effortLevel predicate operator must be in"
                )
            }

            let values = try container.decode([EffortLevel].self, forKey: .values)
            self = .effortLevel(values: values)
        case .tags:
            let operatorName = try container.decode(DeckTagsOperator.self, forKey: .operator)
            let values = try container.decode([String].self, forKey: .values)
            self = .tags(operatorName: operatorName, values: values)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .effortLevel(let values):
            try container.encode(FieldValue.effortLevel, forKey: .field)
            try container.encode("in", forKey: .operator)
            try container.encode(values, forKey: .values)
        case .tags(let operatorName, let values):
            try container.encode(FieldValue.tags, forKey: .field)
            try container.encode(operatorName, forKey: .operator)
            try container.encode(values, forKey: .values)
        }
    }
}

struct DeckFilterDefinition: Codable, Hashable {
    let version: Int
    let combineWith: DeckCombineOperator
    let predicates: [DeckPredicate]
}

struct Workspace: Hashable {
    let workspaceId: String
    let name: String
    let createdAt: String
}

struct UserSettings: Hashable {
    let userId: String
    let workspaceId: String
    let email: String?
    let locale: String
    let createdAt: String
}

// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::WorkspaceSchedulerSettings and apps/web/src/types.ts::WorkspaceSchedulerSettings.
struct WorkspaceSchedulerSettings: Hashable {
    let algorithm: String
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
    let serverVersion: Int64?
    let clientUpdatedAt: String
    let lastModifiedByDeviceId: String
    let lastOperationId: String
    let updatedAt: String
}

// Keep in sync with apps/backend/src/cards.ts::Card and apps/web/src/types.ts::Card.
struct Card: Identifiable, Hashable {
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
    let serverVersion: Int64?
    let clientUpdatedAt: String
    let lastModifiedByDeviceId: String
    let lastOperationId: String
    let updatedAt: String
    let deletedAt: String?

    var id: String {
        cardId
    }
}

struct Deck: Identifiable, Hashable {
    let deckId: String
    let workspaceId: String
    let name: String
    let filterDefinition: DeckFilterDefinition
    let createdAt: String
    let serverVersion: Int64?
    let clientUpdatedAt: String
    let lastModifiedByDeviceId: String
    let lastOperationId: String
    let updatedAt: String
    let deletedAt: String?

    var id: String {
        deckId
    }
}

enum ReviewFilter: Hashable, Identifiable {
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

struct ReviewEvent: Identifiable, Hashable {
    let reviewEventId: String
    let workspaceId: String
    let cardId: String
    let deviceId: String
    let clientEventId: String
    let rating: ReviewRating
    let reviewedAtClient: String
    let reviewedAtServer: String
    let serverVersion: Int64?

    var id: String {
        reviewEventId
    }
}

struct CloudSettings: Hashable {
    let deviceId: String
    let cloudState: CloudAccountState
    let linkedUserId: String?
    let linkedWorkspaceId: String?
    let linkedEmail: String?
    let onboardingCompleted: Bool
    let updatedAt: String
}

struct HomeSnapshot: Hashable {
    let deckCount: Int
    let totalCards: Int
    let dueCount: Int
    let newCount: Int
    let reviewedCount: Int
}

struct DeckListItem: Identifiable, Hashable {
    let deck: Deck
    let totalCards: Int
    let dueCards: Int
    let newCards: Int
    let reviewedCards: Int

    var id: String {
        deck.deckId
    }
}

struct DeckCardStats: Hashable {
    let totalCards: Int
    let dueCards: Int
    let newCards: Int
    let reviewedCards: Int
}

struct AppStateSnapshot: Hashable {
    let workspace: Workspace
    let userSettings: UserSettings
    let schedulerSettings: WorkspaceSchedulerSettings
    let cloudSettings: CloudSettings
    let cards: [Card]
    let decks: [Deck]
}

struct CardEditorInput: Hashable {
    let frontText: String
    let backText: String
    let tags: [String]
    let effortLevel: EffortLevel
}

struct DeckEditorInput: Hashable {
    let name: String
    let filterDefinition: DeckFilterDefinition
}

struct ReviewSubmission: Hashable {
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
