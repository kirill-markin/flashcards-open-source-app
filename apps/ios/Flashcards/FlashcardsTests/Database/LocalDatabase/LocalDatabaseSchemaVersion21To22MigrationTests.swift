import Foundation
import SQLite3
import XCTest
@testable import Flashcards

final class LocalDatabaseSchemaVersion21To22MigrationTests: LocalDatabaseTestCase {
    func testSchemaVersion21MigrationForcesMediaAwareHotBootstrap() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        try database.core.execute(
            sql: """
            UPDATE sync_state
            SET
                last_applied_hot_change_id = 123,
                last_applied_review_sequence_id = 456,
                has_hydrated_hot_state = 1,
                has_hydrated_review_history = 1,
                pending_review_history_import = 1,
                updated_at = '2026-04-24T10:00:00.000Z'
            WHERE workspace_id = ?
            """,
            values: [.text(workspace.workspaceId)]
        )
        try database.close()
        self.database = nil

        try self.prepareSchemaVersion21Database(databaseURL: try XCTUnwrap(self.databaseURL))

        let migratedDatabase = try LocalDatabase(databaseURL: try XCTUnwrap(self.databaseURL))
        self.database = migratedDatabase
        let syncState = try self.loadSyncState(database: migratedDatabase, workspaceId: workspace.workspaceId)

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: migratedDatabase))
        XCTAssertTrue(try self.hasColumn(database: migratedDatabase, tableName: "media_assets", columnName: "media_asset_id"))
        XCTAssertFalse(try self.hasColumn(database: migratedDatabase, tableName: "media_assets", columnName: "storage_key"))
        XCTAssertEqual(syncState.lastAppliedHotChangeId, 0)
        XCTAssertFalse(syncState.hasHydratedHotState)
        XCTAssertEqual(syncState.lastAppliedReviewSequenceId, 456)
        XCTAssertTrue(syncState.hasHydratedReviewHistory)
        XCTAssertTrue(syncState.pendingReviewHistoryImport)
    }

    private func prepareSchemaVersion21Database(databaseURL: URL) throws {
        var connection: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &connection,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let connection else {
            throw LocalStoreError.database("Failed to open schema v21 test database")
        }
        defer {
            sqlite3_close_v2(connection)
        }

        let downgradeSQL = """
        DROP INDEX IF EXISTS idx_media_assets_workspace_updated_at;
        DROP TABLE IF EXISTS media_assets;
        PRAGMA user_version = 21;
        """

        let execResult = sqlite3_exec(connection, downgradeSQL, nil, nil, nil)
        guard execResult == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            throw LocalStoreError.database("Failed to prepare schema v21 fixture: \(message)")
        }
    }

    private func loadSyncState(
        database: LocalDatabase,
        workspaceId: String
    ) throws -> (
        lastAppliedHotChangeId: Int64,
        lastAppliedReviewSequenceId: Int64,
        hasHydratedHotState: Bool,
        hasHydratedReviewHistory: Bool,
        pendingReviewHistoryImport: Bool
    ) {
        let rows = try database.core.query(
            sql: """
            SELECT
                last_applied_hot_change_id,
                last_applied_review_sequence_id,
                has_hydrated_hot_state,
                has_hydrated_review_history,
                pending_review_history_import
            FROM sync_state
            WHERE workspace_id = ?
            LIMIT 1
            """,
            values: [.text(workspaceId)]
        ) { statement in
            (
                lastAppliedHotChangeId: DatabaseCore.columnInt64(statement: statement, index: 0),
                lastAppliedReviewSequenceId: DatabaseCore.columnInt64(statement: statement, index: 1),
                hasHydratedHotState: DatabaseCore.columnInt64(statement: statement, index: 2) != 0,
                hasHydratedReviewHistory: DatabaseCore.columnInt64(statement: statement, index: 3) != 0,
                pendingReviewHistoryImport: DatabaseCore.columnInt64(statement: statement, index: 4) != 0
            )
        }

        return try XCTUnwrap(rows.first)
    }
}
