import Foundation

enum LocalAISqlRowValue: Codable {
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

    init(from decoder: Decoder) throws {
        let singleValueContainer = try decoder.singleValueContainer()

        if singleValueContainer.decodeNil() {
            self = .null
            return
        }

        if let stringArrayValue = try? singleValueContainer.decode([String].self) {
            self = .stringArray(stringArrayValue)
            return
        }

        if let integerArrayValue = try? singleValueContainer.decode([Int].self) {
            self = .integerArray(integerArrayValue)
            return
        }

        if let boolValue = try? singleValueContainer.decode(Bool.self) {
            self = .boolean(boolValue)
            return
        }

        if let integerValue = try? singleValueContainer.decode(Int.self) {
            self = .integer(integerValue)
            return
        }

        if let numberValue = try? singleValueContainer.decode(Double.self) {
            self = .number(numberValue)
            return
        }

        self = .string(try singleValueContainer.decode(String.self))
    }
}

typealias LocalAISqlRow = [String: LocalAISqlRowValue]

struct LocalAISqlReadPayload: Codable {
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

struct LocalAISqlMutationPayload: Codable {
    let statementType: String
    let resource: String
    let sql: String
    let normalizedSql: String
    let rows: [LocalAISqlRow]
    let affectedCount: Int
}

enum LocalAISqlSinglePayload: Codable {
    case read(LocalAISqlReadPayload)
    case mutation(LocalAISqlMutationPayload)

    func encode(to encoder: Encoder) throws {
        switch self {
        case .read(let payload):
            try payload.encode(to: encoder)
        case .mutation(let payload):
            try payload.encode(to: encoder)
        }
    }

    init(from decoder: Decoder) throws {
        if let readPayload = try? LocalAISqlReadPayload(from: decoder) {
            self = .read(readPayload)
            return
        }

        self = .mutation(try LocalAISqlMutationPayload(from: decoder))
    }
}

struct LocalAISqlBatchPayload: Codable {
    let statementType: String
    let resource: String?
    let sql: String
    let normalizedSql: String
    let statements: [LocalAISqlSinglePayload]
    let statementCount: Int
    let affectedCountTotal: Int?
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

/**
 Keep this limit aligned with:
 - `apps/backend/src/aiTools/sqlToolLimits.ts`
 - `apps/web/src/chat/localToolExecutorTypes.ts`
 - `apps/ios/Flashcards/Flashcards/AI/LocalAIToolExecutor.swift`
 */
let maxLocalAISqlLimit: Int = 100
