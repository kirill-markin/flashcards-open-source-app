import Foundation
import XCTest
@testable import Flashcards

final class CloudSyncContractsEncodingTests: XCTestCase {
    func testBootstrapPushEncodesExplicitNullsForNullableCardAndDeckFields() throws {
        let card = self.makeCard(cardId: "card-1", dueAt: nil)
        let deck = Deck(
            deckId: "deck-1",
            workspaceId: "workspace-1",
            name: "Deck",
            filterDefinition: DeckFilterDefinition(version: 2, tags: ["tag-1", "medium"]),
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

    func testBootstrapPushCanonicalizesNonCanonicalCardDueAt() throws {
        let card = self.makeCard(cardId: "card-1", dueAt: "2026-03-09T08:30:00.1Z")
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
                )
            ]
        )

        let requestObject = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )
        let entries = try XCTUnwrap(requestObject["entries"] as? [[String: Any]])
        let cardPayload = try XCTUnwrap(entries[0]["payload"] as? [String: Any])

        XCTAssertEqual(cardPayload["dueAt"] as? String, "2026-03-09T08:30:00.100Z")
    }

    func testRemoteCardPayloadDefaultsMissingCardTypeAndMetadata() throws {
        let payload = try JSONDecoder().decode(
            RemoteCardChangePayload.self,
            from: Data(self.remoteCardPayloadJSON(cardTypeLine: nil, metadataLine: nil).utf8)
        )

        XCTAssertEqual(payload.cardType, basicCardType)
        XCTAssertEqual(payload.metadata, makeDefaultCardMetadata(createdAt: "2026-04-24T10:00:00.000Z"))
    }

    func testRemoteCardPayloadRejectsExplicitNullCardTypeAndMetadata() throws {
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                RemoteCardChangePayload.self,
                from: Data(self.remoteCardPayloadJSON(
                    cardTypeLine: #""cardType": null,"#,
                    metadataLine: self.validCardMetadataJSONLine()
                ).utf8)
            )
        )
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                RemoteCardChangePayload.self,
                from: Data(self.remoteCardPayloadJSON(
                    cardTypeLine: #""cardType": "basic","#,
                    metadataLine: #""metadata": null,"#
                ).utf8)
            )
        )
    }

    func testCardSyncPayloadRejectsExplicitNullCardTypeAndMetadata() throws {
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                CardSyncPayload.self,
                from: Data(self.cardSyncPayloadJSON(
                    cardTypeLine: #""cardType": null,"#,
                    metadataLine: self.validCardMetadataJSONLine()
                ).utf8)
            )
        )
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                CardSyncPayload.self,
                from: Data(self.cardSyncPayloadJSON(
                    cardTypeLine: #""cardType": "basic","#,
                    metadataLine: #""metadata": null,"#
                ).utf8)
            )
        )
    }

    func testCardModelDecodeRejectsExplicitNullCardTypeAndMetadata() throws {
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                Card.self,
                from: Data(self.cardModelJSON(
                    cardTypeLine: #""cardType": null,"#,
                    metadataLine: self.validCardMetadataJSONLine()
                ).utf8)
            )
        )
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                Card.self,
                from: Data(self.cardModelJSON(
                    cardTypeLine: #""cardType": "basic","#,
                    metadataLine: #""metadata": null,"#
                ).utf8)
            )
        )
    }

    func testRemoteCardPayloadRejectsMalformedDueAt() throws {
        let json = """
        {
            "cardId": "card-1",
            "frontText": "Front",
            "backText": "Back",
            "tags": [],
            "effortLevel": "medium",
            "dueAt": "2026-02-31T08:30:00.000Z",
            "createdAt": "2026-04-24T10:00:00.000Z",
            "reps": 1,
            "lapses": 0,
            "fsrsCardState": "review",
            "fsrsStepIndex": null,
            "fsrsStability": 1.0,
            "fsrsDifficulty": 2.0,
            "fsrsLastReviewedAt": "2026-04-24T10:00:00.000Z",
            "fsrsScheduledDays": 1,
            "clientUpdatedAt": "2026-04-24T10:00:00.000Z",
            "lastModifiedByReplicaId": "replica-1",
            "lastOperationId": "operation-1",
            "updatedAt": "2026-04-24T10:00:00.000Z",
            "deletedAt": null
        }
        """

        XCTAssertThrowsError(
            try JSONDecoder().decode(RemoteCardChangePayload.self, from: Data(json.utf8))
        )
    }

    private func assertExplicitNull(key: String, payload: [String: Any]) {
        XCTAssertTrue(payload.keys.contains(key))
        XCTAssertTrue(payload[key] is NSNull)
    }

    private func validCardMetadataJSONLine() -> String {
        #""metadata": {"version":1,"source":{"label":null,"author":null,"comment":null,"createdAt":"2026-04-24T10:00:00.000Z","importedAt":null,"importId":null}},"#
    }

    private func remoteCardPayloadJSON(cardTypeLine: String?, metadataLine: String?) -> String {
        self.cardPayloadJSON(
            workspaceLine: nil,
            cardTypeLine: cardTypeLine,
            metadataLine: metadataLine,
            lwwLines: """
            "clientUpdatedAt": "2026-04-24T10:00:00.000Z",
            "lastModifiedByReplicaId": "replica-1",
            "lastOperationId": "operation-1",
            "updatedAt": "2026-04-24T10:00:00.000Z",
            """
        )
    }

    private func cardSyncPayloadJSON(cardTypeLine: String?, metadataLine: String?) -> String {
        self.cardPayloadJSON(
            workspaceLine: nil,
            cardTypeLine: cardTypeLine,
            metadataLine: metadataLine,
            lwwLines: ""
        )
    }

    private func cardModelJSON(cardTypeLine: String?, metadataLine: String?) -> String {
        self.cardPayloadJSON(
            workspaceLine: #""workspaceId": "workspace-1","#,
            cardTypeLine: cardTypeLine,
            metadataLine: metadataLine,
            lwwLines: """
            "clientUpdatedAt": "2026-04-24T10:00:00.000Z",
            "lastModifiedByReplicaId": "replica-1",
            "lastOperationId": "operation-1",
            "updatedAt": "2026-04-24T10:00:00.000Z",
            """
        )
    }

    private func cardPayloadJSON(
        workspaceLine: String?,
        cardTypeLine: String?,
        metadataLine: String?,
        lwwLines: String
    ) -> String {
        [
            "{",
            #""cardId": "card-1","#,
            workspaceLine,
            #""frontText": "Front","#,
            #""backText": "Back","#,
            cardTypeLine,
            metadataLine,
            #""tags": [],"#,
            #""effortLevel": "medium","#,
            #""dueAt": null,"#,
            #""createdAt": "2026-04-24T10:00:00.000Z","#,
            #""reps": 0,"#,
            #""lapses": 0,"#,
            #""fsrsCardState": "new","#,
            #""fsrsStepIndex": null,"#,
            #""fsrsStability": null,"#,
            #""fsrsDifficulty": null,"#,
            #""fsrsLastReviewedAt": null,"#,
            #""fsrsScheduledDays": null,"#,
            lwwLines,
            #""deletedAt": null"#,
            "}"
        ]
            .compactMap { line in
                line
            }
            .filter { line in
                line.isEmpty == false
            }
            .joined(separator: "\n")
    }

    private func makeCard(cardId: String, dueAt: String?) -> Card {
        Card(
            cardId: cardId,
            workspaceId: "workspace-1",
            frontText: "Front",
            backText: "Back",
            tags: ["tag-1"],
            dueAt: dueAt,
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
    }
}
