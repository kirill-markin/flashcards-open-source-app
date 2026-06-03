import Foundation
import SQLite3
import XCTest
@testable import Flashcards

final class LocalDatabaseUnsupportedSchemaMigrationTests: LocalDatabaseTestCase {
    func testLegacyPreFullFsrsSchemaFailsWithExplicitUnsupportedUpgradeError() throws {
        let databaseURL = try self.makeDatabaseURL()
        try self.createPreFullFsrsSchema(databaseURL: databaseURL)

        XCTAssertThrowsError(try LocalDatabase(databaseURL: databaseURL)) { error in
            XCTAssertEqual(
                Flashcards.errorMessage(error: error),
                "Legacy local schema upgrade is unsupported (pre-full-fsrs schema). Delete the local database and relaunch the app."
            )
        }
    }

    private func createPreFullFsrsSchema(databaseURL: URL) throws {
        var connection: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &connection,
            SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let connection else {
            throw LocalStoreError.database("Failed to open legacy schema test database")
        }
        defer {
            sqlite3_close_v2(connection)
        }

        let legacySQL = """
        CREATE TABLE workspaces (
            workspace_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE cards (
            card_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            front_text TEXT NOT NULL,
            back_text TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            effort_level TEXT NOT NULL,
            due_at TEXT,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE workspace_scheduler_settings (
            workspace_id TEXT PRIMARY KEY,
            algorithm TEXT NOT NULL
        );

        INSERT INTO workspaces (workspace_id, name, created_at)
        VALUES ('legacy-workspace', 'Legacy', '2026-04-01T00:00:00.000Z');

        INSERT INTO cards (
            card_id,
            workspace_id,
            front_text,
            back_text,
            tags_json,
            effort_level,
            due_at,
            updated_at,
            deleted_at
        )
        VALUES (
            'legacy-card',
            'legacy-workspace',
            'Question',
            'Answer',
            '[]',
            'medium',
            NULL,
            '2026-04-01T00:00:00.000Z',
            NULL
        );

        PRAGMA user_version = 0;
        """

        let execResult = sqlite3_exec(connection, legacySQL, nil, nil, nil)
        guard execResult == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            throw LocalStoreError.database("Failed to create legacy schema fixture: \(message)")
        }
    }
}

