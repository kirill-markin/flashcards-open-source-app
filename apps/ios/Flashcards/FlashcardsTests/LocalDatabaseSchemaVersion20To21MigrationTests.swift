import Foundation
import SQLite3
import XCTest
@testable import Flashcards

final class LocalDatabaseSchemaVersion20To21MigrationTests: LocalDatabaseTestCase {
    func testSchemaVersion20MigrationBackfillsCardTypeAndMetadata() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let card = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: []
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        try database.close()
        self.database = nil

        try self.prepareSchemaVersion20Database(databaseURL: try XCTUnwrap(self.databaseURL))

        let migratedDatabase = try LocalDatabase(databaseURL: try XCTUnwrap(self.databaseURL))
        self.database = migratedDatabase
        let migratedCard = try migratedDatabase.cardStore.loadCard(
            workspaceId: workspace.workspaceId,
            cardId: card.cardId
        )
        let rawCard = try self.loadRawCardTypeAndMetadata(database: migratedDatabase, cardId: card.cardId)
        let metadataObject = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(rawCard.metadataJson.utf8)) as? [String: Any]
        )
        let sourceObject = try XCTUnwrap(metadataObject["source"] as? [String: Any])

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: migratedDatabase))
        XCTAssertEqual(rawCard.cardType, basicCardType)
        XCTAssertEqual(migratedCard.cardType, basicCardType)
        XCTAssertEqual(metadataObject["version"] as? Int, 1)
        XCTAssertEqual(sourceObject["createdAt"] as? String, card.createdAt)
        XCTAssertTrue(sourceObject["label"] is NSNull)
        XCTAssertTrue(sourceObject["author"] is NSNull)
        XCTAssertTrue(sourceObject["comment"] is NSNull)
        XCTAssertTrue(sourceObject["importedAt"] is NSNull)
        XCTAssertTrue(sourceObject["importId"] is NSNull)
        XCTAssertEqual(migratedCard.metadata, makeDefaultCardMetadata(createdAt: card.createdAt))
    }

    private func prepareSchemaVersion20Database(databaseURL: URL) throws {
        var connection: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &connection,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let connection else {
            throw LocalStoreError.database("Failed to open schema v20 test database")
        }
        defer {
            sqlite3_close_v2(connection)
        }

        let downgradeSQL = """
        ALTER TABLE cards DROP COLUMN metadata_json;
        ALTER TABLE cards DROP COLUMN card_type;
        PRAGMA user_version = 20;
        """

        let execResult = sqlite3_exec(connection, downgradeSQL, nil, nil, nil)
        guard execResult == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            throw LocalStoreError.database("Failed to prepare schema v20 fixture: \(message)")
        }
    }

    private func loadRawCardTypeAndMetadata(
        database: LocalDatabase,
        cardId: String
    ) throws -> (cardType: String, metadataJson: String) {
        let rows = try database.core.query(
            sql: """
            SELECT card_type, metadata_json
            FROM cards
            WHERE card_id = ?
            LIMIT 1
            """,
            values: [
                .text(cardId)
            ]
        ) { statement in
            (
                cardType: DatabaseCore.columnText(statement: statement, index: 0),
                metadataJson: DatabaseCore.columnText(statement: statement, index: 1)
            )
        }

        return try XCTUnwrap(rows.first)
    }
}
