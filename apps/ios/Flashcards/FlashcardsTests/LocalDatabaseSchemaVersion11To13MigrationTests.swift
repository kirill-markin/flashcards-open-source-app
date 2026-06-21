import Foundation
import SQLite3
import XCTest
@testable import Flashcards

final class LocalDatabaseSchemaVersion11To13MigrationTests: LocalDatabaseTestCase {
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
        XCTAssertEqual(reviewHead.seedReviewQueue.map(\.cardId), ["noncanonical-valid", "canonical-valid", "new-card"])
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
            ),
            cardId: nil
        )
        _ = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(tags: ["medium"])
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
                reviewedAtClient: "2026-04-18T12:00:00.000Z",
                reviewedTimeZone: "UTC"
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
            'fast',
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
}
