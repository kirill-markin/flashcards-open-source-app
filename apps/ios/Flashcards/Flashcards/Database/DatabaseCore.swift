import Foundation
import SQLite3

enum SQLiteValue {
    case integer(Int64)
    case real(Double)
    case text(String)
    case null
}

let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
let defaultSchedulerAlgorithm: String = defaultSchedulerSettingsConfig.algorithm

final class DatabaseCore {
    let databaseURL: URL
    let connection: OpaquePointer
    let encoder: JSONEncoder
    let decoder: JSONDecoder
    private var isClosed: Bool

    convenience init() throws {
        try self.init(databaseURL: Self.defaultDatabaseURL())
    }

    init(databaseURL: URL) throws {
        self.databaseURL = databaseURL
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.isClosed = false
        self.connection = try Self.openConnection(databaseURL: databaseURL)
        sqlite3_busy_timeout(self.connection, 5_000)
        try self.enableForeignKeys()
        try self.enableWriteAheadLogging()
        try LocalDatabaseMigrator(core: self).migrate()
        try LocalDatabaseBootstrapper(core: self).ensureDefaultState()
    }

    deinit {
        if self.isClosed == false {
            sqlite3_close_v2(self.connection)
        }
    }

    func close() throws {
        guard self.isClosed == false else {
            return
        }

        let closeResult = sqlite3_close_v2(self.connection)
        guard closeResult == SQLITE_OK else {
            throw LocalStoreError.database("Failed to close database connection: \(self.lastErrorMessage())")
        }

        self.isClosed = true
    }

    func encodeJsonString<T: Encodable>(value: T) throws -> String {
        let data = try self.encoder.encode(value)
        guard let json = String(data: data, encoding: .utf8) else {
            throw LocalStoreError.database("Failed to encode JSON payload")
        }

        return json
    }

    @discardableResult
    func execute(sql: String, values: [SQLiteValue]) throws -> Int {
        var statement: OpaquePointer?
        let prepareResult = sqlite3_prepare_v2(connection, sql, -1, &statement, nil)
        guard prepareResult == SQLITE_OK, let statement else {
            throw LocalStoreError.database("Failed to prepare statement: \(self.lastErrorMessage())")
        }
        defer {
            sqlite3_finalize(statement)
        }

        try self.bind(values: values, to: statement)
        let stepResult = sqlite3_step(statement)
        guard stepResult == SQLITE_DONE else {
            throw LocalStoreError.database("Failed to execute statement: \(self.lastErrorMessage())")
        }

        return Int(sqlite3_changes(connection))
    }

    func query<T>(
        sql: String,
        values: [SQLiteValue],
        map: (OpaquePointer) throws -> T
    ) throws -> [T] {
        var statement: OpaquePointer?
        let prepareResult = sqlite3_prepare_v2(connection, sql, -1, &statement, nil)
        guard prepareResult == SQLITE_OK, let statement else {
            throw LocalStoreError.database("Failed to prepare query: \(self.lastErrorMessage())")
        }
        defer {
            sqlite3_finalize(statement)
        }

        try self.bind(values: values, to: statement)

        var rows: [T] = []
        while true {
            let stepResult = sqlite3_step(statement)
            if stepResult == SQLITE_ROW {
                rows.append(try map(statement))
                continue
            }

            if stepResult == SQLITE_DONE {
                break
            }

            throw LocalStoreError.database("Failed to execute query: \(self.lastErrorMessage())")
        }

        return rows
    }

    func scalarInt(sql: String, values: [SQLiteValue]) throws -> Int {
        let results = try self.query(sql: sql, values: values) { statement in
            Int(Self.columnInt64(statement: statement, index: 0))
        }

        guard let value = results.first else {
            throw LocalStoreError.database("Expected an integer result for SQL query")
        }

        return value
    }

    func scalarText(sql: String, values: [SQLiteValue]) throws -> String {
        let results = try self.query(sql: sql, values: values) { statement in
            Self.columnText(statement: statement, index: 0)
        }

        guard let value = results.first else {
            throw LocalStoreError.database("Expected a text result for SQL query")
        }

        return value
    }

    func scalarOptionalText(sql: String, values: [SQLiteValue]) throws -> String? {
        let results = try self.query(sql: sql, values: values) { statement in
            Self.columnOptionalText(statement: statement, index: 0)
        }

        guard let value = results.first else {
            throw LocalStoreError.database("Expected an optional text result for SQL query")
        }

        return value
    }

    func inTransaction<T>(_ body: () throws -> T) throws -> T {
        let beginResult = sqlite3_exec(connection, "BEGIN IMMEDIATE TRANSACTION", nil, nil, nil)
        guard beginResult == SQLITE_OK else {
            throw LocalStoreError.database("Failed to begin transaction: \(self.lastErrorMessage())")
        }

        do {
            let result = try body()
            let commitResult = sqlite3_exec(connection, "COMMIT TRANSACTION", nil, nil, nil)
            guard commitResult == SQLITE_OK else {
                throw LocalStoreError.database("Failed to commit transaction: \(self.lastErrorMessage())")
            }
            return result
        } catch {
            sqlite3_exec(connection, "ROLLBACK TRANSACTION", nil, nil, nil)
            throw error
        }
    }

    func resetForAccountDeletion() throws {
        let migrator = LocalDatabaseMigrator(core: self)
        try migrator.resetLocalSchema()
        try migrator.migrate()
        try LocalDatabaseBootstrapper(core: self).ensureDefaultState()
    }

    static func columnText(statement: OpaquePointer, index: Int32) -> String {
        guard let value = sqlite3_column_text(statement, index) else {
            return ""
        }

        return String(cString: value)
    }

    static func columnOptionalText(statement: OpaquePointer, index: Int32) -> String? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else {
            return nil
        }

        return self.columnText(statement: statement, index: index)
    }

    static func columnInt64(statement: OpaquePointer, index: Int32) -> Int64 {
        sqlite3_column_int64(statement, index)
    }

    static func columnDouble(statement: OpaquePointer, index: Int32) -> Double {
        sqlite3_column_double(statement, index)
    }

    static func columnOptionalInt(statement: OpaquePointer, index: Int32) -> Int? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else {
            return nil
        }

        return Int(self.columnInt64(statement: statement, index: index))
    }

    static func columnOptionalDouble(statement: OpaquePointer, index: Int32) -> Double? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else {
            return nil
        }

        return sqlite3_column_double(statement, index)
    }

    func executeScript(sql: String, errorContext: String) throws {
        let resultCode = sqlite3_exec(connection, sql, nil, nil, nil)
        guard resultCode == SQLITE_OK else {
            throw LocalStoreError.database("\(errorContext): \(self.lastErrorMessage())")
        }
    }

    func tableExists(name: String) throws -> Bool {
        let rows = try self.query(
            sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
            values: [.text(name)]
        ) { statement in
            Self.columnText(statement: statement, index: 0)
        }

        return rows.isEmpty == false
    }

    func columnExists(tableName: String, columnName: String) throws -> Bool {
        let columns = try self.query(
            sql: "PRAGMA table_info(\(tableName))",
            values: []
        ) { statement in
            Self.columnText(statement: statement, index: 1)
        }

        return columns.contains(columnName)
    }

    private static func defaultDatabaseURL() throws -> URL {
        guard let applicationSupportDirectory = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            throw LocalStoreError.database("Application Support directory is unavailable")
        }

        let databaseDirectory = applicationSupportDirectory.appendingPathComponent("Flashcards", isDirectory: true)
        try FileManager.default.createDirectory(
            at: databaseDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )

        return databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
    }

    private static func openConnection(databaseURL: URL) throws -> OpaquePointer {
        let parentDirectory = databaseURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: parentDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )

        var connection: OpaquePointer?
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        let resultCode = sqlite3_open_v2(databaseURL.path, &connection, flags, nil)

        guard resultCode == SQLITE_OK, let connection else {
            let message = connection.map { openConnection in
                String(cString: sqlite3_errmsg(openConnection))
            } ?? "Unknown SQLite open error"
            if let connection {
                sqlite3_close(connection)
            }
            throw LocalStoreError.database("Failed to open local database: \(message)")
        }

        return connection
    }

    private func enableForeignKeys() throws {
        try self.executeScript(
            sql: "PRAGMA foreign_keys = ON;",
            errorContext: "Failed to enable SQLite foreign keys"
        )
    }

    private func enableWriteAheadLogging() throws {
        let journalMode = try self.scalarText(sql: "PRAGMA journal_mode = WAL;", values: [])
        if journalMode.lowercased() != "wal" {
            throw LocalStoreError.database("Failed to enable SQLite WAL mode: received \(journalMode)")
        }
    }

    private func bind(values: [SQLiteValue], to statement: OpaquePointer) throws {
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)

            switch value {
            case .integer(let integer):
                guard sqlite3_bind_int64(statement, index, integer) == SQLITE_OK else {
                    throw LocalStoreError.database("Failed to bind integer parameter at index \(offset)")
                }
            case .real(let real):
                guard sqlite3_bind_double(statement, index, real) == SQLITE_OK else {
                    throw LocalStoreError.database("Failed to bind real parameter at index \(offset)")
                }
            case .text(let text):
                guard sqlite3_bind_text(statement, index, text, -1, sqliteTransient) == SQLITE_OK else {
                    throw LocalStoreError.database("Failed to bind text parameter at index \(offset)")
                }
            case .null:
                guard sqlite3_bind_null(statement, index) == SQLITE_OK else {
                    throw LocalStoreError.database("Failed to bind null parameter at index \(offset)")
                }
            }
        }
    }

    private func lastErrorMessage() -> String {
        String(cString: sqlite3_errmsg(connection))
    }
}
