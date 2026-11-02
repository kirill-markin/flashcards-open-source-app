import Foundation

struct CardsListSnapshot: Hashable, Sendable {
    let cards: [Card]
    let totalCount: Int
}

struct DeckSummary: Identifiable, Hashable, Sendable {
    let deckId: String
    let name: String
    let filterDefinition: DeckFilterDefinition
    let createdAt: String
    let totalCards: Int
    let dueCards: Int
    let newCards: Int
    let reviewedCards: Int

    var id: String {
        self.deckId
    }
}

struct DecksListSnapshot: Hashable, Sendable {
    let deckSummaries: [DeckSummary]
    let allCardsStats: DeckCardStats
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
