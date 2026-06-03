import Foundation
import XCTest
@testable import Flashcards

class LocalDatabaseTestCase: XCTestCase {
    var databaseURL: URL?
    var database: LocalDatabase?

    override func tearDownWithError() throws {
        if let database {
            try database.close()
        }
        if let databaseURL {
            try? FileManager.default.removeItem(at: databaseURL)
        }
        self.database = nil
        self.databaseURL = nil
        try super.tearDownWithError()
    }

    func makeDatabase() throws -> LocalDatabase {
        let databaseURL = try self.makeDatabaseURL()
        let database = try LocalDatabase(databaseURL: databaseURL)
        self.databaseURL = databaseURL
        self.database = database
        return database
    }

    func makeDatabaseURL() throws -> URL {
        let databaseDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(
            at: databaseDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
        return databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
    }

    func loadSchemaVersion(database: LocalDatabase) throws -> Int {
        let rows = try database.core.query(
            sql: "PRAGMA user_version",
            values: []
        ) { statement in
            Int(DatabaseCore.columnInt64(statement: statement, index: 0))
        }

        return try XCTUnwrap(rows.first)
    }

    func countRows(database: LocalDatabase, tableName: String) throws -> Int {
        try database.core.scalarInt(
            sql: "SELECT COUNT(*) FROM \(tableName)",
            values: []
        )
    }

    func hasIndex(database: LocalDatabase, tableName: String, indexName: String) throws -> Bool {
        let indexNames = try database.core.query(
            sql: "PRAGMA index_list(\(self.singleQuotedSQLIdentifier(identifier: tableName)))",
            values: []
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 1)
        }

        return indexNames.contains(indexName)
    }

    func hasColumn(database: LocalDatabase, tableName: String, columnName: String) throws -> Bool {
        try database.core.columnExists(tableName: tableName, columnName: columnName)
    }

    private func singleQuotedSQLIdentifier(identifier: String) -> String {
        "'\(identifier.replacingOccurrences(of: "'", with: "''"))'"
    }
}

