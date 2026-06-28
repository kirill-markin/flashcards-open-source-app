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
            includeMediaAssets: true,
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
            includeMediaAssets: true,
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

    func testHotSyncRequestsOptIntoMediaAssets() throws {
        let pullRequest = PullRequest(
            installationId: "installation-1",
            platform: "ios",
            appVersion: "1.0",
            afterHotChangeId: 42,
            limit: 200,
            includeMediaAssets: true
        )
        let bootstrapPullRequest = BootstrapPullRequest(
            mode: "pull",
            installationId: "installation-1",
            platform: "ios",
            appVersion: "1.0",
            cursor: nil,
            limit: 200,
            includeMediaAssets: true
        )

        let pullObject = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(pullRequest)) as? [String: Any]
        )
        let bootstrapPullObject = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(bootstrapPullRequest)) as? [String: Any]
        )

        XCTAssertEqual(pullObject["includeMediaAssets"] as? Bool, true)
        XCTAssertEqual(bootstrapPullObject["includeMediaAssets"] as? Bool, true)
        self.assertExplicitNull(key: "cursor", payload: bootstrapPullObject)
    }

    func testBootstrapPushEncodesMediaAssetMetadataAndExplicitNulls() throws {
        let mediaAsset = self.makeMediaAsset(deletedAt: nil)
        let request = BootstrapPushRequest(
            mode: "push",
            installationId: "installation-1",
            platform: "ios",
            appVersion: "1.0",
            includeMediaAssets: true,
            entries: [
                SyncBootstrapEntryEnvelope(
                    entry: SyncBootstrapEntry(
                        entityType: .mediaAsset,
                        entityId: mediaAsset.mediaAssetId,
                        action: .upsert,
                        payload: .mediaAsset(mediaAsset)
                    )
                )
            ]
        )

        let requestObject = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )
        XCTAssertEqual(requestObject["includeMediaAssets"] as? Bool, true)

        let entries = try XCTUnwrap(requestObject["entries"] as? [[String: Any]])
        let entry = try XCTUnwrap(entries.first)
        XCTAssertEqual(entry["entityType"] as? String, "media_asset")

        let payload = try XCTUnwrap(entry["payload"] as? [String: Any])
        XCTAssertEqual(payload["mediaAssetId"] as? String, mediaAsset.mediaAssetId)
        XCTAssertEqual(payload["workspaceId"] as? String, mediaAsset.workspaceId)
        XCTAssertEqual(payload["mimeType"] as? String, mediaAsset.mimeType)
        XCTAssertEqual(payload["sizeBytes"] as? Int, Int(mediaAsset.sizeBytes))
        XCTAssertEqual(payload["sha256"] as? String, mediaAsset.sha256)
        XCTAssertNil(payload["storageKey"])
        XCTAssertEqual(payload["clientUpdatedAt"] as? String, mediaAsset.clientUpdatedAt)
        XCTAssertEqual(payload["lastOperationId"] as? String, mediaAsset.lastOperationId)
        XCTAssertEqual(payload["updatedAt"] as? String, mediaAsset.updatedAt)
        self.assertExplicitNull(key: "sourceUrl", payload: payload)
        self.assertExplicitNull(key: "deletedAt", payload: payload)
    }

    func testRemoteMediaAssetHotChangeDecodes() throws {
        let json = """
        {
            "changeId": 12,
            "entityType": "media_asset",
            "entityId": "00000000-0000-4000-8000-000000000001",
            "action": "upsert",
            "payload": {
                "mediaAssetId": "00000000-0000-4000-8000-000000000001",
                "workspaceId": "workspace-1",
                "mimeType": "image/png",
                "sizeBytes": 1234,
                "sha256": "sha",
                "sourceUrl": null,
                "createdAt": "2026-04-24T10:00:00.000Z",
                "clientUpdatedAt": "2026-04-24T10:00:01.000Z",
                "lastModifiedByReplicaId": "replica-1",
                "lastOperationId": "operation-media-1",
                "updatedAt": "2026-04-24T10:00:02.000Z",
                "deletedAt": null
            }
        }
        """

        let envelope = try JSONDecoder().decode(RemoteSyncChangeEnvelope.self, from: Data(json.utf8))
        let change = CloudSyncMapper.makeSyncChange(workspaceId: "workspace-1", change: envelope)

        XCTAssertEqual(change.entityType, .mediaAsset)
        guard case .mediaAsset(let mediaAsset) = change.payload else {
            XCTFail("Expected media asset payload")
            return
        }
        XCTAssertEqual(mediaAsset.mediaAssetId, "00000000-0000-4000-8000-000000000001")
        XCTAssertEqual(mediaAsset.mimeType, "image/png")
        XCTAssertEqual(mediaAsset.sizeBytes, 1234)
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

    private func makeMediaAsset(deletedAt: String?) -> MediaAsset {
        MediaAsset(
            mediaAssetId: "00000000-0000-4000-8000-000000000001",
            workspaceId: "workspace-1",
            mimeType: "image/png",
            sizeBytes: 1234,
            sha256: "sha",
            sourceUrl: nil,
            createdAt: "2026-04-24T10:00:00.000Z",
            clientUpdatedAt: "2026-04-24T10:00:01.000Z",
            lastModifiedByReplicaId: "replica-1",
            lastOperationId: "operation-media-1",
            updatedAt: "2026-04-24T10:00:02.000Z",
            deletedAt: deletedAt
        )
    }
}
