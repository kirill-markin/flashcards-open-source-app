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

let basicCardType: String = "basic"

struct CardSourceMetadata: Codable, Hashable, Sendable {
    let label: String?
    let author: String?
    let comment: String?
    let createdAt: String?
    let importedAt: String?
    let importId: String?

    enum CodingKeys: String, CodingKey {
        case label
        case author
        case comment
        case createdAt
        case importedAt
        case importId
    }

    init(
        label: String?,
        author: String?,
        comment: String?,
        createdAt: String?,
        importedAt: String?,
        importId: String?
    ) {
        self.label = label
        self.author = author
        self.comment = comment
        self.createdAt = createdAt
        self.importedAt = importedAt
        self.importId = importId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.label = try container.decode(String?.self, forKey: .label)
        self.author = try container.decode(String?.self, forKey: .author)
        self.comment = try container.decode(String?.self, forKey: .comment)
        self.createdAt = try container.decode(String?.self, forKey: .createdAt)
        self.importedAt = try container.decode(String?.self, forKey: .importedAt)
        self.importId = try container.decode(String?.self, forKey: .importId)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try encodeNullableCardMetadataString(self.label, forKey: .label, in: &container)
        try encodeNullableCardMetadataString(self.author, forKey: .author, in: &container)
        try encodeNullableCardMetadataString(self.comment, forKey: .comment, in: &container)
        try encodeNullableCardMetadataString(self.createdAt, forKey: .createdAt, in: &container)
        try encodeNullableCardMetadataString(self.importedAt, forKey: .importedAt, in: &container)
        try encodeNullableCardMetadataString(self.importId, forKey: .importId, in: &container)
    }
}

struct CardMetadata: Codable, Hashable, Sendable {
    let version: Int
    let source: CardSourceMetadata?

    enum CodingKeys: String, CodingKey {
        case version
        case source
    }

    init(source: CardSourceMetadata?) {
        self.version = 1
        self.source = source
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .version)
        guard version == 1 else {
            throw DecodingError.dataCorruptedError(
                forKey: .version,
                in: container,
                debugDescription: "Card metadata version must be 1"
            )
        }

        self.version = version
        self.source = try container.decode(CardSourceMetadata?.self, forKey: .source)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.version, forKey: .version)
        if let source = self.source {
            try container.encode(source, forKey: .source)
        } else {
            try container.encodeNil(forKey: .source)
        }
    }
}

private func encodeNullableCardMetadataString<Key: CodingKey>(
    _ value: String?,
    forKey key: Key,
    in container: inout KeyedEncodingContainer<Key>
) throws {
    if let value {
        try container.encode(value, forKey: key)
    } else {
        try container.encodeNil(forKey: key)
    }
}

func normalizeCardType(cardType: String?) -> String {
    guard let cardType else {
        return basicCardType
    }

    let trimmedCardType = cardType.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedCardType.isEmpty ? basicCardType : trimmedCardType
}

func makeDefaultCardMetadata(createdAt: String) -> CardMetadata {
    CardMetadata(
        source: CardSourceMetadata(
            label: nil,
            author: nil,
            comment: nil,
            createdAt: createdAt,
            importedAt: nil,
            importId: nil
        )
    )
}

func decodeCardTypeWithLegacyDefault<Key: CodingKey>(
    from container: KeyedDecodingContainer<Key>,
    forKey key: Key
) throws -> String {
    guard container.contains(key) else {
        return basicCardType
    }

    return normalizeCardType(cardType: try container.decode(String.self, forKey: key))
}

func decodeCardMetadataWithLegacyDefault<Key: CodingKey>(
    from container: KeyedDecodingContainer<Key>,
    forKey key: Key,
    createdAt: String
) throws -> CardMetadata {
    guard container.contains(key) else {
        return makeDefaultCardMetadata(createdAt: createdAt)
    }

    return try container.decode(CardMetadata.self, forKey: key)
}

// Keep in sync with apps/backend/src/cards/types.ts::Card, apps/web/src/types.ts::Card, and apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/cards/CardModels.kt::CardSummary.
struct Card: Codable, Identifiable, Hashable, Sendable {
    let cardId: String
    let workspaceId: String
    let frontText: String
    let backText: String
    let cardType: String
    let metadata: CardMetadata
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

    enum CodingKeys: String, CodingKey {
        case cardId
        case workspaceId
        case frontText
        case backText
        case cardType
        case metadata
        case tags
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
        case lastModifiedByReplicaId
        case lastOperationId
        case updatedAt
        case deletedAt
    }

    init(
        cardId: String,
        workspaceId: String,
        frontText: String,
        backText: String,
        cardType: String,
        metadata: CardMetadata,
        tags: [String],
        dueAt: String?,
        createdAt: String,
        reps: Int,
        lapses: Int,
        fsrsCardState: FsrsCardState,
        fsrsStepIndex: Int?,
        fsrsStability: Double?,
        fsrsDifficulty: Double?,
        fsrsLastReviewedAt: String?,
        fsrsScheduledDays: Int?,
        clientUpdatedAt: String,
        lastModifiedByReplicaId: String,
        lastOperationId: String,
        updatedAt: String,
        deletedAt: String?
    ) {
        self.cardId = cardId
        self.workspaceId = workspaceId
        self.frontText = frontText
        self.backText = backText
        self.cardType = normalizeCardType(cardType: cardType)
        self.metadata = metadata
        self.tags = tags
        self.dueAt = dueAt
        self.createdAt = createdAt
        self.reps = reps
        self.lapses = lapses
        self.fsrsCardState = fsrsCardState
        self.fsrsStepIndex = fsrsStepIndex
        self.fsrsStability = fsrsStability
        self.fsrsDifficulty = fsrsDifficulty
        self.fsrsLastReviewedAt = fsrsLastReviewedAt
        self.fsrsScheduledDays = fsrsScheduledDays
        self.clientUpdatedAt = clientUpdatedAt
        self.lastModifiedByReplicaId = lastModifiedByReplicaId
        self.lastOperationId = lastOperationId
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
    }

    init(
        cardId: String,
        workspaceId: String,
        frontText: String,
        backText: String,
        tags: [String],
        dueAt: String?,
        createdAt: String,
        reps: Int,
        lapses: Int,
        fsrsCardState: FsrsCardState,
        fsrsStepIndex: Int?,
        fsrsStability: Double?,
        fsrsDifficulty: Double?,
        fsrsLastReviewedAt: String?,
        fsrsScheduledDays: Int?,
        clientUpdatedAt: String,
        lastModifiedByReplicaId: String,
        lastOperationId: String,
        updatedAt: String,
        deletedAt: String?
    ) {
        self.init(
            cardId: cardId,
            workspaceId: workspaceId,
            frontText: frontText,
            backText: backText,
            cardType: basicCardType,
            metadata: makeDefaultCardMetadata(createdAt: createdAt),
            tags: tags,
            dueAt: dueAt,
            createdAt: createdAt,
            reps: reps,
            lapses: lapses,
            fsrsCardState: fsrsCardState,
            fsrsStepIndex: fsrsStepIndex,
            fsrsStability: fsrsStability,
            fsrsDifficulty: fsrsDifficulty,
            fsrsLastReviewedAt: fsrsLastReviewedAt,
            fsrsScheduledDays: fsrsScheduledDays,
            clientUpdatedAt: clientUpdatedAt,
            lastModifiedByReplicaId: lastModifiedByReplicaId,
            lastOperationId: lastOperationId,
            updatedAt: updatedAt,
            deletedAt: deletedAt
        )
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        self.init(
            cardId: try container.decode(String.self, forKey: .cardId),
            workspaceId: try container.decode(String.self, forKey: .workspaceId),
            frontText: try container.decode(String.self, forKey: .frontText),
            backText: try container.decode(String.self, forKey: .backText),
            cardType: try decodeCardTypeWithLegacyDefault(from: container, forKey: .cardType),
            metadata: try decodeCardMetadataWithLegacyDefault(
                from: container,
                forKey: .metadata,
                createdAt: createdAt
            ),
            tags: try container.decode([String].self, forKey: .tags),
            dueAt: try container.decodeIfPresent(String.self, forKey: .dueAt),
            createdAt: createdAt,
            reps: try container.decode(Int.self, forKey: .reps),
            lapses: try container.decode(Int.self, forKey: .lapses),
            fsrsCardState: try container.decode(FsrsCardState.self, forKey: .fsrsCardState),
            fsrsStepIndex: try container.decodeIfPresent(Int.self, forKey: .fsrsStepIndex),
            fsrsStability: try container.decodeIfPresent(Double.self, forKey: .fsrsStability),
            fsrsDifficulty: try container.decodeIfPresent(Double.self, forKey: .fsrsDifficulty),
            fsrsLastReviewedAt: try container.decodeIfPresent(String.self, forKey: .fsrsLastReviewedAt),
            fsrsScheduledDays: try container.decodeIfPresent(Int.self, forKey: .fsrsScheduledDays),
            clientUpdatedAt: try container.decode(String.self, forKey: .clientUpdatedAt),
            lastModifiedByReplicaId: try container.decode(String.self, forKey: .lastModifiedByReplicaId),
            lastOperationId: try container.decode(String.self, forKey: .lastOperationId),
            updatedAt: try container.decode(String.self, forKey: .updatedAt),
            deletedAt: try container.decodeIfPresent(String.self, forKey: .deletedAt)
        )
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
