import Foundation

/**
 iOS-local AI tool executor.

 Shared workspace access is intentionally collapsed to the single `sql` tool
 so the iOS-local runtime mirrors the public agent surface and the browser
 local mirror.

 Keep this file aligned with:
 - `apps/web/src/chat/localToolExecutor.ts`
 - `apps/backend/src/aiTools/agentSql.ts`
 - `apps/backend/src/aiTools/sqlDialect.ts`
 */

enum AIToolExecutionError: LocalizedError {
    case unsupportedTool(String)
    case invalidToolInput(
        requestId: String?,
        toolName: String,
        toolCallId: String,
        expectedInputType: String,
        decoderSummary: String,
        rawInputSnippet: String
    )

    var errorDescription: String? {
        switch self {
        case .unsupportedTool(let name):
            return "Unsupported AI tool: \(name)"
        case .invalidToolInput(let requestId, let toolName, let toolCallId, _, _, _):
            let reference = requestId?.isEmpty == false ? requestId ?? toolCallId : toolCallId
            return [
                "AI tool input was invalid.",
                "Reference: \(reference)",
                "Stage: \(AIChatFailureStage.toolInputDecode.rawValue)",
                "Tool: \(toolName)",
            ].joined(separator: "\n")
        }
    }
}

private struct AIOutboxEntryPayload: Encodable {
    let operationId: String
    let workspaceId: String
    let entityType: String
    let entityId: String
    let action: String
    let clientUpdatedAt: String
    let createdAt: String
    let attemptCount: Int
    let lastError: String
    let payloadSummary: String
}

private struct LocalOutboxPagePayload: Encodable {
    let outbox: [AIOutboxEntryPayload]
    let nextCursor: String?
}

private struct SqlToolInput: Decodable {
    let sql: String

    private enum CodingKeys: String, CodingKey {
        case sql
    }

    init(from decoder: Decoder) throws {
        try validateObjectKeys(
            decoder: decoder,
            allowedKeys: Set([CodingKeys.sql.rawValue]),
            context: "sql"
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.sql = try container.decode(String.self, forKey: .sql).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct ListOutboxToolInput: Decodable {
    let cursor: String?
    let limit: Int

    private enum CodingKeys: String, CodingKey {
        case cursor
        case limit
    }

    init(from decoder: Decoder) throws {
        try validateObjectKeys(
            decoder: decoder,
            allowedKeys: Set([CodingKeys.cursor.rawValue, CodingKeys.limit.rawValue]),
            context: "list_outbox"
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
        self.limit = try container.decode(Int.self, forKey: .limit)
    }
}

private struct LocalPageCursor: Codable {
    let index: Int
}

private struct DynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }
}

private func validateObjectKeys(
    decoder: Decoder,
    allowedKeys: Set<String>,
    context: String
) throws {
    let container = try decoder.container(keyedBy: DynamicCodingKey.self)
    for key in container.allKeys where allowedKeys.contains(key.stringValue) == false {
        throw LocalStoreError.validation("\(context).\(key.stringValue) is not supported")
    }
}

private func encodePageCursor(index: Int) -> String {
    let json = "{\"index\":\(index)}"
    let data = Data(json.utf8)
    return data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

private func decodePageCursor(cursor: String) throws -> Int {
    let normalizedCursor = cursor
        .replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    let paddingLength = (4 - (normalizedCursor.count % 4)) % 4
    let paddedCursor = normalizedCursor + String(repeating: "=", count: paddingLength)
    guard let data = Data(base64Encoded: paddedCursor) else {
        throw LocalStoreError.validation("cursor is invalid: Cursor payload must be base64")
    }

    do {
        let payload = try JSONDecoder().decode(LocalPageCursor.self, from: data)
        if payload.index < 0 {
            throw LocalStoreError.validation("cursor is invalid: Cursor index must be a non-negative integer")
        }
        return payload.index
    } catch let error as LocalStoreError {
        throw error
    } catch {
        throw LocalStoreError.validation("cursor is invalid: \(localizedMessage(error: error))")
    }
}

private func pageStartIndex(cursor: String?) throws -> Int {
    guard let cursor else {
        return 0
    }
    return try decodePageCursor(cursor: cursor)
}

private func nextCursor(totalCount: Int, startIndex: Int, visibleCount: Int) -> String? {
    let nextIndex = startIndex + visibleCount
    if nextIndex >= totalCount {
        return nil
    }
    return encodePageCursor(index: nextIndex)
}

private func normalizeOutboxLimit(_ limit: Int) throws -> Int {
    if limit < 1 || limit > 100 {
        throw LocalStoreError.validation("limit must be an integer between 1 and 100")
    }

    return limit
}

private func describeOutboxPayload(_ payload: SyncOperationPayload) -> String {
    switch payload {
    case .card(let cardPayload):
        return "card \(cardPayload.cardId)"
    case .deck(let deckPayload):
        return "deck \(deckPayload.deckId)"
    case .workspaceSchedulerSettings:
        return "workspace scheduler settings"
    case .reviewEvent(let reviewEventPayload):
        return "review event \(reviewEventPayload.reviewEventId)"
    }
}

/**
 Mirrors `apps/web/src/chat/localToolExecutor.ts::executeSqlLocally`.
 Keep SQL payload shapes, aggregate semantics, and mutation behavior aligned
 across browser-local and iOS-local runtimes.
 */
private func executeSqlLocally(
    database: LocalDatabase,
    bootstrapSnapshot: AppBootstrapSnapshot,
    sql: String,
    encoder: JSONEncoder
) throws -> LocalAISqlExecutionResult {
    let statement = try localAISqlParseStatement(sql)

    switch statement {
    case .showTables, .describe, .select:
        return try executeLocalAISqlReadStatement(
            database: database,
            bootstrapSnapshot: bootstrapSnapshot,
            sql: sql,
            statement: statement,
            encoder: encoder
        )
    case .insert, .update, .delete:
        return try executeLocalAISqlMutationStatement(
            database: database,
            bootstrapSnapshot: bootstrapSnapshot,
            sql: sql,
            statement: statement,
            encoder: encoder
        )
    }
}

func encodeJSON<Value: Encodable>(
    value: Value,
    encoder: JSONEncoder
) throws -> String {
    let data = try encoder.encode(value)
    guard let stringValue = String(data: data, encoding: .utf8) else {
        throw LocalStoreError.validation("Encoded JSON payload is not UTF-8")
    }
    return stringValue
}

/**
 Executes local AI tools against the iOS local database.

 Mirrors:
 - `apps/web/src/chat/localToolExecutor.ts::createLocalToolExecutor`
 - `apps/backend/src/chat/openai/localTools.ts`
 */
actor LocalAIToolExecutor: AIToolExecuting, AIChatLocalContextLoading {
    private let databaseURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var database: LocalDatabase?

    init(databaseURL: URL, encoder: JSONEncoder, decoder: JSONDecoder) {
        self.databaseURL = databaseURL
        self.encoder = encoder
        self.decoder = decoder
        self.database = nil
    }

    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        let database = try self.databaseInstance()
        let bootstrapSnapshot = try database.loadBootstrapSnapshot()

        switch toolCallRequest.name {
        case "sql":
            let input = try self.decodeInput(SqlToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let result = try executeSqlLocally(
                database: database,
                bootstrapSnapshot: bootstrapSnapshot,
                sql: input.sql,
                encoder: self.encoder
            )
            return AIToolExecutionResult(
                output: result.output,
                didMutateAppState: result.didMutateAppState
            )
        case "get_cloud_settings":
            _ = try self.decodeInput(EmptyToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return AIToolExecutionResult(
                output: try encodeJSON(value: bootstrapSnapshot.cloudSettings, encoder: self.encoder),
                didMutateAppState: false
            )
        case "list_outbox":
            let input = try self.decodeInput(ListOutboxToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return AIToolExecutionResult(
                output: try encodeJSON(
                    value: try self.makeOutboxPayload(
                        database: database,
                        workspaceId: bootstrapSnapshot.workspace.workspaceId,
                        startIndex: try pageStartIndex(cursor: input.cursor),
                        limit: try normalizeOutboxLimit(input.limit)
                    ),
                    encoder: self.encoder
                ),
                didMutateAppState: false
            )
        default:
            throw AIToolExecutionError.unsupportedTool(toolCallRequest.name)
        }
    }

    func loadLocalContext() async throws -> AIChatLocalContext {
        try self.loadLocalContextNow()
    }

    private func databaseInstance() throws -> LocalDatabase {
        if let database = self.database {
            return database
        }

        let database = try LocalDatabase(databaseURL: self.databaseURL)
        self.database = database
        return database
    }

    private func loadLocalContextNow() throws -> AIChatLocalContext {
        try self.databaseInstance().loadAIChatLocalContext()
    }

    private func makeOutboxPayload(
        database: LocalDatabase,
        workspaceId: String,
        startIndex: Int,
        limit: Int
    ) throws -> LocalOutboxPagePayload {
        let entries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: Int.max)
        let visibleEntries = Array(entries.dropFirst(startIndex).prefix(limit))
        return LocalOutboxPagePayload(
            outbox: visibleEntries.map { entry in
                AIOutboxEntryPayload(
                    operationId: entry.operationId,
                    workspaceId: entry.workspaceId,
                    entityType: entry.operation.entityType.rawValue,
                    entityId: entry.operation.entityId,
                    action: entry.operation.action.rawValue,
                    clientUpdatedAt: entry.operation.clientUpdatedAt,
                    createdAt: entry.createdAt,
                    attemptCount: entry.attemptCount,
                    lastError: entry.lastError,
                    payloadSummary: describeOutboxPayload(entry.operation.payload)
                )
            },
            nextCursor: nextCursor(
                totalCount: entries.count,
                startIndex: startIndex,
                visibleCount: visibleEntries.count
            )
        )
    }

    private func decodeInput<Input: Decodable>(
        _ type: Input.Type,
        toolCallRequest: AIToolCallRequest,
        requestId: String?
    ) throws -> Input {
        let data = Data(toolCallRequest.input.utf8)
        do {
            return try self.decoder.decode(type, from: data)
        } catch {
            let summary = aiChatDecoderSummary(error: error)
            let rawInputSnippet = aiChatTruncatedSnippet(toolCallRequest.input)
            logFlashcardsError(
                domain: "chat",
                action: "local_tool_input_decode_failed",
                metadata: [
                    "requestId": requestId ?? "",
                    "toolName": toolCallRequest.name,
                    "toolCallId": toolCallRequest.toolCallId,
                    "expectedInputType": String(describing: Input.self),
                    "decoderSummary": summary,
                    "rawInputSnippet": rawInputSnippet,
                ]
            )
            throw AIToolExecutionError.invalidToolInput(
                requestId: requestId,
                toolName: toolCallRequest.name,
                toolCallId: toolCallRequest.toolCallId,
                expectedInputType: String(describing: Input.self),
                decoderSummary: summary,
                rawInputSnippet: rawInputSnippet
            )
        }
    }
}

struct UnavailableAIToolExecutor: AIToolExecuting, AIChatLocalContextLoading {
    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        _ = toolCallRequest
        _ = requestId
        throw LocalStoreError.uninitialized("AI tool executor is unavailable")
    }

    func loadLocalContext() async throws -> AIChatLocalContext {
        throw LocalStoreError.uninitialized("AI tool executor is unavailable")
    }
}

private struct EmptyToolInput: Decodable {
    init(from decoder: Decoder) throws {
        try validateObjectKeys(decoder: decoder, allowedKeys: Set(), context: "empty")
    }
}
