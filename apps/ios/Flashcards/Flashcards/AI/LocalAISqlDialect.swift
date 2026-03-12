import Foundation

/**
 iOS mirror of the published SQL dialect used by backend and browser-local AI
 runtimes.

 Keep this file aligned with:
 - `apps/backend/src/aiTools/sqlDialect.ts`
 - `apps/web/src/chat/localToolExecutor.ts`
 */

enum LocalAISqlResourceName: String, CaseIterable, Sendable {
    case workspace
    case cards
    case decks
    case reviewEvents = "review_events"
}

enum LocalAISqlOrderDirection: String, Sendable {
    case asc
    case desc
}

enum LocalAISqlColumnType: String, Sendable {
    case string
    case stringArray = "string[]"
    case integerArray = "integer[]"
    case uuid
    case integer
    case number
    case boolean
    case datetime
}

enum LocalAISqlComparisonOperator: String, Sendable {
    case equals = "="
    case lessThan = "<"
    case lessThanOrEqual = "<="
    case greaterThan = ">"
    case greaterThanOrEqual = ">="
}

enum LocalAISqlAggregateFunctionName: String, Sendable {
    case count
    case sum
    case avg
    case min
    case max
}

struct LocalAISqlColumnDescriptor: Sendable {
    let columnName: String
    let type: LocalAISqlColumnType
    let nullable: Bool
    let readOnly: Bool
    let filterable: Bool
    let sortable: Bool
    let description: String
}

struct LocalAISqlResourceDescriptor: Sendable {
    let resourceName: LocalAISqlResourceName
    let description: String
    let columns: [LocalAISqlColumnDescriptor]
    let writable: Bool
}

enum LocalAISqlLiteralValue: Sendable {
    case string(String)
    case integer(Int)
    case number(Double)
    case boolean(Bool)
    case null
}

enum LocalAISqlPredicateValue: Sendable {
    case literal(LocalAISqlLiteralValue)
    case now
}

enum LocalAISqlStatementValue: Sendable {
    case literal(LocalAISqlLiteralValue)
    case stringArray([String])
}

enum LocalAISqlPredicate: Sendable {
    case comparison(columnName: String, `operator`: LocalAISqlComparisonOperator, value: LocalAISqlPredicateValue)
    case `in`(columnName: String, values: [LocalAISqlLiteralValue])
    case overlap(columnName: String, values: [String])
    case isNull(columnName: String)
    case isNotNull(columnName: String)
    case match(query: String)
}

typealias LocalAISqlPredicateClause = [LocalAISqlPredicate]

struct LocalAISqlSelectOrderBy: Sendable {
    let expressionName: String
    let direction: LocalAISqlOrderDirection
}

enum LocalAISqlSelectItem: Sendable {
    case wildcard
    case column(columnName: String, alias: String?)
    case aggregate(functionName: LocalAISqlAggregateFunctionName, columnName: String?, alias: String?)
}

struct LocalAISqlFromSource: Sendable {
    let resourceName: LocalAISqlResourceName
    let unnestColumnName: String?
    let unnestAlias: String?
}

struct LocalAISqlSelectStatement: Sendable {
    let source: LocalAISqlFromSource
    let selectItems: [LocalAISqlSelectItem]
    let predicateClauses: [LocalAISqlPredicateClause]
    let groupBy: [String]
    let orderBy: [LocalAISqlSelectOrderBy]
    let limit: Int?
    let offset: Int?
    let normalizedSql: String
}

struct LocalAISqlShowTablesStatement: Sendable {
    let likePattern: String?
    let normalizedSql: String
}

struct LocalAISqlDescribeStatement: Sendable {
    let resourceName: LocalAISqlResourceName
    let normalizedSql: String
}

struct LocalAISqlInsertStatement: Sendable {
    let resourceName: LocalAISqlResourceName
    let columnNames: [String]
    let rows: [[LocalAISqlStatementValue]]
    let normalizedSql: String
}

struct LocalAISqlAssignment: Sendable {
    let columnName: String
    let value: LocalAISqlStatementValue
}

struct LocalAISqlUpdateStatement: Sendable {
    let resourceName: LocalAISqlResourceName
    let assignments: [LocalAISqlAssignment]
    let predicateClauses: [LocalAISqlPredicateClause]
    let normalizedSql: String
}

struct LocalAISqlDeleteStatement: Sendable {
    let resourceName: LocalAISqlResourceName
    let predicateClauses: [LocalAISqlPredicateClause]
    let normalizedSql: String
}

enum LocalAISqlStatement: Sendable {
    case showTables(LocalAISqlShowTablesStatement)
    case describe(LocalAISqlDescribeStatement)
    case select(LocalAISqlSelectStatement)
    case insert(LocalAISqlInsertStatement)
    case update(LocalAISqlUpdateStatement)
    case delete(LocalAISqlDeleteStatement)
}

private let localAISqlCardColumnDescriptors: [LocalAISqlColumnDescriptor] = [
    LocalAISqlColumnDescriptor(columnName: "card_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Card identifier."),
    LocalAISqlColumnDescriptor(columnName: "front_text", type: .string, nullable: false, readOnly: false, filterable: true, sortable: true, description: "Card front prompt text."),
    LocalAISqlColumnDescriptor(columnName: "back_text", type: .string, nullable: false, readOnly: false, filterable: true, sortable: true, description: "Card back answer text."),
    LocalAISqlColumnDescriptor(columnName: "tags", type: .stringArray, nullable: false, readOnly: false, filterable: true, sortable: true, description: "Card tags."),
    LocalAISqlColumnDescriptor(columnName: "effort_level", type: .string, nullable: false, readOnly: false, filterable: true, sortable: true, description: "Card effort level."),
    LocalAISqlColumnDescriptor(columnName: "due_at", type: .datetime, nullable: true, readOnly: true, filterable: true, sortable: true, description: "Next due timestamp."),
    LocalAISqlColumnDescriptor(columnName: "reps", type: .integer, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Total reps count."),
    LocalAISqlColumnDescriptor(columnName: "lapses", type: .integer, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Total lapses count."),
    LocalAISqlColumnDescriptor(columnName: "updated_at", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Last update timestamp."),
    LocalAISqlColumnDescriptor(columnName: "deleted_at", type: .datetime, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Deletion timestamp for tombstones."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_card_state", type: .string, nullable: false, readOnly: true, filterable: true, sortable: false, description: "Persisted FSRS state."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_step_index", type: .integer, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Persisted FSRS step index."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_stability", type: .number, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Persisted FSRS stability."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_difficulty", type: .number, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Persisted FSRS difficulty."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_last_reviewed_at", type: .datetime, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Persisted last reviewed timestamp."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_scheduled_days", type: .integer, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Persisted scheduled interval in days."),
]

private let localAISqlResourceDescriptorsByName: [LocalAISqlResourceName: LocalAISqlResourceDescriptor] = [
    .workspace: LocalAISqlResourceDescriptor(
        resourceName: .workspace,
        description: "Selected workspace identity and scheduler settings.",
        columns: [
            LocalAISqlColumnDescriptor(columnName: "workspace_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Selected workspace identifier."),
            LocalAISqlColumnDescriptor(columnName: "name", type: .string, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Selected workspace display name."),
            LocalAISqlColumnDescriptor(columnName: "created_at", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Workspace creation timestamp."),
            LocalAISqlColumnDescriptor(columnName: "algorithm", type: .string, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Scheduler algorithm identifier."),
            LocalAISqlColumnDescriptor(columnName: "desired_retention", type: .number, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Workspace desired retention target."),
            LocalAISqlColumnDescriptor(columnName: "learning_steps_minutes", type: .integerArray, nullable: false, readOnly: true, filterable: false, sortable: false, description: "Configured learning steps."),
            LocalAISqlColumnDescriptor(columnName: "relearning_steps_minutes", type: .integerArray, nullable: false, readOnly: true, filterable: false, sortable: false, description: "Configured relearning steps."),
            LocalAISqlColumnDescriptor(columnName: "maximum_interval_days", type: .integer, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Maximum review interval in days."),
            LocalAISqlColumnDescriptor(columnName: "enable_fuzz", type: .boolean, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Whether interval fuzz is enabled."),
        ],
        writable: false
    ),
    .cards: LocalAISqlResourceDescriptor(
        resourceName: .cards,
        description: "Cards in the selected workspace.",
        columns: localAISqlCardColumnDescriptors,
        writable: true
    ),
    .decks: LocalAISqlResourceDescriptor(
        resourceName: .decks,
        description: "Decks in the selected workspace.",
        columns: [
            LocalAISqlColumnDescriptor(columnName: "deck_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Deck identifier."),
            LocalAISqlColumnDescriptor(columnName: "name", type: .string, nullable: false, readOnly: false, filterable: true, sortable: true, description: "Deck name."),
            LocalAISqlColumnDescriptor(columnName: "tags", type: .stringArray, nullable: false, readOnly: false, filterable: true, sortable: false, description: "Deck filter tags."),
            LocalAISqlColumnDescriptor(columnName: "effort_levels", type: .stringArray, nullable: false, readOnly: false, filterable: true, sortable: false, description: "Deck filter effort levels."),
            LocalAISqlColumnDescriptor(columnName: "created_at", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Deck creation timestamp."),
            LocalAISqlColumnDescriptor(columnName: "updated_at", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Deck last update timestamp."),
            LocalAISqlColumnDescriptor(columnName: "deleted_at", type: .datetime, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Deck deletion timestamp."),
        ],
        writable: true
    ),
    .reviewEvents: LocalAISqlResourceDescriptor(
        resourceName: .reviewEvents,
        description: "Immutable review event rows.",
        columns: [
            LocalAISqlColumnDescriptor(columnName: "review_event_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Review event identifier."),
            LocalAISqlColumnDescriptor(columnName: "card_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Reviewed card identifier."),
            LocalAISqlColumnDescriptor(columnName: "device_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: false, description: "Device that submitted the review."),
            LocalAISqlColumnDescriptor(columnName: "client_event_id", type: .string, nullable: false, readOnly: true, filterable: true, sortable: false, description: "Client event identifier."),
            LocalAISqlColumnDescriptor(columnName: "rating", type: .integer, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Submitted review rating."),
            LocalAISqlColumnDescriptor(columnName: "reviewed_at_client", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Client review timestamp."),
            LocalAISqlColumnDescriptor(columnName: "reviewed_at_server", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Server review timestamp."),
        ],
        writable: false
    ),
]

func localAISqlResourceDescriptors() -> [LocalAISqlResourceDescriptor] {
    LocalAISqlResourceName.allCases.compactMap { resourceName in
        localAISqlResourceDescriptorsByName[resourceName]
    }
}

func localAISqlResourceDescriptor(resourceName: LocalAISqlResourceName) throws -> LocalAISqlResourceDescriptor {
    guard let descriptor = localAISqlResourceDescriptorsByName[resourceName] else {
        throw LocalStoreError.validation("Unknown resource: \(resourceName.rawValue)")
    }
    return descriptor
}

func localAISqlColumnDescriptor(
    resourceName: LocalAISqlResourceName,
    columnName: String
) throws -> LocalAISqlColumnDescriptor {
    let descriptor = try localAISqlResourceDescriptor(resourceName: resourceName)
    guard let columnDescriptor = descriptor.columns.first(where: { candidate in
        candidate.columnName == columnName
    }) else {
        throw LocalStoreError.validation("Unknown column for \(resourceName.rawValue): \(columnName)")
    }
    return columnDescriptor
}

func localAISqlNormalizeWhitespace(_ value: String) -> String {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let withoutSemicolon = trimmedValue.replacingOccurrences(
        of: #";\s*$"#,
        with: "",
        options: .regularExpression
    )
    return withoutSemicolon.replacingOccurrences(
        of: #"\s+"#,
        with: " ",
        options: .regularExpression
    )
}

private func localAISqlUppercaseKeyword(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .uppercased()
}

private func localAISqlFirstWord(_ value: String) -> String {
    let components = value.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
    guard let first = components.first else {
        return ""
    }
    return localAISqlUppercaseKeyword(String(first))
}

private func localAISqlMatch(
    pattern: String,
    value: String
) -> [String]? {
    guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
        return nil
    }
    let fullRange = NSRange(value.startIndex..<value.endIndex, in: value)
    guard let match = expression.firstMatch(in: value, options: [], range: fullRange) else {
        return nil
    }

    var groups: [String] = []
    groups.reserveCapacity(match.numberOfRanges)
    for rangeIndex in 0..<match.numberOfRanges {
        let range = match.range(at: rangeIndex)
        if range.location == NSNotFound {
            groups.append("")
            continue
        }
        guard let stringRange = Range(range, in: value) else {
            groups.append("")
            continue
        }
        groups.append(String(value[stringRange]))
    }
    return groups
}

private func localAISqlSeparatorMatches(
    characters: [Character],
    index: Int,
    separator: String
) -> Bool {
    let separatorCharacters = Array(separator.uppercased())
    if index + separatorCharacters.count > characters.count {
        return false
    }

    for offset in 0..<separatorCharacters.count {
        if String(characters[index + offset]).uppercased() != String(separatorCharacters[offset]) {
            return false
        }
    }

    return true
}

private func localAISqlSplitTopLevel(
    value: String,
    separator: String
) -> [String] {
    let characters = Array(value)
    var parts: [String] = []
    var current: [Character] = []
    var inString = false
    var depth = 0
    var index = 0

    while index < characters.count {
        let character = characters[index]
        let nextCharacter = index + 1 < characters.count ? characters[index + 1] : nil

        if character == "'" {
            current.append(character)
            if inString, nextCharacter == "'" {
                current.append("'")
                index += 2
                continue
            }

            inString.toggle()
            index += 1
            continue
        }

        if inString {
            current.append(character)
            index += 1
            continue
        }

        if character == "(" {
            depth += 1
            current.append(character)
            index += 1
            continue
        }

        if character == ")" {
            depth -= 1
            current.append(character)
            index += 1
            continue
        }

        if depth == 0, localAISqlSeparatorMatches(characters: characters, index: index, separator: separator) {
            let part = String(current).trimmingCharacters(in: .whitespacesAndNewlines)
            if part.isEmpty == false {
                parts.append(part)
            }
            current = []
            index += separator.count
            continue
        }

        current.append(character)
        index += 1
    }

    let tail = String(current).trimmingCharacters(in: .whitespacesAndNewlines)
    if tail.isEmpty == false {
        parts.append(tail)
    }

    return parts
}

private func localAISqlSplitTopLevelByKeyword(
    value: String,
    keyword: String
) -> [String] {
    let characters = Array(value)
    let keywordCharacters = Array(keyword.uppercased())
    var parts: [String] = []
    var current: [Character] = []
    var inString = false
    var depth = 0
    var index = 0

    while index < characters.count {
        let character = characters[index]
        let nextCharacter = index + 1 < characters.count ? characters[index + 1] : nil

        if character == "'" {
            current.append(character)
            if inString, nextCharacter == "'" {
                current.append("'")
                index += 2
                continue
            }

            inString.toggle()
            index += 1
            continue
        }

        if inString {
            current.append(character)
            index += 1
            continue
        }

        if character == "(" {
            depth += 1
            current.append(character)
            index += 1
            continue
        }

        if character == ")" {
            depth -= 1
            current.append(character)
            index += 1
            continue
        }

        let matchesKeyword = depth == 0
            && index + keywordCharacters.count <= characters.count
            && zip(keywordCharacters, characters[index..<(index + keywordCharacters.count)]).allSatisfy { left, right in
                String(left) == String(right).uppercased()
            }
        let precededByWhitespace = index == 0 || characters[index - 1].isWhitespace
        let followedByWhitespace = index + keywordCharacters.count >= characters.count
            || characters[index + keywordCharacters.count].isWhitespace

        if matchesKeyword && precededByWhitespace && followedByWhitespace {
            let part = String(current).trimmingCharacters(in: .whitespacesAndNewlines)
            if part.isEmpty == false {
                parts.append(part)
            }
            current = []
            index += keywordCharacters.count
            continue
        }

        current.append(character)
        index += 1
    }

    let tail = String(current).trimmingCharacters(in: .whitespacesAndNewlines)
    if tail.isEmpty == false {
        parts.append(tail)
    }

    return parts
}

private func localAISqlParseStringLiteral(_ value: String) throws -> String {
    guard value.hasPrefix("'"), value.hasSuffix("'"), value.count >= 2 else {
        throw LocalStoreError.validation("Expected a quoted string literal")
    }
    let startIndex = value.index(after: value.startIndex)
    let endIndex = value.index(before: value.endIndex)
    return value[startIndex..<endIndex].replacingOccurrences(of: "''", with: "'")
}

private func localAISqlParseLiteral(_ value: String) throws -> LocalAISqlLiteralValue {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedValue.caseInsensitiveCompare("NULL") == .orderedSame {
        return .null
    }
    if trimmedValue.caseInsensitiveCompare("TRUE") == .orderedSame {
        return .boolean(true)
    }
    if trimmedValue.caseInsensitiveCompare("FALSE") == .orderedSame {
        return .boolean(false)
    }
    if trimmedValue.hasPrefix("'"), trimmedValue.hasSuffix("'") {
        return .string(try localAISqlParseStringLiteral(trimmedValue))
    }
    if trimmedValue.range(of: #"^-?\d+$"#, options: .regularExpression) != nil {
        guard let integerValue = Int(trimmedValue) else {
            throw LocalStoreError.validation("Unsupported literal: \(trimmedValue)")
        }
        return .integer(integerValue)
    }
    if trimmedValue.range(of: #"^-?\d+\.\d+$"#, options: .regularExpression) != nil {
        guard let numberValue = Double(trimmedValue) else {
            throw LocalStoreError.validation("Unsupported literal: \(trimmedValue)")
        }
        return .number(numberValue)
    }

    throw LocalStoreError.validation("Unsupported literal: \(trimmedValue)")
}

private func localAISqlParsePredicateValue(_ value: String) throws -> LocalAISqlPredicateValue {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedValue.caseInsensitiveCompare("NOW()") == .orderedSame {
        return .now
    }
    return .literal(try localAISqlParseLiteral(trimmedValue))
}

private func localAISqlParseStringArrayLiteralList(_ value: String) throws -> [String] {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.hasPrefix("("), trimmedValue.hasSuffix(")") else {
        throw LocalStoreError.validation("Expected a parenthesized value list")
    }
    let innerStart = trimmedValue.index(after: trimmedValue.startIndex)
    let innerEnd = trimmedValue.index(before: trimmedValue.endIndex)
    let innerValue = trimmedValue[innerStart..<innerEnd].trimmingCharacters(in: .whitespacesAndNewlines)
    if innerValue.isEmpty {
        return []
    }

    return try localAISqlSplitTopLevel(value: innerValue, separator: ",").map { item in
        let parsedValue = try localAISqlParseLiteral(item)
        guard case .string(let stringValue) = parsedValue else {
            throw LocalStoreError.validation("Expected only string literals in the list")
        }
        return stringValue
    }
}

func localAISqlSourceColumnDescriptors(
    source: LocalAISqlFromSource
) throws -> [String: LocalAISqlColumnDescriptor] {
    var descriptors = Dictionary(uniqueKeysWithValues: try localAISqlResourceDescriptor(resourceName: source.resourceName).columns.map { descriptor in
        (descriptor.columnName, descriptor)
    })

    if let unnestAlias = source.unnestAlias {
        descriptors[unnestAlias] = LocalAISqlColumnDescriptor(
            columnName: unnestAlias,
            type: .string,
            nullable: false,
            readOnly: true,
            filterable: true,
            sortable: true,
            description: "Expanded \(source.unnestColumnName ?? "unnest") element."
        )
    }

    return descriptors
}

private func localAISqlEnsureSourceColumnExists(
    source: LocalAISqlFromSource,
    columnName: String
) throws {
    let descriptors = try localAISqlSourceColumnDescriptors(source: source)
    if descriptors[columnName] == nil {
        throw LocalStoreError.validation("Unknown column for \(source.resourceName.rawValue): \(columnName)")
    }
}

private func localAISqlParseFromSource(
    resourceName: String,
    unnestColumnName: String?,
    unnestAlias: String?
) throws -> LocalAISqlFromSource {
    let normalizedResourceName = resourceName.lowercased()
    guard let parsedResourceName = LocalAISqlResourceName(rawValue: normalizedResourceName) else {
        throw LocalStoreError.validation("Unknown resource: \(normalizedResourceName)")
    }

    if unnestColumnName == nil, unnestAlias == nil {
        return LocalAISqlFromSource(resourceName: parsedResourceName, unnestColumnName: nil, unnestAlias: nil)
    }

    let normalizedUnnestColumnName = (unnestColumnName ?? "").lowercased()
    let normalizedUnnestAlias = (unnestAlias ?? "").lowercased()
    if parsedResourceName != .cards || normalizedUnnestColumnName != "tags" {
        throw LocalStoreError.validation("UNNEST is only supported for cards.tags")
    }

    return LocalAISqlFromSource(
        resourceName: parsedResourceName,
        unnestColumnName: normalizedUnnestColumnName,
        unnestAlias: normalizedUnnestAlias
    )
}

private func localAISqlParsePredicate(
    source: LocalAISqlFromSource,
    value: String
) throws -> LocalAISqlPredicate {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)

    if let groups = localAISqlMatch(
        pattern: #"^MATCH\s*\(\s*('(?:''|[^'])*')\s*\)$"#,
        value: trimmedValue
    ) {
        return .match(query: try localAISqlParseStringLiteral(groups[1]))
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)\s+IS\s+NOT\s+NULL$"#,
        value: trimmedValue
    ) {
        let columnName = groups[1].lowercased()
        try localAISqlEnsureSourceColumnExists(source: source, columnName: columnName)
        return .isNotNull(columnName: columnName)
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)\s+IS\s+NULL$"#,
        value: trimmedValue
    ) {
        let columnName = groups[1].lowercased()
        try localAISqlEnsureSourceColumnExists(source: source, columnName: columnName)
        return .isNull(columnName: columnName)
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)\s+OVERLAP\s*(\(.+\))$"#,
        value: trimmedValue
    ) {
        let columnName = groups[1].lowercased()
        try localAISqlEnsureSourceColumnExists(source: source, columnName: columnName)
        return .overlap(columnName: columnName, values: try localAISqlParseStringArrayLiteralList(groups[2]))
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)\s+IN\s*(\(.+\))$"#,
        value: trimmedValue
    ) {
        let columnName = groups[1].lowercased()
        try localAISqlEnsureSourceColumnExists(source: source, columnName: columnName)
        let listValue = groups[2]
        let innerStart = listValue.index(after: listValue.startIndex)
        let innerEnd = listValue.index(before: listValue.endIndex)
        let innerValue = String(listValue[innerStart..<innerEnd])
        let values = try localAISqlSplitTopLevel(value: innerValue, separator: ",").map(localAISqlParseLiteral)
        return .in(columnName: columnName, values: values)
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)\s*(=|<=|>=|<|>)\s*(.+)$"#,
        value: trimmedValue
    ) {
        let columnName = groups[1].lowercased()
        try localAISqlEnsureSourceColumnExists(source: source, columnName: columnName)
        guard let comparisonOperator = LocalAISqlComparisonOperator(rawValue: groups[2]) else {
            throw LocalStoreError.validation("Unsupported comparison operator: \(groups[2])")
        }
        return .comparison(
            columnName: columnName,
            operator: comparisonOperator,
            value: try localAISqlParsePredicateValue(groups[3])
        )
    }

    throw LocalStoreError.validation("Unsupported predicate: \(trimmedValue)")
}

private func localAISqlParsePredicateClauses(
    source: LocalAISqlFromSource,
    value: String
) throws -> [LocalAISqlPredicateClause] {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedValue.isEmpty {
        return []
    }

    return try localAISqlSplitTopLevelByKeyword(value: trimmedValue, keyword: "OR").map { clause in
        try localAISqlSplitTopLevelByKeyword(value: clause, keyword: "AND").map { predicate in
            try localAISqlParsePredicate(source: source, value: predicate)
        }
    }
}

private func localAISqlParseOrderBy(value: String) throws -> [LocalAISqlSelectOrderBy] {
    try localAISqlSplitTopLevel(value: value, separator: ",").map { item in
        guard let groups = localAISqlMatch(
            pattern: #"^([a-z_][a-z0-9_]*)(?:\s+(ASC|DESC))?$"#,
            value: item.trimmingCharacters(in: .whitespacesAndNewlines)
        ) else {
            throw LocalStoreError.validation("Unsupported ORDER BY item: \(item)")
        }

        return LocalAISqlSelectOrderBy(
            expressionName: groups[1].lowercased(),
            direction: (groups.count > 2 && groups[2].isEmpty == false ? groups[2].lowercased() : "asc") == "desc" ? .desc : .asc
        )
    }
}

private func localAISqlExtractSimpleNumberClause(
    statementTail: String,
    keyword: String
) -> Int? {
    guard let groups = localAISqlMatch(
        pattern: "\\b\(keyword)\\s+(\\d+)\\b",
        value: statementTail
    ) else {
        return nil
    }
    return Int(groups[1])
}

private func localAISqlParseAliasedExpression(
    _ value: String
) -> (expression: String, alias: String?) {
    guard let groups = localAISqlMatch(
        pattern: #"^([\s\S]+?)\s+AS\s+([a-z_][a-z0-9_]*)$"#,
        value: value.trimmingCharacters(in: .whitespacesAndNewlines)
    ) else {
        return (value.trimmingCharacters(in: .whitespacesAndNewlines), nil)
    }

    return (groups[1].trimmingCharacters(in: .whitespacesAndNewlines), groups[2].lowercased())
}

private func localAISqlParseSelectItem(
    source: LocalAISqlFromSource,
    value: String
) throws -> LocalAISqlSelectItem {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedValue == "*" {
        return .wildcard
    }

    let parsedExpression = localAISqlParseAliasedExpression(trimmedValue)
    let expression = parsedExpression.expression
    let alias = parsedExpression.alias

    if localAISqlMatch(pattern: #"^COUNT\s*\(\s*\*\s*\)$"#, value: expression) != nil {
        return .aggregate(functionName: .count, columnName: nil, alias: alias)
    }

    if let groups = localAISqlMatch(
        pattern: #"^(SUM|AVG|MIN|MAX)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)$"#,
        value: expression
    ) {
        let columnName = groups[2].lowercased()
        try localAISqlEnsureSourceColumnExists(source: source, columnName: columnName)
        guard let functionName = LocalAISqlAggregateFunctionName(rawValue: groups[1].lowercased()) else {
            throw LocalStoreError.validation("Unsupported aggregate function: \(groups[1])")
        }
        return .aggregate(functionName: functionName, columnName: columnName, alias: alias)
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)$"#,
        value: expression
    ) {
        let columnName = groups[1].lowercased()
        try localAISqlEnsureSourceColumnExists(source: source, columnName: columnName)
        return .column(columnName: columnName, alias: alias)
    }

    throw LocalStoreError.validation("Unsupported SELECT item: \(trimmedValue)")
}

private func localAISqlIsWildcardSelect(_ statement: LocalAISqlSelectStatement) -> Bool {
    if statement.selectItems.count != 1 {
        return false
    }
    if case .wildcard = statement.selectItems[0] {
        return true
    }
    return false
}

private func localAISqlParseSelectStatement(normalizedSql: String) throws -> LocalAISqlSelectStatement {
    guard let groups = localAISqlMatch(
        pattern: #"^SELECT\s+([\s\S]+?)\s+FROM\s+([a-z_][a-z0-9_]*)(?:\s+UNNEST\s+([a-z_][a-z0-9_]*)\s+AS\s+([a-z_][a-z0-9_]*))?([\s\S]*)$"#,
        value: normalizedSql
    ) else {
        throw LocalStoreError.validation("Unsupported SELECT statement")
    }

    let source = try localAISqlParseFromSource(
        resourceName: groups[2],
        unnestColumnName: groups.count > 3 && groups[3].isEmpty == false ? groups[3] : nil,
        unnestAlias: groups.count > 4 && groups[4].isEmpty == false ? groups[4] : nil
    )
    let statementTail = groups.count > 5 ? groups[5] : ""
    let whereGroups = localAISqlMatch(
        pattern: #"\bWHERE\b([\s\S]+?)(?=\bGROUP BY\b|\bORDER BY\b|\bLIMIT\b|\bOFFSET\b|$)"#,
        value: statementTail
    )
    let groupByGroups = localAISqlMatch(
        pattern: #"\bGROUP BY\b([\s\S]+?)(?=\bORDER BY\b|\bLIMIT\b|\bOFFSET\b|$)"#,
        value: statementTail
    )
    let orderByGroups = localAISqlMatch(
        pattern: #"\bORDER BY\b([\s\S]+?)(?=\bLIMIT\b|\bOFFSET\b|$)"#,
        value: statementTail
    )

    let selectItems = try localAISqlSplitTopLevel(value: groups[1], separator: ",").map { item in
        try localAISqlParseSelectItem(source: source, value: item)
    }
    let groupBy: [String]
    if let groupByValue = groupByGroups?[1] {
        groupBy = try localAISqlSplitTopLevel(value: groupByValue, separator: ",").map { item in
            let normalizedItem = item.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            try localAISqlEnsureSourceColumnExists(source: source, columnName: normalizedItem)
            return normalizedItem
        }
    } else {
        groupBy = []
    }

    let hasAggregateSelectItem = selectItems.contains { item in
        if case .aggregate = item {
            return true
        }
        return false
    }

    if localAISqlIsWildcardSelect(
        LocalAISqlSelectStatement(
            source: source,
            selectItems: selectItems,
            predicateClauses: [],
            groupBy: groupBy,
            orderBy: [],
            limit: nil,
            offset: nil,
            normalizedSql: normalizedSql
        )
    ) {
        if groupBy.isEmpty == false {
            throw LocalStoreError.validation("GROUP BY is not supported with SELECT *")
        }
    } else if hasAggregateSelectItem == false {
        throw LocalStoreError.validation("Projected SELECT statements must include aggregate functions")
    }

    for item in selectItems {
        if case .column(let columnName, _) = item, groupBy.contains(where: { $0 == columnName }) == false {
            throw LocalStoreError.validation("Grouped SELECT must list \(columnName) in GROUP BY")
        }
    }

    if let unnestAlias = source.unnestAlias {
        let referencesAlias = selectItems.contains { item in
            if case .column(let columnName, _) = item {
                return columnName == unnestAlias
            }
            return false
        }
        if referencesAlias, groupBy.contains(where: { $0 == unnestAlias }) == false {
            throw LocalStoreError.validation("Grouped SELECT must list \(unnestAlias) in GROUP BY")
        }
    }

    return LocalAISqlSelectStatement(
        source: source,
        selectItems: selectItems,
        predicateClauses: try whereGroups == nil ? [] : localAISqlParsePredicateClauses(source: source, value: whereGroups?[1] ?? ""),
        groupBy: groupBy,
        orderBy: try orderByGroups == nil ? [] : localAISqlParseOrderBy(value: orderByGroups?[1] ?? ""),
        limit: localAISqlExtractSimpleNumberClause(statementTail: statementTail, keyword: "LIMIT"),
        offset: localAISqlExtractSimpleNumberClause(statementTail: statementTail, keyword: "OFFSET"),
        normalizedSql: normalizedSql
    )
}

private func localAISqlParseShowTablesStatement(normalizedSql: String) throws -> LocalAISqlShowTablesStatement? {
    guard let groups = localAISqlMatch(
        pattern: #"^SHOW\s+TABLES(?:\s+LIKE\s+('(?:''|[^'])*'))?$"#,
        value: normalizedSql
    ) else {
        return nil
    }

    let likePattern = groups.count > 1 && groups[1].isEmpty == false
        ? try localAISqlParseStringLiteral(groups[1])
        : nil

    return LocalAISqlShowTablesStatement(likePattern: likePattern, normalizedSql: normalizedSql)
}

private func localAISqlParseDescribeStatement(normalizedSql: String) throws -> LocalAISqlDescribeStatement? {
    guard let groups = localAISqlMatch(
        pattern: #"^(?:DESCRIBE|SHOW\s+COLUMNS\s+FROM)\s+([a-z_][a-z0-9_]*)$"#,
        value: normalizedSql
    ) else {
        return nil
    }

    guard let resourceName = LocalAISqlResourceName(rawValue: groups[1].lowercased()) else {
        throw LocalStoreError.validation("Unknown resource: \(groups[1].lowercased())")
    }

    return LocalAISqlDescribeStatement(resourceName: resourceName, normalizedSql: normalizedSql)
}

private func localAISqlParseInsertStatement(normalizedSql: String) throws -> LocalAISqlInsertStatement {
    guard let groups = localAISqlMatch(
        pattern: #"^INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\((.+)\)\s+VALUES\s+([\s\S]+)$"#,
        value: normalizedSql
    ) else {
        throw LocalStoreError.validation("Unsupported INSERT statement")
    }

    guard let resourceName = LocalAISqlResourceName(rawValue: groups[1].lowercased()),
          resourceName == .cards || resourceName == .decks else {
        throw LocalStoreError.validation("INSERT is not supported for \(groups[1].lowercased())")
    }

    let columnNames = try localAISqlSplitTopLevel(value: groups[2], separator: ",").map { columnName in
        let normalizedColumnName = columnName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let columnDescriptor = try localAISqlColumnDescriptor(resourceName: resourceName, columnName: normalizedColumnName)
        if columnDescriptor.readOnly {
            throw LocalStoreError.validation("Column is read-only: \(normalizedColumnName)")
        }
        return normalizedColumnName
    }

    let rows = localAISqlSplitTopLevel(value: groups[3], separator: ",").map { row in
        row.trimmingCharacters(in: .whitespacesAndNewlines)
    }.filter { row in
        row.hasPrefix("(")
    }
    if rows.isEmpty {
        throw LocalStoreError.validation("INSERT must include at least one VALUES row")
    }

    let parsedRows = try rows.map { row in
        guard row.hasPrefix("("), row.hasSuffix(")") else {
            throw LocalStoreError.validation("Invalid VALUES row")
        }
        let values = try localAISqlSplitTopLevel(value: String(row.dropFirst().dropLast()), separator: ",").enumerated().map { index, value in
            guard index < columnNames.count else {
                throw LocalStoreError.validation("VALUES row contains more values than columns")
            }
            let columnName = columnNames[index]
            let columnDescriptor = try localAISqlColumnDescriptor(resourceName: resourceName, columnName: columnName)
            if columnDescriptor.type == .stringArray {
                return LocalAISqlStatementValue.stringArray(try localAISqlParseStringArrayLiteralList(value))
            }
            return LocalAISqlStatementValue.literal(try localAISqlParseLiteral(value))
        }
        if values.count != columnNames.count {
            throw LocalStoreError.validation("VALUES row does not match the declared column count")
        }
        return values
    }

    return LocalAISqlInsertStatement(
        resourceName: resourceName,
        columnNames: columnNames,
        rows: parsedRows,
        normalizedSql: normalizedSql
    )
}

private func localAISqlParseAssignments(
    resourceName: LocalAISqlResourceName,
    value: String
) throws -> [LocalAISqlAssignment] {
    try localAISqlSplitTopLevel(value: value, separator: ",").map { assignment in
        guard let groups = localAISqlMatch(
            pattern: #"^([a-z_][a-z0-9_]*)\s*=\s*(.+)$"#,
            value: assignment
        ) else {
            throw LocalStoreError.validation("Unsupported assignment: \(assignment)")
        }

        let columnName = groups[1].lowercased()
        let columnDescriptor = try localAISqlColumnDescriptor(resourceName: resourceName, columnName: columnName)
        if columnDescriptor.readOnly {
            throw LocalStoreError.validation("Column is read-only: \(columnName)")
        }

        let parsedValue: LocalAISqlStatementValue
        if columnDescriptor.type == .stringArray {
            parsedValue = .stringArray(try localAISqlParseStringArrayLiteralList(groups[2]))
        } else {
            parsedValue = .literal(try localAISqlParseLiteral(groups[2]))
        }

        return LocalAISqlAssignment(columnName: columnName, value: parsedValue)
    }
}

private func localAISqlParseUpdateStatement(normalizedSql: String) throws -> LocalAISqlUpdateStatement {
    guard let groups = localAISqlMatch(
        pattern: #"^UPDATE\s+([a-z_][a-z0-9_]*)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$"#,
        value: normalizedSql
    ) else {
        throw LocalStoreError.validation("Unsupported UPDATE statement")
    }

    guard let resourceName = LocalAISqlResourceName(rawValue: groups[1].lowercased()),
          resourceName == .cards || resourceName == .decks else {
        throw LocalStoreError.validation("UPDATE is not supported for \(groups[1].lowercased())")
    }

    let source = LocalAISqlFromSource(resourceName: resourceName, unnestColumnName: nil, unnestAlias: nil)
    return LocalAISqlUpdateStatement(
        resourceName: resourceName,
        assignments: try localAISqlParseAssignments(resourceName: resourceName, value: groups[2]),
        predicateClauses: try localAISqlParsePredicateClauses(source: source, value: groups[3]),
        normalizedSql: normalizedSql
    )
}

private func localAISqlParseDeleteStatement(normalizedSql: String) throws -> LocalAISqlDeleteStatement {
    guard let groups = localAISqlMatch(
        pattern: #"^DELETE\s+FROM\s+([a-z_][a-z0-9_]*)\s+WHERE\s+([\s\S]+)$"#,
        value: normalizedSql
    ) else {
        throw LocalStoreError.validation("Unsupported DELETE statement")
    }

    guard let resourceName = LocalAISqlResourceName(rawValue: groups[1].lowercased()),
          resourceName == .cards || resourceName == .decks else {
        throw LocalStoreError.validation("DELETE is not supported for \(groups[1].lowercased())")
    }

    let source = LocalAISqlFromSource(resourceName: resourceName, unnestColumnName: nil, unnestAlias: nil)
    return LocalAISqlDeleteStatement(
        resourceName: resourceName,
        predicateClauses: try localAISqlParsePredicateClauses(source: source, value: groups[2]),
        normalizedSql: normalizedSql
    )
}

/**
 Swift mirror of `apps/backend/src/aiTools/sqlDialect.ts::parseSqlStatement`.
 */
func localAISqlParseStatement(_ value: String) throws -> LocalAISqlStatement {
    let normalizedSql = localAISqlNormalizeWhitespace(value)
    if normalizedSql.isEmpty {
        throw LocalStoreError.validation("sql must not be empty")
    }

    if let showTablesStatement = try localAISqlParseShowTablesStatement(normalizedSql: normalizedSql) {
        return .showTables(showTablesStatement)
    }

    if let describeStatement = try localAISqlParseDescribeStatement(normalizedSql: normalizedSql) {
        return .describe(describeStatement)
    }

    switch localAISqlFirstWord(normalizedSql) {
    case "SELECT":
        return .select(try localAISqlParseSelectStatement(normalizedSql: normalizedSql))
    case "INSERT":
        return .insert(try localAISqlParseInsertStatement(normalizedSql: normalizedSql))
    case "UPDATE":
        return .update(try localAISqlParseUpdateStatement(normalizedSql: normalizedSql))
    case "DELETE":
        return .delete(try localAISqlParseDeleteStatement(normalizedSql: normalizedSql))
    default:
        throw LocalStoreError.validation("Unsupported SQL statement")
    }
}
