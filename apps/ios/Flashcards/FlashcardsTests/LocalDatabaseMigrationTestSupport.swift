import SQLite3
@testable import Flashcards

struct DueAtMillisMigrationTestRow {
    let cardId: String
    let dueAtMillis: Int64?
}

struct FsrsLastReviewedAtMillisMigrationTestRow {
    let cardId: String
    let fsrsLastReviewedAtMillis: Int64?
}

extension LocalDatabaseTestCase {
    func loadDueAtMillisRows(database: LocalDatabase) throws -> [DueAtMillisMigrationTestRow] {
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

    func loadFsrsLastReviewedAtMillisRows(
        database: LocalDatabase
    ) throws -> [FsrsLastReviewedAtMillisMigrationTestRow] {
        try database.core.query(
            sql: """
            SELECT card_id, fsrs_last_reviewed_at_millis
            FROM cards
            ORDER BY card_id ASC
            """,
            values: []
        ) { statement in
            let fsrsLastReviewedAtMillis: Int64?
            if sqlite3_column_type(statement, 1) == SQLITE_NULL {
                fsrsLastReviewedAtMillis = nil
            } else {
                fsrsLastReviewedAtMillis = DatabaseCore.columnInt64(statement: statement, index: 1)
            }
            return FsrsLastReviewedAtMillisMigrationTestRow(
                cardId: DatabaseCore.columnText(statement: statement, index: 0),
                fsrsLastReviewedAtMillis: fsrsLastReviewedAtMillis
            )
        }
    }

    func insertMigrationCard(
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

    func setMigrationCardFsrsLastReviewedAt(
        database: LocalDatabase,
        cardId: String,
        fsrsLastReviewedAt: String
    ) throws {
        try database.core.execute(
            sql: """
            UPDATE cards
            SET fsrs_last_reviewed_at = ?,
                fsrs_last_reviewed_at_millis = ?
            WHERE card_id = ?
            """,
            values: [
                .text(fsrsLastReviewedAt),
                parseStrictIsoTimestampEpochMillis(value: fsrsLastReviewedAt).map(SQLiteValue.integer) ?? .null,
                .text(cardId)
            ]
        )
    }
}

