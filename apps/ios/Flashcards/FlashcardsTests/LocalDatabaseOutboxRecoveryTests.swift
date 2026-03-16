import Foundation
import XCTest
@testable import Flashcards

final class LocalDatabaseOutboxRecoveryTests: XCTestCase {
    func testBootstrapOutboxRecreatesMissingOperationsWithoutDuplicates() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let cardId = try testFirstActiveCard(database: database).cardId
        _ = try database.createDeck(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeDeckInput(name: "Deck")
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: workspaceId,
            desiredRetention: 0.93,
            learningStepsMinutes: [2, 8],
            relearningStepsMinutes: [12],
            maximumIntervalDays: 700,
            enableFuzz: true
        )
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        let existingEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        try database.deleteOutboxEntries(operationIds: existingEntries.map { entry in
            entry.operationId
        })
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100).count, 0)

        try database.bootstrapOutbox(workspaceId: workspaceId)

        var recreatedEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertEqual(recreatedEntries.count, 4)
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .card
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .deck
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .workspaceSchedulerSettings
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .reviewEvent
            }.count,
            1
        )

        try database.bootstrapOutbox(workspaceId: workspaceId)
        recreatedEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertEqual(recreatedEntries.count, 4)
    }

    func testBootstrapOutboxSkipsReviewEventsFromAnotherDevice() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )

        let localCard = try testFirstActiveCard(database: database)
        let remoteReviewEvent = ReviewEvent(
            reviewEventId: "remote-review-event",
            workspaceId: workspaceId,
            cardId: localCard.cardId,
            deviceId: "remote-device",
            clientEventId: "remote-client-event",
            rating: .good,
            reviewedAtClient: "2026-03-09T01:00:00.000Z",
            reviewedAtServer: "2026-03-09T01:00:01.000Z"
        )
        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 1,
                entityType: .reviewEvent,
                entityId: remoteReviewEvent.reviewEventId,
                action: .append,
                payload: .reviewEvent(remoteReviewEvent)
            )
        )

        let existingEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        try database.deleteOutboxEntries(operationIds: existingEntries.map { entry in
            entry.operationId
        })

        try database.bootstrapOutbox(workspaceId: workspaceId)

        let recreatedEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertEqual(recreatedEntries.count, 2)
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .card
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .workspaceSchedulerSettings
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .reviewEvent
            }.count,
            0
        )
    }

    func testBootstrapOutboxDoesNotDuplicatePendingLocalReviewEvent() throws {
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

        let existingEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        try database.deleteOutboxEntries(operationIds: existingEntries.compactMap { entry in
            entry.operation.entityType == .reviewEvent ? nil : entry.operationId
        })

        try database.bootstrapOutbox(workspaceId: workspaceId)

        let recreatedEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertEqual(recreatedEntries.count, 3)
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .card
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .workspaceSchedulerSettings
            }.count,
            1
        )
        XCTAssertEqual(
            recreatedEntries.filter { entry in
                entry.operation.entityType == .reviewEvent
            }.count,
            1
        )
    }

    func testDeleteStaleReviewEventOutboxEntriesRemovesOnlyMismatchedReviewEventOperations() throws {
        let (databaseURL, database) = try LocalDatabaseTestSupport.makeDatabaseWithURL(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)
        let originalDeviceId = try testCloudSettings(database: database).deviceId

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let cardId = try testFirstActiveCard(database: database).cardId
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: workspaceId,
            desiredRetention: 0.92,
            learningStepsMinutes: [2, 12],
            relearningStepsMinutes: [15],
            maximumIntervalDays: 1200,
            enableFuzz: false
        )
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        try LocalDatabaseTestSupport.updateStoredDeviceId(
            databaseURL: databaseURL,
            deviceId: "replacement-device-id"
        )

        let removedEntriesCount = try database.deleteStaleReviewEventOutboxEntries(workspaceId: workspaceId)

        XCTAssertEqual(removedEntriesCount, 1)

        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertEqual(outboxEntries.count, 3)
        XCTAssertEqual(
            outboxEntries.filter { entry in
                entry.operation.entityType == .card
            }.count,
            2
        )
        XCTAssertEqual(
            outboxEntries.filter { entry in
                entry.operation.entityType == .workspaceSchedulerSettings
            }.count,
            1
        )
        XCTAssertEqual(
            outboxEntries.filter { entry in
                entry.operation.entityType == .reviewEvent
            }.count,
            0
        )

        let reviewEvents = try database.loadReviewEvents(workspaceId: workspaceId)
        XCTAssertEqual(reviewEvents.count, 1)
        XCTAssertEqual(reviewEvents.first?.deviceId, originalDeviceId)
    }

    func testDeleteStaleReviewEventOutboxEntriesKeepsMatchingReviewEventOperations() throws {
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

        let removedEntriesCount = try database.deleteStaleReviewEventOutboxEntries(workspaceId: workspaceId)

        XCTAssertEqual(removedEntriesCount, 0)
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100).count, 3)
        XCTAssertEqual(
            try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100).filter { entry in
                entry.operation.entityType == .reviewEvent
            }.count,
            1
        )
    }

    func testLoadOutboxEntriesRepairsLegacyCardPayloadMissingCreatedAt() throws {
        let (databaseURL, database) = try LocalDatabaseTestSupport.makeDatabaseWithURL(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)
        let deviceId = try testCloudSettings(database: database).deviceId

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )

        let card = try testFirstActiveCard(database: database)
        let existingEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        try database.deleteOutboxEntries(operationIds: existingEntries.map { entry in
            entry.operationId
        })

        let legacyPayloadJson = #"""
        {
          "cardId": "\#(card.cardId)",
          "frontText": "\#(card.frontText)",
          "backText": "\#(card.backText)",
          "tags": ["tag-a"],
          "effortLevel": "\#(card.effortLevel.rawValue)",
          "dueAt": null,
          "reps": \#(card.reps),
          "lapses": \#(card.lapses),
          "fsrsCardState": "\#(card.fsrsCardState.rawValue)",
          "fsrsStepIndex": null,
          "fsrsStability": null,
          "fsrsDifficulty": null,
          "fsrsLastReviewedAt": null,
          "fsrsScheduledDays": null,
          "deletedAt": null
        }
        """#
        let core = try DatabaseCore(databaseURL: databaseURL)
        _ = try core.execute(
            sql: """
            INSERT INTO outbox (
                operation_id,
                workspace_id,
                device_id,
                entity_type,
                entity_id,
                operation_type,
                payload_json,
                client_updated_at,
                created_at,
                attempt_count,
                last_error
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
            """,
            values: [
                .text("legacy-card-upsert"),
                .text(workspaceId),
                .text(deviceId),
                .text("card"),
                .text(card.cardId),
                .text("upsert"),
                .text(legacyPayloadJson),
                .text(card.updatedAt),
                .text(nowIsoTimestamp())
            ]
        )

        let repairedEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        XCTAssertEqual(repairedEntries.count, 1)

        guard case .card(let repairedCardPayload) = repairedEntries[0].operation.payload else {
            return XCTFail("Expected card payload")
        }

        XCTAssertEqual(repairedCardPayload.createdAt, card.createdAt)
        XCTAssertEqual(repairedCardPayload.cardId, card.cardId)
    }
}
