import Foundation

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
