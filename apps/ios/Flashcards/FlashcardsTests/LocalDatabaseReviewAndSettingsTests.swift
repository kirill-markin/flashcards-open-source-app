import Foundation
import XCTest
@testable import Flashcards

final class LocalDatabaseReviewAndSettingsTests: XCTestCase {
    func testSubmitReviewUpdatesCardAndEnqueuesReviewEventAndCardOperations() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)
        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let cardId = try testFirstActiveCard(database: database).cardId

        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        let reviewedCard = try testFirstActiveCard(database: database)
        XCTAssertEqual(reviewedCard.cardId, cardId)
        XCTAssertNotNil(reviewedCard.dueAt)
        XCTAssertGreaterThan(reviewedCard.reps, 0)

        let reviewEvents = try database.loadReviewEvents(workspaceId: workspaceId)
        XCTAssertEqual(reviewEvents.count, 1)
        XCTAssertEqual(reviewEvents.first?.cardId, cardId)

        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 3)
        XCTAssertEqual(
            outboxEntries.filter { entry in
                entry.operation.entityType == .card
            }.count,
            2
        )
        XCTAssertEqual(
            outboxEntries.filter { entry in
                entry.operation.entityType == .reviewEvent
            }.count,
            1
        )
    }

    func testUpdateWorkspaceSchedulerSettingsPersistsAndEnqueuesOperation() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

        try database.updateWorkspaceSchedulerSettings(
            workspaceId: workspaceId,
            desiredRetention: 0.92,
            learningStepsMinutes: [2, 12],
            relearningStepsMinutes: [15],
            maximumIntervalDays: 1200,
            enableFuzz: false
        )

        let schedulerSettings = try testSchedulerSettings(database: database)
        XCTAssertEqual(schedulerSettings.desiredRetention, 0.92, accuracy: 0.00000001)
        XCTAssertEqual(schedulerSettings.learningStepsMinutes, [2, 12])
        XCTAssertEqual(schedulerSettings.relearningStepsMinutes, [15])
        XCTAssertEqual(schedulerSettings.maximumIntervalDays, 1200)
        XCTAssertFalse(schedulerSettings.enableFuzz)

        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 50)
        XCTAssertEqual(outboxEntries.count, 1)
        XCTAssertTrue(outboxEntries.contains { entry in
            if case .workspaceSchedulerSettings(let payload) = entry.operation.payload {
                return payload.desiredRetention == 0.92
                    && payload.learningStepsMinutes == [2, 12]
                    && payload.relearningStepsMinutes == [15]
                    && payload.maximumIntervalDays == 1200
                    && payload.enableFuzz == false
            }

            return false
        })
    }
}
