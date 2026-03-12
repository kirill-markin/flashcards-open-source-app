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

private enum LocalAISqlRowValue: Encodable {
    case string(String)
    case integer(Int)
    case number(Double)
    case boolean(Bool)
    case null
    case stringArray([String])
    case integerArray([Int])

    func encode(to encoder: Encoder) throws {
        var singleValueContainer = encoder.singleValueContainer()

        switch self {
        case .string(let value):
            try singleValueContainer.encode(value)
        case .integer(let value):
            try singleValueContainer.encode(value)
        case .number(let value):
            try singleValueContainer.encode(value)
        case .boolean(let value):
            try singleValueContainer.encode(value)
        case .null:
            try singleValueContainer.encodeNil()
        case .stringArray(let value):
            try singleValueContainer.encode(value)
        case .integerArray(let value):
            try singleValueContainer.encode(value)
        }
    }
}

private typealias LocalAISqlRow = [String: LocalAISqlRowValue]

private struct LocalAISqlReadPayload: Encodable {
    let statementType: String
    let resource: String?
    let sql: String
    let normalizedSql: String
    let rows: [LocalAISqlRow]
    let rowCount: Int
    let limit: Int?
    let offset: Int?
    let hasMore: Bool
}

private struct LocalAISqlMutationPayload: Encodable {
    let statementType: String
    let resource: String
    let sql: String
    let normalizedSql: String
    let rows: [LocalAISqlRow]
    let affectedCount: Int
}

private struct LocalAISqlExecutionResult {
    let output: String
    let didMutateAppState: Bool
}

private struct LocalAISqlSelectExecutionResult {
    let rows: [LocalAISqlRow]
    let rowCount: Int
    let limit: Int
    let offset: Int
    let hasMore: Bool
}

private struct LocalAISqlGroupedRows {
    let groupRow: LocalAISqlRow
    let groupedRows: [LocalAISqlRow]
}

private let maxLocalAISqlLimit: Int = 100

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

private func normalizeSqlLimit(_ limit: Int?) throws -> Int {
    guard let limit else {
        return maxLocalAISqlLimit
    }
    if limit < 1 {
        throw LocalStoreError.validation("LIMIT must be greater than 0")
    }
    return min(limit, maxLocalAISqlLimit)
}

private func normalizeSqlOffset(_ offset: Int?) throws -> Int {
    guard let offset else {
        return 0
    }
    if offset < 0 {
        throw LocalStoreError.validation("OFFSET must be a non-negative integer")
    }
    return offset
}

private func compareCardsByUpdatedAt(left: Card, right: Card) -> Bool {
    left.updatedAt > right.updatedAt
}

private func compareDecksByUpdatedAt(left: Deck, right: Deck) -> Bool {
    if left.updatedAt != right.updatedAt {
        return left.updatedAt > right.updatedAt
    }

    return left.createdAt > right.createdAt
}

/**
 Mirrors `apps/web/src/chat/localToolExecutor.ts::currentActiveCards`.
 Keep the default card ordering aligned across browser-local and iOS-local SQL
 reads so the same SQL query returns rows in the same implicit order.
 */
private func currentActiveCards(snapshot: AppStateSnapshot) -> [Card] {
    activeCards(cards: snapshot.cards).sorted(by: compareCardsByUpdatedAt)
}

private func activeDecks(snapshot: AppStateSnapshot) -> [Deck] {
    snapshot.decks.filter { deck in
        deck.deletedAt == nil
    }.sorted(by: compareDecksByUpdatedAt)
}

private func toSqlRowValue(literal: LocalAISqlLiteralValue) -> LocalAISqlRowValue {
    switch literal {
    case .string(let value):
        return .string(value)
    case .integer(let value):
        return .integer(value)
    case .number(let value):
        return .number(value)
    case .boolean(let value):
        return .boolean(value)
    case .null:
        return .null
    }
}

private func toSqlWorkspaceRow(snapshot: AppStateSnapshot) -> LocalAISqlRow {
    [
        "workspace_id": .string(snapshot.workspace.workspaceId),
        "name": .string(snapshot.workspace.name),
        "created_at": .string(snapshot.workspace.createdAt),
        "algorithm": .string(snapshot.schedulerSettings.algorithm),
        "desired_retention": .number(snapshot.schedulerSettings.desiredRetention),
        "learning_steps_minutes": .integerArray(snapshot.schedulerSettings.learningStepsMinutes),
        "relearning_steps_minutes": .integerArray(snapshot.schedulerSettings.relearningStepsMinutes),
        "maximum_interval_days": .integer(snapshot.schedulerSettings.maximumIntervalDays),
        "enable_fuzz": .boolean(snapshot.schedulerSettings.enableFuzz),
    ]
}

private func toSqlCardRow(card: Card) -> LocalAISqlRow {
    [
        "card_id": .string(card.cardId),
        "front_text": .string(card.frontText),
        "back_text": .string(card.backText),
        "tags": .stringArray(card.tags),
        "effort_level": .string(card.effortLevel.rawValue),
        "due_at": card.dueAt.map(LocalAISqlRowValue.string) ?? .null,
        "reps": .integer(card.reps),
        "lapses": .integer(card.lapses),
        "updated_at": .string(card.updatedAt),
        "deleted_at": card.deletedAt.map(LocalAISqlRowValue.string) ?? .null,
        "fsrs_card_state": .string(card.fsrsCardState.rawValue),
        "fsrs_step_index": card.fsrsStepIndex.map(LocalAISqlRowValue.integer) ?? .null,
        "fsrs_stability": card.fsrsStability.map(LocalAISqlRowValue.number) ?? .null,
        "fsrs_difficulty": card.fsrsDifficulty.map(LocalAISqlRowValue.number) ?? .null,
        "fsrs_last_reviewed_at": card.fsrsLastReviewedAt.map(LocalAISqlRowValue.string) ?? .null,
        "fsrs_scheduled_days": card.fsrsScheduledDays.map(LocalAISqlRowValue.integer) ?? .null,
    ]
}

private func toSqlDeckRow(deck: Deck) -> LocalAISqlRow {
    [
        "deck_id": .string(deck.deckId),
        "name": .string(deck.name),
        "tags": .stringArray(deck.filterDefinition.tags),
        "effort_levels": .stringArray(deck.filterDefinition.effortLevels.map(\.rawValue)),
        "created_at": .string(deck.createdAt),
        "updated_at": .string(deck.updatedAt),
        "deleted_at": deck.deletedAt.map(LocalAISqlRowValue.string) ?? .null,
    ]
}

private func toSqlReviewEventRow(event: ReviewEvent) -> LocalAISqlRow {
    [
        "review_event_id": .string(event.reviewEventId),
        "card_id": .string(event.cardId),
        "device_id": .string(event.deviceId),
        "client_event_id": .string(event.clientEventId),
        "rating": .integer(event.rating.rawValue),
        "reviewed_at_client": .string(event.reviewedAtClient),
        "reviewed_at_server": .string(event.reviewedAtServer),
    ]
}

private func compareRowValues(
    left: LocalAISqlRowValue?,
    right: LocalAISqlRowValue?
) -> Int {
    if left == nil && right == nil {
        return 0
    }
    if left == nil {
        return -1
    }
    if right == nil {
        return 1
    }

    switch (left, right) {
    case (.some(.null), .some(.null)):
        return 0
    case (.some(.null), _):
        return -1
    case (_, .some(.null)):
        return 1
    case (.some(.string(let leftValue)), .some(.string(let rightValue))):
        return leftValue.localizedStandardCompare(rightValue).comparisonNumber
    case (.some(.integer(let leftValue)), .some(.integer(let rightValue))):
        return leftValue == rightValue ? 0 : (leftValue < rightValue ? -1 : 1)
    case (.some(.number(let leftValue)), .some(.number(let rightValue))):
        return leftValue == rightValue ? 0 : (leftValue < rightValue ? -1 : 1)
    case (.some(.integer(let leftValue)), .some(.number(let rightValue))):
        let leftNumber = Double(leftValue)
        return leftNumber == rightValue ? 0 : (leftNumber < rightValue ? -1 : 1)
    case (.some(.number(let leftValue)), .some(.integer(let rightValue))):
        let rightNumber = Double(rightValue)
        return leftValue == rightNumber ? 0 : (leftValue < rightNumber ? -1 : 1)
    case (.some(.boolean(let leftValue)), .some(.boolean(let rightValue))):
        let leftNumber = leftValue ? 1 : 0
        let rightNumber = rightValue ? 1 : 0
        return leftNumber == rightNumber ? 0 : (leftNumber < rightNumber ? -1 : 1)
    case (.some(.stringArray(let leftValue)), .some(.stringArray(let rightValue))):
        return leftValue.joined(separator: "\u{0000}").localizedStandardCompare(rightValue.joined(separator: "\u{0000}")).comparisonNumber
    case (.some(.integerArray(let leftValue)), .some(.integerArray(let rightValue))):
        let leftText = leftValue.map(String.init).joined(separator: "\u{0000}")
        let rightText = rightValue.map(String.init).joined(separator: "\u{0000}")
        return leftText.localizedStandardCompare(rightText).comparisonNumber
    default:
        return String(describing: left!).localizedStandardCompare(String(describing: right!)).comparisonNumber
    }
}

private func valuesEqual(
    left: LocalAISqlRowValue?,
    right: LocalAISqlLiteralValue
) -> Bool {
    switch (left, right) {
    case (.some(.string(let leftValue)), .string(let rightValue)):
        return leftValue == rightValue
    case (.some(.integer(let leftValue)), .integer(let rightValue)):
        return leftValue == rightValue
    case (.some(.number(let leftValue)), .number(let rightValue)):
        return leftValue == rightValue
    case (.some(.integer(let leftValue)), .number(let rightValue)):
        return Double(leftValue) == rightValue
    case (.some(.number(let leftValue)), .integer(let rightValue)):
        return leftValue == Double(rightValue)
    case (.some(.boolean(let leftValue)), .boolean(let rightValue)):
        return leftValue == rightValue
    case (.some(.null), .null):
        return true
    default:
        return false
    }
}

private func compareScalarValues(
    left: LocalAISqlRowValue?,
    right: LocalAISqlLiteralValue
) -> Int? {
    switch (left, right) {
    case (.some(.string(let leftValue)), .string(let rightValue)):
        return leftValue.localizedStandardCompare(rightValue).comparisonNumber
    case (.some(.integer(let leftValue)), .integer(let rightValue)):
        return leftValue == rightValue ? 0 : (leftValue < rightValue ? -1 : 1)
    case (.some(.number(let leftValue)), .number(let rightValue)):
        return leftValue == rightValue ? 0 : (leftValue < rightValue ? -1 : 1)
    case (.some(.integer(let leftValue)), .number(let rightValue)):
        let leftNumber = Double(leftValue)
        return leftNumber == rightValue ? 0 : (leftNumber < rightValue ? -1 : 1)
    case (.some(.number(let leftValue)), .integer(let rightValue)):
        let rightNumber = Double(rightValue)
        return leftValue == rightNumber ? 0 : (leftValue < rightNumber ? -1 : 1)
    case (.some(.boolean(let leftValue)), .boolean(let rightValue)):
        let leftNumber = leftValue ? 1 : 0
        let rightNumber = rightValue ? 1 : 0
        return leftNumber == rightNumber ? 0 : (leftNumber < rightNumber ? -1 : 1)
    default:
        return nil
    }
}

private func normalizeStringArray(value: LocalAISqlRowValue?) -> [String] {
    switch value {
    case .stringArray(let values):
        return values
    default:
        return []
    }
}

private func normalizeAggregateNumbers(rows: [LocalAISqlRow], columnName: String) -> [Double] {
    rows.compactMap { row in
        switch row[columnName] {
        case .integer(let value):
            return Double(value)
        case .number(let value):
            return value
        default:
            return nil
        }
    }
}

private func normalizeAggregateComparableValues(rows: [LocalAISqlRow], columnName: String) -> [LocalAISqlRowValue] {
    rows.compactMap { row in
        switch row[columnName] {
        case .string, .integer, .number, .boolean:
            return row[columnName]
        default:
            return nil
        }
    }
}

private func normalizeSearchableText(value: LocalAISqlRowValue) -> String {
    switch value {
    case .string(let rawValue):
        return rawValue.lowercased()
    case .integer(let rawValue):
        return String(rawValue)
    case .number(let rawValue):
        return String(rawValue)
    case .boolean(let rawValue):
        return rawValue ? "true" : "false"
    case .null:
        return ""
    case .stringArray(let rawValue):
        return rawValue.joined(separator: " ").lowercased()
    case .integerArray(let rawValue):
        return rawValue.map(String.init).joined(separator: " ")
    }
}

private func resolvePredicateValue(_ value: LocalAISqlPredicateValue) -> LocalAISqlLiteralValue {
    switch value {
    case .literal(let literal):
        return literal
    case .now:
        return .string(currentIsoTimestamp())
    }
}

private func rowMatchesPredicate(
    row: LocalAISqlRow,
    predicate: LocalAISqlPredicate
) throws -> Bool {
    switch predicate {
    case .match(let query):
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalizedQuery.isEmpty {
            throw LocalStoreError.validation("MATCH query must not be empty")
        }
        return row.values.contains { value in
            normalizeSearchableText(value: value).contains(normalizedQuery)
        }
    case .comparison(let columnName, let comparisonOperator, let predicateValue):
        let resolvedPredicateValue = resolvePredicateValue(predicateValue)
        if comparisonOperator == .equals {
            return valuesEqual(left: row[columnName], right: resolvedPredicateValue)
        }

        guard let comparison = compareScalarValues(left: row[columnName], right: resolvedPredicateValue) else {
            return false
        }
        switch comparisonOperator {
        case .equals:
            return comparison == 0
        case .lessThan:
            return comparison < 0
        case .lessThanOrEqual:
            return comparison <= 0
        case .greaterThan:
            return comparison > 0
        case .greaterThanOrEqual:
            return comparison >= 0
        }
    case .in(let columnName, let values):
        return values.contains { value in
            valuesEqual(left: row[columnName], right: value)
        }
    case .isNull(let columnName):
        if case .some(.null) = row[columnName] {
            return true
        }
        return false
    case .isNotNull(let columnName):
        if case .some(.null) = row[columnName] {
            return false
        }
        return row[columnName] != nil
    case .overlap(let columnName, let values):
        return normalizeStringArray(value: row[columnName]).contains { item in
            values.contains(item)
        }
    }
}

private func validatePredicate(
    source: LocalAISqlFromSource,
    predicate: LocalAISqlPredicate
) throws {
    if case .match = predicate {
        return
    }

    let columnName: String
    switch predicate {
    case .comparison(let predicateColumnName, _, _):
        columnName = predicateColumnName
    case .in(let predicateColumnName, _):
        columnName = predicateColumnName
    case .overlap(let predicateColumnName, _):
        columnName = predicateColumnName
    case .isNull(let predicateColumnName):
        columnName = predicateColumnName
    case .isNotNull(let predicateColumnName):
        columnName = predicateColumnName
    case .match:
        return
    }

    let descriptors = try localAISqlSourceColumnDescriptors(source: source)
    guard let descriptor = descriptors[columnName] else {
        throw LocalStoreError.validation("Unknown column for \(source.resourceName.rawValue): \(columnName)")
    }
    if descriptor.filterable == false {
        throw LocalStoreError.validation("Column is not filterable: \(columnName)")
    }
}

private func applyPredicateClauses(
    source: LocalAISqlFromSource,
    rows: [LocalAISqlRow],
    predicateClauses: [LocalAISqlPredicateClause]
) throws -> [LocalAISqlRow] {
    for clause in predicateClauses {
        for predicate in clause {
            try validatePredicate(source: source, predicate: predicate)
        }
    }

    if predicateClauses.isEmpty {
        return rows
    }

    return try rows.filter { row in
        try predicateClauses.contains { clause in
            try clause.allSatisfy { predicate in
                try rowMatchesPredicate(row: row, predicate: predicate)
            }
        }
    }
}

private func applyOrderBy(
    rows: [LocalAISqlRow],
    orderBy: [LocalAISqlSelectOrderBy]
) -> [LocalAISqlRow] {
    if orderBy.isEmpty {
        return rows
    }

    return rows.sorted { left, right in
        for item in orderBy {
            let comparison = compareRowValues(left: left[item.expressionName], right: right[item.expressionName])
            if comparison != 0 {
                return item.direction == .desc ? comparison > 0 : comparison < 0
            }
        }

        return false
    }
}

private func paginateRows(
    rows: [LocalAISqlRow],
    limit: Int,
    offset: Int
) -> (rows: [LocalAISqlRow], hasMore: Bool) {
    if offset >= rows.count {
        return ([], false)
    }

    let endIndex = min(offset + limit, rows.count)
    let pagedRows = Array(rows[offset..<endIndex])
    return (pagedRows, endIndex < rows.count)
}

private func likePatternToRegex(_ value: String) throws -> NSRegularExpression {
    let escapedValue = NSRegularExpression.escapedPattern(for: value)
        .replacingOccurrences(of: "%", with: ".*")
        .replacingOccurrences(of: "_", with: ".")
    return try NSRegularExpression(pattern: "^\(escapedValue)$", options: [.caseInsensitive])
}

private func regexMatches(
    expression: NSRegularExpression,
    value: String
) -> Bool {
    let fullRange = NSRange(value.startIndex..<value.endIndex, in: value)
    return expression.firstMatch(in: value, options: [], range: fullRange) != nil
}

private func loadSelectRows(
    database: LocalDatabase,
    snapshot: AppStateSnapshot,
    resourceName: LocalAISqlResourceName
) throws -> [LocalAISqlRow] {
    switch resourceName {
    case .workspace:
        return [toSqlWorkspaceRow(snapshot: snapshot)]
    case .cards:
        return currentActiveCards(snapshot: snapshot).map(toSqlCardRow)
    case .decks:
        return activeDecks(snapshot: snapshot).map(toSqlDeckRow)
    case .reviewEvents:
        return try database.loadReviewEvents(workspaceId: snapshot.workspace.workspaceId).map(toSqlReviewEventRow)
    }
}

private func expandRowsForSource(
    source: LocalAISqlFromSource,
    rows: [LocalAISqlRow]
) -> [LocalAISqlRow] {
    guard let unnestAlias = source.unnestAlias,
          let unnestColumnName = source.unnestColumnName else {
        return rows
    }

    return rows.flatMap { row in
        normalizeStringArray(value: row[unnestColumnName]).map { value in
            var expandedRow = row
            expandedRow[unnestAlias] = .string(value)
            return expandedRow
        }
    }
}

private func defaultAggregateAlias(
    functionName: LocalAISqlAggregateFunctionName,
    columnName: String?
) -> String {
    if functionName == .count {
        return "count"
    }
    return "\(functionName.rawValue)_\(columnName ?? "value")"
}

private func validateRowOrderBy(
    source: LocalAISqlFromSource,
    orderBy: [LocalAISqlSelectOrderBy]
) throws {
    let descriptors = try localAISqlSourceColumnDescriptors(source: source)
    for item in orderBy {
        guard let descriptor = descriptors[item.expressionName] else {
            throw LocalStoreError.validation("Unknown ORDER BY target: \(item.expressionName)")
        }
        if descriptor.sortable == false {
            throw LocalStoreError.validation("Column is not sortable: \(item.expressionName)")
        }
    }
}

private func validateAggregateSelect(
    statement: LocalAISqlSelectStatement
) throws {
    let descriptors = try localAISqlSourceColumnDescriptors(source: statement.source)
    for groupColumn in statement.groupBy where descriptors[groupColumn] == nil {
        throw LocalStoreError.validation("Unknown GROUP BY column: \(groupColumn)")
    }

    var outputNames = Set<String>()
    for item in statement.selectItems {
        switch item {
        case .wildcard:
            throw LocalStoreError.validation("SELECT * cannot be mixed with aggregate projections")
        case .column(let columnName, let alias):
            if statement.groupBy.contains(columnName) == false {
                throw LocalStoreError.validation("Grouped SELECT must list \(columnName) in GROUP BY")
            }
            outputNames.insert(alias ?? columnName)
        case .aggregate(let functionName, let columnName, let alias):
            let outputName = alias ?? defaultAggregateAlias(functionName: functionName, columnName: columnName)
            outputNames.insert(outputName)
            if functionName == .count {
                continue
            }
            guard let aggregateColumnName = columnName,
                  let descriptor = descriptors[aggregateColumnName] else {
                throw LocalStoreError.validation("Unknown aggregate column: \(columnName ?? "")")
            }
            if functionName == .avg || functionName == .sum {
                if descriptor.type != LocalAISqlColumnType.integer && descriptor.type != LocalAISqlColumnType.number {
                    throw LocalStoreError.validation("\(functionName.rawValue.uppercased()) only supports numeric columns")
                }
            }
        }
    }

    for item in statement.orderBy where outputNames.contains(item.expressionName) == false && statement.groupBy.contains(item.expressionName) == false {
        throw LocalStoreError.validation("Unknown ORDER BY target: \(item.expressionName)")
    }
}

private func groupRowsForAggregateSelect(
    rows: [LocalAISqlRow],
    groupBy: [String],
    shouldReturnSingleAggregateRow: Bool
) -> [LocalAISqlGroupedRows] {
    if groupBy.isEmpty {
        if rows.isEmpty && shouldReturnSingleAggregateRow == false {
            return []
        }
        return [LocalAISqlGroupedRows(groupRow: [:], groupedRows: rows)]
    }

    var groupedRowsByKey: [String: LocalAISqlGroupedRows] = [:]
    var orderedKeys: [String] = []

    for row in rows {
        let keyValues = groupBy.map { columnName in
            row[columnName] ?? .null
        }
        let key = keyValues.map(String.init(describing:)).joined(separator: "\u{0001}")
        if let existing = groupedRowsByKey[key] {
            groupedRowsByKey[key] = LocalAISqlGroupedRows(
                groupRow: existing.groupRow,
                groupedRows: existing.groupedRows + [row]
            )
            continue
        }

        let groupRow = Dictionary(uniqueKeysWithValues: groupBy.map { columnName in
            (columnName, row[columnName] ?? .null)
        })
        groupedRowsByKey[key] = LocalAISqlGroupedRows(groupRow: groupRow, groupedRows: [row])
        orderedKeys.append(key)
    }

    return orderedKeys.compactMap { key in
        groupedRowsByKey[key]
    }
}

private func buildAggregateOutputRow(
    groupRow: LocalAISqlRow,
    groupedRows: [LocalAISqlRow],
    selectItems: [LocalAISqlSelectItem]
) throws -> LocalAISqlRow {
    var outputRow: LocalAISqlRow = [:]

    for item in selectItems {
        switch item {
        case .wildcard:
            throw LocalStoreError.validation("Aggregate SELECT cannot project *")
        case .column(let columnName, let alias):
            outputRow[alias ?? columnName] = groupRow[columnName] ?? .null
        case .aggregate(let functionName, let columnName, let alias):
            let outputName = alias ?? defaultAggregateAlias(functionName: functionName, columnName: columnName)
            if functionName == .count {
                outputRow[outputName] = .integer(groupedRows.count)
                continue
            }

            guard let aggregateColumnName = columnName else {
                throw LocalStoreError.validation("Aggregate column is required")
            }

            if functionName == .sum {
                let values = normalizeAggregateNumbers(rows: groupedRows, columnName: aggregateColumnName)
                outputRow[outputName] = .number(values.reduce(0, +))
                continue
            }

            if functionName == .avg {
                let values = normalizeAggregateNumbers(rows: groupedRows, columnName: aggregateColumnName)
                if values.isEmpty {
                    outputRow[outputName] = .null
                } else {
                    outputRow[outputName] = .number(values.reduce(0, +) / Double(values.count))
                }
                continue
            }

            let comparableValues = normalizeAggregateComparableValues(rows: groupedRows, columnName: aggregateColumnName)
            if comparableValues.isEmpty {
                outputRow[outputName] = .null
                continue
            }

            let sortedValues = comparableValues.sorted { left, right in
                compareRowValues(left: left, right: right) < 0
            }
            outputRow[outputName] = functionName == .min ? sortedValues.first ?? .null : sortedValues.last ?? .null
        }
    }

    return outputRow
}

private func executeAggregateSelect(
    statement: LocalAISqlSelectStatement,
    rows: [LocalAISqlRow]
) throws -> [LocalAISqlRow] {
    try validateAggregateSelect(statement: statement)
    let groups = groupRowsForAggregateSelect(
        rows: rows,
        groupBy: statement.groupBy,
        shouldReturnSingleAggregateRow: statement.selectItems.contains { item in
            if case .aggregate = item {
                return true
            }
            return false
        }
    )
    let aggregateRows = try groups.map { group in
        try buildAggregateOutputRow(
            groupRow: group.groupRow,
            groupedRows: group.groupedRows,
            selectItems: statement.selectItems
        )
    }
    return applyOrderBy(rows: aggregateRows, orderBy: statement.orderBy)
}

private func isWildcardSelect(_ statement: LocalAISqlSelectStatement) -> Bool {
    if statement.selectItems.count != 1 {
        return false
    }
    if case .wildcard = statement.selectItems[0] {
        return true
    }
    return false
}

/**
 Mirrors `apps/backend/src/aiTools/sqlDialect.ts::executeSqlSelect`.
 Keep aggregate execution, `NOW()` filtering, and `UNNEST tags AS tag`
 semantics aligned across backend and iOS-local SQL runtimes.
 */
private func executeSqlSelect(
    statement: LocalAISqlSelectStatement,
    rows: [LocalAISqlRow]
) throws -> LocalAISqlSelectExecutionResult {
    let limit = try normalizeSqlLimit(statement.limit)
    let offset = try normalizeSqlOffset(statement.offset)
    let expandedRows = expandRowsForSource(source: statement.source, rows: rows)
    let filteredRows = try applyPredicateClauses(
        source: statement.source,
        rows: expandedRows,
        predicateClauses: statement.predicateClauses
    )
    let orderedRows: [LocalAISqlRow]
    if isWildcardSelect(statement) {
        try validateRowOrderBy(source: statement.source, orderBy: statement.orderBy)
        orderedRows = applyOrderBy(rows: filteredRows, orderBy: statement.orderBy)
    } else {
        orderedRows = try executeAggregateSelect(statement: statement, rows: filteredRows)
    }
    let paginatedRows = paginateRows(rows: orderedRows, limit: limit, offset: offset)
    return LocalAISqlSelectExecutionResult(
        rows: paginatedRows.rows,
        rowCount: paginatedRows.rows.count,
        limit: limit,
        offset: offset,
        hasMore: paginatedRows.hasMore
    )
}

private func statementValueString(
    _ value: LocalAISqlStatementValue?
) -> String? {
    guard let value else {
        return nil
    }
    if case .literal(.string(let rawValue)) = value {
        return rawValue
    }
    return nil
}

private func statementValueEffortLevel(
    _ value: LocalAISqlStatementValue?
) -> EffortLevel? {
    guard let rawValue = statementValueString(value) else {
        return nil
    }
    return EffortLevel(rawValue: rawValue)
}

private func statementValueStringArray(
    _ value: LocalAISqlStatementValue?
) -> [String]? {
    guard let value else {
        return nil
    }
    if case .stringArray(let rawValue) = value {
        return rawValue
    }
    return nil
}

private func rowFromInsert(
    columnNames: [String],
    values: [LocalAISqlStatementValue]
) -> [String: LocalAISqlStatementValue] {
    Dictionary(uniqueKeysWithValues: columnNames.enumerated().compactMap { index, columnName in
        guard let value = values[safe: index] else {
            return nil
        }
        return (columnName, value)
    })
}

private func toCreateCardInput(row: [String: LocalAISqlStatementValue]) throws -> CardEditorInput {
    guard let frontText = statementValueString(row["front_text"]),
          let backText = statementValueString(row["back_text"]) else {
        throw LocalStoreError.validation("INSERT INTO cards requires front_text and back_text")
    }
    guard let effortLevel = statementValueEffortLevel(row["effort_level"]) else {
        throw LocalStoreError.validation("INSERT INTO cards requires effort_level to be fast, medium, or long")
    }

    return CardEditorInput(
        frontText: frontText,
        backText: backText,
        tags: statementValueStringArray(row["tags"]) ?? [],
        effortLevel: effortLevel
    )
}

private func toCreateDeckInput(row: [String: LocalAISqlStatementValue]) throws -> DeckEditorInput {
    guard let name = statementValueString(row["name"]) else {
        throw LocalStoreError.validation("INSERT INTO decks requires name")
    }

    let effortLevels = (statementValueStringArray(row["effort_levels"]) ?? []).compactMap(EffortLevel.init(rawValue:))

    return DeckEditorInput(
        name: name,
        filterDefinition: buildDeckFilterDefinition(
            effortLevels: effortLevels,
            tags: statementValueStringArray(row["tags"]) ?? []
        )
    )
}

private func toResolvedCardUpdateInput(
    existingCard: Card,
    row: [String: LocalAISqlStatementValue]
) -> CardEditorInput {
    CardEditorInput(
        frontText: statementValueString(row["front_text"]) ?? existingCard.frontText,
        backText: statementValueString(row["back_text"]) ?? existingCard.backText,
        tags: statementValueStringArray(row["tags"]) ?? existingCard.tags,
        effortLevel: statementValueEffortLevel(row["effort_level"]) ?? existingCard.effortLevel
    )
}

private func toResolvedDeckUpdateInput(
    existingDeck: Deck,
    row: [String: LocalAISqlStatementValue]
) -> DeckEditorInput {
    DeckEditorInput(
        name: statementValueString(row["name"]) ?? existingDeck.name,
        filterDefinition: buildDeckFilterDefinition(
            effortLevels: statementValueStringArray(row["effort_levels"])?.compactMap(EffortLevel.init(rawValue:))
                ?? existingDeck.filterDefinition.effortLevels,
            tags: statementValueStringArray(row["tags"]) ?? existingDeck.filterDefinition.tags
        )
    )
}

private func findCard(snapshot: AppStateSnapshot, cardId: String) throws -> Card {
    guard let card = snapshot.cards.first(where: { item in
        item.cardId == cardId && item.deletedAt == nil
    }) else {
        throw LocalStoreError.notFound("Card not found")
    }
    return card
}

private func findDeck(snapshot: AppStateSnapshot, deckId: String) throws -> Deck {
    guard let deck = snapshot.decks.first(where: { item in
        item.deckId == deckId && item.deletedAt == nil
    }) else {
        throw LocalStoreError.notFound("Deck not found")
    }
    return deck
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
    snapshot: AppStateSnapshot,
    sql: String,
    encoder: JSONEncoder
) throws -> LocalAISqlExecutionResult {
    let statement = try localAISqlParseStatement(sql)

    switch statement {
    case .showTables(let showTablesStatement):
        let likeExpression = try showTablesStatement.likePattern.map(likePatternToRegex)
        let rows = localAISqlResourceDescriptors().filter { descriptor in
            guard let likeExpression else {
                return true
            }
            return regexMatches(expression: likeExpression, value: descriptor.resourceName.rawValue)
        }.map { descriptor in
            [
                "table_name": LocalAISqlRowValue.string(descriptor.resourceName.rawValue),
                "writable": .boolean(descriptor.writable),
                "description": .string(descriptor.description),
            ]
        }
        return LocalAISqlExecutionResult(
            output: try encodeJSON(
                value: LocalAISqlReadPayload(
                    statementType: "show_tables",
                    resource: nil,
                    sql: sql,
                    normalizedSql: showTablesStatement.normalizedSql,
                    rows: rows,
                    rowCount: rows.count,
                    limit: nil,
                    offset: nil,
                    hasMore: false
                ),
                encoder: encoder
            ),
            didMutateAppState: false
        )
    case .describe(let describeStatement):
        let descriptor = try localAISqlResourceDescriptor(resourceName: describeStatement.resourceName)
        let rows = descriptor.columns.map { column in
            [
                "column_name": LocalAISqlRowValue.string(column.columnName),
                "type": .string(column.type.rawValue),
                "nullable": .boolean(column.nullable),
                "read_only": .boolean(column.readOnly),
                "filterable": .boolean(column.filterable),
                "sortable": .boolean(column.sortable),
                "description": .string(column.description),
            ]
        }
        return LocalAISqlExecutionResult(
            output: try encodeJSON(
                value: LocalAISqlReadPayload(
                    statementType: "describe",
                    resource: describeStatement.resourceName.rawValue,
                    sql: sql,
                    normalizedSql: describeStatement.normalizedSql,
                    rows: rows,
                    rowCount: rows.count,
                    limit: nil,
                    offset: nil,
                    hasMore: false
                ),
                encoder: encoder
            ),
            didMutateAppState: false
        )
    case .select(let selectStatement):
        let result = try executeSqlSelect(
            statement: selectStatement,
            rows: try loadSelectRows(
                database: database,
                snapshot: snapshot,
                resourceName: selectStatement.source.resourceName
            )
        )
        return LocalAISqlExecutionResult(
            output: try encodeJSON(
                value: LocalAISqlReadPayload(
                    statementType: "select",
                    resource: selectStatement.source.resourceName.rawValue,
                    sql: sql,
                    normalizedSql: selectStatement.normalizedSql,
                    rows: result.rows,
                    rowCount: result.rowCount,
                    limit: result.limit,
                    offset: result.offset,
                    hasMore: result.hasMore
                ),
                encoder: encoder
            ),
            didMutateAppState: false
        )
    case .insert(let insertStatement):
        if insertStatement.resourceName == .cards {
            let createdCards = try database.createCards(
                workspaceId: snapshot.workspace.workspaceId,
                inputs: try insertStatement.rows.map { values in
                    try toCreateCardInput(row: rowFromInsert(columnNames: insertStatement.columnNames, values: values))
                }
            )
            return LocalAISqlExecutionResult(
                output: try encodeJSON(
                    value: LocalAISqlMutationPayload(
                        statementType: "insert",
                        resource: insertStatement.resourceName.rawValue,
                        sql: sql,
                        normalizedSql: insertStatement.normalizedSql,
                        rows: createdCards.map(toSqlCardRow),
                        affectedCount: createdCards.count
                    ),
                    encoder: encoder
                ),
                didMutateAppState: true
            )
        }

        let createdDecks = try database.createDecks(
            workspaceId: snapshot.workspace.workspaceId,
            inputs: try insertStatement.rows.map { values in
                try toCreateDeckInput(row: rowFromInsert(columnNames: insertStatement.columnNames, values: values))
            }
        )
        return LocalAISqlExecutionResult(
            output: try encodeJSON(
                value: LocalAISqlMutationPayload(
                    statementType: "insert",
                    resource: insertStatement.resourceName.rawValue,
                    sql: sql,
                    normalizedSql: insertStatement.normalizedSql,
                    rows: createdDecks.map(toSqlDeckRow),
                    affectedCount: createdDecks.count
                ),
                encoder: encoder
            ),
            didMutateAppState: true
        )
    case .update(let updateStatement):
        let matchingRows = try applyPredicateClauses(
            source: LocalAISqlFromSource(resourceName: updateStatement.resourceName, unnestColumnName: nil, unnestAlias: nil),
            rows: try loadSelectRows(
                database: database,
                snapshot: snapshot,
                resourceName: updateStatement.resourceName
            ),
            predicateClauses: updateStatement.predicateClauses
        )
        let assignmentRow = Dictionary(uniqueKeysWithValues: updateStatement.assignments.map { assignment in
            (assignment.columnName, assignment.value)
        })

        if updateStatement.resourceName == .cards {
            let updates = try matchingRows.map { row in
                guard case .string(let cardId) = row["card_id"] else {
                    throw LocalStoreError.validation("Expected card_id in selected row")
                }
                return CardUpdateInput(
                    cardId: cardId,
                    input: toResolvedCardUpdateInput(
                        existingCard: try findCard(snapshot: snapshot, cardId: cardId),
                        row: assignmentRow
                    )
                )
            }
            let updatedCards = try database.updateCards(workspaceId: snapshot.workspace.workspaceId, updates: updates)
            return LocalAISqlExecutionResult(
                output: try encodeJSON(
                    value: LocalAISqlMutationPayload(
                        statementType: "update",
                        resource: updateStatement.resourceName.rawValue,
                        sql: sql,
                        normalizedSql: updateStatement.normalizedSql,
                        rows: updatedCards.map(toSqlCardRow),
                        affectedCount: updatedCards.count
                    ),
                    encoder: encoder
                ),
                didMutateAppState: true
            )
        }

        let updates = try matchingRows.map { row in
            guard case .string(let deckId) = row["deck_id"] else {
                throw LocalStoreError.validation("Expected deck_id in selected row")
            }
            return DeckUpdateInput(
                deckId: deckId,
                input: toResolvedDeckUpdateInput(
                    existingDeck: try findDeck(snapshot: snapshot, deckId: deckId),
                    row: assignmentRow
                )
            )
        }
        let updatedDecks = try database.updateDecks(workspaceId: snapshot.workspace.workspaceId, updates: updates)
        return LocalAISqlExecutionResult(
            output: try encodeJSON(
                value: LocalAISqlMutationPayload(
                    statementType: "update",
                    resource: updateStatement.resourceName.rawValue,
                    sql: sql,
                    normalizedSql: updateStatement.normalizedSql,
                    rows: updatedDecks.map(toSqlDeckRow),
                    affectedCount: updatedDecks.count
                ),
                encoder: encoder
            ),
            didMutateAppState: true
        )
    case .delete(let deleteStatement):
        let matchingRows = try applyPredicateClauses(
            source: LocalAISqlFromSource(resourceName: deleteStatement.resourceName, unnestColumnName: nil, unnestAlias: nil),
            rows: try loadSelectRows(
                database: database,
                snapshot: snapshot,
                resourceName: deleteStatement.resourceName
            ),
            predicateClauses: deleteStatement.predicateClauses
        )

        if deleteStatement.resourceName == .cards {
            let cardIds = try matchingRows.map { row in
                guard case .string(let cardId) = row["card_id"] else {
                    throw LocalStoreError.validation("Expected card_id in selected row")
                }
                return cardId
            }
            _ = try database.deleteCards(workspaceId: snapshot.workspace.workspaceId, cardIds: cardIds)
            return LocalAISqlExecutionResult(
                output: try encodeJSON(
                    value: LocalAISqlMutationPayload(
                        statementType: "delete",
                        resource: deleteStatement.resourceName.rawValue,
                        sql: sql,
                        normalizedSql: deleteStatement.normalizedSql,
                        rows: [],
                        affectedCount: cardIds.count
                    ),
                    encoder: encoder
                ),
                didMutateAppState: true
            )
        }

        let deckIds = try matchingRows.map { row in
            guard case .string(let deckId) = row["deck_id"] else {
                throw LocalStoreError.validation("Expected deck_id in selected row")
            }
            return deckId
        }
        _ = try database.deleteDecks(workspaceId: snapshot.workspace.workspaceId, deckIds: deckIds)
        return LocalAISqlExecutionResult(
            output: try encodeJSON(
                value: LocalAISqlMutationPayload(
                    statementType: "delete",
                    resource: deleteStatement.resourceName.rawValue,
                    sql: sql,
                    normalizedSql: deleteStatement.normalizedSql,
                    rows: [],
                    affectedCount: deckIds.count
                ),
                encoder: encoder
            ),
            didMutateAppState: true
        )
    }
}

private func encodeJSON<Value: Encodable>(
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
 Executes local AI tools against the iOS app snapshot and local database.

 Mirrors:
 - `apps/web/src/chat/localToolExecutor.ts::createLocalToolExecutor`
 - `apps/backend/src/chat/openai/localTools.ts`
 */
actor LocalAIToolExecutor: AIToolExecuting, AIChatSnapshotLoading {
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
        let snapshot = try database.loadStateSnapshot()

        switch toolCallRequest.name {
        case "sql":
            let input = try self.decodeInput(SqlToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            let result = try executeSqlLocally(
                database: database,
                snapshot: snapshot,
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
                output: try encodeJSON(value: snapshot.cloudSettings, encoder: self.encoder),
                didMutateAppState: false
            )
        case "list_outbox":
            let input = try self.decodeInput(ListOutboxToolInput.self, toolCallRequest: toolCallRequest, requestId: requestId)
            return AIToolExecutionResult(
                output: try encodeJSON(
                    value: try self.makeOutboxPayload(
                        database: database,
                        workspaceId: snapshot.workspace.workspaceId,
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

    func loadSnapshot() async throws -> AppStateSnapshot {
        try self.loadSnapshotNow()
    }

    private func databaseInstance() throws -> LocalDatabase {
        if let database = self.database {
            return database
        }

        let database = try LocalDatabase(databaseURL: self.databaseURL)
        self.database = database
        return database
    }

    private func loadSnapshotNow() throws -> AppStateSnapshot {
        try self.databaseInstance().loadStateSnapshot()
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

struct UnavailableAIToolExecutor: AIToolExecuting, AIChatSnapshotLoading {
    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        _ = toolCallRequest
        _ = requestId
        throw LocalStoreError.uninitialized("AI tool executor is unavailable")
    }

    func loadSnapshot() async throws -> AppStateSnapshot {
        throw LocalStoreError.uninitialized("AI tool executor is unavailable")
    }
}

private struct EmptyToolInput: Decodable {
    init(from decoder: Decoder) throws {
        try validateObjectKeys(decoder: decoder, allowedKeys: Set(), context: "empty")
    }
}

private extension ComparisonResult {
    var comparisonNumber: Int {
        switch self {
        case .orderedAscending:
            return -1
        case .orderedSame:
            return 0
        case .orderedDescending:
            return 1
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        if indices.contains(index) {
            return self[index]
        }

        return nil
    }
}
