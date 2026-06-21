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

    func testSchemaVersion18MigrationMovesLegacyEffortIntoTagsAndDropsColumn() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let card = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["existing"]
            ),
            cardId: nil
        )
        let deck = try database.createDeck(
            workspaceId: workspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(tags: ["topic"])
            )
        )
        try database.close()
        self.database = nil

        try self.prepareSchemaVersion18DatabaseWithLegacyEffort(
            databaseURL: try XCTUnwrap(self.databaseURL),
            cardId: card.cardId,
            deckId: deck.deckId
        )

        let migratedDatabase = try LocalDatabase(databaseURL: try XCTUnwrap(self.databaseURL))
        self.database = migratedDatabase
        let migratedCard = try migratedDatabase.cardStore.loadCard(
            workspaceId: workspace.workspaceId,
            cardId: card.cardId
        )
        let migratedDeck = try migratedDatabase.deckStore.loadDeck(
            workspaceId: workspace.workspaceId,
            deckId: deck.deckId
        )
        let storedTags = try migratedDatabase.core.query(
            sql: """
            SELECT tag
            FROM card_tags
            WHERE workspace_id = ? AND card_id = ?
            ORDER BY tag ASC
            """,
            values: [
                .text(workspace.workspaceId),
                .text(card.cardId)
            ]
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 0)
        }

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: migratedDatabase))
        XCTAssertFalse(try self.hasColumn(database: migratedDatabase, tableName: "cards", columnName: "effort_level"))
        XCTAssertFalse(
            try self.hasIndex(
                database: migratedDatabase,
                tableName: "cards",
                indexName: "idx_cards_workspace_effort_created_active"
            )
        )
        XCTAssertEqual(migratedCard.tags, ["existing", "medium"])
        XCTAssertEqual(storedTags, ["existing", "medium"])
        XCTAssertEqual(migratedDeck.filterDefinition, DeckFilterDefinition(version: 2, tags: ["topic", "long"]))
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

    private func prepareSchemaVersion18DatabaseWithLegacyEffort(
        databaseURL: URL,
        cardId: String,
        deckId: String
    ) throws {
        var connection: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &connection,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openResult == SQLITE_OK, let connection else {
            throw LocalStoreError.database("Failed to open schema v18 test database")
        }
        defer {
            sqlite3_close_v2(connection)
        }

        let legacyDeckFilterJSON = #"{"version":2,"effortLevels":["long"],"tags":["topic"]}"#
        let downgradeSQL = """
        ALTER TABLE cards
        ADD COLUMN effort_level TEXT NOT NULL DEFAULT 'fast' CHECK (effort_level IN ('fast', 'medium', 'long'));
        UPDATE cards
        SET effort_level = 'medium'
        WHERE card_id = '\(cardId)';
        CREATE INDEX IF NOT EXISTS idx_cards_workspace_effort_created_active
            ON cards(workspace_id, effort_level, created_at DESC, card_id ASC)
            WHERE deleted_at IS NULL;
        UPDATE decks
        SET filter_definition_json = '\(legacyDeckFilterJSON)'
        WHERE deck_id = '\(deckId)';
        PRAGMA user_version = 18;
        """

        let execResult = sqlite3_exec(connection, downgradeSQL, nil, nil, nil)
        guard execResult == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            throw LocalStoreError.database("Failed to prepare schema v18 fixture: \(message)")
        }
    }
}
