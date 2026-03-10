import XCTest
@testable import Flashcards

final class CardsSearchTests: XCTestCase {
    func testCardsMatchingSearchTextReturnsAllCardsForBlankSearch() {
        let cards = [self.makeCard(frontText: "Hola", backText: "Hello", tags: ["spanish"])]

        XCTAssertEqual(cardsMatchingSearchText(cards: cards, searchText: "  "), cards)
    }

    func testCardsMatchingSearchTextMatchesFrontBackAndTagsCaseInsensitively() {
        let cards = [
            self.makeCard(frontText: "Hola", backText: "Hello", tags: ["spanish"]),
            self.makeCard(frontText: "Bonjour", backText: "Hello", tags: ["french"]),
            self.makeCard(frontText: "Ciao", backText: "Hi", tags: ["italian"])
        ]

        XCTAssertEqual(cardsMatchingSearchText(cards: cards, searchText: "hola").map(\.cardId), ["card-Hola"])
        XCTAssertEqual(cardsMatchingSearchText(cards: cards, searchText: "HELLO").map(\.cardId), ["card-Hola", "card-Bonjour"])
        XCTAssertEqual(cardsMatchingSearchText(cards: cards, searchText: "FREN").map(\.cardId), ["card-Bonjour"])
    }

    private func makeCard(frontText: String, backText: String, tags: [String]) -> Card {
        Card(
            cardId: "card-\(frontText)",
            workspaceId: "workspace-1",
            frontText: frontText,
            backText: backText,
            tags: tags,
            effortLevel: .fast,
            dueAt: nil,
            reps: 0,
            lapses: 0,
            fsrsCardState: .new,
            fsrsStepIndex: nil,
            fsrsStability: nil,
            fsrsDifficulty: nil,
            fsrsLastReviewedAt: nil,
            fsrsScheduledDays: nil,
            clientUpdatedAt: "2026-03-10T00:00:00.000Z",
            lastModifiedByDeviceId: "device-1",
            lastOperationId: "operation-1",
            updatedAt: "2026-03-10T00:00:00.000Z",
            deletedAt: nil
        )
    }
}
