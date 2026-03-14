import XCTest
@testable import Flashcards

final class ReviewFilterTests: XCTestCase {
    func testReviewFilterIdsDistinguishDeckAndTagValues() {
        XCTAssertEqual(ReviewFilter.allCards.id, "system-all-cards")
        XCTAssertEqual(ReviewFilter.deck(deckId: "grammar").id, "deck:grammar")
        XCTAssertEqual(ReviewFilter.tag(tag: "grammar").id, "tag:grammar")
    }

    func testResolveReviewFilterFallsBackWhenTagIsMissing() {
        let cards = [
            self.makeCard(cardId: "card-1", tags: ["grammar"], deletedAt: nil)
        ]

        XCTAssertEqual(
            resolveReviewFilter(
                reviewFilter: .tag(tag: "travel"),
                decks: [],
                cards: cards
            ),
            .allCards
        )
    }

    func testCardsMatchingReviewFilterAndTitleSupportTagFilters() {
        let grammarDeck = self.makeDeck(
            deckId: "deck-1",
            name: "Grammar",
            tags: ["grammar"]
        )
        let grammarCard = self.makeCard(cardId: "card-1", tags: ["grammar", "verbs"], deletedAt: nil)
        let travelCard = self.makeCard(cardId: "card-2", tags: ["travel"], deletedAt: nil)

        XCTAssertEqual(
            cardsMatchingReviewFilter(
                reviewFilter: .tag(tag: "verbs"),
                decks: [grammarDeck],
                cards: [grammarCard, travelCard]
            ),
            [grammarCard]
        )
        XCTAssertEqual(
            reviewFilterTitle(
                reviewFilter: .tag(tag: "verbs"),
                decks: [grammarDeck],
                cards: [grammarCard, travelCard]
            ),
            "verbs"
        )
    }

    func testSwitchToAllCardsReviewActionShowsForValidDeckFilter() {
        let grammarDeck = self.makeDeck(
            deckId: "deck-1",
            name: "Grammar",
            tags: ["grammar"]
        )

        XCTAssertTrue(
            shouldShowSwitchToAllCardsReviewAction(
                reviewFilter: .deck(deckId: "deck-1"),
                decks: [grammarDeck],
                cards: []
            )
        )
    }

    func testSwitchToAllCardsReviewActionShowsForValidTagFilter() {
        let grammarCard = self.makeCard(cardId: "card-1", tags: ["grammar"], deletedAt: nil)

        XCTAssertTrue(
            shouldShowSwitchToAllCardsReviewAction(
                reviewFilter: .tag(tag: "grammar"),
                decks: [],
                cards: [grammarCard]
            )
        )
    }

    func testSwitchToAllCardsReviewActionHidesForAllCardsFilter() {
        XCTAssertFalse(
            shouldShowSwitchToAllCardsReviewAction(
                reviewFilter: .allCards,
                decks: [],
                cards: []
            )
        )
    }

    func testSwitchToAllCardsReviewActionHidesForInvalidReviewFilters() {
        let grammarDeck = self.makeDeck(
            deckId: "deck-1",
            name: "Grammar",
            tags: ["grammar"]
        )
        let grammarCard = self.makeCard(cardId: "card-1", tags: ["grammar"], deletedAt: nil)

        XCTAssertFalse(
            shouldShowSwitchToAllCardsReviewAction(
                reviewFilter: .deck(deckId: "missing-deck"),
                decks: [grammarDeck],
                cards: [grammarCard]
            )
        )
        XCTAssertFalse(
            shouldShowSwitchToAllCardsReviewAction(
                reviewFilter: .tag(tag: "travel"),
                decks: [grammarDeck],
                cards: [grammarCard]
            )
        )
    }

    func testWorkspaceTagsSummarySortsByCountThenName() {
        let summary = workspaceTagsSummary(cards: [
            self.makeCard(cardId: "card-1", tags: ["verbs", "grammar"], deletedAt: nil),
            self.makeCard(cardId: "card-2", tags: ["grammar"], deletedAt: nil),
            self.makeCard(cardId: "card-3", tags: ["travel"], deletedAt: nil),
            self.makeCard(cardId: "card-4", tags: ["animals"], deletedAt: nil)
        ])

        XCTAssertEqual(
            summary.tags,
            [
                WorkspaceTagSummary(tag: "grammar", cardsCount: 2),
                WorkspaceTagSummary(tag: "animals", cardsCount: 1),
                WorkspaceTagSummary(tag: "travel", cardsCount: 1),
                WorkspaceTagSummary(tag: "verbs", cardsCount: 1)
            ]
        )
    }

    private func makeCard(cardId: String, tags: [String], deletedAt: String?) -> Card {
        Card(
            cardId: cardId,
            workspaceId: "workspace-1",
            frontText: "Front",
            backText: "Back",
            tags: tags,
            effortLevel: .fast,
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
            deletedAt: deletedAt
        )
    }

    private func makeDeck(deckId: String, name: String, tags: [String]) -> Deck {
        Deck(
            deckId: deckId,
            workspaceId: "workspace-1",
            name: name,
            filterDefinition: DeckFilterDefinition(
                version: 2,
                effortLevels: [],
                tags: tags
            ),
            createdAt: "2026-03-10T00:00:00.000Z",
            clientUpdatedAt: "2026-03-10T00:00:00.000Z",
            lastModifiedByDeviceId: "device-1",
            lastOperationId: "operation-1",
            updatedAt: "2026-03-10T00:00:00.000Z",
            deletedAt: nil
        )
    }
}
