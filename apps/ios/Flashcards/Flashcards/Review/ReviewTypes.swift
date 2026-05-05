import Foundation

let allCardsDeckLabel: String = String(
    localized: "cards.all_cards_deck_label",
    table: "Foundation",
    comment: "System deck label for all cards"
)

// Keep raw values in sync with apps/backend/src/schedule.ts::ReviewRating,
// apps/web/src/types.ts review rating wire fields, and
// apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FlashcardsModels.kt::ReviewRating.
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
            return String(
                localized: "review_rating.again.title",
                table: "Foundation",
                comment: "Review rating title for Again"
            )
        case .hard:
            return String(
                localized: "review_rating.hard.title",
                table: "Foundation",
                comment: "Review rating title for Hard"
            )
        case .good:
            return String(
                localized: "review_rating.good.title",
                table: "Foundation",
                comment: "Review rating title for Good"
            )
        case .easy:
            return String(
                localized: "review_rating.easy.title",
                table: "Foundation",
                comment: "Review rating title for Easy"
            )
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

enum ReviewFilter: Hashable, Identifiable, Sendable {
    case allCards
    case deck(deckId: String)
    case effort(level: EffortLevel)
    case tag(tag: String)

    var id: String {
        switch self {
        case .allCards:
            return "system-all-cards"
        case .deck(let deckId):
            return "deck:\(deckId)"
        case .effort(let level):
            return "effort:\(level.rawValue)"
        case .tag(let tag):
            return "tag:\(tag)"
        }
    }
}

struct ReviewCounts: Hashable, Sendable {
    let dueCount: Int
    let totalCount: Int
}

enum ReviewQueryDefinition: Hashable, Sendable {
    case allCards
    case deck(filterDefinition: DeckFilterDefinition)
    case tag(exactTagNames: [String])
}

struct ReviewTimelinePage: Hashable, Sendable {
    let cards: [Card]
    let hasMoreCards: Bool
}

struct ReviewEvent: Codable, Identifiable, Hashable, Sendable {
    let reviewEventId: String
    let workspaceId: String
    let cardId: String
    let replicaId: String
    let clientEventId: String
    let rating: ReviewRating
    let reviewedAtClient: String
    let reviewedAtServer: String

    enum CodingKeys: String, CodingKey {
        case reviewEventId
        case workspaceId
        case cardId
        case replicaId
        case clientEventId
        case rating
        case reviewedAtClient
        case reviewedAtServer
    }

    var id: String {
        reviewEventId
    }

    init(
        reviewEventId: String,
        workspaceId: String,
        cardId: String,
        replicaId: String,
        clientEventId: String,
        rating: ReviewRating,
        reviewedAtClient: String,
        reviewedAtServer: String
    ) {
        self.reviewEventId = reviewEventId
        self.workspaceId = workspaceId
        self.cardId = cardId
        self.replicaId = replicaId
        self.clientEventId = clientEventId
        self.rating = rating
        self.reviewedAtClient = reviewedAtClient
        self.reviewedAtServer = reviewedAtServer
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.reviewEventId = try container.decode(String.self, forKey: .reviewEventId)
        self.workspaceId = try container.decode(String.self, forKey: .workspaceId)
        self.cardId = try container.decode(String.self, forKey: .cardId)
        self.replicaId = try container.decode(String.self, forKey: .replicaId)
        self.clientEventId = try container.decode(String.self, forKey: .clientEventId)
        self.rating = try container.decode(ReviewRating.self, forKey: .rating)
        self.reviewedAtClient = try container.decode(String.self, forKey: .reviewedAtClient)
        self.reviewedAtServer = try container.decode(String.self, forKey: .reviewedAtServer)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.reviewEventId, forKey: .reviewEventId)
        try container.encode(self.workspaceId, forKey: .workspaceId)
        try container.encode(self.cardId, forKey: .cardId)
        try container.encode(self.clientEventId, forKey: .clientEventId)
        try container.encode(self.rating, forKey: .rating)
        try container.encode(self.reviewedAtClient, forKey: .reviewedAtClient)
        try container.encode(self.reviewedAtServer, forKey: .reviewedAtServer)
    }
}

enum ReviewRefreshMode: Hashable, Sendable {
    case blockingReset
    case backgroundReconcileSilently
    case backgroundReconcileWithVisibleChangeBanner
}

struct ReviewSubmission: Hashable, Sendable {
    let cardId: String
    let rating: ReviewRating
    let reviewedAtClient: String
}
