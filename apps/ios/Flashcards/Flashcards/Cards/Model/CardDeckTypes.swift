import Foundation

// Keep in sync with apps/backend/src/decks/index.ts::DeckFilterDefinition,
// apps/web/src/types.ts::DeckFilterDefinition, and
// apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/cards/CardModels.kt::DeckFilterDefinition.
struct DeckFilterDefinition: Codable, Hashable, Sendable {
    let version: Int
    let tags: [String]

    enum CodingKeys: String, CodingKey {
        case version
        case tags
        case effortLevels
    }

    init(version: Int, tags: [String]) {
        self.version = version
        self.tags = tags
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .version)
        let tags = try container.decode([String].self, forKey: .tags)
        let legacyEffortLevels = try container.decodeIfPresent([String].self, forKey: .effortLevels) ?? []

        self.version = version
        self.tags = try tagsAppendingLegacyEffortTags(tags: tags, effortLevels: legacyEffortLevels)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.version, forKey: .version)
        try container.encode(self.tags, forKey: .tags)
    }
}

struct CardFilter: Codable, Hashable, Sendable {
    let tags: [String]
}

// Keep in sync with apps/backend/src/cards/types.ts::Card, apps/web/src/types.ts::Card, and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/cards/CardModels.kt::CardSummary.
struct Card: Codable, Identifiable, Hashable, Sendable {
    let cardId: String
    let workspaceId: String
    let frontText: String
    let backText: String
    let tags: [String]
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
