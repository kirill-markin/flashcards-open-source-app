import Foundation
import SQLite3
import XCTest
@testable import Flashcards

final class LocalDatabaseSchemaVersion14To15MigrationTests: LocalDatabaseTestCase {
    func testSchemaVersion14MigrationBackfillsExistingOutboxIsInitialCreate() throws {
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
        // is backfilled to is_initial_create = 1. MIN catches a regression where
        // the WHERE clause unexpectedly matches multiple rows of mixed values.
        XCTAssertEqual(
            1,
            try migratedDatabase.core.scalarInt(
                sql: """
                SELECT MIN(is_initial_create)
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
                SELECT COALESCE(SUM(is_initial_create), 0)
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

    func testSchemaVersion15MigrationBackfillsStrictFsrsLastReviewedAtMillis() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        try self.insertMigrationCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "canonical-valid",
            dueAt: nil,
            createdAt: "2026-03-09T08:00:00.000Z"
        )
        try self.setMigrationCardFsrsLastReviewedAt(
            database: database,
            cardId: "canonical-valid",
            fsrsLastReviewedAt: "2026-03-09T08:59:00.000Z"
        )
        try self.insertMigrationCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "noncanonical-valid",
            dueAt: nil,
            createdAt: "2026-03-09T08:30:00.000Z"
        )
        try self.setMigrationCardFsrsLastReviewedAt(
            database: database,
            cardId: "noncanonical-valid",
            fsrsLastReviewedAt: "2026-03-09T09:00:00Z"
        )
        try self.insertMigrationCard(
            database: database,
            workspaceId: workspace.workspaceId,
            cardId: "malformed-number",
            dueAt: nil,
            createdAt: "2026-03-09T09:00:00.000Z"
        )
        try self.setMigrationCardFsrsLastReviewedAt(
            database: database,
            cardId: "malformed-number",
            fsrsLastReviewedAt: "1000"
        )
        try database.close()
        self.database = nil

        try self.prepareSchemaVersion15Database(databaseURL: try XCTUnwrap(self.databaseURL))

        let migratedDatabase = try LocalDatabase(databaseURL: try XCTUnwrap(self.databaseURL))
        self.database = migratedDatabase
        let rows = try self.loadFsrsLastReviewedAtMillisRows(database: migratedDatabase)
        let rowsByCardId = Dictionary(uniqueKeysWithValues: rows.map { row in
            (row.cardId, row.fsrsLastReviewedAtMillis)
        })

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: migratedDatabase))
        XCTAssertTrue(
            try self.hasColumn(
                database: migratedDatabase,
                tableName: "cards",
                columnName: "fsrs_last_reviewed_at_millis"
            )
        )
        XCTAssertTrue(
            try self.hasColumn(
                database: migratedDatabase,
                tableName: "sync_state",
                columnName: "pending_review_history_import"
            )
        )
        XCTAssertTrue(
            try self.hasIndex(
                database: migratedDatabase,
                tableName: "cards",
                indexName: "idx_cards_workspace_fsrs_last_reviewed_millis_due_active"
            )
        )
        XCTAssertEqual(
            0,
            try migratedDatabase.core.scalarInt(
                sql: "SELECT pending_review_history_import FROM sync_state WHERE workspace_id = ?",
                values: [.text(workspace.workspaceId)]
            )
        )
        XCTAssertEqual(
            try XCTUnwrap(rowsByCardId["canonical-valid"] ?? nil),
            try XCTUnwrap(parseStrictIsoTimestampEpochMillis(value: "2026-03-09T08:59:00.000Z"))
        )
        XCTAssertEqual(
            try XCTUnwrap(rowsByCardId["noncanonical-valid"] ?? nil),
            try XCTUnwrap(parseStrictIsoTimestampEpochMillis(value: "2026-03-09T09:00:00Z"))
        )
        XCTAssertNil(rowsByCardId["malformed-number"] ?? nil)
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
        // present, is_initial_create absent) so the v14-to-v15 migration runs against
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

    private func prepareSchemaVersion15Database(databaseURL: URL) throws {
        var connection: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &connection,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let connection else {
            throw LocalStoreError.database("Failed to open schema v15 test database")
        }
        defer {
            sqlite3_close_v2(connection)
        }

        let downgradeSQL = """
        PRAGMA legacy_alter_table = ON;
        DROP INDEX IF EXISTS idx_cards_workspace_fsrs_last_reviewed_millis_due_active;
        ALTER TABLE cards RENAME TO cards_v16;
        CREATE TABLE cards (
            card_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            front_text TEXT NOT NULL,
            back_text TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            effort_level TEXT NOT NULL CHECK (effort_level IN ('fast', 'medium', 'long')),
            due_at TEXT,
            due_at_millis INTEGER,
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
        SELECT
            card_id,
            workspace_id,
            front_text,
            back_text,
            tags_json,
            'fast',
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
        FROM cards_v16;
        DROP TABLE cards_v16;
        CREATE INDEX IF NOT EXISTS idx_cards_workspace_created_at
            ON cards(workspace_id, created_at DESC, card_id ASC);
        CREATE INDEX IF NOT EXISTS idx_cards_workspace_updated_at
            ON cards(workspace_id, updated_at DESC, card_id ASC);
        CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_millis_active
            ON cards(workspace_id, due_at_millis, created_at DESC, card_id ASC)
            WHERE deleted_at IS NULL AND due_at_millis IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_cards_workspace_new_due_active
            ON cards(workspace_id, created_at DESC, card_id ASC)
            WHERE deleted_at IS NULL AND due_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_cards_workspace_effort_created_active
            ON cards(workspace_id, effort_level, created_at DESC, card_id ASC)
            WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_cards_workspace_fsrs_last_reviewed_at
            ON cards(workspace_id, fsrs_last_reviewed_at DESC)
            WHERE deleted_at IS NULL;
        PRAGMA legacy_alter_table = OFF;
        PRAGMA user_version = 15;
        """

        let execResult = sqlite3_exec(connection, downgradeSQL, nil, nil, nil)
        guard execResult == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            throw LocalStoreError.database("Failed to prepare schema v15 fixture: \(message)")
        }
    }
}
