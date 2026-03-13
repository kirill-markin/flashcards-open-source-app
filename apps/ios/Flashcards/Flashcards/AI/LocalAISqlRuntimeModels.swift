import Foundation

enum LocalAISqlRowValue: Encodable {
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

typealias LocalAISqlRow = [String: LocalAISqlRowValue]

struct LocalAISqlReadPayload: Encodable {
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

struct LocalAISqlMutationPayload: Encodable {
    let statementType: String
    let resource: String
    let sql: String
    let normalizedSql: String
    let rows: [LocalAISqlRow]
    let affectedCount: Int
}

struct LocalAISqlExecutionResult {
    let output: String
    let didMutateAppState: Bool
}

struct LocalAISqlSelectExecutionResult {
    let rows: [LocalAISqlRow]
    let rowCount: Int
    let limit: Int
    let offset: Int
    let hasMore: Bool
}

struct LocalAISqlGroupedRows {
    let groupRow: LocalAISqlRow
    let groupedRows: [LocalAISqlRow]
}

let maxLocalAISqlLimit: Int = 100
