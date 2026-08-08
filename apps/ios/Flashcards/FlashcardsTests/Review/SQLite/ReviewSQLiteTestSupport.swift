import Foundation
import XCTest
@testable import Flashcards

class ReviewSQLiteTestCase: XCTestCase {
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

    func makeDatabase() throws -> LocalDatabase {
        let databaseURL = try self.makeDatabaseURL()
        let database = try LocalDatabase(databaseURL: databaseURL)
        self.databaseURL = databaseURL
        self.database = database
        return database
    }

    func makeDatabaseURL() throws -> URL {
        let databaseDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(
            at: databaseDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
        return databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
    }

    func insertCard(
        database: LocalDatabase,
        workspaceId: String,
        cardId: String,
        dueAt: String?,
        createdAt: String
    ) throws {
        try self.insertCard(
            database: database,
            workspaceId: workspaceId,
            cardId: cardId,
            dueAt: dueAt,
            createdAt: createdAt,
            fsrsLastReviewedAt: nil,
            tags: []
        )
    }

    func insertCard(
        database: LocalDatabase,
        workspaceId: String,
        cardId: String,
        dueAt: String?,
        createdAt: String,
        tags: [String]
    ) throws {
        try self.insertCard(
            database: database,
            workspaceId: workspaceId,
            cardId: cardId,
            dueAt: dueAt,
            createdAt: createdAt,
            fsrsLastReviewedAt: nil,
            tags: tags
        )
    }

    func insertCard(
        database: LocalDatabase,
        workspaceId: String,
        cardId: String,
        dueAt: String?,
        createdAt: String,
        fsrsLastReviewedAt: String?,
        tags: [String]
    ) throws {
        let tagsJson = try database.core.encodeJsonString(value: tags)
        let metadataJson = try database.core.encodeJsonString(value: makeDefaultCardMetadata(createdAt: createdAt))
        try database.core.execute(
            sql: """
            INSERT INTO cards (
                card_id,
                workspace_id,
                front_text,
                back_text,
                card_type,
                metadata_json,
                tags_json,
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
                fsrs_last_reviewed_at_millis,
                fsrs_scheduled_days,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'new', NULL, NULL, NULL, ?, ?, NULL, ?, 'test-replica', ?, ?, NULL)
            """,
            values: [
                .text(cardId),
                .text(workspaceId),
                .text("Front \(cardId)"),
                .text("Back \(cardId)"),
                .text(basicCardType),
                .text(metadataJson),
                .text(tagsJson),
                dueAt.map(SQLiteValue.text) ?? .null,
                dueAt.flatMap(parseStrictIsoTimestampEpochMillis).map(SQLiteValue.integer) ?? .null,
                .text(createdAt),
                fsrsLastReviewedAt.map(SQLiteValue.text) ?? .null,
                fsrsLastReviewedAt.flatMap(parseStrictIsoTimestampEpochMillis).map(SQLiteValue.integer) ?? .null,
                .text(createdAt),
                .text("operation-\(cardId)"),
                .text(createdAt)
            ]
        )
        try database.cardStore.replaceCardTagsReadModel(
            workspaceId: workspaceId,
            cardId: cardId,
            tags: tags
        )
    }
}

