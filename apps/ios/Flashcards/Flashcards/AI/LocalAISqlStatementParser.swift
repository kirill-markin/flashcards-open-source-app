import Foundation

func localAISqlParseFromSource(
    resourceName: String,
    unnestColumnName: String?,
    unnestAlias: String?
) throws -> LocalAISqlFromSource {
    let normalizedResourceName = resourceName.lowercased()
    guard let resource = LocalAISqlResourceName(rawValue: normalizedResourceName) else {
        throw LocalStoreError.validation("Unknown resource: \(normalizedResourceName)")
    }

    if unnestColumnName == nil, unnestAlias == nil {
        return LocalAISqlFromSource(resourceName: resource, unnestColumnName: nil, unnestAlias: nil)
    }

    let normalizedUnnestColumnName = (unnestColumnName ?? "").lowercased()
    let normalizedUnnestAlias = (unnestAlias ?? "").lowercased()
    if normalizedResourceName != LocalAISqlResourceName.cards.rawValue || normalizedUnnestColumnName != "tags" {
        throw LocalStoreError.validation("UNNEST is only supported for cards.tags")
    }

    return LocalAISqlFromSource(
        resourceName: resource,
        unnestColumnName: "tags",
        unnestAlias: normalizedUnnestAlias
    )
}

func localAISqlParsePredicate(
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
        pattern: #"^LOWER\s*\(\s*([a-z_][a-z0-9_]*)\s*\)\s+LIKE\s+('(?:''|[^'])*')$"#,
        value: trimmedValue
    ) {
        let columnName = groups[1].lowercased()
        try localAISqlEnsureSourceColumnExists(source: source, columnName: columnName)
        return .like(
            columnName: columnName,
            pattern: try localAISqlParseStringLiteral(groups[2]),
            caseInsensitive: true
        )
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)\s+LIKE\s+('(?:''|[^'])*')$"#,
        value: trimmedValue
    ) {
        let columnName = groups[1].lowercased()
        try localAISqlEnsureSourceColumnExists(source: source, columnName: columnName)
        return .like(
            columnName: columnName,
            pattern: try localAISqlParseStringLiteral(groups[2]),
            caseInsensitive: false
        )
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
        let innerValue = String(groups[2].dropFirst().dropLast())
        let values = try localAISqlSplitTopLevel(value: innerValue, separator: ",").map(localAISqlParseLiteral)
        return .in(columnName: columnName, values: values)
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)\s*(=|<=|>=|<|>)\s*([\s\S]+)$"#,
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

func localAISqlParsePredicateClauses(
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

func localAISqlParseOrderBy(value: String) throws -> [LocalAISqlSelectOrderBy] {
    let items = localAISqlSplitTopLevel(value: value, separator: ",").map { item in
        item.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    if items.count == 1, (items[0].range(of: #"^RANDOM\s*\(\s*\)$"#, options: .regularExpression) != nil) {
        return [.random]
    }

    for item in items where item.range(of: #"^RANDOM\s*\(\s*\)\s+(ASC|DESC)$"#, options: [.regularExpression, .caseInsensitive]) != nil {
        throw LocalStoreError.validation("RANDOM() does not support ASC or DESC")
    }

    if items.contains(where: { item in
        item.range(of: #"^RANDOM\s*\(\s*\)$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }) {
        throw LocalStoreError.validation("RANDOM() must be the only ORDER BY item")
    }

    return try items.map { item in
        guard let groups = localAISqlMatch(
            pattern: #"^([a-z_][a-z0-9_]*)(?:\s+(ASC|DESC))?$"#,
            value: item
        ) else {
            throw LocalStoreError.validation("Unsupported ORDER BY item: \(item)")
        }

        return .column(
            expressionName: groups[1].lowercased(),
            direction: LocalAISqlOrderDirection(rawValue: (groups.count > 2 && groups[2].isEmpty == false ? groups[2] : "ASC").lowercased()) ?? .asc
        )
    }
}

func localAISqlExtractSimpleNumberClause(
    statementTail: String,
    keyword: String
) -> Int? {
    guard let groups = localAISqlMatch(
        pattern: #"[\s\S]*\b\#(keyword)\s+(\d+)\b[\s\S]*"#,
        value: statementTail
    ) else {
        return nil
    }

    return Int(groups[1])
}

func localAISqlParseAliasedExpression(
    _ value: String
) -> (expression: String, alias: String?) {
    guard let groups = localAISqlMatch(
        pattern: #"^([\s\S]+?)\s+AS\s+([a-z_][a-z0-9_]*)$"#,
        value: value
    ) else {
        return (value.trimmingCharacters(in: .whitespacesAndNewlines), nil)
    }

    return (groups[1].trimmingCharacters(in: .whitespacesAndNewlines), groups[2].lowercased())
}

func localAISqlParseSelectItem(
    source: LocalAISqlFromSource,
    value: String
) throws -> LocalAISqlSelectItem {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedValue == "*" {
        return .wildcard
    }

    let parsedExpression = localAISqlParseAliasedExpression(trimmedValue)
    if localAISqlMatch(pattern: #"^COUNT\s*\(\s*\*\s*\)$"#, value: parsedExpression.expression) != nil {
        return .aggregate(functionName: .count, columnName: nil, alias: parsedExpression.alias)
    }

    if let groups = localAISqlMatch(
        pattern: #"^(SUM|AVG|MIN|MAX)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)$"#,
        value: parsedExpression.expression
    ) {
        let columnName = groups[2].lowercased()
        try localAISqlEnsureSourceColumnExists(source: source, columnName: columnName)
        guard let functionName = LocalAISqlAggregateFunctionName(rawValue: groups[1].lowercased()) else {
            throw LocalStoreError.validation("Unsupported aggregate function: \(groups[1])")
        }
        return .aggregate(functionName: functionName, columnName: columnName, alias: parsedExpression.alias)
    }

    if let groups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)$"#,
        value: parsedExpression.expression
    ) {
        let columnName = groups[1].lowercased()
        try localAISqlEnsureSourceColumnExists(source: source, columnName: columnName)
        return .column(columnName: columnName, alias: parsedExpression.alias)
    }

    throw LocalStoreError.validation("Unsupported SELECT item: \(trimmedValue)")
}

func localAISqlIsWildcardSelect(_ statement: LocalAISqlSelectStatement) -> Bool {
    statement.selectItems.count == 1 && {
        if case .wildcard = statement.selectItems[0] {
            return true
        }
        return false
    }()
}

func localAISqlParseSelectStatement(normalizedSql: String) throws -> LocalAISqlSelectStatement {
    guard let selectPrefix = localAISqlMatch(
        pattern: #"^(SELECT)\s+"#,
        value: normalizedSql
    )?[0] else {
        throw LocalStoreError.validation("Unsupported SELECT statement")
    }

    let selectBody = String(normalizedSql.dropFirst(selectPrefix.count))
    guard let fromMatch = localAISqlFindTopLevelClauseMatches(
        value: selectBody,
        definitions: [LocalAISqlTopLevelClauseDefinition(name: "from", keyword: "FROM")]
    ).first else {
        throw LocalStoreError.validation("Unsupported SELECT statement")
    }

    let selectItemsValue = String(selectBody.prefix(fromMatch.index)).trimmingCharacters(in: .whitespacesAndNewlines)
    let fromAndTailValue = String(selectBody.dropFirst(fromMatch.index + fromMatch.keyword.count)).trimmingCharacters(in: .whitespacesAndNewlines)
    let extractedClauses = try localAISqlExtractTopLevelClauses(
        value: fromAndTailValue,
        definitions: [
            LocalAISqlTopLevelClauseDefinition(name: "where", keyword: "WHERE"),
            LocalAISqlTopLevelClauseDefinition(name: "groupBy", keyword: "GROUP BY"),
            LocalAISqlTopLevelClauseDefinition(name: "orderBy", keyword: "ORDER BY"),
            LocalAISqlTopLevelClauseDefinition(name: "limit", keyword: "LIMIT"),
            LocalAISqlTopLevelClauseDefinition(name: "offset", keyword: "OFFSET"),
        ],
        context: "SELECT"
    )
    guard let sourceGroups = localAISqlMatch(
        pattern: #"^([a-z_][a-z0-9_]*)(?:\s+UNNEST\s+([a-z_][a-z0-9_]*)\s+AS\s+([a-z_][a-z0-9_]*))?$"#,
        value: extractedClauses.leadingSegment
    ) else {
        throw LocalStoreError.validation("Unsupported SELECT statement")
    }

    let source = try localAISqlParseFromSource(
        resourceName: sourceGroups[1],
        unnestColumnName: sourceGroups.count > 2 && sourceGroups[2].isEmpty == false ? sourceGroups[2] : nil,
        unnestAlias: sourceGroups.count > 3 && sourceGroups[3].isEmpty == false ? sourceGroups[3] : nil
    )
    let selectItems = try localAISqlSplitTopLevel(value: selectItemsValue, separator: ",").map { item in
        try localAISqlParseSelectItem(source: source, value: item)
    }
    let groupBy: [String]
    if let groupByValue = extractedClauses.clauseValues["groupBy"] {
        groupBy = try localAISqlSplitTopLevel(value: groupByValue, separator: ",").map { item in
            let normalizedItem = item.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            try localAISqlEnsureSourceColumnExists(source: source, columnName: normalizedItem)
            return normalizedItem
        }
    } else {
        groupBy = []
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
    ), groupBy.isEmpty == false {
        throw LocalStoreError.validation("GROUP BY is not supported with SELECT *")
    }

    let requiresGroupedColumns = groupBy.isEmpty == false || selectItems.contains { item in
        if case .aggregate = item {
            return true
        }
        return false
    }
    if requiresGroupedColumns {
        for item in selectItems {
            if case .column(let columnName, _) = item, groupBy.contains(columnName) == false {
                throw LocalStoreError.validation("Grouped SELECT must list \(columnName) in GROUP BY")
            }
        }

        if let unnestAlias = source.unnestAlias, groupBy.contains(unnestAlias) == false {
            let referencesAlias = selectItems.contains { item in
                if case .column(let columnName, _) = item {
                    return columnName == unnestAlias
                }
                return false
            }
            if referencesAlias {
                throw LocalStoreError.validation("Grouped SELECT must list \(unnestAlias) in GROUP BY")
            }
        }
    }

    return LocalAISqlSelectStatement(
        source: source,
        selectItems: selectItems,
        predicateClauses: try extractedClauses.clauseValues["where"].map { value in
            try localAISqlParsePredicateClauses(source: source, value: value)
        } ?? [],
        groupBy: groupBy,
        orderBy: try extractedClauses.clauseValues["orderBy"].map { value in
            try localAISqlParseOrderBy(value: value)
        } ?? [],
        limit: try localAISqlParseSimpleNumberClauseValue(extractedClauses.clauseValues["limit"], keyword: "LIMIT"),
        offset: try localAISqlParseSimpleNumberClauseValue(extractedClauses.clauseValues["offset"], keyword: "OFFSET"),
        normalizedSql: normalizedSql
    )
}

func localAISqlParseShowTablesStatement(normalizedSql: String) throws -> LocalAISqlShowTablesStatement? {
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

func localAISqlParseDescribeStatement(normalizedSql: String) throws -> LocalAISqlDescribeStatement? {
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

func localAISqlParseInsertStatement(normalizedSql: String) throws -> LocalAISqlInsertStatement {
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

func localAISqlParseAssignments(
    resourceName: LocalAISqlResourceName,
    value: String
) throws -> [LocalAISqlAssignment] {
    try localAISqlSplitTopLevel(value: value, separator: ",").map { assignment in
        guard let groups = localAISqlMatch(
            pattern: #"^([a-z_][a-z0-9_]*)\s*=\s*([\s\S]+)$"#,
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

func localAISqlParseUpdateStatement(normalizedSql: String) throws -> LocalAISqlUpdateStatement {
    guard let groups = localAISqlMatch(
        pattern: #"^UPDATE\s+([a-z_][a-z0-9_]*)([\s\S]*)$"#,
        value: normalizedSql
    ) else {
        throw LocalStoreError.validation("Unsupported UPDATE statement")
    }

    guard let resourceName = LocalAISqlResourceName(rawValue: groups[1].lowercased()),
          resourceName == .cards || resourceName == .decks else {
        throw LocalStoreError.validation("UPDATE is not supported for \(groups[1].lowercased())")
    }

    let source = LocalAISqlFromSource(resourceName: resourceName, unnestColumnName: nil, unnestAlias: nil)
    let extractedClauses = try localAISqlExtractTopLevelClauses(
        value: groups[2].trimmingCharacters(in: .whitespacesAndNewlines),
        definitions: [
            LocalAISqlTopLevelClauseDefinition(name: "set", keyword: "SET"),
            LocalAISqlTopLevelClauseDefinition(name: "where", keyword: "WHERE"),
        ],
        context: "UPDATE"
    )
    guard extractedClauses.leadingSegment.isEmpty,
          let assignmentsValue = extractedClauses.clauseValues["set"],
          let predicateValue = extractedClauses.clauseValues["where"] else {
        throw LocalStoreError.validation("Unsupported UPDATE statement")
    }

    return LocalAISqlUpdateStatement(
        resourceName: resourceName,
        assignments: try localAISqlParseAssignments(resourceName: resourceName, value: assignmentsValue),
        predicateClauses: try localAISqlParsePredicateClauses(source: source, value: predicateValue),
        normalizedSql: normalizedSql
    )
}

func localAISqlParseDeleteStatement(normalizedSql: String) throws -> LocalAISqlDeleteStatement {
    guard let groups = localAISqlMatch(
        pattern: #"^DELETE\s+FROM\s+([a-z_][a-z0-9_]*)([\s\S]*)$"#,
        value: normalizedSql
    ) else {
        throw LocalStoreError.validation("Unsupported DELETE statement")
    }

    guard let resourceName = LocalAISqlResourceName(rawValue: groups[1].lowercased()),
          resourceName == .cards || resourceName == .decks else {
        throw LocalStoreError.validation("DELETE is not supported for \(groups[1].lowercased())")
    }

    let source = LocalAISqlFromSource(resourceName: resourceName, unnestColumnName: nil, unnestAlias: nil)
    let extractedClauses = try localAISqlExtractTopLevelClauses(
        value: groups[2].trimmingCharacters(in: .whitespacesAndNewlines),
        definitions: [
            LocalAISqlTopLevelClauseDefinition(name: "where", keyword: "WHERE"),
        ],
        context: "DELETE"
    )
    guard extractedClauses.leadingSegment.isEmpty,
          let predicateValue = extractedClauses.clauseValues["where"] else {
        throw LocalStoreError.validation("Unsupported DELETE statement")
    }

    return LocalAISqlDeleteStatement(
        resourceName: resourceName,
        predicateClauses: try localAISqlParsePredicateClauses(source: source, value: predicateValue),
        normalizedSql: normalizedSql
    )
}
