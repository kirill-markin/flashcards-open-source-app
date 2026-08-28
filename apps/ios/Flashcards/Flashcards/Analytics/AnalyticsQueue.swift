import Foundation
import SQLite3

/// One queued event with the identity it was emitted under. Identity is stored per event rather than
/// read at flush time so a batch never claims a session or an anonymous id the event did not belong
/// to — the queue survives relaunches, session rotation and logout.
///
/// The stored `anonymousId` is also what makes the identity boundary durable: it is compared with the
/// persisted current id before anything is sent, so a row written before a logout is recognisable as
/// such no matter what happened to the process or to the wipe that was supposed to remove it.
struct AnalyticsQueuedEvent: Sendable, Equatable {
    let anonymousId: String
    let sessionId: String
    let payload: AnalyticsEventPayload
}

/// A batch is always drawn from a single `(anonymousId, sessionId)` pair, because both are batch-level
/// fields on the wire.
struct AnalyticsQueueBatch: Sendable, Equatable {
    let anonymousId: String
    let sessionId: String
    let payloads: [AnalyticsEventPayload]

    var eventIds: [String] {
        self.payloads.map { payload in
            payload.eventId
        }
    }
}

struct AnalyticsQueueAppendOutcome: Sendable, Equatable {
    let queuedEventCount: Int
    let overflowDroppedCount: Int
    let expiredDroppedCount: Int
}

/// A batch and the identity-boundary purge that had to happen before it could be selected. The two are
/// returned together so a batch can never be produced without the purge having run.
struct AnalyticsQueueBatchLoad: Sendable, Equatable {
    let batch: AnalyticsQueueBatch?
    let boundaryDiscardedCount: Int
}

enum AnalyticsQueueError: LocalizedError, Equatable {
    case open(String)
    case write(String)
    case read(String)

    var errorDescription: String? {
        switch self {
        case .open(let message):
            return "Analytics queue could not be opened: \(message)"
        case .write(let message):
            return "Analytics queue write failed: \(message)"
        case .read(let message):
            return "Analytics queue read failed: \(message)"
        }
    }
}

/**
 * Durable event queue in its own SQLite file, deliberately separate from the product database under
 * `Database/`. A separate file rather than a separate table: one SQLite file means one write lock, so
 * analytics writes would contend with product sync writes, which is exactly what the no-blocking rule
 * forbids. This queue is best effort and has a TTL; the sync outbox is strict and preserves product
 * data. They must not be mixed.
 *
 * The store is opened lazily, so app launch never waits for it.
 *
 * `@unchecked Sendable` because `AnalyticsRuntime` owns the only reference and every call already
 * runs on that actor's executor, which keeps the SQLite work off the main actor without paying for a
 * second hop on every queue write.
 */
final class AnalyticsQueue: @unchecked Sendable {
    private let databaseURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var connection: OpaquePointer?

    init(databaseURL: URL? = nil) {
        self.databaseURL = databaseURL ?? AnalyticsQueue.defaultDatabaseURL()
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.connection = nil
    }

    deinit {
        if let connection = self.connection {
            sqlite3_close_v2(connection)
        }
    }

    static func defaultDatabaseURL() -> URL {
        let applicationSupportDirectory = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first
        let directory = (applicationSupportDirectory ?? URL(fileURLWithPath: NSTemporaryDirectory()))
            .appendingPathComponent("Flashcards", isDirectory: true)
        return directory.appendingPathComponent("analytics.sqlite", isDirectory: false)
    }

    func append(event: AnalyticsQueuedEvent, now: Date) throws -> AnalyticsQueueAppendOutcome {
        let connection = try self.openedConnection()
        let payloadJson = try self.encodePayload(payload: event.payload)
        let payloadBytes = payloadJson.utf8.count
        guard payloadBytes <= analyticsMaximumEventByteCount else {
            throw AnalyticsQueueError.write(
                "Event \(event.payload.eventName) is \(payloadBytes) bytes and exceeds the per-event limit"
            )
        }

        let expiredDroppedCount = try self.deleteExpired(connection: connection, now: now)
        try self.execute(
            connection: connection,
            sql: """
                INSERT OR REPLACE INTO analytics_events
                    (event_id, created_at, anonymous_id, session_id, payload, payload_bytes)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
            values: [
                .text(event.payload.eventId),
                .real(now.timeIntervalSince1970),
                .text(event.anonymousId),
                .text(event.sessionId),
                .text(payloadJson),
                .integer(Int64(payloadBytes))
            ]
        )
        let overflowDroppedCount = try self.enforceCaps(connection: connection)

        return AnalyticsQueueAppendOutcome(
            queuedEventCount: try self.scalarInt(connection: connection, sql: "SELECT COUNT(*) FROM analytics_events"),
            overflowDroppedCount: overflowDroppedCount,
            expiredDroppedCount: expiredDroppedCount
        )
    }

    func removeExpired(now: Date) throws -> Int {
        let connection = try self.openedConnection()
        return try self.deleteExpired(connection: connection, now: now)
    }

    /**
     * Oldest events first, restricted to the identity pair of the oldest row so the batch envelope can
     * carry one `anonymousId` and one `sessionId` truthfully.
     *
     * Every row that does not belong to `anonymousId` is deleted first, in the same call that produces
     * the batch, which is the send-time half of the identity boundary. `anonymous_id` rotates in
     * `UserDefaults` before the boundary's queue wipe is even scheduled, so a wipe that failed — or a
     * process that died before it ran — leaves rows that are still recognisably pre-boundary here and
     * are removed rather than posted under the next person's credential. If the purge itself fails the
     * whole call throws and no batch is produced, so the failure is closed rather than silent.
     */
    func loadNextBatch(limit: Int, anonymousId: String) throws -> AnalyticsQueueBatchLoad {
        let connection = try self.openedConnection()
        let boundaryDiscardedCount = try self.removeEvents(notOwnedByAnonymousId: anonymousId)
        let identity = try self.query(
            connection: connection,
            sql: "SELECT anonymous_id, session_id FROM analytics_events ORDER BY created_at ASC, rowid ASC LIMIT 1",
            values: []
        ) { statement in
            (
                AnalyticsQueue.columnText(statement: statement, index: 0),
                AnalyticsQueue.columnText(statement: statement, index: 1)
            )
        }.first
        guard let identity else {
            return AnalyticsQueueBatchLoad(batch: nil, boundaryDiscardedCount: boundaryDiscardedCount)
        }

        let rows = try self.query(
            connection: connection,
            sql: """
                SELECT event_id, payload FROM analytics_events
                WHERE anonymous_id = ? AND session_id = ?
                ORDER BY created_at ASC, rowid ASC
                LIMIT ?
                """,
            values: [.text(identity.0), .text(identity.1), .integer(Int64(max(1, limit)))]
        ) { statement in
            (
                AnalyticsQueue.columnText(statement: statement, index: 0),
                AnalyticsQueue.columnText(statement: statement, index: 1)
            )
        }

        var payloads: [AnalyticsEventPayload] = []
        var undecodableEventIds: [String] = []
        for row in rows {
            guard let data = row.1.data(using: .utf8),
                  let payload = try? self.decoder.decode(AnalyticsEventPayload.self, from: data) else {
                undecodableEventIds.append(row.0)
                continue
            }
            payloads.append(payload)
        }

        // A row that cannot be decoded can never be sent, so it is removed rather than left to block
        // the head of the queue forever.
        try self.delete(eventIds: undecodableEventIds)

        guard payloads.isEmpty == false else {
            return AnalyticsQueueBatchLoad(batch: nil, boundaryDiscardedCount: boundaryDiscardedCount)
        }

        return AnalyticsQueueBatchLoad(
            batch: AnalyticsQueueBatch(
                anonymousId: identity.0,
                sessionId: identity.1,
                payloads: payloads
            ),
            boundaryDiscardedCount: boundaryDiscardedCount
        )
    }

    /**
     * Removes every row that does not belong to `anonymousId`, and returns how many there were.
     *
     * Called at the identity boundary and again before every batch selection, so the boundary does not
     * depend on either call succeeding: the rotated `anonymous_id` is the fact, and this is only the
     * cleanup that acts on it.
     */
    @discardableResult
    func removeEvents(notOwnedByAnonymousId anonymousId: String) throws -> Int {
        let connection = try self.openedConnection()
        return try self.execute(
            connection: connection,
            sql: "DELETE FROM analytics_events WHERE anonymous_id <> ?",
            values: [.text(anonymousId)]
        )
    }

    func delete(eventIds: [String]) throws {
        guard eventIds.isEmpty == false else {
            return
        }

        let connection = try self.openedConnection()
        let placeholders = Array(repeating: "?", count: eventIds.count).joined(separator: ", ")
        try self.execute(
            connection: connection,
            sql: "DELETE FROM analytics_events WHERE event_id IN (\(placeholders))",
            values: eventIds.map { eventId in
                SQLiteValue.text(eventId)
            }
        )
    }

    /// The kill switch, which drops everything regardless of who it belongs to. The identity boundary
    /// uses `removeEvents(notOwnedByAnonymousId:)` instead, so a boundary discard stays distinguishable
    /// from a disabled client.
    @discardableResult
    func removeAll() throws -> Int {
        let connection = try self.openedConnection()
        return try self.execute(connection: connection, sql: "DELETE FROM analytics_events", values: [])
    }

    private func encodePayload(payload: AnalyticsEventPayload) throws -> String {
        let data = try self.encoder.encode(payload)
        guard let json = String(data: data, encoding: .utf8) else {
            throw AnalyticsQueueError.write("Event payload could not be encoded as UTF-8")
        }

        return json
    }

    private func deleteExpired(connection: OpaquePointer, now: Date) throws -> Int {
        let cutoff = now.timeIntervalSince1970 - analyticsQueueTimeToLiveSeconds
        return try self.execute(
            connection: connection,
            sql: "DELETE FROM analytics_events WHERE created_at < ?",
            values: [.real(cutoff)]
        )
    }

    /// Overflow policy is drop oldest, on both the event-count cap and the byte cap.
    private func enforceCaps(connection: OpaquePointer) throws -> Int {
        var droppedCount = try self.execute(
            connection: connection,
            sql: """
                DELETE FROM analytics_events WHERE rowid IN (
                    SELECT rowid FROM analytics_events
                    ORDER BY created_at DESC, rowid DESC
                    LIMIT -1 OFFSET ?
                )
                """,
            values: [.integer(Int64(analyticsQueueMaximumEventCount))]
        )

        while true {
            let totalByteCount = try self.scalarInt(
                connection: connection,
                sql: "SELECT COALESCE(SUM(payload_bytes), 0) FROM analytics_events"
            )
            guard totalByteCount > analyticsQueueMaximumByteCount else {
                break
            }

            let removed = try self.execute(
                connection: connection,
                sql: """
                    DELETE FROM analytics_events WHERE rowid IN (
                        SELECT rowid FROM analytics_events
                        ORDER BY created_at ASC, rowid ASC
                        LIMIT 100
                    )
                    """,
                values: []
            )
            guard removed > 0 else {
                break
            }
            droppedCount += removed
        }

        return droppedCount
    }

    private func openedConnection() throws -> OpaquePointer {
        if let connection = self.connection {
            return connection
        }

        let directory = self.databaseURL.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: nil
            )
        } catch {
            throw AnalyticsQueueError.open(Flashcards.errorMessage(error: error))
        }

        var connection: OpaquePointer?
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        let resultCode = sqlite3_open_v2(self.databaseURL.path, &connection, flags, nil)
        guard resultCode == SQLITE_OK, let connection else {
            let message = connection.map { openedConnection in
                String(cString: sqlite3_errmsg(openedConnection))
            } ?? "Unknown SQLite open error"
            if let connection {
                sqlite3_close_v2(connection)
            }
            throw AnalyticsQueueError.open(message)
        }

        sqlite3_busy_timeout(connection, 2_000)
        do {
            try self.createSchema(connection: connection)
        } catch {
            sqlite3_close_v2(connection)
            throw error
        }

        self.connection = connection
        return connection
    }

    private func createSchema(connection: OpaquePointer) throws {
        let sql = """
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS analytics_events (
                event_id TEXT PRIMARY KEY NOT NULL,
                created_at REAL NOT NULL,
                anonymous_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                payload_bytes INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS analytics_events_created_at
                ON analytics_events (created_at);
            """
        guard sqlite3_exec(connection, sql, nil, nil, nil) == SQLITE_OK else {
            throw AnalyticsQueueError.open(String(cString: sqlite3_errmsg(connection)))
        }
    }

    @discardableResult
    private func execute(connection: OpaquePointer, sql: String, values: [SQLiteValue]) throws -> Int {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(connection, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw AnalyticsQueueError.write(String(cString: sqlite3_errmsg(connection)))
        }
        defer {
            sqlite3_finalize(statement)
        }

        try self.bind(connection: connection, values: values, to: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw AnalyticsQueueError.write(String(cString: sqlite3_errmsg(connection)))
        }

        return Int(sqlite3_changes(connection))
    }

    private func query<T>(
        connection: OpaquePointer,
        sql: String,
        values: [SQLiteValue],
        map: (OpaquePointer) -> T
    ) throws -> [T] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(connection, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw AnalyticsQueueError.read(String(cString: sqlite3_errmsg(connection)))
        }
        defer {
            sqlite3_finalize(statement)
        }

        try self.bind(connection: connection, values: values, to: statement)

        var rows: [T] = []
        while true {
            let stepResult = sqlite3_step(statement)
            if stepResult == SQLITE_ROW {
                rows.append(map(statement))
                continue
            }
            if stepResult == SQLITE_DONE {
                break
            }

            throw AnalyticsQueueError.read(String(cString: sqlite3_errmsg(connection)))
        }

        return rows
    }

    private func scalarInt(connection: OpaquePointer, sql: String) throws -> Int {
        let rows = try self.query(connection: connection, sql: sql, values: []) { statement in
            Int(sqlite3_column_int64(statement, 0))
        }
        guard let value = rows.first else {
            throw AnalyticsQueueError.read("Expected one row for \(sql)")
        }

        return value
    }

    private func bind(connection: OpaquePointer, values: [SQLiteValue], to statement: OpaquePointer) throws {
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            let resultCode: Int32
            switch value {
            case .integer(let integer):
                resultCode = sqlite3_bind_int64(statement, index, integer)
            case .real(let real):
                resultCode = sqlite3_bind_double(statement, index, real)
            case .text(let text):
                resultCode = sqlite3_bind_text(statement, index, text, -1, sqliteTransient)
            case .null:
                resultCode = sqlite3_bind_null(statement, index)
            }
            guard resultCode == SQLITE_OK else {
                throw AnalyticsQueueError.write(String(cString: sqlite3_errmsg(connection)))
            }
        }
    }

    private static func columnText(statement: OpaquePointer, index: Int32) -> String {
        guard let value = sqlite3_column_text(statement, index) else {
            return ""
        }

        return String(cString: value)
    }
}
