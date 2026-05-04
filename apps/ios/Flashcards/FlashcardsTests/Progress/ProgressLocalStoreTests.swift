import Foundation
import XCTest
@testable import Flashcards

final class ProgressLocalStoreTests: ProgressStoreTestCase {
    func testLoadReviewScheduleBucketsByLocalDueDateAcrossWorkspaceMembership() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let secondWorkspace = try self.insertWorkspace(
            database: database,
            name: "Workspace 2",
            createdAt: "2026-04-02T00:00:00Z"
        )
        let excludedWorkspace = try self.insertWorkspace(
            database: database,
            name: "Workspace 3",
            createdAt: "2026-04-03T00:00:00Z"
        )
        let timeZone = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))
        let referenceLocalDate = "2026-04-18"

        _ = try self.addReviewScheduleCard(
            database: database,
            workspaceId: workspace.workspaceId,
            dueAt: nil
        )
        _ = try self.addReviewScheduleCard(
            database: database,
            workspaceId: secondWorkspace.workspaceId,
            dueAt: nil
        )
        try self.addReviewScheduleCardAtBoundary(
            database: database,
            workspaceId: workspace.workspaceId,
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: -1,
            offsetSeconds: 0
        )
        try self.addReviewScheduleCardAtBoundary(
            database: database,
            workspaceId: workspace.workspaceId,
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: 1,
            offsetSeconds: -1
        )
        try self.addReviewScheduleCardAtBoundary(
            database: database,
            workspaceId: workspace.workspaceId,
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: 1,
            offsetSeconds: 0
        )
        try self.addReviewScheduleCardAtBoundary(
            database: database,
            workspaceId: workspace.workspaceId,
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: 8,
            offsetSeconds: -1
        )
        try self.addReviewScheduleCardAtBoundary(
            database: database,
            workspaceId: workspace.workspaceId,
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: 8,
            offsetSeconds: 0
        )
        try self.addReviewScheduleCardAtBoundary(
            database: database,
            workspaceId: workspace.workspaceId,
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: 31,
            offsetSeconds: 0
        )
        try self.addReviewScheduleCardAtBoundary(
            database: database,
            workspaceId: workspace.workspaceId,
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: 91,
            offsetSeconds: 0
        )
        try self.addReviewScheduleCardAtBoundary(
            database: database,
            workspaceId: workspace.workspaceId,
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: 361,
            offsetSeconds: 0
        )
        try self.addReviewScheduleCardAtBoundary(
            database: database,
            workspaceId: workspace.workspaceId,
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: 721,
            offsetSeconds: 0
        )
        let deletedCard = try self.addReviewScheduleCardAtBoundary(
            database: database,
            workspaceId: workspace.workspaceId,
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: 1,
            offsetSeconds: 0
        )
        _ = try database.deleteCard(workspaceId: workspace.workspaceId, cardId: deletedCard.cardId)
        try self.addReviewScheduleCardAtBoundary(
            database: database,
            workspaceId: excludedWorkspace.workspaceId,
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: 1,
            offsetSeconds: 0
        )

        let schedule = try database.cardStore.loadReviewSchedule(
            workspaceIds: [
                workspace.workspaceId,
                secondWorkspace.workspaceId,
            ],
            timeZone: timeZone.identifier,
            referenceLocalDate: referenceLocalDate
        )

        XCTAssertEqual(ReviewScheduleBucketKey.stableOrder, schedule.buckets.map(\.key))
        XCTAssertEqual(11, schedule.totalCards)
        XCTAssertEqual(2, self.reviewScheduleCount(schedule: schedule, key: .new))
        XCTAssertEqual(2, self.reviewScheduleCount(schedule: schedule, key: .today))
        XCTAssertEqual(2, self.reviewScheduleCount(schedule: schedule, key: .days1To7))
        XCTAssertEqual(1, self.reviewScheduleCount(schedule: schedule, key: .days8To30))
        XCTAssertEqual(1, self.reviewScheduleCount(schedule: schedule, key: .days31To90))
        XCTAssertEqual(1, self.reviewScheduleCount(schedule: schedule, key: .days91To360))
        XCTAssertEqual(1, self.reviewScheduleCount(schedule: schedule, key: .years1To2))
        XCTAssertEqual(1, self.reviewScheduleCount(schedule: schedule, key: .later))
    }

    func testLoadPendingReviewEventPayloadsReturnsOnlyUnsyncedReviewEvents() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let card = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )

        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )

        let pendingBeforeDelete = try database.loadPendingReviewEventPayloads(
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId
        )

        XCTAssertEqual(1, pendingBeforeDelete.count)
        XCTAssertEqual("2026-04-02T15:50:57.000Z", pendingBeforeDelete.first?.reviewedAtClient)

        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let pendingAfterDelete = try database.loadPendingReviewEventPayloads(
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId
        )

        XCTAssertTrue(pendingAfterDelete.isEmpty)
        XCTAssertEqual(1, try database.loadReviewEvents(workspaceId: workspace.workspaceId).count)
    }

    func testPendingReviewScheduleImpactTracksOnlyScheduleRelevantCardOperations() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let createdCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )

        XCTAssertTrue(
            try database.hasPendingReviewScheduleImpactingCardOperation(
                workspaceId: workspace.workspaceId,
                installationId: cloudSettings.installationId
            )
        )
        try self.clearOutbox(database: database, workspaceId: workspace.workspaceId)

        _ = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Updated question",
                backText: "Updated answer",
                tags: ["edited"],
                effortLevel: .long
            ),
            cardId: createdCard.cardId
        )

        XCTAssertFalse(
            try database.hasPendingReviewScheduleImpactingCardOperation(
                workspaceId: workspace.workspaceId,
                installationId: cloudSettings.installationId
            )
        )
        XCTAssertEqual(1, try self.pendingCardOutboxCount(database: database, workspaceId: workspace.workspaceId))
        XCTAssertEqual(0, try self.pendingCardReviewScheduleImpactSum(database: database, workspaceId: workspace.workspaceId))
        try self.clearOutbox(database: database, workspaceId: workspace.workspaceId)

        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: createdCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )

        XCTAssertTrue(
            try database.hasPendingReviewScheduleImpactingCardOperation(
                workspaceId: workspace.workspaceId,
                installationId: cloudSettings.installationId
            )
        )
        try self.clearOutbox(database: database, workspaceId: workspace.workspaceId)

        _ = try database.deleteCard(workspaceId: workspace.workspaceId, cardId: createdCard.cardId)

        XCTAssertTrue(
            try database.hasPendingReviewScheduleImpactingCardOperation(
                workspaceId: workspace.workspaceId,
                installationId: cloudSettings.installationId
            )
        )
        XCTAssertEqual(1, try self.pendingCardOutboxCount(database: database, workspaceId: workspace.workspaceId))
        XCTAssertEqual(1, try self.pendingCardReviewScheduleImpactSum(database: database, workspaceId: workspace.workspaceId))
    }

    @discardableResult
    private func addReviewScheduleCardAtBoundary(
        database: LocalDatabase,
        workspaceId: String,
        referenceLocalDate: String,
        timeZone: TimeZone,
        offsetDays: Int,
        offsetSeconds: TimeInterval
    ) throws -> Card {
        let dueAt = try self.reviewScheduleBoundaryDate(
            referenceLocalDate: referenceLocalDate,
            timeZone: timeZone,
            offsetDays: offsetDays
        )
        .addingTimeInterval(offsetSeconds)
        return try self.addReviewScheduleCard(
            database: database,
            workspaceId: workspaceId,
            dueAt: dueAt
        )
    }

    @discardableResult
    private func addReviewScheduleCard(
        database: LocalDatabase,
        workspaceId: String,
        dueAt: Date?
    ) throws -> Card {
        let card = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        guard let dueAt else {
            return card
        }

        let dueAtText = formatIsoTimestamp(date: dueAt)
        try database.core.execute(
            sql: """
            UPDATE cards
            SET due_at = ?, due_at_millis = ?
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text(dueAtText),
                .integer(epochMillis(date: dueAt)),
                .text(workspaceId),
                .text(card.cardId),
            ]
        )
        return card
    }

    private func reviewScheduleBoundaryDate(
        referenceLocalDate: String,
        timeZone: TimeZone,
        offsetDays: Int
    ) throws -> Date {
        let calendar = makeProgressStoreCalendar(timeZone: timeZone)
        let referenceDate = try progressDateForStore(localDate: referenceLocalDate, calendar: calendar)
        guard let boundaryDate = calendar.date(byAdding: .day, value: offsetDays, to: referenceDate) else {
            throw LocalStoreError.validation("Test review schedule boundary could not be calculated")
        }

        return boundaryDate
    }

    private func reviewScheduleCount(
        schedule: UserReviewSchedule,
        key: ReviewScheduleBucketKey
    ) -> Int {
        schedule.buckets.first { bucket in
            bucket.key == key
        }?.count ?? 0
    }

    private func clearOutbox(database: LocalDatabase, workspaceId: String) throws {
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))
    }

    private func pendingCardOutboxCount(database: LocalDatabase, workspaceId: String) throws -> Int {
        try database.core.scalarInt(
            sql: """
            SELECT COUNT(*)
            FROM outbox
            WHERE workspace_id = ? AND entity_type = 'card'
            """,
            values: [.text(workspaceId)]
        )
    }

    private func pendingCardReviewScheduleImpactSum(database: LocalDatabase, workspaceId: String) throws -> Int {
        try database.core.scalarInt(
            sql: """
            SELECT COALESCE(SUM(review_schedule_impact), 0)
            FROM outbox
            WHERE workspace_id = ? AND entity_type = 'card'
            """,
            values: [.text(workspaceId)]
        )
    }
}
