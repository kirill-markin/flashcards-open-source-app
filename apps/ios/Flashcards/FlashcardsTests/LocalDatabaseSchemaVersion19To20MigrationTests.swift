import Foundation
import SQLite3
import XCTest
@testable import Flashcards

final class LocalDatabaseSchemaVersion19To20MigrationTests: LocalDatabaseTestCase {
    func testSchemaVersion19MigrationRebuildsReviewOrderIndexesWithCreatedAtAscending() throws {
        let database = try self.makeDatabase()
        try database.close()
        self.database = nil

        try self.prepareSchemaVersion19Database(databaseURL: try XCTUnwrap(self.databaseURL))

        let migratedDatabase = try LocalDatabase(databaseURL: try XCTUnwrap(self.databaseURL))
        self.database = migratedDatabase

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: migratedDatabase))
        XCTAssertEqual(
            try self.loadIndexColumnOrder(database: migratedDatabase, indexName: "idx_cards_workspace_due_millis_active"),
            [
                SQLiteIndexColumnOrder(name: "workspace_id", isDescending: false),
                SQLiteIndexColumnOrder(name: "due_at_millis", isDescending: false),
                SQLiteIndexColumnOrder(name: "created_at", isDescending: false),
                SQLiteIndexColumnOrder(name: "card_id", isDescending: false)
            ]
        )
        XCTAssertEqual(
            try self.loadIndexColumnOrder(database: migratedDatabase, indexName: "idx_cards_workspace_new_due_active"),
            [
                SQLiteIndexColumnOrder(name: "workspace_id", isDescending: false),
                SQLiteIndexColumnOrder(name: "created_at", isDescending: false),
                SQLiteIndexColumnOrder(name: "card_id", isDescending: false)
            ]
        )
        XCTAssertEqual(
            try self.loadIndexColumnOrder(
                database: migratedDatabase,
                indexName: "idx_cards_workspace_fsrs_last_reviewed_millis_due_active"
            ),
            [
                SQLiteIndexColumnOrder(name: "workspace_id", isDescending: false),
                SQLiteIndexColumnOrder(name: "fsrs_last_reviewed_at_millis", isDescending: false),
                SQLiteIndexColumnOrder(name: "due_at_millis", isDescending: false),
                SQLiteIndexColumnOrder(name: "created_at", isDescending: false),
                SQLiteIndexColumnOrder(name: "card_id", isDescending: false)
            ]
        )
        XCTAssertEqual(
            try self.loadIndexColumnOrder(database: migratedDatabase, indexName: "idx_cards_workspace_created_at"),
            [
                SQLiteIndexColumnOrder(name: "workspace_id", isDescending: false),
                SQLiteIndexColumnOrder(name: "created_at", isDescending: true),
                SQLiteIndexColumnOrder(name: "card_id", isDescending: false)
            ]
        )
    }

    private func prepareSchemaVersion19Database(databaseURL: URL) throws {
        var connection: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &connection,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let connection else {
            throw LocalStoreError.database("Failed to open schema v19 test database")
        }
        defer {
            sqlite3_close_v2(connection)
        }

        let downgradeSQL = """
        DROP INDEX IF EXISTS idx_cards_workspace_due_millis_active;
        DROP INDEX IF EXISTS idx_cards_workspace_new_due_active;
        DROP INDEX IF EXISTS idx_cards_workspace_fsrs_last_reviewed_millis_due_active;
        CREATE INDEX idx_cards_workspace_due_millis_active
            ON cards(workspace_id, due_at_millis, created_at DESC, card_id ASC)
            WHERE deleted_at IS NULL AND due_at_millis IS NOT NULL;
        CREATE INDEX idx_cards_workspace_new_due_active
            ON cards(workspace_id, created_at DESC, card_id ASC)
            WHERE deleted_at IS NULL AND due_at IS NULL;
        CREATE INDEX idx_cards_workspace_fsrs_last_reviewed_millis_due_active
            ON cards(workspace_id, fsrs_last_reviewed_at_millis, due_at_millis, created_at DESC, card_id ASC)
            WHERE deleted_at IS NULL AND due_at_millis IS NOT NULL AND fsrs_last_reviewed_at_millis IS NOT NULL;
        PRAGMA user_version = 19;
        """

        let execResult = sqlite3_exec(connection, downgradeSQL, nil, nil, nil)
        guard execResult == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            throw LocalStoreError.database("Failed to prepare schema v19 fixture: \(message)")
        }
    }
}
