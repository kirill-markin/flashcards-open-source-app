import Foundation
import XCTest
@testable import Flashcards

final class LocalWorkspaceLinkMigrationTests: LocalWorkspaceSyncTestCase {
    func testMigrateLocalWorkspaceToLinkedWorkspaceReplacesLocalShellForNonEmptyRemoteWorkspace() throws {
        let database = try self.makeDatabase()
        let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: localWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.submitReview(
            workspaceId: localWorkspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )
        try self.updateSyncState(
            database: database,
            workspaceId: localWorkspace.workspaceId,
            hotChangeId: 123,
            reviewSequenceId: 456
        )

        try database.migrateLocalWorkspaceToLinkedWorkspace(
            localWorkspaceId: localWorkspace.workspaceId,
            linkedSession: self.makeLinkedSession(workspaceId: "workspace-linked"),
            remoteWorkspaceIsEmpty: false
        )

        XCTAssertEqual("workspace-linked", try database.workspaceSettingsStore.loadWorkspace().workspaceId)
        XCTAssertEqual(1, try self.loadWorkspaceIds(database: database).count)
        XCTAssertTrue(try database.loadActiveCards(workspaceId: "workspace-linked").isEmpty)
        XCTAssertTrue(try database.loadReviewEvents(workspaceId: "workspace-linked").isEmpty)
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
        XCTAssertNil(try self.loadSyncState(database: database, workspaceId: localWorkspace.workspaceId))
        XCTAssertEqual(
            WorkspaceSyncStateSnapshot(
                workspaceId: "workspace-linked",
                lastAppliedHotChangeId: 0,
                lastAppliedReviewSequenceId: 0,
                hasHydratedHotState: false,
                hasHydratedReviewHistory: false
            ),
            try self.loadSyncState(database: database, workspaceId: "workspace-linked")
        )
    }

    func testMigrateLocalWorkspaceToLinkedWorkspaceForksLocalDataForEmptyRemoteWorkspaceAndResetsSyncState() throws {
        let database = try self.makeDatabase()
        let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: localWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["tag"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let savedDeck = try database.createDeck(
            workspaceId: localWorkspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [], tags: ["tag"])
            )
        )
        _ = try database.submitReview(
            workspaceId: localWorkspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: localWorkspace.workspaceId,
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36500,
            enableFuzz: true
        )
        let sourceReviewEvent = try XCTUnwrap(try database.loadReviewEvents(workspaceId: localWorkspace.workspaceId).first)
        try self.updateSyncState(
            database: database,
            workspaceId: localWorkspace.workspaceId,
            hotChangeId: 123,
            reviewSequenceId: 456
        )
        let expectedForkedCardId = forkedCardIdForWorkspace(
            sourceWorkspaceId: localWorkspace.workspaceId,
            destinationWorkspaceId: "workspace-linked",
            sourceCardId: savedCard.cardId
        )
        let expectedForkedDeckId = forkedDeckIdForWorkspace(
            sourceWorkspaceId: localWorkspace.workspaceId,
            destinationWorkspaceId: "workspace-linked",
            sourceDeckId: savedDeck.deckId
        )
        let expectedForkedReviewEventId = forkedReviewEventIdForWorkspace(
            sourceWorkspaceId: localWorkspace.workspaceId,
            destinationWorkspaceId: "workspace-linked",
            sourceReviewEventId: sourceReviewEvent.reviewEventId
        )

        try database.migrateLocalWorkspaceToLinkedWorkspace(
            localWorkspaceId: localWorkspace.workspaceId,
            linkedSession: self.makeLinkedSession(workspaceId: "workspace-linked"),
            remoteWorkspaceIsEmpty: true
        )

        let migratedCards = try database.loadActiveCards(workspaceId: "workspace-linked")
        let migratedReviewEvents = try database.loadReviewEvents(workspaceId: "workspace-linked")
        let migratedCard = try XCTUnwrap(migratedCards.first)
        let migratedReviewEvent = try XCTUnwrap(migratedReviewEvents.first)
        let migratedDeck = try XCTUnwrap(try database.loadActiveDecks(workspaceId: "workspace-linked").first)
        let outboxRows = try self.loadOutboxRows(database: database)
        let cardOutboxRows = outboxRows.filter { row in
            row.entityType == SyncEntityType.card.rawValue
        }
        let deckOutboxRows = outboxRows.filter { row in
            row.entityType == SyncEntityType.deck.rawValue
        }
        let reviewEventOutboxRows = outboxRows.filter { row in
            row.entityType == SyncEntityType.reviewEvent.rawValue
        }
        let schedulerOutboxRows = outboxRows.filter { row in
            row.entityType == SyncEntityType.workspaceSchedulerSettings.rawValue
        }

        XCTAssertEqual(1, try self.loadWorkspaceIds(database: database).count)
        XCTAssertEqual(expectedForkedCardId, migratedCard.cardId)
        XCTAssertEqual("workspace-linked", migratedCard.workspaceId)
        XCTAssertEqual(["tag"], migratedCard.tags)
        XCTAssertEqual(expectedForkedDeckId, migratedDeck.deckId)
        XCTAssertEqual(1, migratedReviewEvents.count)
        XCTAssertEqual(expectedForkedReviewEventId, migratedReviewEvent.reviewEventId)
        XCTAssertEqual("workspace-linked", migratedReviewEvent.workspaceId)
        XCTAssertEqual(expectedForkedCardId, migratedReviewEvent.cardId)
        XCTAssertTrue(outboxRows.allSatisfy { row in row.workspaceId == "workspace-linked" })
        XCTAssertFalse(outboxRows.contains { row in row.entityId == savedCard.cardId })
        XCTAssertFalse(outboxRows.contains { row in row.entityId == savedDeck.deckId })
        XCTAssertFalse(outboxRows.contains { row in row.entityId == sourceReviewEvent.reviewEventId })
        XCTAssertTrue(
            try cardOutboxRows.allSatisfy { row in
                let payload = try JSONDecoder().decode(WorkspaceSyncCardOutboxPayload.self, from: Data(row.payloadJson.utf8))
                return row.entityId == expectedForkedCardId && payload.cardId == expectedForkedCardId
            }
        )
        XCTAssertTrue(
            try deckOutboxRows.allSatisfy { row in
                let payload = try JSONDecoder().decode(WorkspaceSyncDeckOutboxPayload.self, from: Data(row.payloadJson.utf8))
                return row.entityId == expectedForkedDeckId && payload.deckId == expectedForkedDeckId
            }
        )
        XCTAssertTrue(
            try reviewEventOutboxRows.allSatisfy { row in
                let payload = try JSONDecoder().decode(
                    WorkspaceSyncReviewEventOutboxPayload.self,
                    from: Data(row.payloadJson.utf8)
                )
                return row.entityId == expectedForkedReviewEventId
                    && payload.reviewEventId == expectedForkedReviewEventId
                    && payload.cardId == expectedForkedCardId
            }
        )
        XCTAssertEqual(["workspace-linked"], schedulerOutboxRows.map(\.entityId))
        XCTAssertGreaterThan(try self.loadOutboxCount(database: database), 0)
        XCTAssertNil(try self.loadSyncState(database: database, workspaceId: localWorkspace.workspaceId))
        XCTAssertEqual(
            WorkspaceSyncStateSnapshot(
                workspaceId: "workspace-linked",
                lastAppliedHotChangeId: 0,
                lastAppliedReviewSequenceId: 0,
                hasHydratedHotState: false,
                hasHydratedReviewHistory: false
            ),
            try self.loadSyncState(database: database, workspaceId: "workspace-linked")
        )
    }
}
