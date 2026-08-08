import Foundation
import XCTest
@testable import Flashcards

final class ReviewSQLiteEligibilityTests: ReviewSQLiteTestCase {
    func testSQLiteReviewQueueIncludesOldDueNonCanonicalBeforeLimitedCanonicalRows() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "non-canonical-old-earliest",
            dueAt: "2026-03-09T06:00:00Z",
            createdAt: "2026-03-09T08:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "canonical-old-first",
            dueAt: "2026-03-09T06:30:00.000Z",
            createdAt: "2026-03-09T08:30:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "canonical-old-second",
            dueAt: "2026-03-09T07:00:00.000Z",
            createdAt: "2026-03-09T08:45:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "canonical-old-third",
            dueAt: "2026-03-09T07:30:00.000Z",
            createdAt: "2026-03-09T09:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 2
        )

        XCTAssertEqual(
            reviewHead.seedReviewQueue.map(\.cardId),
            ["non-canonical-old-earliest", "canonical-old-first"]
        )
        XCTAssertTrue(reviewHead.hasMoreCards)
    }

    func testSQLiteReviewQueueOrdersLimitedNonCanonicalOldDueByNormalizedTimestampTies() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "fraction-a-newer",
            dueAt: "2026-03-09T07:30:00.1Z",
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "fraction-b-newer",
            dueAt: "2026-03-09T07:30:00.1000Z",
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "fraction-c-older",
            dueAt: "2026-03-09T07:30:00.10000Z",
            createdAt: "2026-03-09T06:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "fraction-d-oldest",
            dueAt: "2026-03-09T07:30:00.100000Z",
            createdAt: "2026-03-09T05:00:00.000Z"
        )

        let queueRows = try database.cardStore.loadReviewQueueRows(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 1,
            excludedCardIds: []
        )

        XCTAssertEqual(queueRows.map(\.cardId), ["fraction-d-oldest", "fraction-c-older"])
    }

    func testSQLiteReviewCountsUseActiveQueueDueEligibility() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "recent-due",
            dueAt: "2026-03-09T08:30:00.000Z",
            createdAt: "2026-03-09T08:00:00.000Z",
            fsrsLastReviewedAt: "2026-03-09T08:30:00.000Z",
            tags: []
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "old-due",
            dueAt: "2026-03-09T07:30:00Z",
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "new-card",
            dueAt: nil,
            createdAt: "2026-03-09T10:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "future-due",
            dueAt: "2026-03-09T09:00:00.001Z",
            createdAt: "2026-03-09T11:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-due",
            dueAt: "1000",
            createdAt: "2026-03-09T12:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-calendar-day",
            dueAt: "2026-02-31T08:59:00.000Z",
            createdAt: "2026-03-09T13:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let reviewCounts = try database.loadReviewCounts(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["recent-due", "old-due", "new-card"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(reviewCounts, ReviewCounts(dueCount: 3, totalCount: 6))
    }

    func testSQLiteActiveDueBucketOrderUsesDueAtIndexOrder() throws {
        XCTAssertFalse(cardStoreActiveDueBucketOrderSQL.lowercased().contains("julianday"))
        XCTAssertTrue(cardStoreActiveDueBucketOrderSQL.lowercased().contains("due_at_millis"))
        XCTAssertTrue(cardStoreActiveDueBucketOrderSQL.lowercased().contains("created_at asc"))

        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let planDetails = try database.core.query(
            sql: """
            EXPLAIN QUERY PLAN
            SELECT
            \(cardStoreSelectColumnsSQL)
            FROM cards
            WHERE workspace_id = ?
                AND deleted_at IS NULL
                AND due_at_millis IS NOT NULL
                AND due_at_millis <= ?
                AND (
                    fsrs_last_reviewed_at_millis IS NULL
                    OR fsrs_last_reviewed_at_millis < ?
                    OR fsrs_last_reviewed_at_millis > ?
                )
            ORDER BY \(cardStoreActiveDueBucketOrderSQL)
            LIMIT ?
            """,
            values: [
                .text(workspace.workspaceId),
                .integer(try XCTUnwrap(parseStrictIsoTimestampEpochMillis(value: "2026-03-09T08:00:00.000Z"))),
                .integer(try XCTUnwrap(parseStrictIsoTimestampEpochMillis(value: "2026-03-09T08:00:00.000Z"))),
                .integer(try XCTUnwrap(parseStrictIsoTimestampEpochMillis(value: "2026-03-09T09:00:00.000Z"))),
                .integer(11)
            ]
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 3)
        }
        let queryPlan = planDetails.joined(separator: "\n")

        XCTAssertTrue(queryPlan.contains("idx_cards_workspace_due_millis_active"), queryPlan)
        XCTAssertFalse(queryPlan.contains("USE TEMP B-TREE"), queryPlan)
    }

}

