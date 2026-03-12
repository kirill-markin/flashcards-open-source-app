import Foundation
import XCTest
@testable import Flashcards

final class ReviewQueryDatabaseTests: XCTestCase {
    func testLoadReviewCountsReturnsExpectedCountsForAllTagAndDeckQueries() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Due grammar medium",
                backText: "Back",
                tags: ["grammar"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Due other medium",
                backText: "Back",
                tags: ["other"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let futureGrammarLong = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Future grammar long",
                backText: "Back",
                tags: ["grammar"],
                effortLevel: .long
            ),
            cardId: nil
        )

        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: futureGrammarLong.cardId,
                rating: .good,
                reviewedAtClient: currentIsoTimestamp()
            )
        )

        let allCounts = try database.loadReviewCounts(
            workspaceId: workspaceId,
            reviewQueryDefinition: .allCards,
            now: Date()
        )
        let tagCounts = try database.loadReviewCounts(
            workspaceId: workspaceId,
            reviewQueryDefinition: .tag(tag: "grammar"),
            now: Date()
        )
        let deckCounts = try database.loadReviewCounts(
            workspaceId: workspaceId,
            reviewQueryDefinition: .deck(
                filterDefinition: buildDeckFilterDefinition(
                    effortLevels: [.medium],
                    tags: ["other"]
                )
            ),
            now: Date()
        )

        XCTAssertEqual(allCounts.totalCount, 3)
        XCTAssertEqual(allCounts.dueCount, 2)
        XCTAssertEqual(tagCounts.totalCount, 2)
        XCTAssertEqual(tagCounts.dueCount, 1)
        XCTAssertEqual(deckCounts.totalCount, 1)
        XCTAssertEqual(deckCounts.dueCount, 1)
    }

    func testLoadReviewTimelinePageUsesStablePagingAndOrdering() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try database.loadStateSnapshot().workspace.workspaceId

        let firstCard = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "First due",
                backText: "Back",
                tags: ["queue"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let secondCard = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Second due",
                backText: "Back",
                tags: ["queue"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let thirdCard = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Third due",
                backText: "Back",
                tags: ["queue"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: firstCard.cardId,
                rating: .good,
                reviewedAtClient: currentIsoTimestamp()
            )
        )

        let firstPage = try database.loadReviewTimelinePage(
            workspaceId: workspaceId,
            reviewQueryDefinition: .allCards,
            now: Date(),
            limit: 2,
            offset: 0
        )
        let secondPage = try database.loadReviewTimelinePage(
            workspaceId: workspaceId,
            reviewQueryDefinition: .allCards,
            now: Date(),
            limit: 2,
            offset: 2
        )

        XCTAssertEqual(firstPage.cards.map(\.cardId), [thirdCard.cardId, secondCard.cardId])
        XCTAssertTrue(firstPage.hasMoreCards)
        XCTAssertEqual(secondPage.cards.map(\.cardId), [firstCard.cardId])
        XCTAssertFalse(secondPage.hasMoreCards)
    }
}
