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
        XCTAssertEqual(
            cardsMatchingSearchText(cards: cards, searchText: "FAST").map(\.cardId),
            ["card-Hola", "card-Bonjour", "card-Ciao"]
        )
    }

    func testCardsMatchingSearchTextRequiresEveryToken() {
        let cards = [
            self.makeCard(frontText: "Hola", backText: "Hello", tags: ["spanish"]),
            self.makeCard(frontText: "Bonjour", backText: "Hi", tags: ["french"]),
            self.makeCard(frontText: "Ciao", backText: "Salve", tags: ["italian"])
        ]

        XCTAssertEqual(
            cardsMatchingSearchText(cards: cards, searchText: "hola spanish").map(\.cardId),
            ["card-Hola"]
        )
    }

    func testCardsMatchingSearchTextMergesTokensAfterFifthToken() {
        let cards = [
            self.makeCard(frontText: "alpha beta", backText: "gamma delta epsilon zeta eta", tags: ["combo"]),
            self.makeCard(frontText: "alpha beta", backText: "gamma delta epsilon zeta", tags: ["single"])
        ]

        XCTAssertEqual(
            cardsMatchingSearchText(
                cards: cards,
                searchText: "alpha beta gamma delta epsilon zeta eta"
            ).map(\.cardId),
            ["card-alpha beta"]
        )
    }

    func testCardsMatchingSearchTextAndFilterAppliesBothConditionsWithTagOverlap() {
        let cards = [
            self.makeCard(frontText: "Hola", backText: "Hello", tags: ["grammar"], effortLevel: .fast),
            self.makeCard(frontText: "Bonjour", backText: "Hello", tags: ["verbs"], effortLevel: .fast),
            self.makeCard(frontText: "Adios", backText: "Bye", tags: ["travel"], effortLevel: .fast)
        ]

        XCTAssertEqual(
            cardsMatchingSearchTextAndFilter(
                cards: cards,
                searchText: "hello",
                filter: CardFilter(tags: ["grammar", "verbs"], effort: [.fast])
            ).map(\.cardId),
            ["card-Hola", "card-Bonjour"]
        )
    }

    func testFormatCardFilterSummaryDescribesEmptyAndCombinedFilters() {
        XCTAssertEqual(formatCardFilterSummary(filter: nil), "No filters")
        XCTAssertEqual(
            formatCardFilterSummary(filter: CardFilter(tags: [], effort: [.fast, .medium])),
            "effort in fast, medium"
        )
        XCTAssertEqual(
            formatCardFilterSummary(filter: CardFilter(tags: ["grammar", "verbs"], effort: [])),
            "tags any of grammar, verbs"
        )
        XCTAssertEqual(
            formatCardFilterSummary(filter: CardFilter(tags: ["grammar"], effort: [.fast])),
            "effort in fast AND tags any of grammar"
        )
    }

    func testDeckFilterMatchesAnySelectedTagAndFormatsSummary() {
        let filterDefinition = buildDeckFilterDefinition(
            effortLevels: [.fast, .medium],
            tags: ["grammar", "verbs"]
        )

        XCTAssertTrue(
            matchesDeckFilterDefinition(
                filterDefinition: filterDefinition,
                card: self.makeCard(frontText: "Hola", backText: "Hello", tags: ["verbs"], effortLevel: .fast)
            )
        )
        XCTAssertFalse(
            matchesDeckFilterDefinition(
                filterDefinition: filterDefinition,
                card: self.makeCard(frontText: "Adios", backText: "Bye", tags: ["travel"], effortLevel: .fast)
            )
        )
        XCTAssertEqual(
            formatDeckFilterDefinition(filterDefinition: filterDefinition),
            "effort in fast, medium AND tags any of grammar, verbs"
        )
    }

    private func makeCard(frontText: String, backText: String, tags: [String]) -> Card {
        self.makeCard(frontText: frontText, backText: backText, tags: tags, effortLevel: .fast)
    }

    private func makeCard(frontText: String, backText: String, tags: [String], effortLevel: EffortLevel) -> Card {
        Card(
            cardId: "card-\(frontText)",
            workspaceId: "workspace-1",
            frontText: frontText,
            backText: backText,
            tags: tags,
            effortLevel: effortLevel,
            dueAt: nil,
            createdAt: "2026-03-10T00:00:00.000Z",
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
