import Foundation
import SQLite3
import XCTest
@testable import Flashcards

final class LocalDatabaseLifecycleTests: XCTestCase {
    private var databaseURL: URL?
    private var database: LocalDatabase?

    override func tearDownWithError() throws {
        if let database {
            try database.close()
        }
        if let databaseURL {
            try? FileManager.default.removeItem(at: databaseURL)
        }
        self.database = nil
        self.databaseURL = nil
        try super.tearDownWithError()
    }

    func testFreshInitializationCreatesDefaultBootstrapState() throws {
        let database = try self.makeDatabase()

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: database))
        XCTAssertTrue(
            try self.hasIndex(
                database: database,
                tableName: "review_events",
                indexName: "idx_review_events_reviewed_at_client"
            )
        )
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "app_local_settings"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "workspaces"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "user_settings"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "sync_state"))

        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let userSettings = try database.workspaceSettingsStore.loadUserSettings()

        XCTAssertEqual(.disconnected, cloudSettings.cloudState)
        XCTAssertEqual(Optional(workspace.workspaceId), cloudSettings.activeWorkspaceId)
        XCTAssertEqual(workspace.workspaceId, userSettings.workspaceId)
        XCTAssertEqual(
            1,
            try database.core.scalarInt(
                sql: "SELECT COUNT(*) FROM sync_state WHERE workspace_id = ?",
                values: [.text(workspace.workspaceId)]
            )
        )
    }

    func testAppWideReviewEventUsesDayExistenceSemantics() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let card = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let reviewTime = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-19T12:00:00.000Z"))
        let dayStart = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-19T00:00:00.000Z"))
        let nextDayStart = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-20T00:00:00.000Z"))
        let followingDayStart = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-21T00:00:00.000Z"))

        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: formatIsoTimestamp(date: reviewTime)
            )
        )

        XCTAssertTrue(try database.hasAppWideReviewEvent(start: dayStart, end: nextDayStart))
        XCTAssertFalse(try database.hasAppWideReviewEvent(start: nextDayStart, end: followingDayStart))
    }

    func testResetForAccountDeletionRecreatesDisconnectedDefaultState() throws {
        let database = try self.makeDatabase()
        let originalWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        _ = try database.saveCard(
            workspaceId: originalWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        try database.updateCloudSettings(
            cloudState: .linked,
            linkedUserId: "user-1",
            linkedWorkspaceId: originalWorkspace.workspaceId,
            activeWorkspaceId: originalWorkspace.workspaceId,
            linkedEmail: "user@example.com"
        )

        try database.resetForAccountDeletion()

        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let userSettings = try database.workspaceSettingsStore.loadUserSettings()

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: database))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "app_local_settings"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "workspaces"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "user_settings"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "sync_state"))
        XCTAssertEqual(0, try self.countRows(database: database, tableName: "cards"))
        XCTAssertEqual(.disconnected, cloudSettings.cloudState)
        XCTAssertNil(cloudSettings.linkedUserId)
        XCTAssertNil(cloudSettings.linkedWorkspaceId)
        XCTAssertEqual(Optional(workspace.workspaceId), cloudSettings.activeWorkspaceId)
        XCTAssertEqual(workspace.workspaceId, userSettings.workspaceId)
    }

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

    func testSchemaVersion11MigrationAddsReviewEventClientTimeIndex() throws {
        let database = try self.makeDatabase()
        try database.close()
        self.database = nil

        try self.prepareSchemaVersion11Database(databaseURL: try XCTUnwrap(self.databaseURL))

        let migratedDatabase = try LocalDatabase(databaseURL: try XCTUnwrap(self.databaseURL))
        self.database = migratedDatabase

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: migratedDatabase))
        XCTAssertTrue(
            try self.hasIndex(
                database: migratedDatabase,
                tableName: "review_events",
                indexName: "idx_review_events_reviewed_at_client"
            )
        )
    }

    private func makeDatabase() throws -> LocalDatabase {
        let databaseURL = try self.makeDatabaseURL()
        let database = try LocalDatabase(databaseURL: databaseURL)
        self.databaseURL = databaseURL
        self.database = database
        return database
    }

    private func makeDatabaseURL() throws -> URL {
        let databaseDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(
            at: databaseDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
        return databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
    }

    private func loadSchemaVersion(database: LocalDatabase) throws -> Int {
        let rows = try database.core.query(
            sql: "PRAGMA user_version",
            values: []
        ) { statement in
            Int(DatabaseCore.columnInt64(statement: statement, index: 0))
        }

        return try XCTUnwrap(rows.first)
    }

    private func countRows(database: LocalDatabase, tableName: String) throws -> Int {
        try database.core.scalarInt(
            sql: "SELECT COUNT(*) FROM \(tableName)",
            values: []
        )
    }

    private func hasIndex(database: LocalDatabase, tableName: String, indexName: String) throws -> Bool {
        let indexNames = try database.core.query(
            sql: "PRAGMA index_list(\(self.singleQuotedSQLIdentifier(identifier: tableName)))",
            values: []
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 1)
        }

        return indexNames.contains(indexName)
    }

    private func prepareSchemaVersion11Database(databaseURL: URL) throws {
        var connection: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &connection,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let connection else {
            throw LocalStoreError.database("Failed to open schema v11 test database")
        }
        defer {
            sqlite3_close_v2(connection)
        }

        let downgradeSQL = """
        DROP INDEX IF EXISTS idx_review_events_reviewed_at_client;
        PRAGMA user_version = 11;
        """

        let execResult = sqlite3_exec(connection, downgradeSQL, nil, nil, nil)
        guard execResult == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            throw LocalStoreError.database("Failed to prepare schema v11 fixture: \(message)")
        }
    }

    private func singleQuotedSQLIdentifier(identifier: String) -> String {
        "'\(identifier.replacingOccurrences(of: "'", with: "''"))'"
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
