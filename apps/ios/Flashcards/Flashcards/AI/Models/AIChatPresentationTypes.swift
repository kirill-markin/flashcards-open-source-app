import Foundation

enum AIChatPresentationRequest: Hashable, Sendable {
    case createCard
    case attachCard(AIChatCardReference)
}

struct AIChatCardReference: Hashable, Sendable {
    let cardId: String
    let frontText: String
    let backText: String
    let tags: [String]
    let effortLevel: EffortLevel
}

func makeAIChatCardReference(card: Card) -> AIChatCardReference {
    AIChatCardReference(
        cardId: card.cardId,
        frontText: card.frontText,
        backText: card.backText,
        tags: card.tags,
        effortLevel: card.effortLevel
    )
}
