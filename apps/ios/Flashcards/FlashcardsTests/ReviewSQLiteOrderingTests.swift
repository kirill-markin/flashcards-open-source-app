import Foundation
import XCTest
@testable import Flashcards

final class ReviewSQLiteOrderingTests: XCTestCase {
    private var databaseURL: URL?
    private var database: LocalDatabase?

    override func tearDownWithError() throws {
        if let database {
            try database.close()
        }
        if let databaseURL {
            try? FileManager.default.removeItem(at: databaseURL)
        }
        self.database = nil
        self.databaseURL = nil
        try super.tearDownWithError()
    }

    func testSQLiteReviewQueueAndTimelineUseRecentDuePriorityBuckets() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "old-due",
            dueAt: "2026-03-09T07:59:59.999Z",
            createdAt: "2026-03-09T08:30:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "recent-now",
            dueAt: "2026-03-09T09:00:00.000Z",
            createdAt: "2026-03-09T08:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "recent-cutoff",
            dueAt: "2026-03-09T08:00:00.000Z",
            createdAt: "2026-03-09T07:30:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "new-card",
            dueAt: nil,
            createdAt: "2026-03-09T09:30:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "future-one-millisecond",
            dueAt: "2026-03-09T09:00:00.001Z",
            createdAt: "2026-03-09T10:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-due",
            dueAt: "1000",
            createdAt: "2026-03-09T11:00:00.000Z"
        )

        let limitedHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 3
        )
        let fullHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(limitedHead.seedReviewQueue.map(\.cardId), ["recent-cutoff", "recent-now", "old-due"])
        XCTAssertTrue(limitedHead.hasMoreCards)
        XCTAssertEqual(fullHead.seedReviewQueue.map(\.cardId), ["recent-cutoff", "recent-now", "old-due", "new-card"])
        XCTAssertFalse(fullHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            ["recent-cutoff", "recent-now", "old-due", "new-card", "future-one-millisecond", "malformed-due"]
        )
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueAndTimelineTreatVariableFractionDueAtAsParseable() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "recent-one-digit-fraction",
            dueAt: "2026-03-09T08:30:00.1Z",
            createdAt: "2026-03-09T08:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "old-six-digit-fraction",
            dueAt: "2026-03-09T07:30:00.123456Z",
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "future-one-digit-fraction",
            dueAt: "2026-03-09T09:00:00.1Z",
            createdAt: "2026-03-09T09:30:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-due",
            dueAt: "1000",
            createdAt: "2026-03-09T10:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["recent-one-digit-fraction", "old-six-digit-fraction"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            [
                "recent-one-digit-fraction",
                "old-six-digit-fraction",
                "future-one-digit-fraction",
                "malformed-due"
            ]
        )
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueAndTimelineMatchSwiftTruncatedFractionSemantics() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.123Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "canonical-now-older",
            dueAt: "2026-03-09T09:00:00.123Z",
            createdAt: "2026-03-09T08:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "truncated-now-newer",
            dueAt: "2026-03-09T09:00:00.123999Z",
            createdAt: "2026-03-09T08:30:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "future-one-millisecond",
            dueAt: "2026-03-09T09:00:00.124Z",
            createdAt: "2026-03-09T09:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["truncated-now-newer", "canonical-now-older"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            ["truncated-now-newer", "canonical-now-older", "future-one-millisecond"]
        )
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            sortCardsForReviewTimeline(cards: timelinePage.cards, now: now).map(\.cardId)
        )
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewTimelineOrdersMalformedDueAtByCreatedAtThenCardId() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-newer-a",
            dueAt: "3000",
            createdAt: "2026-03-09T11:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-newer-z",
            dueAt: "2000",
            createdAt: "2026-03-09T11:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-older",
            dueAt: "1000",
            createdAt: "2026-03-09T10:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), [])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            ["malformed-newer-a", "malformed-newer-z", "malformed-older"]
        )
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueRejectsShapeValidInvalidTimestampComponents() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "recent-valid",
            dueAt: "2026-03-09T08:59:00.000Z",
            createdAt: "2026-03-09T08:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-month",
            dueAt: "2026-13-09T08:59:00.000Z",
            createdAt: "2026-03-09T11:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-minute",
            dueAt: "2026-03-09T08:99:00.000Z",
            createdAt: "2026-03-09T10:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-second",
            dueAt: "2026-03-09T08:59:60.000Z",
            createdAt: "2026-03-09T09:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-calendar-day",
            dueAt: "2026-02-31T08:59:00.000Z",
            createdAt: "2026-03-09T12:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-non-leap-day",
            dueAt: "2026-02-29T08:59:00.000Z",
            createdAt: "2026-03-09T11:30:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["recent-valid"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            [
                "recent-valid",
                "invalid-calendar-day",
                "invalid-non-leap-day",
                "invalid-month",
                "invalid-minute",
                "invalid-second"
            ]
        )
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueAcceptsValidLeapDayDueAt() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2024-02-29T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "valid-leap-day",
            dueAt: "2024-02-29T08:59:00.000Z",
            createdAt: "2024-02-29T08:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-calendar-day",
            dueAt: "2024-02-30T08:59:00.000Z",
            createdAt: "2024-02-29T09:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["valid-leap-day"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(timelinePage.cards.map(\.cardId), ["valid-leap-day", "invalid-calendar-day"])
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueAndTimelineOrderEquivalentDueTimesByCreatedAtDescending() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "same-due-older",
            dueAt: "2026-03-09T08:30:00.000Z",
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "same-due-newer",
            dueAt: "2026-03-09T08:30:00Z",
            createdAt: "2026-03-09T08:00:00.000Z"
        )

        let reviewHead = try database.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let timelinePage = try database.loadReviewTimelinePage(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10,
            offset: 0
        )

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["same-due-newer", "same-due-older"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(timelinePage.cards.map(\.cardId), ["same-due-newer", "same-due-older"])
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

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

        XCTAssertEqual(queueRows.map(\.cardId), ["fraction-a-newer", "fraction-b-newer"])
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
            createdAt: "2026-03-09T08:00:00.000Z"
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
                AND due_at_millis < ?
            ORDER BY \(cardStoreActiveDueBucketOrderSQL)
            LIMIT ?
            """,
            values: [
                .text(workspace.workspaceId),
                .integer(try XCTUnwrap(parseStrictIsoTimestampEpochMillis(value: "2026-03-09T08:00:00.000Z"))),
                .integer(11)
            ]
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 3)
        }
        let queryPlan = planDetails.joined(separator: "\n")

        XCTAssertTrue(queryPlan.contains("idx_cards_workspace_due_millis_active"), queryPlan)
        XCTAssertFalse(queryPlan.contains("USE TEMP B-TREE"), queryPlan)
    }

    private func makeDatabase() throws -> LocalDatabase {
        let databaseURL = try self.makeDatabaseURL()
        let database = try LocalDatabase(databaseURL: databaseURL)
        self.databaseURL = databaseURL
        self.database = database
        return database
    }

    private func makeDatabaseURL() throws -> URL {
        let databaseDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(
            at: databaseDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
        return databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
    }

    private func insertCard(
        database: LocalDatabase,
        workspaceId: String,
        cardId: String,
        dueAt: String?,
        createdAt: String
    ) throws {
        try database.core.execute(
            sql: """
            INSERT INTO cards (
                card_id,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                due_at_millis,
                created_at,
                reps,
                lapses,
                fsrs_card_state,
                fsrs_step_index,
                fsrs_stability,
                fsrs_difficulty,
                fsrs_last_reviewed_at,
                fsrs_scheduled_days,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            )
            VALUES (?, ?, ?, ?, ?, 'fast', ?, ?, ?, 0, 0, 'new', NULL, NULL, NULL, NULL, NULL, ?, 'test-replica', ?, ?, NULL)
            """,
            values: [
                .text(cardId),
                .text(workspaceId),
                .text("Front \(cardId)"),
                .text("Back \(cardId)"),
                .text("[]"),
                dueAt.map(SQLiteValue.text) ?? .null,
                dueAt.flatMap(parseStrictIsoTimestampEpochMillis).map(SQLiteValue.integer) ?? .null,
                .text(createdAt),
                .text(createdAt),
                .text("operation-\(cardId)"),
                .text(createdAt)
            ]
        )
    }
}
