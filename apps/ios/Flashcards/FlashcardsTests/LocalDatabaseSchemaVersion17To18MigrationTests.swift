import Foundation
import SQLite3
import XCTest
@testable import Flashcards

final class LocalDatabaseSchemaVersion17To18MigrationTests: LocalDatabaseTestCase {
    func testSchemaVersion17MigrationAddsNullableReviewEventTimezone() throws {
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
        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-18T12:00:00.000Z",
                reviewedTimeZone: "Europe/Madrid"
            )
        )
        try database.close()
        self.database = nil

        try self.prepareSchemaVersion17Database(databaseURL: try XCTUnwrap(self.databaseURL))

        let migratedDatabase = try LocalDatabase(databaseURL: try XCTUnwrap(self.databaseURL))
        self.database = migratedDatabase
        let reviewEvents = try migratedDatabase.loadReviewEvents(workspaceId: workspace.workspaceId)

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: migratedDatabase))
        XCTAssertTrue(
            try self.hasColumn(
                database: migratedDatabase,
                tableName: "review_events",
                columnName: "reviewed_time_zone"
            )
        )
        XCTAssertEqual(1, reviewEvents.count)
        XCTAssertNil(reviewEvents.first?.reviewedTimeZone)
    }

    private func prepareSchemaVersion17Database(databaseURL: URL) throws {
        var connection: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &connection,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let connection else {
            throw LocalStoreError.database("Failed to open schema v17 test database")
        }
        defer {
            sqlite3_close_v2(connection)
        }

        let downgradeSQL = """
        PRAGMA legacy_alter_table = ON;
        DROP INDEX IF EXISTS idx_review_events_workspace_card_time;
        DROP INDEX IF EXISTS idx_review_events_reviewed_at_client;
        ALTER TABLE review_events RENAME TO review_events_v18;
        CREATE TABLE review_events (
            review_event_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
            replica_id TEXT NOT NULL,
            client_event_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 3),
            reviewed_at_client TEXT NOT NULL,
            reviewed_at_server TEXT NOT NULL,
            UNIQUE (workspace_id, replica_id, client_event_id)
        );
        INSERT INTO review_events (
            review_event_id,
            workspace_id,
            card_id,
            replica_id,
            client_event_id,
            rating,
            reviewed_at_client,
            reviewed_at_server
        )
        SELECT
            review_event_id,
            workspace_id,
            card_id,
            replica_id,
            client_event_id,
            rating,
            reviewed_at_client,
            reviewed_at_server
        FROM review_events_v18;
        DROP TABLE review_events_v18;
        CREATE INDEX IF NOT EXISTS idx_review_events_workspace_card_time
            ON review_events(workspace_id, card_id, reviewed_at_server DESC);
        CREATE INDEX IF NOT EXISTS idx_review_events_reviewed_at_client
            ON review_events(reviewed_at_client);
        DELETE FROM outbox;
        PRAGMA legacy_alter_table = OFF;
        PRAGMA user_version = 17;
        """

        let execResult = sqlite3_exec(connection, downgradeSQL, nil, nil, nil)
        guard execResult == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            throw LocalStoreError.database("Failed to prepare schema v17 fixture: \(message)")
        }
    }
}
