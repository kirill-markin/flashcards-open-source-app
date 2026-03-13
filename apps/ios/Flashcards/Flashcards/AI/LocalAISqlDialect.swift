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
    case like(columnName: String, pattern: String, caseInsensitive: Bool)
    case `in`(columnName: String, values: [LocalAISqlLiteralValue])
    case overlap(columnName: String, values: [String])
    case isNull(columnName: String)
    case isNotNull(columnName: String)
    case match(query: String)
}

typealias LocalAISqlPredicateClause = [LocalAISqlPredicate]

enum LocalAISqlSelectOrderBy: Sendable {
    case column(expressionName: String, direction: LocalAISqlOrderDirection)
    case random
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

/**
 Swift entrypoint for the iOS SQL dialect mirror.
 Parser support and schema helpers live in adjacent files.
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
