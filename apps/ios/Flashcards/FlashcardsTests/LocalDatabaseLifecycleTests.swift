import Foundation
import SQLite3
import XCTest
@testable import Flashcards

private struct DueAtMillisMigrationTestRow {
    let cardId: String
    let dueAtMillis: Int64?
}

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
        XCTAssertTrue(try self.hasColumn(database: database, tableName: "cards", columnName: "due_at_millis"))
        XCTAssertTrue(try self.hasColumn(database: database, tableName: "outbox", columnName: "review_schedule_impact"))
        XCTAssertTrue(
            try self.hasIndex(
                database: database,
                tableName: "cards",
                indexName: "idx_cards_workspace_due_millis_active"
            )
        )
        XCTAssertTrue(
            try self.hasIndex(
                database: database,
                tableName: "cards",
                indexName: "idx_cards_workspace_new_due_active"
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

    func testSchemaVersion12MigrationBackfillsStrictDueAtMillis() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        try self.insertMigrationCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "canonical-valid",
            dueAt: "2026-03-09T08:59:00.000Z",
            createdAt: "2026-03-09T08:00:00.000Z"
        )
        try self.insertMigrationCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "noncanonical-valid",
            dueAt: "2026-03-09T07:30:00Z",
            createdAt: "2026-03-09T07:00:00.000Z"
        )
        try self.insertMigrationCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "invalid-calendar-day",
            dueAt: "2026-02-31T08:59:00.000Z",
            createdAt: "2026-03-09T10:00:00.000Z"
        )
        try self.insertMigrationCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-number",
            dueAt: "1000",
            createdAt: "2026-03-09T11:00:00.000Z"
        )
        try self.insertMigrationCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "new-card",
            dueAt: nil,
            createdAt: "2026-03-09T12:00:00.000Z"
        )
        try database.close()
        self.database = nil

        try self.prepareSchemaVersion12Database(databaseURL: try XCTUnwrap(self.databaseURL))

        let migratedDatabase = try LocalDatabase(databaseURL: try XCTUnwrap(self.databaseURL))
        self.database = migratedDatabase
        let now = try XCTUnwrap(parseStrictIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let rows = try self.loadDueAtMillisRows(database: migratedDatabase)
        let rowsByCardId = Dictionary(uniqueKeysWithValues: rows.map { row in
            (row.cardId, row.dueAtMillis)
        })
        let canonicalMillis = try XCTUnwrap(rowsByCardId["canonical-valid"] ?? nil)
        let noncanonicalMillis = try XCTUnwrap(rowsByCardId["noncanonical-valid"] ?? nil)
        let reviewHead = try migratedDatabase.loadReviewHead(
            workspaceId: workspace.workspaceId,
            resolvedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards,
            now: now,
            limit: 10
        )
        let reviewCounts = try migratedDatabase.loadReviewCounts(
            workspaceId: workspace.workspaceId,
            reviewQueryDefinition: .allCards,
            now: now
        )

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: migratedDatabase))
        XCTAssertTrue(try self.hasColumn(database: migratedDatabase, tableName: "cards", columnName: "due_at_millis"))
        XCTAssertEqual(
            canonicalMillis,
            try XCTUnwrap(parseStrictIsoTimestampEpochMillis(value: "2026-03-09T08:59:00.000Z"))
        )
        XCTAssertEqual(
            noncanonicalMillis,
            try XCTUnwrap(parseStrictIsoTimestampEpochMillis(value: "2026-03-09T07:30:00Z"))
        )
        XCTAssertNil(rowsByCardId["invalid-calendar-day"] ?? nil)
        XCTAssertNil(rowsByCardId["malformed-number"] ?? nil)
        XCTAssertNil(rowsByCardId["new-card"] ?? nil)
        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["canonical-valid", "noncanonical-valid", "new-card"])
        XCTAssertEqual(reviewCounts, ReviewCounts(dueCount: 3, totalCount: 5))
    }

    func testSchemaVersion13MigrationBackfillsExistingOutboxScheduleImpact() throws {
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
        _ = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [.medium], tags: [])
            )
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: workspace.workspaceId,
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 365,
            enableFuzz: true
        )
        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-18T12:00:00.000Z"
            )
        )
        try database.close()
        self.database = nil

        try self.prepareSchemaVersion13Database(databaseURL: try XCTUnwrap(self.databaseURL))

        let migratedDatabase = try LocalDatabase(databaseURL: try XCTUnwrap(self.databaseURL))
        self.database = migratedDatabase

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: migratedDatabase))
        XCTAssertTrue(
            try self.hasColumn(
                database: migratedDatabase,
                tableName: "outbox",
                columnName: "review_schedule_impact"
            )
        )
        XCTAssertEqual(
            1,
            try migratedDatabase.core.scalarInt(
                sql: """
                SELECT MIN(review_schedule_impact)
                FROM outbox
                WHERE workspace_id = ? AND entity_type = 'card'
                """,
                values: [.text(workspace.workspaceId)]
            )
        )
        XCTAssertEqual(
            0,
            try migratedDatabase.core.scalarInt(
                sql: """
                SELECT COALESCE(SUM(review_schedule_impact), 0)
                FROM outbox
                WHERE workspace_id = ? AND entity_type IN ('deck', 'workspace_scheduler_settings', 'review_event')
                """,
                values: [.text(workspace.workspaceId)]
            )
        )
    }

    func testSchemaVersion14MigrationBackfillsExistingOutboxIsInitialCreate() throws {
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
        _ = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [.medium], tags: [])
            )
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: workspace.workspaceId,
            desiredRetention: 0.9,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 365,
            enableFuzz: true
        )
        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-18T12:00:00.000Z"
            )
        )
        try database.close()
        self.database = nil

        try self.prepareSchemaVersion14Database(databaseURL: try XCTUnwrap(self.databaseURL))

        let migratedDatabase = try LocalDatabase(databaseURL: try XCTUnwrap(self.databaseURL))
        self.database = migratedDatabase

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: migratedDatabase))
        XCTAssertTrue(
            try self.hasColumn(
                database: migratedDatabase,
                tableName: "outbox",
                columnName: "is_initial_create"
            )
        )
        // The fresh-create card upsert (cards.created_at == client_updated_at)
        // is backfilled to is_initial_create = 1.
        XCTAssertEqual(
            1,
            try migratedDatabase.core.scalarInt(
                sql: """
                SELECT is_initial_create
                FROM outbox
                WHERE workspace_id = ?
                    AND entity_id = ?
                    AND entity_type = 'card'
                    AND operation_type = 'upsert'
                    AND client_updated_at != '2026-04-18T12:00:00.000Z'
                """,
                values: [.text(workspace.workspaceId), .text(card.cardId)]
            )
        )
        // The review-driven card upsert (different client_updated_at) stays at 0.
        XCTAssertEqual(
            0,
            try migratedDatabase.core.scalarInt(
                sql: """
                SELECT is_initial_create
                FROM outbox
                WHERE workspace_id = ?
                    AND entity_id = ?
                    AND entity_type = 'card'
                    AND operation_type = 'upsert'
                    AND client_updated_at = '2026-04-18T12:00:00.000Z'
                """,
                values: [.text(workspace.workspaceId), .text(card.cardId)]
            )
        )
        // Non-card entity types are never initial creates.
        XCTAssertEqual(
            0,
            try migratedDatabase.core.scalarInt(
                sql: """
                SELECT COALESCE(SUM(is_initial_create), 0)
                FROM outbox
                WHERE workspace_id = ?
                    AND entity_type IN ('deck', 'workspace_scheduler_settings', 'review_event')
                """,
                values: [.text(workspace.workspaceId)]
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

    private func hasColumn(database: LocalDatabase, tableName: String, columnName: String) throws -> Bool {
        try database.core.columnExists(tableName: tableName, columnName: columnName)
    }

    private func loadDueAtMillisRows(database: LocalDatabase) throws -> [DueAtMillisMigrationTestRow] {
        try database.core.query(
            sql: """
            SELECT card_id, due_at_millis
            FROM cards
            ORDER BY card_id ASC
            """,
            values: []
        ) { statement in
            let dueAtMillis: Int64?
            if sqlite3_column_type(statement, 1) == SQLITE_NULL {
                dueAtMillis = nil
            } else {
                dueAtMillis = DatabaseCore.columnInt64(statement: statement, index: 1)
            }
            return DueAtMillisMigrationTestRow(
                cardId: DatabaseCore.columnText(statement: statement, index: 0),
                dueAtMillis: dueAtMillis
            )
        }
    }

    private func insertMigrationCard(
        database: LocalDatabase,
        workspaceId: String,
        cardId: String,
        dueAt: String?,
        createdAt: String
    ) throws {
        try database.core.execute(
            sql: """
            INSERT INTO cards (
                card_id,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                due_at_millis,
                created_at,
                reps,
                lapses,
                fsrs_card_state,
                fsrs_step_index,
                fsrs_stability,
                fsrs_difficulty,
                fsrs_last_reviewed_at,
                fsrs_scheduled_days,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            )
            VALUES (?, ?, ?, ?, '[]', 'fast', ?, ?, ?, 0, 0, 'new', NULL, NULL, NULL, NULL, NULL, ?, 'test-replica', ?, ?, NULL)
            """,
            values: [
                .text(cardId),
                .text(workspaceId),
                .text("Front \(cardId)"),
                .text("Back \(cardId)"),
                dueAt.map(SQLiteValue.text) ?? .null,
                dueAt.flatMap(parseStrictIsoTimestampEpochMillis).map(SQLiteValue.integer) ?? .null,
                .text(createdAt),
                .text(createdAt),
                .text("operation-\(cardId)"),
                .text(createdAt)
            ]
        )
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

    private func prepareSchemaVersion12Database(databaseURL: URL) throws {
        var connection: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &connection,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let connection else {
            throw LocalStoreError.database("Failed to open schema v12 test database")
        }
        defer {
            sqlite3_close_v2(connection)
        }

        let downgradeSQL = """
        PRAGMA legacy_alter_table = ON;
        DROP INDEX IF EXISTS idx_cards_workspace_due_millis_active;
        DROP INDEX IF EXISTS idx_cards_workspace_new_due_active;
        ALTER TABLE cards RENAME TO cards_v13;
        CREATE TABLE cards (
            card_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            front_text TEXT NOT NULL,
            back_text TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            effort_level TEXT NOT NULL CHECK (effort_level IN ('fast', 'medium', 'long')),
            due_at TEXT,
            created_at TEXT NOT NULL,
            reps INTEGER NOT NULL CHECK (reps >= 0),
            lapses INTEGER NOT NULL CHECK (lapses >= 0),
            fsrs_card_state TEXT NOT NULL CHECK (fsrs_card_state IN ('new', 'learning', 'review', 'relearning')),
            fsrs_step_index INTEGER CHECK (fsrs_step_index IS NULL OR fsrs_step_index >= 0),
            fsrs_stability REAL,
            fsrs_difficulty REAL,
            fsrs_last_reviewed_at TEXT,
            fsrs_scheduled_days INTEGER CHECK (fsrs_scheduled_days IS NULL OR fsrs_scheduled_days >= 0),
            client_updated_at TEXT NOT NULL,
            last_modified_by_replica_id TEXT NOT NULL,
            last_operation_id TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        INSERT INTO cards (
            card_id,
            workspace_id,
            front_text,
            back_text,
            tags_json,
            effort_level,
            due_at,
            created_at,
            reps,
            lapses,
            fsrs_card_state,
            fsrs_step_index,
            fsrs_stability,
            fsrs_difficulty,
            fsrs_last_reviewed_at,
            fsrs_scheduled_days,
            client_updated_at,
            last_modified_by_replica_id,
            last_operation_id,
            updated_at,
            deleted_at
        )
        SELECT
            card_id,
            workspace_id,
            front_text,
            back_text,
            tags_json,
            effort_level,
            due_at,
            created_at,
            reps,
            lapses,
            fsrs_card_state,
            fsrs_step_index,
            fsrs_stability,
            fsrs_difficulty,
            fsrs_last_reviewed_at,
            fsrs_scheduled_days,
            client_updated_at,
            last_modified_by_replica_id,
            last_operation_id,
            updated_at,
            deleted_at
        FROM cards_v13;
        DROP TABLE cards_v13;
        CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_active
            ON cards(workspace_id, due_at)
            WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_created_active
            ON cards(workspace_id, due_at, created_at DESC, card_id ASC)
            WHERE deleted_at IS NULL;
        PRAGMA legacy_alter_table = OFF;
        PRAGMA user_version = 12;
        """

        let execResult = sqlite3_exec(connection, downgradeSQL, nil, nil, nil)
        guard execResult == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            throw LocalStoreError.database("Failed to prepare schema v12 fixture: \(message)")
        }
    }

    private func prepareSchemaVersion13Database(databaseURL: URL) throws {
        var connection: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &connection,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let connection else {
            throw LocalStoreError.database("Failed to open schema v13 test database")
        }
        defer {
            sqlite3_close_v2(connection)
        }

        let downgradeSQL = """
        PRAGMA legacy_alter_table = ON;
        DROP INDEX IF EXISTS idx_outbox_workspace_created_at;
        ALTER TABLE outbox RENAME TO outbox_v14;
        CREATE TABLE outbox (
            operation_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            installation_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            operation_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            client_updated_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
        );
        INSERT INTO outbox (
            operation_id,
            workspace_id,
            installation_id,
            entity_type,
            entity_id,
            operation_type,
            payload_json,
            client_updated_at,
            created_at,
            attempt_count,
            last_error
        )
        SELECT
            operation_id,
            workspace_id,
            installation_id,
            entity_type,
            entity_id,
            operation_type,
            payload_json,
            client_updated_at,
            created_at,
            attempt_count,
            last_error
        FROM outbox_v14;
        DROP TABLE outbox_v14;
        CREATE INDEX IF NOT EXISTS idx_outbox_workspace_created_at
            ON outbox(workspace_id, created_at ASC);
        PRAGMA legacy_alter_table = OFF;
        PRAGMA user_version = 13;
        """

        let execResult = sqlite3_exec(connection, downgradeSQL, nil, nil, nil)
        guard execResult == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            throw LocalStoreError.database("Failed to prepare schema v13 fixture: \(message)")
        }
    }

    private func prepareSchemaVersion14Database(databaseURL: URL) throws {
        var connection: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &connection,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let connection else {
            throw LocalStoreError.database("Failed to open schema v14 test database")
        }
        defer {
            sqlite3_close_v2(connection)
        }

        // Recreate the outbox table with the v14 column set (review_schedule_impact
        // present, is_initial_create absent) so the v14→v15 migration runs against
        // an authentic pre-migration shape.
        let downgradeSQL = """
        PRAGMA legacy_alter_table = ON;
        DROP INDEX IF EXISTS idx_outbox_workspace_created_at;
        ALTER TABLE outbox RENAME TO outbox_v15;
        CREATE TABLE outbox (
            operation_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            installation_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            operation_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            client_updated_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            review_schedule_impact INTEGER NOT NULL DEFAULT 1 CHECK (review_schedule_impact IN (0, 1)),
            last_error TEXT
        );
        INSERT INTO outbox (
            operation_id,
            workspace_id,
            installation_id,
            entity_type,
            entity_id,
            operation_type,
            payload_json,
            client_updated_at,
            created_at,
            attempt_count,
            review_schedule_impact,
            last_error
        )
        SELECT
            operation_id,
            workspace_id,
            installation_id,
            entity_type,
            entity_id,
            operation_type,
            payload_json,
            client_updated_at,
            created_at,
            attempt_count,
            review_schedule_impact,
            last_error
        FROM outbox_v15;
        DROP TABLE outbox_v15;
        CREATE INDEX IF NOT EXISTS idx_outbox_workspace_created_at
            ON outbox(workspace_id, created_at ASC);
        PRAGMA legacy_alter_table = OFF;
        PRAGMA user_version = 14;
        """

        let execResult = sqlite3_exec(connection, downgradeSQL, nil, nil, nil)
        guard execResult == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            throw LocalStoreError.database("Failed to prepare schema v14 fixture: \(message)")
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
