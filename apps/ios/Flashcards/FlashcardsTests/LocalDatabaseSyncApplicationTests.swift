import Foundation
import XCTest
@testable import Flashcards

final class LocalDatabaseSyncApplicationTests: XCTestCase {
    func testApplySyncChangePreservesLwwAndReviewEventIdempotency() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Local card", backText: "Local back"),
            cardId: nil
        )
        _ = try database.createDeck(
            workspaceId: workspaceId,
            input: LocalDatabaseTestSupport.makeDeckInput(name: "Local deck")
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: workspaceId,
            desiredRetention: 0.91,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 365,
            enableFuzz: true
        )

        let localCard = try testFirstActiveCard(database: database)
        let localDeck = try testFirstActiveDeck(database: database)
        let localSettings = try testSchedulerSettings(database: database)

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 1,
                entityType: .card,
                entityId: localCard.cardId,
                action: .upsert,
                payload: .card(
                    LocalDatabaseTestSupport.makeRemoteCard(
                        from: localCard,
                        frontText: "Older remote card",
                        clientUpdatedAt: "2026-03-07T00:00:00.000Z",
                        deviceId: "remote-device-old",
                        operationId: "remote-op-old"
                    )
                )
            )
        )

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 2,
                entityType: .deck,
                entityId: localDeck.deckId,
                action: .upsert,
                payload: .deck(
                    LocalDatabaseTestSupport.makeRemoteDeck(
                        from: localDeck,
                        name: "Older remote deck",
                        clientUpdatedAt: "2026-03-07T00:00:00.000Z",
                        deviceId: "remote-device-old",
                        operationId: "remote-op-old"
                    )
                )
            )
        )

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 3,
                entityType: .workspaceSchedulerSettings,
                entityId: workspaceId,
                action: .upsert,
                payload: .workspaceSchedulerSettings(
                    LocalDatabaseTestSupport.makeRemoteWorkspaceSettings(
                        from: localSettings,
                        desiredRetention: 0.8,
                        clientUpdatedAt: "2026-03-07T00:00:00.000Z",
                        deviceId: "remote-device-old",
                        operationId: "remote-op-old"
                    )
                )
            )
        )

        var cards = try testActiveCards(database: database)
        var decks = try testActiveDecks(database: database)
        var schedulerSettings = try testSchedulerSettings(database: database)
        XCTAssertEqual(cards.first?.frontText, localCard.frontText)
        XCTAssertEqual(decks.first?.name, localDeck.name)
        XCTAssertEqual(schedulerSettings.desiredRetention, localSettings.desiredRetention, accuracy: 0.00000001)

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 4,
                entityType: .card,
                entityId: localCard.cardId,
                action: .upsert,
                payload: .card(
                    LocalDatabaseTestSupport.makeRemoteCard(
                        from: localCard,
                        frontText: "Newer remote card",
                        clientUpdatedAt: "2026-03-09T00:00:00.000Z",
                        deviceId: "remote-device-new",
                        operationId: "remote-op-new"
                    )
                )
            )
        )

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 5,
                entityType: .deck,
                entityId: localDeck.deckId,
                action: .upsert,
                payload: .deck(
                    LocalDatabaseTestSupport.makeRemoteDeck(
                        from: localDeck,
                        name: "Newer remote deck",
                        clientUpdatedAt: "2026-03-09T00:00:00.000Z",
                        deviceId: "remote-device-new",
                        operationId: "remote-op-new"
                    )
                )
            )
        )

        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 6,
                entityType: .workspaceSchedulerSettings,
                entityId: workspaceId,
                action: .upsert,
                payload: .workspaceSchedulerSettings(
                    LocalDatabaseTestSupport.makeRemoteWorkspaceSettings(
                        from: localSettings,
                        desiredRetention: 0.95,
                        clientUpdatedAt: "2026-03-09T00:00:00.000Z",
                        deviceId: "remote-device-new",
                        operationId: "remote-op-new"
                    )
                )
            )
        )

        let remoteReviewEvent = ReviewEvent(
            reviewEventId: "remote-review-event",
            workspaceId: workspaceId,
            cardId: localCard.cardId,
            deviceId: "remote-device-new",
            clientEventId: "remote-client-event",
            rating: .good,
            reviewedAtClient: "2026-03-09T01:00:00.000Z",
            reviewedAtServer: "2026-03-09T01:00:01.000Z"
        )
        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 7,
                entityType: .reviewEvent,
                entityId: remoteReviewEvent.reviewEventId,
                action: .append,
                payload: .reviewEvent(remoteReviewEvent)
            )
        )
        try database.applySyncChange(
            workspaceId: workspaceId,
            change: SyncChange(
                changeId: 8,
                entityType: .reviewEvent,
                entityId: remoteReviewEvent.reviewEventId,
                action: .append,
                payload: .reviewEvent(remoteReviewEvent)
            )
        )

        cards = try testActiveCards(database: database)
        decks = try testActiveDecks(database: database)
        schedulerSettings = try testSchedulerSettings(database: database)
        XCTAssertEqual(cards.first?.frontText, "Newer remote card")
        XCTAssertEqual(decks.first?.name, "Newer remote deck")
        XCTAssertEqual(schedulerSettings.desiredRetention, 0.95, accuracy: 0.00000001)

        let reviewEvents = try database.loadReviewEvents(workspaceId: workspaceId)
        XCTAssertEqual(reviewEvents.filter { event in
            event.reviewEventId == remoteReviewEvent.reviewEventId
        }.count, 1)
    }
}
