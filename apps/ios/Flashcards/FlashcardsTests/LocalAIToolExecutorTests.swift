import Foundation
import XCTest
@testable import Flashcards

private enum SqlJsonValue: Decodable, Equatable {
    case string(String)
    case integer(Int)
    case number(Double)
    case boolean(Bool)
    case null
    case stringArray([String])
    case integerArray([Int])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
            return
        }
        if let value = try? container.decode([String].self) {
            self = .stringArray(value)
            return
        }
        if let value = try? container.decode([Int].self) {
            self = .integerArray(value)
            return
        }
        if let value = try? container.decode(Bool.self) {
            self = .boolean(value)
            return
        }
        if let value = try? container.decode(Int.self) {
            self = .integer(value)
            return
        }
        if let value = try? container.decode(Double.self) {
            self = .number(value)
            return
        }
        self = .string(try container.decode(String.self))
    }

    var stringValue: String? {
        if case .string(let value) = self {
            return value
        }

        return nil
    }

    var integerValue: Int? {
        if case .integer(let value) = self {
            return value
        }

        return nil
    }

    var booleanValue: Bool? {
        if case .boolean(let value) = self {
            return value
        }

        return nil
    }

    var stringArrayValue: [String]? {
        if case .stringArray(let value) = self {
            return value
        }

        return nil
    }
}

private struct SqlReadPayload: Decodable {
    let statementType: String
    let resource: String?
    let sql: String
    let normalizedSql: String
    let rows: [[String: SqlJsonValue]]
    let rowCount: Int
    let limit: Int?
    let offset: Int?
    let hasMore: Bool
}

private struct SqlMutationPayload: Decodable {
    let statementType: String
    let resource: String
    let sql: String
    let normalizedSql: String
    let rows: [[String: SqlJsonValue]]
    let affectedCount: Int
}

private struct OutboxPayload: Decodable {
    let outbox: [OutboxRow]
    let nextCursor: String?
}

private struct OutboxRow: Decodable {
    let operationId: String
    let entityType: String
    let action: String
}

@MainActor
final class LocalAIToolExecutorTests: AIChatTestCaseBase {
    private func makeExecutor(
        flashcardsStore: FlashcardsStore
    ) throws -> LocalAIToolExecutor {
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        return LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )
    }

    private func executeSql(
        executor: LocalAIToolExecutor,
        sql: String,
        toolCallId: String
    ) async throws -> AIToolExecutionResult {
        try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: toolCallId,
                name: "sql",
                input: "{\"sql\":\"\(sql.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\"}"
            ),
            requestId: "request-1"
        )
    }

    func testLocalToolExecutorSupportsSqlIntrospection() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = try self.makeExecutor(flashcardsStore: flashcardsStore)

        let tablesResult = try await self.executeSql(
            executor: executor,
            sql: "SHOW TABLES",
            toolCallId: "call-show-tables"
        )
        let tablesPayload = try JSONDecoder().decode(SqlReadPayload.self, from: Data(tablesResult.output.utf8))
        XCTAssertEqual(tablesPayload.statementType, "show_tables")
        XCTAssertEqual(tablesPayload.resource, nil)
        XCTAssertEqual(
            Set(tablesPayload.rows.compactMap { row in row["table_name"]?.stringValue }),
            Set(["workspace", "cards", "decks", "review_events"])
        )
        XCTAssertFalse(tablesResult.didMutateAppState)

        let describeResult = try await self.executeSql(
            executor: executor,
            sql: "DESCRIBE workspace",
            toolCallId: "call-describe-workspace"
        )
        let describePayload = try JSONDecoder().decode(SqlReadPayload.self, from: Data(describeResult.output.utf8))
        XCTAssertEqual(describePayload.statementType, "describe")
        XCTAssertEqual(describePayload.resource, "workspace")
        XCTAssertTrue(describePayload.rows.contains { row in
            row["column_name"]?.stringValue == "algorithm"
                && row["read_only"]?.booleanValue == true
        })
    }

    func testLocalToolExecutorReadsWorkspaceAndAggregateSqlQueries() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = try self.makeExecutor(flashcardsStore: flashcardsStore)

        _ = try await self.executeSql(
            executor: executor,
            sql: """
            INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES
            ('Front 1', 'Back 1', ('grammar', 'verbs'), 'fast'),
            ('Front 2', 'Back 2', ('grammar'), 'fast'),
            ('Front 3', 'Back 3', ('reading'), 'medium')
            """,
            toolCallId: "call-insert-aggregate-cards"
        )

        let workspaceResult = try await self.executeSql(
            executor: executor,
            sql: "SELECT * FROM workspace LIMIT 1 OFFSET 0",
            toolCallId: "call-select-workspace"
        )
        let workspacePayload = try JSONDecoder().decode(SqlReadPayload.self, from: Data(workspaceResult.output.utf8))
        XCTAssertEqual(workspacePayload.rowCount, 1)
        XCTAssertEqual(workspacePayload.rows.first?["algorithm"]?.stringValue, "fsrs-6")

        let aggregateResult = try await self.executeSql(
            executor: executor,
            sql: "SELECT tag, COUNT(*) AS cards_count FROM cards UNNEST tags AS tag GROUP BY tag ORDER BY cards_count DESC, tag ASC LIMIT 20 OFFSET 0",
            toolCallId: "call-aggregate-tags"
        )
        let aggregatePayload = try JSONDecoder().decode(SqlReadPayload.self, from: Data(aggregateResult.output.utf8))
        XCTAssertEqual(aggregatePayload.resource, "cards")
        XCTAssertTrue(aggregatePayload.rows.contains { row in
            row["tag"]?.stringValue == "grammar" && row["cards_count"]?.integerValue == 2
        })
        XCTAssertTrue(aggregatePayload.rows.contains { row in
            row["tag"]?.stringValue == "verbs" && row["cards_count"]?.integerValue == 1
        })
    }

    func testLocalToolExecutorCreatesReadsAndUpdatesCardsThroughSql() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = try self.makeExecutor(flashcardsStore: flashcardsStore)

        let insertResult = try await self.executeSql(
            executor: executor,
            sql: "INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES ('Front', 'Back', ('grammar', 'verbs'), 'medium')",
            toolCallId: "call-insert-card"
        )
        let insertPayload = try JSONDecoder().decode(SqlMutationPayload.self, from: Data(insertResult.output.utf8))
        XCTAssertEqual(insertPayload.statementType, "insert")
        XCTAssertEqual(insertPayload.resource, "cards")
        XCTAssertEqual(insertPayload.affectedCount, 1)
        XCTAssertEqual(insertPayload.rows.first?["front_text"]?.stringValue, "Front")
        XCTAssertTrue(insertResult.didMutateAppState)

        let selectResult = try await self.executeSql(
            executor: executor,
            sql: "SELECT * FROM cards WHERE tags OVERLAP ('grammar') ORDER BY updated_at DESC LIMIT 20 OFFSET 0",
            toolCallId: "call-select-cards"
        )
        let selectPayload = try JSONDecoder().decode(SqlReadPayload.self, from: Data(selectResult.output.utf8))
        XCTAssertEqual(selectPayload.statementType, "select")
        XCTAssertEqual(selectPayload.resource, "cards")
        XCTAssertEqual(selectPayload.rowCount, 1)
        let cardId = try XCTUnwrap(selectPayload.rows.first?["card_id"]?.stringValue)

        let updateResult = try await self.executeSql(
            executor: executor,
            sql: "UPDATE cards SET back_text = 'Updated', effort_level = 'long' WHERE card_id = '\(cardId)'",
            toolCallId: "call-update-card"
        )
        let updatePayload = try JSONDecoder().decode(SqlMutationPayload.self, from: Data(updateResult.output.utf8))
        XCTAssertEqual(updatePayload.statementType, "update")
        XCTAssertEqual(updatePayload.affectedCount, 1)
        XCTAssertEqual(updatePayload.rows.first?["back_text"]?.stringValue, "Updated")
        XCTAssertEqual(updatePayload.rows.first?["effort_level"]?.stringValue, "long")
    }

    func testLocalToolExecutorFiltersAndPaginatesSqlSelects() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = try self.makeExecutor(flashcardsStore: flashcardsStore)

        _ = try await self.executeSql(
            executor: executor,
            sql: """
            INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES
            ('Front 1', 'Back 1', ('grammar'), 'fast'),
            ('Front 2', 'Back 2', ('grammar', 'verbs'), 'fast'),
            ('Front 3', 'Back 3', ('reading'), 'medium')
            """,
            toolCallId: "call-insert-many-cards"
        )

        let selectResult = try await self.executeSql(
            executor: executor,
            sql: "SELECT * FROM cards WHERE tags OVERLAP ('grammar') AND effort_level IN ('fast') ORDER BY updated_at DESC LIMIT 1 OFFSET 0",
            toolCallId: "call-select-filtered-cards"
        )
        let selectPayload = try JSONDecoder().decode(SqlReadPayload.self, from: Data(selectResult.output.utf8))
        XCTAssertEqual(selectPayload.rowCount, 1)
        XCTAssertEqual(selectPayload.limit, 1)
        XCTAssertEqual(selectPayload.offset, 0)
        XCTAssertTrue(selectPayload.hasMore)
        XCTAssertEqual(selectPayload.rows.first?["effort_level"]?.stringValue, "fast")
        XCTAssertTrue(selectPayload.rows.first?["tags"]?.stringArrayValue?.contains("grammar") == true)
    }

    func testLocalToolExecutorCreatesDeletesAndReadsDecksThroughSql() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = try self.makeExecutor(flashcardsStore: flashcardsStore)

        let insertResult = try await self.executeSql(
            executor: executor,
            sql: "INSERT INTO decks (name, effort_levels, tags) VALUES ('Grammar', ('fast', 'medium'), ('grammar'))",
            toolCallId: "call-insert-deck"
        )
        let insertPayload = try JSONDecoder().decode(SqlMutationPayload.self, from: Data(insertResult.output.utf8))
        let deckId = try XCTUnwrap(insertPayload.rows.first?["deck_id"]?.stringValue)
        XCTAssertEqual(insertPayload.affectedCount, 1)

        let deleteResult = try await self.executeSql(
            executor: executor,
            sql: "DELETE FROM decks WHERE deck_id = '\(deckId)'",
            toolCallId: "call-delete-deck"
        )
        let deletePayload = try JSONDecoder().decode(SqlMutationPayload.self, from: Data(deleteResult.output.utf8))
        XCTAssertEqual(deletePayload.statementType, "delete")
        XCTAssertEqual(deletePayload.resource, "decks")
        XCTAssertEqual(deletePayload.affectedCount, 1)

        let selectResult = try await self.executeSql(
            executor: executor,
            sql: "SELECT * FROM decks ORDER BY updated_at DESC LIMIT 20 OFFSET 0",
            toolCallId: "call-select-decks"
        )
        let selectPayload = try JSONDecoder().decode(SqlReadPayload.self, from: Data(selectResult.output.utf8))
        XCTAssertEqual(selectPayload.rowCount, 0)
    }

    func testLocalToolExecutorSupportsLocalOnlyTools() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = try self.makeExecutor(flashcardsStore: flashcardsStore)

        _ = try await self.executeSql(
            executor: executor,
            sql: "INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES ('Front', 'Back', ('tag-a'), 'medium')",
            toolCallId: "call-insert-outbox-card"
        )

        let cloudSettingsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(toolCallId: "call-cloud-settings", name: "get_cloud_settings", input: "{}"),
            requestId: "request-1"
        )
        let cloudSettings = try JSONDecoder().decode(CloudSettings.self, from: Data(cloudSettingsResult.output.utf8))
        XCTAssertFalse(cloudSettings.deviceId.isEmpty)
        XCTAssertFalse(cloudSettingsResult.didMutateAppState)

        let outboxResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-list-outbox",
                name: "list_outbox",
                input: "{\"cursor\":null,\"limit\":20}"
            ),
            requestId: "request-1"
        )
        let outboxPayload = try JSONDecoder().decode(OutboxPayload.self, from: Data(outboxResult.output.utf8))
        XCTAssertEqual(outboxPayload.outbox.count, 1)
        XCTAssertEqual(outboxPayload.outbox.first?.entityType, "card")
        XCTAssertEqual(outboxPayload.outbox.first?.action, "upsert")
        XCTAssertNil(outboxPayload.nextCursor)
    }

    func testLocalToolExecutorWrapsInvalidSqlInputWithDiagnostics() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = try self.makeExecutor(flashcardsStore: flashcardsStore)

        do {
            _ = try await executor.execute(
                toolCallRequest: AIToolCallRequest(
                    toolCallId: "call-invalid-sql",
                    name: "sql",
                    input: "{\"sql\":\"SHOW TABLES\"}\n{\"sql\":\"DESCRIBE cards\"}"
                ),
                requestId: "request-123"
            )
            XCTFail("Expected invalid tool input error")
        } catch let error as AIToolExecutionError {
            guard case .invalidToolInput(let requestId, let toolName, let toolCallId, _, let decoderSummary, let rawInputSnippet) = error else {
                return XCTFail("Expected invalidToolInput, received \(error.localizedDescription)")
            }

            XCTAssertEqual(requestId, "request-123")
            XCTAssertEqual(toolName, "sql")
            XCTAssertEqual(toolCallId, "call-invalid-sql")
            XCTAssertFalse(decoderSummary.isEmpty)
            XCTAssertEqual(rawInputSnippet, "{\"sql\":\"SHOW TABLES\"}\n{\"sql\":\"DESCRIBE cards\"}")
        }
    }

    func testLocalToolExecutorRejectsLegacySharedToolNames() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = try self.makeExecutor(flashcardsStore: flashcardsStore)

        do {
            _ = try await executor.execute(
                toolCallRequest: AIToolCallRequest(
                    toolCallId: "call-legacy-tool",
                    name: "legacy_shared_tool",
                    input: "{}"
                ),
                requestId: "request-1"
            )
            XCTFail("Expected unsupported tool error")
        } catch let error as AIToolExecutionError {
            guard case .unsupportedTool(let toolName) = error else {
                return XCTFail("Expected unsupported tool error, received \(error)")
            }

            XCTAssertEqual(toolName, "legacy_shared_tool")
        }
    }

    func testLocalToolExecutorReadsLatestCommittedStateBetweenSqlCalls() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = try self.makeExecutor(flashcardsStore: flashcardsStore)

        let initialResult = try await self.executeSql(
            executor: executor,
            sql: "SELECT * FROM cards ORDER BY updated_at DESC LIMIT 20 OFFSET 0",
            toolCallId: "call-select-initial"
        )
        let initialPayload = try JSONDecoder().decode(SqlReadPayload.self, from: Data(initialResult.output.utf8))
        XCTAssertEqual(initialPayload.rowCount, 0)

        try flashcardsStore.saveCard(
            input: CardEditorInput(
                frontText: "Fresh Front",
                backText: "Fresh Back",
                tags: ["fresh"],
                effortLevel: .medium
            ),
            editingCardId: nil
        )

        let updatedResult = try await self.executeSql(
            executor: executor,
            sql: "SELECT * FROM cards ORDER BY updated_at DESC LIMIT 20 OFFSET 0",
            toolCallId: "call-select-updated"
        )
        let updatedPayload = try JSONDecoder().decode(SqlReadPayload.self, from: Data(updatedResult.output.utf8))
        XCTAssertEqual(updatedPayload.rowCount, 1)
        XCTAssertEqual(updatedPayload.rows.first?["front_text"]?.stringValue, "Fresh Front")
    }

    func testLocalToolExecutorSupportsNowBasedDueFiltering() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = try self.makeExecutor(flashcardsStore: flashcardsStore)

        try flashcardsStore.saveCard(
            input: CardEditorInput(
                frontText: "Due Front",
                backText: "Due Back",
                tags: ["due"],
                effortLevel: .medium
            ),
            editingCardId: nil
        )

        let snapshot = try await executor.loadSnapshot()
        let dueCard = try XCTUnwrap(snapshot.cards.first { card in
            card.frontText == "Due Front"
        })

        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let database = try LocalDatabase(databaseURL: databaseURL)
        _ = try database.upsertCardSnapshot(
            workspaceId: snapshot.workspace.workspaceId,
            deviceId: snapshot.cloudSettings.deviceId,
            snapshot: CardSnapshotUpsertInput(
                cardId: dueCard.cardId,
                frontText: dueCard.frontText,
                backText: dueCard.backText,
                tags: dueCard.tags,
                effortLevel: dueCard.effortLevel,
                dueAt: "2000-01-01T00:00:00.000Z",
                reps: dueCard.reps,
                lapses: dueCard.lapses,
                fsrsCardState: dueCard.fsrsCardState,
                fsrsStepIndex: dueCard.fsrsStepIndex,
                fsrsStability: dueCard.fsrsStability,
                fsrsDifficulty: dueCard.fsrsDifficulty,
                fsrsLastReviewedAt: dueCard.fsrsLastReviewedAt,
                fsrsScheduledDays: dueCard.fsrsScheduledDays
            )
        )

        let selectResult = try await self.executeSql(
            executor: executor,
            sql: "SELECT * FROM cards WHERE due_at IS NOT NULL AND due_at <= NOW() ORDER BY due_at ASC LIMIT 20 OFFSET 0",
            toolCallId: "call-select-due-cards"
        )
        let selectPayload = try JSONDecoder().decode(SqlReadPayload.self, from: Data(selectResult.output.utf8))
        XCTAssertTrue(selectPayload.rows.contains { row in
            row["card_id"]?.stringValue == dueCard.cardId
        })
    }
}
