import Foundation

// Keep in sync with apps/backend/src/cards/types.ts::EffortLevel,
// apps/web/src/types.ts::EffortLevel, and
// apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FlashcardsModels.kt::EffortLevel.
enum EffortLevel: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
    case fast
    case medium
    case long

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .fast:
            return String(
                localized: "effort.fast.title",
                table: "Foundation",
                comment: "Fast effort level title"
            )
        case .medium:
            return String(
                localized: "effort.medium.title",
                table: "Foundation",
                comment: "Medium effort level title"
            )
        case .long:
            return String(
                localized: "effort.long.title",
                table: "Foundation",
                comment: "Long effort level title"
            )
        }
    }
}

// Keep in sync with apps/backend/src/decks.ts::DeckFilterDefinition,
// apps/web/src/types.ts::DeckFilterDefinition, and
// apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FlashcardsModels.kt::DeckFilterDefinition.
struct DeckFilterDefinition: Codable, Hashable, Sendable {
    let version: Int
    let effortLevels: [EffortLevel]
    let tags: [String]
}

struct CardFilter: Codable, Hashable, Sendable {
    let tags: [String]
    let effort: [EffortLevel]
}

// Keep in sync with apps/backend/src/cards.ts::Card, apps/web/src/types.ts::Card, and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FlashcardsModels.kt::CardSummary.
struct Card: Codable, Identifiable, Hashable, Sendable {
    let cardId: String
    let workspaceId: String
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
    let lastModifiedByReplicaId: String
    let lastOperationId: String
    let updatedAt: String
    let deletedAt: String?

    var id: String {
        deckId
    }
}
