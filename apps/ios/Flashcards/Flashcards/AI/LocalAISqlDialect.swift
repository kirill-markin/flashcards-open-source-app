import Foundation

/**
 iOS mirror of the published SQL dialect used by backend and browser-local AI
 runtimes.

 Keep this file aligned with:
 - `apps/backend/src/aiTools/sqlDialect.ts`
 - `apps/web/src/chat/localToolExecutor.ts`
 */

enum LocalAISqlResourceName: String, CaseIterable, Sendable {
    case workspaceContext = "workspace_context"
    case schedulerSettings = "scheduler_settings"
    case tagsSummary = "tags_summary"
    case cards
    case dueCards = "due_cards"
    case decks
    case reviewHistory = "review_history"
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

enum LocalAISqlStatementValue: Sendable {
    case literal(LocalAISqlLiteralValue)
    case stringArray([String])
}

enum LocalAISqlPredicate: Sendable {
    case comparison(columnName: String, value: LocalAISqlLiteralValue)
    case `in`(columnName: String, values: [LocalAISqlLiteralValue])
    case overlap(columnName: String, values: [String])
    case isNull(columnName: String)
    case match(query: String)
}

struct LocalAISqlSelectOrderBy: Sendable {
    let columnName: String
    let direction: LocalAISqlOrderDirection
}

struct LocalAISqlSelectStatement: Sendable {
    let resourceName: LocalAISqlResourceName
    let predicates: [LocalAISqlPredicate]
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
    let predicates: [LocalAISqlPredicate]
    let normalizedSql: String
}

struct LocalAISqlDeleteStatement: Sendable {
    let resourceName: LocalAISqlResourceName
    let predicates: [LocalAISqlPredicate]
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
    LocalAISqlColumnDescriptor(
        columnName: "card_id",
        type: .uuid,
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Card identifier."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "front_text",
        type: .string,
        nullable: false,
        readOnly: false,
        filterable: true,
        sortable: true,
        description: "Card front prompt text."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "back_text",
        type: .string,
        nullable: false,
        readOnly: false,
        filterable: true,
        sortable: true,
        description: "Card back answer text."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "tags",
        type: .stringArray,
        nullable: false,
        readOnly: false,
        filterable: true,
        sortable: true,
        description: "Card tags."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "effort_level",
        type: .string,
        nullable: false,
        readOnly: false,
        filterable: true,
        sortable: true,
        description: "Card effort level."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "due_at",
        type: .datetime,
        nullable: true,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Next due timestamp."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "reps",
        type: .integer,
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Total reps count."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "lapses",
        type: .integer,
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Total lapses count."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "updated_at",
        type: .datetime,
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Last update timestamp."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "deleted_at",
        type: .datetime,
        nullable: true,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Deletion timestamp for tombstones."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "fsrs_card_state",
        type: .string,
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: false,
        description: "Persisted FSRS state."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "fsrs_step_index",
        type: .integer,
        nullable: true,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Persisted FSRS step index."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "fsrs_stability",
        type: .number,
        nullable: true,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Persisted FSRS stability."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "fsrs_difficulty",
        type: .number,
        nullable: true,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Persisted FSRS difficulty."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "fsrs_last_reviewed_at",
        type: .datetime,
        nullable: true,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Persisted last reviewed timestamp."
    ),
    LocalAISqlColumnDescriptor(
        columnName: "fsrs_scheduled_days",
        type: .integer,
        nullable: true,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Persisted scheduled interval in days."
    ),
]

private let localAISqlResourceDescriptorsByName: [LocalAISqlResourceName: LocalAISqlResourceDescriptor] = [
    .workspaceContext: LocalAISqlResourceDescriptor(
        resourceName: .workspaceContext,
        description: "Selected workspace summary plus deck summary and scheduler settings.",
        columns: [
            LocalAISqlColumnDescriptor(
                columnName: "workspace_id",
                type: .uuid,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Selected workspace identifier."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "workspace_name",
                type: .string,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Selected workspace display name."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "total_cards",
                type: .integer,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Total active cards in the selected workspace."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "due_cards",
                type: .integer,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Active due cards count."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "new_cards",
                type: .integer,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Active unseen cards count."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "reviewed_cards",
                type: .integer,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Active reviewed cards count."
            ),
        ],
        writable: false
    ),
    .schedulerSettings: LocalAISqlResourceDescriptor(
        resourceName: .schedulerSettings,
        description: "Workspace-level scheduler settings.",
        columns: [
            LocalAISqlColumnDescriptor(
                columnName: "algorithm",
                type: .string,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Scheduler algorithm identifier."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "desired_retention",
                type: .number,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Workspace desired retention target."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "learning_steps_minutes",
                type: .integerArray,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Configured learning steps."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "relearning_steps_minutes",
                type: .integerArray,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Configured relearning steps."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "maximum_interval_days",
                type: .integer,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Maximum review interval in days."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "enable_fuzz",
                type: .boolean,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Whether interval fuzz is enabled."
            ),
        ],
        writable: false
    ),
    .tagsSummary: LocalAISqlResourceDescriptor(
        resourceName: .tagsSummary,
        description: "Workspace tag summary with counts.",
        columns: [
            LocalAISqlColumnDescriptor(
                columnName: "tag",
                type: .string,
                nullable: false,
                readOnly: true,
                filterable: true,
                sortable: true,
                description: "Workspace tag."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "cards_count",
                type: .integer,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: true,
                description: "Active cards count for the tag."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "total_cards",
                type: .integer,
                nullable: false,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Total active cards in the workspace."
            ),
        ],
        writable: false
    ),
    .cards: LocalAISqlResourceDescriptor(
        resourceName: .cards,
        description: "Cards in the selected workspace.",
        columns: localAISqlCardColumnDescriptors,
        writable: true
    ),
    .dueCards: LocalAISqlResourceDescriptor(
        resourceName: .dueCards,
        description: "Cards currently due for review.",
        columns: localAISqlCardColumnDescriptors,
        writable: false
    ),
    .decks: LocalAISqlResourceDescriptor(
        resourceName: .decks,
        description: "Decks in the selected workspace.",
        columns: [
            LocalAISqlColumnDescriptor(
                columnName: "deck_id",
                type: .uuid,
                nullable: false,
                readOnly: true,
                filterable: true,
                sortable: true,
                description: "Deck identifier."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "name",
                type: .string,
                nullable: false,
                readOnly: false,
                filterable: true,
                sortable: true,
                description: "Deck name."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "tags",
                type: .stringArray,
                nullable: false,
                readOnly: false,
                filterable: true,
                sortable: false,
                description: "Deck filter tags."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "effort_levels",
                type: .stringArray,
                nullable: false,
                readOnly: false,
                filterable: true,
                sortable: false,
                description: "Deck filter effort levels."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "created_at",
                type: .datetime,
                nullable: false,
                readOnly: true,
                filterable: true,
                sortable: true,
                description: "Deck creation timestamp."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "updated_at",
                type: .datetime,
                nullable: false,
                readOnly: true,
                filterable: true,
                sortable: true,
                description: "Deck last update timestamp."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "deleted_at",
                type: .datetime,
                nullable: true,
                readOnly: true,
                filterable: false,
                sortable: false,
                description: "Deck deletion timestamp."
            ),
        ],
        writable: true
    ),
    .reviewHistory: LocalAISqlResourceDescriptor(
        resourceName: .reviewHistory,
        description: "Immutable review history rows.",
        columns: [
            LocalAISqlColumnDescriptor(
                columnName: "review_event_id",
                type: .uuid,
                nullable: false,
                readOnly: true,
                filterable: true,
                sortable: true,
                description: "Review event identifier."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "card_id",
                type: .uuid,
                nullable: false,
                readOnly: true,
                filterable: true,
                sortable: true,
                description: "Reviewed card identifier."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "device_id",
                type: .uuid,
                nullable: false,
                readOnly: true,
                filterable: true,
                sortable: false,
                description: "Device that submitted the review."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "client_event_id",
                type: .string,
                nullable: false,
                readOnly: true,
                filterable: true,
                sortable: false,
                description: "Client event identifier."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "rating",
                type: .integer,
                nullable: false,
                readOnly: true,
                filterable: true,
                sortable: true,
                description: "Submitted review rating."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "reviewed_at_client",
                type: .datetime,
                nullable: false,
                readOnly: true,
                filterable: true,
                sortable: true,
                description: "Client review timestamp."
            ),
            LocalAISqlColumnDescriptor(
                columnName: "reviewed_at_server",
                type: .datetime,
                nullable: false,
                readOnly: true,
                filterable: true,
                sortable: true,
                description: "Server review timestamp."
            ),
        ],
        writable: false
    ),
]

func localAISqlResourceDescriptors() -> [LocalAISqlResourceDescriptor] {
    LocalAISqlResourceName.allCases.compactMap { resourceName in
        localAISqlResourceDescriptorsByName[resourceName]
    }
}

private func localAISqlFindColumnDescriptor(
    resourceName: LocalAISqlResourceName,
    columnName: String
) throws -> LocalAISqlColumnDescriptor {
    guard let descriptor = localAISqlResourceDescriptorsByName[resourceName] else {
        throw LocalStoreError.validation("Unknown resource: \(resourceName.rawValue)")
    }
    guard let columnDescriptor = descriptor.columns.first(where: { candidate in
        candidate.columnName == columnName
    }) else {
        throw LocalStoreError.validation("Unknown column for \(resourceName.rawValue): \(columnName)")
    }
    return columnDescriptor
}

private func localAISqlNormalizeWhitespace(_ value: String) -> String {
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

private func localAISqlFirstWord(_ value: String) -> String {
    let components = value.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
    guard let first = components.first else {
        return ""
    }
    return String(first).uppercased()
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
        let candidateCharacter = characters[index + offset]
        if String(candidateCharacter).uppercased() != String(separatorCharacters[offset]) {
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
        switch parsedValue {
        case .string(let stringValue):
            return stringValue
        default:
            throw LocalStoreError.validation("Expected only string literals in the list")
        }
    }
}

private func localAISqlParsePredicate(
    resourceName: LocalAISqlResourceName,
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
        pattern: #"^([a-z_][a-z0-9_]*)\s+IS\s+NULL$"#,
        value: trimmedValue
    ) {
        let columnName = groups[1].lowercased()
        _ = try localAISqlFindColumnDescriptor(resourceName: resourceName, columnName: columnName)
        return .isNull(columnName: columnName)
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)\s+OVERLAP\s*(\(.+\))$"#,
        value: trimmedValue
    ) {
        let columnName = groups[1].lowercased()
        _ = try localAISqlFindColumnDescriptor(resourceName: resourceName, columnName: columnName)
        return .overlap(columnName: columnName, values: try localAISqlParseStringArrayLiteralList(groups[2]))
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)\s+IN\s*(\(.+\))$"#,
        value: trimmedValue
    ) {
        let columnName = groups[1].lowercased()
        _ = try localAISqlFindColumnDescriptor(resourceName: resourceName, columnName: columnName)
        let listValue = groups[2]
        let innerStart = listValue.index(after: listValue.startIndex)
        let innerEnd = listValue.index(before: listValue.endIndex)
        let innerValue = String(listValue[innerStart..<innerEnd])
        let values = try localAISqlSplitTopLevel(value: innerValue, separator: ",").map(localAISqlParseLiteral)
        return .in(columnName: columnName, values: values)
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)\s*=\s*(.+)$"#,
        value: trimmedValue
    ) {
        let columnName = groups[1].lowercased()
        _ = try localAISqlFindColumnDescriptor(resourceName: resourceName, columnName: columnName)
        return .comparison(columnName: columnName, value: try localAISqlParseLiteral(groups[2]))
    }

    throw LocalStoreError.validation("Unsupported predicate: \(trimmedValue)")
}

private func localAISqlParseOrderBy(
    resourceName: LocalAISqlResourceName,
    value: String
) throws -> [LocalAISqlSelectOrderBy] {
    try localAISqlSplitTopLevel(value: value, separator: ",").map { item in
        guard let groups = localAISqlMatch(
            pattern: #"^([a-z_][a-z0-9_]*)(?:\s+(ASC|DESC))?$"#,
            value: item.trimmingCharacters(in: .whitespacesAndNewlines)
        ) else {
            throw LocalStoreError.validation("Unsupported ORDER BY item: \(item)")
        }

        let columnName = groups[1].lowercased()
        let direction = groups.count > 2 && groups[2].isEmpty == false ? groups[2].lowercased() : "asc"
        let columnDescriptor = try localAISqlFindColumnDescriptor(resourceName: resourceName, columnName: columnName)
        if columnDescriptor.sortable == false {
            throw LocalStoreError.validation("Column is not sortable: \(columnName)")
        }

        return LocalAISqlSelectOrderBy(
            columnName: columnName,
            direction: direction == "desc" ? .desc : .asc
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

private func localAISqlParseSelectStatement(normalizedSql: String) throws -> LocalAISqlSelectStatement {
    guard let groups = localAISqlMatch(
        pattern: #"^SELECT\s+\*\s+FROM\s+([a-z_][a-z0-9_]*)([\s\S]*)$"#,
        value: normalizedSql
    ) else {
        throw LocalStoreError.validation("Unsupported SELECT statement")
    }

    guard let resourceName = LocalAISqlResourceName(rawValue: groups[1].lowercased()) else {
        throw LocalStoreError.validation("Unknown resource: \(groups[1].lowercased())")
    }

    let statementTail = groups[2]
    let whereGroups = localAISqlMatch(
        pattern: #"\bWHERE\b([\s\S]+?)(?=\bORDER BY\b|\bLIMIT\b|\bOFFSET\b|$)"#,
        value: statementTail
    )
    let orderByGroups = localAISqlMatch(
        pattern: #"\bORDER BY\b([\s\S]+?)(?=\bLIMIT\b|\bOFFSET\b|$)"#,
        value: statementTail
    )

    let predicates = try whereGroups == nil
        ? []
        : localAISqlSplitTopLevel(value: whereGroups?[1] ?? "", separator: "AND").map { predicate in
            try localAISqlParsePredicate(resourceName: resourceName, value: predicate)
        }

    let orderBy = try orderByGroups == nil
        ? []
        : localAISqlParseOrderBy(resourceName: resourceName, value: orderByGroups?[1] ?? "")

    return LocalAISqlSelectStatement(
        resourceName: resourceName,
        predicates: predicates,
        orderBy: orderBy,
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

    return LocalAISqlShowTablesStatement(
        likePattern: likePattern,
        normalizedSql: normalizedSql
    )
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

    return LocalAISqlDescribeStatement(
        resourceName: resourceName,
        normalizedSql: normalizedSql
    )
}

private func localAISqlParseInsertStatement(normalizedSql: String) throws -> LocalAISqlInsertStatement {
    guard let groups = localAISqlMatch(
        pattern: #"^INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\((.+)\)\s+VALUES\s+([\s\S]+)$"#,
        value: normalizedSql
    ) else {
        throw LocalStoreError.validation("Unsupported INSERT statement")
    }

    guard let resourceName = LocalAISqlResourceName(rawValue: groups[1].lowercased()) else {
        throw LocalStoreError.validation("INSERT is not supported for \(groups[1].lowercased())")
    }
    if resourceName != .cards && resourceName != .decks {
        throw LocalStoreError.validation("INSERT is not supported for \(resourceName.rawValue)")
    }

    let columnNames = try localAISqlSplitTopLevel(value: groups[2], separator: ",").map { columnName in
        let normalizedColumnName = columnName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let columnDescriptor = try localAISqlFindColumnDescriptor(resourceName: resourceName, columnName: normalizedColumnName)
        if columnDescriptor.readOnly {
            throw LocalStoreError.validation("Column is read-only: \(normalizedColumnName)")
        }
        return normalizedColumnName
    }

    let rows = localAISqlSplitTopLevel(value: groups[3], separator: ",").filter { row in
        row.hasPrefix("(")
    }
    if rows.isEmpty {
        throw LocalStoreError.validation("INSERT must include at least one VALUES row")
    }

    let parsedRows = try rows.map { row in
        guard row.hasPrefix("("), row.hasSuffix(")") else {
            throw LocalStoreError.validation("Invalid VALUES row")
        }
        let startIndex = row.index(after: row.startIndex)
        let endIndex = row.index(before: row.endIndex)
        let values = try localAISqlSplitTopLevel(value: String(row[startIndex..<endIndex]), separator: ",").enumerated().map { index, value in
            guard let columnName = columnNames[safe: index] else {
                throw LocalStoreError.validation("VALUES row contains more values than columns")
            }
            let columnDescriptor = try localAISqlFindColumnDescriptor(resourceName: resourceName, columnName: columnName)
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
        let columnDescriptor = try localAISqlFindColumnDescriptor(resourceName: resourceName, columnName: columnName)
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

    guard let resourceName = LocalAISqlResourceName(rawValue: groups[1].lowercased()) else {
        throw LocalStoreError.validation("UPDATE is not supported for \(groups[1].lowercased())")
    }
    if resourceName != .cards && resourceName != .decks {
        throw LocalStoreError.validation("UPDATE is not supported for \(resourceName.rawValue)")
    }

    return LocalAISqlUpdateStatement(
        resourceName: resourceName,
        assignments: try localAISqlParseAssignments(resourceName: resourceName, value: groups[2]),
        predicates: try localAISqlSplitTopLevel(value: groups[3], separator: "AND").map { predicate in
            try localAISqlParsePredicate(resourceName: resourceName, value: predicate)
        },
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

    guard let resourceName = LocalAISqlResourceName(rawValue: groups[1].lowercased()) else {
        throw LocalStoreError.validation("DELETE is not supported for \(groups[1].lowercased())")
    }
    if resourceName != .cards && resourceName != .decks {
        throw LocalStoreError.validation("DELETE is not supported for \(resourceName.rawValue)")
    }

    return LocalAISqlDeleteStatement(
        resourceName: resourceName,
        predicates: try localAISqlSplitTopLevel(value: groups[2], separator: "AND").map { predicate in
            try localAISqlParsePredicate(resourceName: resourceName, value: predicate)
        },
        normalizedSql: normalizedSql
    )
}

/**
 Swift mirror of `apps/backend/src/aiTools/sqlDialect.ts::parseSqlStatement`.
 Update both implementations together so the shared SQL surface stays aligned
 across backend, browser-local, and iOS-local runtimes.
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

    let statementKeyword = localAISqlFirstWord(normalizedSql)
    if statementKeyword == "SELECT" {
        return .select(try localAISqlParseSelectStatement(normalizedSql: normalizedSql))
    }
    if statementKeyword == "INSERT" {
        return .insert(try localAISqlParseInsertStatement(normalizedSql: normalizedSql))
    }
    if statementKeyword == "UPDATE" {
        return .update(try localAISqlParseUpdateStatement(normalizedSql: normalizedSql))
    }
    if statementKeyword == "DELETE" {
        return .delete(try localAISqlParseDeleteStatement(normalizedSql: normalizedSql))
    }

    throw LocalStoreError.validation("Unsupported SQL statement")
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        if indices.contains(index) {
            return self[index]
        }

        return nil
    }
}
