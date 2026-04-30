import Foundation
import XCTest
@testable import Flashcards

final class PublicSyncConflictLocalIdRepairTests: LocalWorkspaceSyncTestCase {
    func testRepairLocalIdForPublicCardSyncConflictRewritesCardReferencesAndOutbox() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["tag"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )

        let recovery = try database.repairLocalIdForPublicSyncConflict(
            workspaceId: workspace.workspaceId,
            syncConflict: CloudSyncConflictDetails(
                phase: "push",
                entityType: .card,
                entityId: savedCard.cardId,
                entryIndex: nil,
                reviewEventIndex: nil,
                recoverable: true
            )
        )

        let replacementCardId = recovery.replacementEntityId
        let cards = try database.loadActiveCards(workspaceId: workspace.workspaceId)
        let reviewEvents = try database.loadReviewEvents(workspaceId: workspace.workspaceId)
        let outboxRows = try self.loadOutboxRows(database: database)
        XCTAssertEqual(.card, recovery.entityType)
        XCTAssertEqual(savedCard.cardId, recovery.sourceEntityId)
        XCTAssertNotEqual(savedCard.cardId, replacementCardId)
        XCTAssertNotNil(UUID(uuidString: replacementCardId))
        XCTAssertFalse(cards.contains { card in card.cardId == savedCard.cardId })
        XCTAssertTrue(cards.contains { card in card.cardId == replacementCardId })
        XCTAssertEqual(0, try self.loadCardTagCount(database: database, cardId: savedCard.cardId))
        XCTAssertEqual(1, try self.loadCardTagCount(database: database, cardId: replacementCardId))
        XCTAssertTrue(reviewEvents.allSatisfy { reviewEvent in reviewEvent.cardId == replacementCardId })
        XCTAssertFalse(outboxRows.contains { row in row.entityId == savedCard.cardId })
        XCTAssertTrue(
            try outboxRows
                .filter { row in row.entityType == SyncEntityType.card.rawValue }
                .allSatisfy { row in
                    let payload = try JSONDecoder().decode(WorkspaceSyncCardOutboxPayload.self, from: Data(row.payloadJson.utf8))
                    return row.entityId == replacementCardId && payload.cardId == replacementCardId
                }
        )
        XCTAssertTrue(
            try outboxRows
                .filter { row in row.entityType == SyncEntityType.reviewEvent.rawValue }
                .allSatisfy { row in
                    let payload = try JSONDecoder().decode(
                        WorkspaceSyncReviewEventOutboxPayload.self,
                        from: Data(row.payloadJson.utf8)
                    )
                    return payload.cardId == replacementCardId
                }
        )
    }

    func testRepairLocalIdForPublicReviewEventSyncConflictRewritesReviewEventAndOutbox() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
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
                cardId: savedCard.cardId,
                rating: .easy,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )
        let sourceReviewEvent = try XCTUnwrap(try database.loadReviewEvents(workspaceId: workspace.workspaceId).first)

        let recovery = try database.repairLocalIdForPublicSyncConflict(
            workspaceId: workspace.workspaceId,
            syncConflict: CloudSyncConflictDetails(
                phase: "review_history_import",
                entityType: .reviewEvent,
                entityId: sourceReviewEvent.reviewEventId,
                entryIndex: nil,
                reviewEventIndex: 0,
                recoverable: true
            )
        )

        let replacementReviewEventId = recovery.replacementEntityId
        let reviewEvents = try database.loadReviewEvents(workspaceId: workspace.workspaceId)
        let outboxRows = try self.loadOutboxRows(database: database).filter { row in
            row.entityType == SyncEntityType.reviewEvent.rawValue
        }
        XCTAssertEqual(.reviewEvent, recovery.entityType)
        XCTAssertEqual(sourceReviewEvent.reviewEventId, recovery.sourceEntityId)
        XCTAssertNotEqual(sourceReviewEvent.reviewEventId, replacementReviewEventId)
        XCTAssertNotNil(UUID(uuidString: replacementReviewEventId))
        XCTAssertFalse(reviewEvents.contains { reviewEvent in reviewEvent.reviewEventId == sourceReviewEvent.reviewEventId })
        XCTAssertTrue(reviewEvents.contains { reviewEvent in
            reviewEvent.reviewEventId == replacementReviewEventId && reviewEvent.cardId == savedCard.cardId
        })
        XCTAssertTrue(
            try outboxRows.allSatisfy { row in
                let payload = try JSONDecoder().decode(
                    WorkspaceSyncReviewEventOutboxPayload.self,
                    from: Data(row.payloadJson.utf8)
                )
                return row.entityId == replacementReviewEventId
                    && payload.reviewEventId == replacementReviewEventId
                    && payload.cardId == savedCard.cardId
            }
        )
    }

    func testRepairLocalIdForPublicDeckSyncConflictRewritesDeckAndOutbox() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedDeck = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [.medium], tags: ["tag"])
            )
        )

        let recovery = try database.repairLocalIdForPublicSyncConflict(
            workspaceId: workspace.workspaceId,
            syncConflict: CloudSyncConflictDetails(
                phase: "bootstrap",
                entityType: .deck,
                entityId: savedDeck.deckId,
                entryIndex: 0,
                reviewEventIndex: nil,
                recoverable: true
            )
        )

        let replacementDeckId = recovery.replacementEntityId
        let decks = try database.loadActiveDecks(workspaceId: workspace.workspaceId)
        let deckOutboxRows = try self.loadOutboxRows(database: database).filter { row in
            row.entityType == SyncEntityType.deck.rawValue
        }
        XCTAssertEqual(.deck, recovery.entityType)
        XCTAssertEqual(savedDeck.deckId, recovery.sourceEntityId)
        XCTAssertNotEqual(savedDeck.deckId, replacementDeckId)
        XCTAssertNotNil(UUID(uuidString: replacementDeckId))
        XCTAssertFalse(decks.contains { deck in deck.deckId == savedDeck.deckId })
        XCTAssertTrue(decks.contains { deck in deck.deckId == replacementDeckId })
        XCTAssertTrue(
            try deckOutboxRows.allSatisfy { row in
                let payload = try JSONDecoder().decode(WorkspaceSyncDeckOutboxPayload.self, from: Data(row.payloadJson.utf8))
                return row.entityId == replacementDeckId && payload.deckId == replacementDeckId
            }
        )
    }
}
