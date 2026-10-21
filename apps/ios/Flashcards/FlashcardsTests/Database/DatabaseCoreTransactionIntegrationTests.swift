import Foundation
import SQLite3
import XCTest
@testable import Flashcards

final class DatabaseCoreTransactionIntegrationTests: LocalDatabaseTestCase {
    func testCompetingTransactionWaitsForReadTransactionCommit() throws {
        let database = try self.makeDatabase()
        nonisolated(unsafe) let core = database.core
        let contenderStarted = DispatchSemaphore(value: 0)
        let contenderFinished = DispatchSemaphore(value: 0)
        try core.execute(sql: "CREATE TABLE transaction_probe (value TEXT NOT NULL)", values: [])

        try core.inReadTransaction {
            XCTAssertEqual(0, try core.scalarInt(sql: "SELECT COUNT(*) FROM transaction_probe", values: []))
            DispatchQueue.global().async {
                defer { contenderFinished.signal() }
                do {
                    let mutex = try XCTUnwrap(sqlite3_db_mutex(core.connection))
                    let lockResult = sqlite3_mutex_try(mutex)
                    if lockResult == SQLITE_OK { sqlite3_mutex_leave(mutex) }
                    XCTAssertEqual(lockResult, SQLITE_BUSY)
                    contenderStarted.signal()
                    _ = try core.inTransaction {
                        try core.execute(sql: "INSERT INTO transaction_probe VALUES ('contender')", values: [])
                    }
                } catch {
                    XCTFail("Competing transaction failed: \(error)")
                }
            }
            XCTAssertEqual(contenderStarted.wait(timeout: .now() + 5), .success)
            XCTAssertEqual(contenderFinished.wait(timeout: .now()), .timedOut)
        }

        XCTAssertEqual(contenderFinished.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(1, try core.scalarInt(sql: "SELECT COUNT(*) FROM transaction_probe", values: []))
        XCTAssertEqual(1, sqlite3_get_autocommit(core.connection))
    }

    func testStandaloneWriteWaitsForRollbackAndOriginalErrorIsPreserved() throws {
        let database = try self.makeDatabase()
        nonisolated(unsafe) let core = database.core
        let contenderStarted = DispatchSemaphore(value: 0)
        let contenderFinished = DispatchSemaphore(value: 0)
        try core.execute(sql: "CREATE TABLE transaction_probe (value TEXT NOT NULL)", values: [])

        XCTAssertThrowsError(try core.inTransaction {
            try core.execute(sql: "INSERT INTO transaction_probe VALUES ('rolled-back')", values: [])
            DispatchQueue.global().async {
                defer { contenderFinished.signal() }
                do {
                    let mutex = try XCTUnwrap(sqlite3_db_mutex(core.connection))
                    let lockResult = sqlite3_mutex_try(mutex)
                    if lockResult == SQLITE_OK { sqlite3_mutex_leave(mutex) }
                    XCTAssertEqual(lockResult, SQLITE_BUSY)
                    contenderStarted.signal()
                    try core.execute(sql: "INSERT INTO transaction_probe VALUES ('contender')", values: [])
                } catch {
                    XCTFail("Standalone write failed: \(error)")
                }
            }
            XCTAssertEqual(contenderStarted.wait(timeout: .now() + 5), .success)
            XCTAssertEqual(contenderFinished.wait(timeout: .now()), .timedOut)
            throw TransactionProbeError.rollback
        }) { error in
            XCTAssertEqual(error as? TransactionProbeError, .rollback)
        }

        XCTAssertEqual(contenderFinished.wait(timeout: .now() + 5), .success)
        XCTAssertEqual("contender", try core.scalarText(sql: "SELECT value FROM transaction_probe", values: []))
        XCTAssertEqual(1, try core.scalarInt(sql: "SELECT COUNT(*) FROM transaction_probe", values: []))
        XCTAssertEqual(1, sqlite3_get_autocommit(core.connection))
    }

    func testNestedTransactionStillFailsAndOuterTransactionRollsBack() throws {
        let core = try self.makeDatabase().core
        try core.execute(sql: "CREATE TABLE transaction_probe (value TEXT NOT NULL)", values: [])

        XCTAssertThrowsError(try core.inTransaction {
            try core.execute(sql: "INSERT INTO transaction_probe VALUES ('rolled-back')", values: [])
            try core.inTransaction { () }
        }) { error in
            guard case LocalStoreError.database(let message) = error else {
                return XCTFail("Expected database error, received: \(error)")
            }
            XCTAssertTrue(message.contains("cannot start a transaction within a transaction"))
        }

        XCTAssertEqual(0, try core.scalarInt(sql: "SELECT COUNT(*) FROM transaction_probe", values: []))
        _ = try core.inTransaction {
            try core.execute(sql: "INSERT INTO transaction_probe VALUES ('after-rollback')", values: [])
        }
        XCTAssertEqual(1, sqlite3_get_autocommit(core.connection))
    }
}

private enum TransactionProbeError: Error, Equatable {
    case rollback
}
