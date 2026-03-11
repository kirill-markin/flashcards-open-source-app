import XCTest
@testable import Flashcards

final class TagSuggestionsTests: XCTestCase {
    func testTagSuggestionsIgnoreDeletedCardsAndSortByPopularity() {
        let suggestions = tagSuggestions(cards: [
            self.makeCard(cardId: "card-1", tags: ["verbs", "grammar"], deletedAt: nil),
            self.makeCard(cardId: "card-2", tags: ["grammar"], deletedAt: nil),
            self.makeCard(cardId: "card-3", tags: ["animals"], deletedAt: nil),
            self.makeCard(cardId: "card-4", tags: ["travel"], deletedAt: "2026-03-10T00:00:00.000Z")
        ])

        XCTAssertEqual(
            suggestions,
            [
                TagSuggestion(tag: "grammar", countState: .ready(cardsCount: 2)),
                TagSuggestion(tag: "animals", countState: .ready(cardsCount: 1)),
                TagSuggestion(tag: "verbs", countState: .ready(cardsCount: 1))
            ]
        )
    }

    func testFilterTagSuggestionsPreservesPopularityOrderWhileFilteringAndExcludingSelectedTags() {
        let filteredSuggestions = filterTagSuggestions(
            suggestions: [
                TagSuggestion(tag: "grammar", countState: .ready(cardsCount: 4)),
                TagSuggestion(tag: "verbs", countState: .ready(cardsCount: 3)),
                TagSuggestion(tag: "vocabulary", countState: .ready(cardsCount: 2)),
                TagSuggestion(tag: "travel", countState: .ready(cardsCount: 1))
            ],
            selectedTags: ["grammar"],
            searchText: "v"
        )

        XCTAssertEqual(
            filteredSuggestions,
            [
                TagSuggestion(tag: "verbs", countState: .ready(cardsCount: 3)),
                TagSuggestion(tag: "vocabulary", countState: .ready(cardsCount: 2))
            ]
        )
    }

    func testSelectedTagSuggestionsUseSavedCountOrZeroForNewDraftTag() {
        let suggestions = selectedTagSuggestions(
            selectedTags: ["grammar", "new-tag"],
            suggestions: [
                TagSuggestion(tag: "grammar", countState: .ready(cardsCount: 2))
            ]
        )

        XCTAssertEqual(
            suggestions,
            [
                TagSuggestion(tag: "grammar", countState: .ready(cardsCount: 2)),
                TagSuggestion(tag: "new-tag", countState: .ready(cardsCount: 0))
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
}
