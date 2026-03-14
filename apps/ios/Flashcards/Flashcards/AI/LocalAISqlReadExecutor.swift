import Foundation

func normalizeSqlLimit(_ limit: Int?) throws -> Int {
    guard let limit else {
        return maxLocalAISqlLimit
    }
    if limit < 1 {
        throw LocalStoreError.validation("LIMIT must be greater than 0")
    }
    return min(limit, maxLocalAISqlLimit)
}

func normalizeSqlOffset(_ offset: Int?) throws -> Int {
    guard let offset else {
        return 0
    }
    if offset < 0 {
        throw LocalStoreError.validation("OFFSET must be a non-negative integer")
    }
    return offset
}

private func compareCardsByUpdatedAt(left: Card, right: Card) -> Bool {
    if left.updatedAt != right.updatedAt {
        return left.updatedAt > right.updatedAt
    }

    if left.createdAt != right.createdAt {
        return left.createdAt > right.createdAt
    }

    return left.cardId < right.cardId
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
func currentActiveCards(snapshot: AppStateSnapshot) -> [Card] {
    activeCards(cards: snapshot.cards).sorted(by: compareCardsByUpdatedAt)
}

func activeDecks(snapshot: AppStateSnapshot) -> [Deck] {
    snapshot.decks.filter { deck in
        deck.deletedAt == nil
    }.sorted(by: compareDecksByUpdatedAt)
}

func toSqlRowValue(literal: LocalAISqlLiteralValue) -> LocalAISqlRowValue {
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

func toSqlWorkspaceRow(snapshot: AppStateSnapshot) -> LocalAISqlRow {
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

func toSqlCardRow(card: Card) -> LocalAISqlRow {
    [
        "card_id": .string(card.cardId),
        "front_text": .string(card.frontText),
        "back_text": .string(card.backText),
        "tags": .stringArray(card.tags),
        "effort_level": .string(card.effortLevel.rawValue),
        "due_at": card.dueAt.map(LocalAISqlRowValue.string) ?? .null,
        "created_at": .string(card.createdAt),
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

func toSqlDeckRow(deck: Deck) -> LocalAISqlRow {
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

func toSqlReviewEventRow(event: ReviewEvent) -> LocalAISqlRow {
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

private func escapeLikePattern(_ value: String) -> String {
    NSRegularExpression.escapedPattern(for: value)
}

private func likePatternToRegularExpression(
    _ value: String,
    caseInsensitive: Bool
) throws -> NSRegularExpression {
    let escapedPattern = escapeLikePattern(value)
        .replacingOccurrences(of: "%", with: ".*")
        .replacingOccurrences(of: "_", with: ".")
    let options: NSRegularExpression.Options = caseInsensitive ? [.caseInsensitive] : []
    return try NSRegularExpression(pattern: "^\(escapedPattern)$", options: options)
}

private func stringValueMatchesLikePattern(
    value: String,
    pattern: String,
    caseInsensitive: Bool
) throws -> Bool {
    let regularExpression = try likePatternToRegularExpression(
        pattern,
        caseInsensitive: caseInsensitive
    )
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return regularExpression.firstMatch(in: value, options: [], range: range) != nil
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
    case .like(let columnName, let pattern, let caseInsensitive):
        guard case .some(.string(let value)) = row[columnName] else {
            return false
        }
        return try stringValueMatchesLikePattern(
            value: value,
            pattern: pattern,
            caseInsensitive: caseInsensitive
        )
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
    case .like(let predicateColumnName, _, _):
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

func applyPredicateClauses(
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

    if orderBy.count == 1, case .random = orderBy[0] {
        var shuffledRows = rows
        shuffledRows.shuffle()
        return shuffledRows
    }

    return rows.sorted { left, right in
        for item in orderBy {
            guard case .column(let expressionName, let direction) = item else {
                return false
            }
            let comparison = compareRowValues(left: left[expressionName], right: right[expressionName])
            if comparison != 0 {
                return direction == .desc ? comparison > 0 : comparison < 0
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

func likePatternToRegex(_ value: String) throws -> NSRegularExpression {
    let escapedValue = NSRegularExpression.escapedPattern(for: value)
        .replacingOccurrences(of: "%", with: ".*")
        .replacingOccurrences(of: "_", with: ".")
    return try NSRegularExpression(pattern: "^\(escapedValue)$", options: [.caseInsensitive])
}

func regexMatches(
    expression: NSRegularExpression,
    value: String
) -> Bool {
    let fullRange = NSRange(value.startIndex..<value.endIndex, in: value)
    return expression.firstMatch(in: value, options: [], range: fullRange) != nil
}

func loadSelectRows(
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
        guard case .column(let expressionName, _) = item else {
            continue
        }
        guard let descriptor = descriptors[expressionName] else {
            throw LocalStoreError.validation("Unknown ORDER BY target: \(expressionName)")
        }
        if descriptor.sortable == false {
            throw LocalStoreError.validation("Column is not sortable: \(expressionName)")
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

    for item in statement.orderBy {
        guard case .column(let expressionName, _) = item else {
            continue
        }
        if outputNames.contains(expressionName) == false && statement.groupBy.contains(expressionName) == false {
            throw LocalStoreError.validation("Unknown ORDER BY target: \(expressionName)")
        }
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

private func projectSelectRow(
    row: LocalAISqlRow,
    selectItems: [LocalAISqlSelectItem]
) throws -> LocalAISqlRow {
    var outputRow: LocalAISqlRow = [:]

    for item in selectItems {
        guard case .column(let columnName, let alias) = item else {
            throw LocalStoreError.validation("Projected SELECT can only include columns")
        }
        outputRow[alias ?? columnName] = row[columnName] ?? .null
    }

    return outputRow
}

private func executeProjectedSelect(
    statement: LocalAISqlSelectStatement,
    rows: [LocalAISqlRow]
) throws -> [LocalAISqlRow] {
    try validateRowOrderBy(source: statement.source, orderBy: statement.orderBy)
    let orderedRows = applyOrderBy(rows: rows, orderBy: statement.orderBy)
    return try orderedRows.map { row in
        try projectSelectRow(row: row, selectItems: statement.selectItems)
    }
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

private func isGroupedSelect(_ statement: LocalAISqlSelectStatement) -> Bool {
    if statement.groupBy.isEmpty == false {
        return true
    }

    return statement.selectItems.contains { item in
        if case .aggregate = item {
            return true
        }
        return false
    }
}

/**
 Mirrors `apps/backend/src/aiTools/sqlDialect.ts::executeSqlSelect`.
 Keep aggregate execution, `NOW()` filtering, and `UNNEST tags AS tag`
 semantics aligned across backend and iOS-local SQL runtimes.
 */
func executeSqlSelect(
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
    } else if isGroupedSelect(statement) {
        orderedRows = try executeAggregateSelect(statement: statement, rows: filteredRows)
    } else {
        orderedRows = try executeProjectedSelect(statement: statement, rows: filteredRows)
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

func executeLocalAISqlReadStatement(
    database: LocalDatabase,
    snapshot: AppStateSnapshot,
    sql: String,
    statement: LocalAISqlStatement,
    encoder: JSONEncoder
) throws -> LocalAISqlExecutionResult {
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
    default:
        throw LocalStoreError.validation("Expected a read SQL statement")
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
