import Foundation
import XCTest
@testable import Flashcards

final class ReviewSQLiteDueOrderingTests: ReviewSQLiteTestCase {
    func testSQLiteReviewQueueAndTimelineUseRecentlyReviewedDuePriorityBuckets() throws {
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
            createdAt: "2026-03-09T08:00:00.000Z",
            fsrsLastReviewedAt: "2026-03-09T09:00:00Z",
            tags: []
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "recent-cutoff",
            dueAt: "2026-03-09T08:00:00.000Z",
            createdAt: "2026-03-09T07:30:00.000Z",
            fsrsLastReviewedAt: "2026-03-09T08:00:00.000Z",
            tags: []
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "due-last-hour-old-review",
            dueAt: "2026-03-09T08:15:00.000Z",
            createdAt: "2026-03-09T07:45:00.000Z",
            fsrsLastReviewedAt: "2026-03-09T07:59:59.999Z",
            tags: []
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
        XCTAssertEqual(fullHead.seedReviewQueue.map(\.cardId), ["recent-cutoff", "recent-now", "old-due", "due-last-hour-old-review", "new-card"])
        XCTAssertFalse(fullHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            ["recent-cutoff", "recent-now", "old-due", "due-last-hour-old-review", "new-card", "future-one-millisecond", "malformed-due"]
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
            createdAt: "2026-03-09T08:00:00.000Z",
            fsrsLastReviewedAt: "2026-03-09T08:30:00.100Z",
            tags: []
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

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["canonical-now-older", "truncated-now-newer"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            ["canonical-now-older", "truncated-now-newer", "future-one-millisecond"]
        )
        XCTAssertEqual(
            timelinePage.cards.map(\.cardId),
            sortCardsForReviewTimeline(cards: timelinePage.cards, now: now).map(\.cardId)
        )
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewTimelineOrdersMalformedDueAtByOlderCreatedAtThenCardId() throws {
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
            ["malformed-older", "malformed-newer-a", "malformed-newer-z"]
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
                "invalid-second",
                "invalid-minute",
                "invalid-month",
                "invalid-non-leap-day",
                "invalid-calendar-day"
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

    func testSQLiteReviewQueueAndTimelineOrderEquivalentDueTimesByCreatedAtAscending() throws {
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

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["same-due-older", "same-due-newer"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(timelinePage.cards.map(\.cardId), ["same-due-older", "same-due-newer"])
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

    func testSQLiteReviewQueueAndTimelineOrderNewCardsByCreatedAtAscending() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))

        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "new-card-older",
            dueAt: nil,
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "new-card-newer",
            dueAt: nil,
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

        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["new-card-older", "new-card-newer"])
        XCTAssertFalse(reviewHead.hasMoreCards)
        XCTAssertEqual(timelinePage.cards.map(\.cardId), ["new-card-older", "new-card-newer"])
        XCTAssertFalse(timelinePage.hasMoreCards)
    }

}

