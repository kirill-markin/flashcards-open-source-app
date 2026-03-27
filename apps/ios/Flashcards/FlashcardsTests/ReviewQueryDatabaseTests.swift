import Foundation
import XCTest
@testable import Flashcards

final class ReviewQueryDatabaseTests: XCTestCase {
    func testLoadReviewCountsReturnsExpectedCountsForAllTagAndDeckQueries() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

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
                reviewedAtClient: nowIsoTimestamp()
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
        let workspaceId = try testWorkspaceId(database: database)

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
                reviewedAtClient: nowIsoTimestamp()
            )
        )
        try database.core.execute(
            sql: """
            UPDATE cards
            SET created_at = CASE card_id
                WHEN ? THEN ?
                WHEN ? THEN ?
                WHEN ? THEN ?
                ELSE created_at
            END
            WHERE card_id IN (?, ?, ?)
            """,
            values: [
                .text(firstCard.cardId),
                .text("2026-03-09T10:00:00.000Z"),
                .text(secondCard.cardId),
                .text("2026-03-09T11:00:00.000Z"),
                .text(thirdCard.cardId),
                .text("2026-03-09T12:00:00.000Z"),
                .text(firstCard.cardId),
                .text(secondCard.cardId),
                .text(thirdCard.cardId)
            ]
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

    func testLoadReviewTimelinePagePlacesNullDueCardsBeforeEqualDueCardsAndUsesStableTieBreaks() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

        let nullOlder = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Null older",
                backText: "Back",
                tags: ["queue"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let nullNewer = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Null newer",
                backText: "Back",
                tags: ["queue"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let sameDueOlder = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Same due older",
                backText: "Back",
                tags: ["queue"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let sameDueNewer = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Same due newer",
                backText: "Back",
                tags: ["queue"],
                effortLevel: .medium
            ),
            cardId: nil
        )

        try database.core.execute(
            sql: """
            UPDATE cards
            SET due_at = CASE card_id
                WHEN ? THEN NULL
                WHEN ? THEN NULL
                WHEN ? THEN ?
                WHEN ? THEN ?
                ELSE due_at
            END,
            created_at = CASE card_id
                WHEN ? THEN ?
                WHEN ? THEN ?
                WHEN ? THEN ?
                WHEN ? THEN ?
                ELSE created_at
            END
            WHERE card_id IN (?, ?, ?, ?)
            """,
            values: [
                .text(nullOlder.cardId),
                .text(nullNewer.cardId),
                .text(sameDueOlder.cardId),
                .text("2026-03-09T08:00:00.000Z"),
                .text(sameDueNewer.cardId),
                .text("2026-03-09T08:00:00.000Z"),
                .text(nullOlder.cardId),
                .text("2026-03-09T10:00:00.000Z"),
                .text(nullNewer.cardId),
                .text("2026-03-09T11:00:00.000Z"),
                .text(sameDueOlder.cardId),
                .text("2026-03-09T12:00:00.000Z"),
                .text(sameDueNewer.cardId),
                .text("2026-03-09T13:00:00.000Z"),
                .text(nullOlder.cardId),
                .text(nullNewer.cardId),
                .text(sameDueOlder.cardId),
                .text(sameDueNewer.cardId)
            ]
        )

        let page = try database.loadReviewTimelinePage(
            workspaceId: workspaceId,
            reviewQueryDefinition: .allCards,
            now: Date(),
            limit: 4,
            offset: 0
        )

        XCTAssertEqual(
            page.cards.map(\.cardId),
            [nullNewer.cardId, nullOlder.cardId, sameDueNewer.cardId, sameDueOlder.cardId]
        )
    }
}
