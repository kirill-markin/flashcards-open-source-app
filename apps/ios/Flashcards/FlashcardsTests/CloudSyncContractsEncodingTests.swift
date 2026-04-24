import Foundation
import XCTest
@testable import Flashcards

final class CloudSyncContractsEncodingTests: XCTestCase {
    func testBootstrapPushEncodesExplicitNullsForNullableCardAndDeckFields() throws {
        let card = Card(
            cardId: "card-1",
            workspaceId: "workspace-1",
            frontText: "Front",
            backText: "Back",
            tags: ["tag-1"],
            effortLevel: .medium,
            dueAt: nil,
            createdAt: "2026-04-24T10:00:00.000Z",
            reps: 0,
            lapses: 0,
            fsrsCardState: .new,
            fsrsStepIndex: nil,
            fsrsStability: nil,
            fsrsDifficulty: nil,
            fsrsLastReviewedAt: nil,
            fsrsScheduledDays: nil,
            clientUpdatedAt: "2026-04-24T10:00:00.000Z",
            lastModifiedByReplicaId: "replica-1",
            lastOperationId: "operation-1",
            updatedAt: "2026-04-24T10:00:00.000Z",
            deletedAt: nil
        )
        let deck = Deck(
            deckId: "deck-1",
            workspaceId: "workspace-1",
            name: "Deck",
            filterDefinition: DeckFilterDefinition(version: 2, effortLevels: [.medium], tags: ["tag-1"]),
            createdAt: "2026-04-24T10:00:00.000Z",
            clientUpdatedAt: "2026-04-24T10:00:00.000Z",
            lastModifiedByReplicaId: "replica-1",
            lastOperationId: "operation-2",
            updatedAt: "2026-04-24T10:00:00.000Z",
            deletedAt: nil
        )
        let request = BootstrapPushRequest(
            mode: "push",
            installationId: "installation-1",
            platform: "ios",
            appVersion: "1.0",
            entries: [
                SyncBootstrapEntryEnvelope(
                    entry: SyncBootstrapEntry(
                        entityType: .card,
                        entityId: card.cardId,
                        action: .upsert,
                        payload: .card(card)
                    )
                ),
                SyncBootstrapEntryEnvelope(
                    entry: SyncBootstrapEntry(
                        entityType: .deck,
                        entityId: deck.deckId,
                        action: .upsert,
                        payload: .deck(deck)
                    )
                )
            ]
        )

        let requestObject = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )
        let entries = try XCTUnwrap(requestObject["entries"] as? [[String: Any]])
        XCTAssertEqual(entries.count, 2)

        let cardPayload = try XCTUnwrap(entries[0]["payload"] as? [String: Any])
        self.assertExplicitNull(key: "dueAt", payload: cardPayload)
        self.assertExplicitNull(key: "fsrsStepIndex", payload: cardPayload)
        self.assertExplicitNull(key: "fsrsStability", payload: cardPayload)
        self.assertExplicitNull(key: "fsrsDifficulty", payload: cardPayload)
        self.assertExplicitNull(key: "fsrsLastReviewedAt", payload: cardPayload)
        self.assertExplicitNull(key: "fsrsScheduledDays", payload: cardPayload)
        self.assertExplicitNull(key: "deletedAt", payload: cardPayload)

        let deckPayload = try XCTUnwrap(entries[1]["payload"] as? [String: Any])
        self.assertExplicitNull(key: "deletedAt", payload: deckPayload)
    }

    private func assertExplicitNull(key: String, payload: [String: Any]) {
        XCTAssertTrue(payload.keys.contains(key))
        XCTAssertTrue(payload[key] is NSNull)
    }
}
