import Foundation
import SQLite3

enum SQLiteValue {
    case integer(Int64)
    case real(Double)
    case text(String)
    case null
}

let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
let localDatabaseSchemaVersion: Int = 7
let defaultSchedulerAlgorithm: String = defaultSchedulerSettingsConfig.algorithm

final class DatabaseCore {
    let databaseURL: URL
    let connection: OpaquePointer
    let encoder: JSONEncoder
    let decoder: JSONDecoder

    convenience init() throws {
        try self.init(databaseURL: Self.defaultDatabaseURL())
    }

    init(databaseURL: URL) throws {
        self.databaseURL = databaseURL
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.connection = try Self.openConnection(databaseURL: databaseURL)
        sqlite3_busy_timeout(self.connection, 5_000)
        try self.enableForeignKeys()
        try self.enableWriteAheadLogging()
        try self.migrate()
        try self.ensureDefaultState()
    }

    deinit {
        sqlite3_close(connection)
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
        let resultCode = sqlite3_exec(connection, "PRAGMA foreign_keys = ON;", nil, nil, nil)
        guard resultCode == SQLITE_OK else {
            throw LocalStoreError.database("Failed to enable SQLite foreign keys: \(self.lastErrorMessage())")
        }
    }

    private func enableWriteAheadLogging() throws {
        let journalMode = try self.scalarText(sql: "PRAGMA journal_mode = WAL;", values: [])
        if journalMode.lowercased() != "wal" {
            throw LocalStoreError.database("Failed to enable SQLite WAL mode: received \(journalMode)")
        }
    }

    private func migrate() throws {
        var schemaVersion = try self.loadSchemaVersion()
        let hasPreFullFsrsSchema = try self.hasPreFullFsrsSchema()
        if schemaVersion > 0 && schemaVersion < 4 {
            try self.resetLocalSchema()
            schemaVersion = try self.loadSchemaVersion()
        } else if schemaVersion == 0 && hasPreFullFsrsSchema {
            try self.resetLocalSchema()
            schemaVersion = try self.loadSchemaVersion()
        }

        if schemaVersion == 0 {
            try self.runBaseSchemaMigrationSQL()
            try self.setSchemaVersion(version: localDatabaseSchemaVersion)
            return
        }

        let startingSchemaVersion = schemaVersion
        while schemaVersion < localDatabaseSchemaVersion {
            switch schemaVersion {
            case 4:
                try self.migrateSchemaVersion4To5()
                schemaVersion = 5
            case 5:
                try self.migrateSchemaVersion5To6()
                schemaVersion = 6
            case 6:
                try self.migrateSchemaVersion6To7()
                schemaVersion = 7
            default:
                throw LocalStoreError.database("Unsupported local schema version: \(schemaVersion)")
            }

            try self.setSchemaVersion(version: schemaVersion)
        }

        try self.runBaseSchemaMigrationSQL()

        if startingSchemaVersion < 7 {
            try self.rebuildCardTagsReadModel()
        }
    }

    private func runBaseSchemaMigrationSQL() throws {
        let defaultEnableFuzzValue: Int = defaultSchedulerSettingsConfig.enableFuzz ? 1 : 0
        let migrationSQL = """
        CREATE TABLE IF NOT EXISTS workspaces (
            workspace_id TEXT PRIMARY KEY, -- workspace identifier shared across local and server stores
            name TEXT NOT NULL, -- human-readable workspace name shown in the UI
            created_at TEXT NOT NULL, -- local creation timestamp for the workspace row
            fsrs_algorithm TEXT NOT NULL DEFAULT '\(defaultSchedulerSettingsConfig.algorithm)' CHECK (fsrs_algorithm = '\(defaultSchedulerSettingsConfig.algorithm)'), -- scheduler algorithm name kept aligned with the backend contract
            fsrs_desired_retention REAL NOT NULL DEFAULT \(defaultSchedulerSettingsConfig.desiredRetention) CHECK (fsrs_desired_retention > 0 AND fsrs_desired_retention < 1), -- desired recall probability target
            fsrs_learning_steps_minutes_json TEXT NOT NULL DEFAULT '\(defaultSchedulerSettingsConfig.learningStepsMinutesJson)', -- JSON-encoded learning steps mirrored from the backend row
            fsrs_relearning_steps_minutes_json TEXT NOT NULL DEFAULT '\(defaultSchedulerSettingsConfig.relearningStepsMinutesJson)', -- JSON-encoded relearning steps mirrored from the backend row
            fsrs_maximum_interval_days INTEGER NOT NULL DEFAULT \(defaultSchedulerSettingsConfig.maximumIntervalDays) CHECK (fsrs_maximum_interval_days >= 1), -- maximum interval cap mirrored from the backend row
            fsrs_enable_fuzz INTEGER NOT NULL DEFAULT \(defaultEnableFuzzValue) CHECK (fsrs_enable_fuzz IN (0, 1)), -- whether FSRS fuzzing is enabled
            fsrs_client_updated_at TEXT NOT NULL, -- client-side LWW timestamp for the most recent local or synced scheduler-settings winner
            fsrs_last_modified_by_device_id TEXT NOT NULL, -- device that produced the currently winning scheduler-settings row
            fsrs_last_operation_id TEXT NOT NULL, -- client-generated operation identifier used as the deterministic final LWW tie-break
            fsrs_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP -- last time the local mirror row was written or merged
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            user_id TEXT PRIMARY KEY,
            workspace_id TEXT REFERENCES workspaces(workspace_id) ON DELETE SET NULL,
            email TEXT,
            locale TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cards (
            card_id TEXT PRIMARY KEY, -- card identifier generated locally so the row can be created offline
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE, -- workspace ownership for isolation and pull scoping
            front_text TEXT NOT NULL, -- prompt shown to the learner
            back_text TEXT NOT NULL, -- answer shown after reveal
            tags_json TEXT NOT NULL, -- JSON-encoded tag list used by local filtering and sync payload generation
            effort_level TEXT NOT NULL CHECK (effort_level IN ('fast', 'medium', 'long')), -- effort classification mirrored from the backend card row
            due_at TEXT, -- next scheduled review timestamp; NULL for cards that have never been scheduled
            created_at TEXT NOT NULL, -- original card creation timestamp that must survive later edits, reviews, deletes, and sync merges
            reps INTEGER NOT NULL CHECK (reps >= 0), -- denormalized total successful review count cached on the row
            lapses INTEGER NOT NULL CHECK (lapses >= 0), -- denormalized lapse count cached on the row
            fsrs_card_state TEXT NOT NULL CHECK (fsrs_card_state IN ('new', 'learning', 'review', 'relearning')), -- persisted FSRS state required for offline scheduling
            fsrs_step_index INTEGER CHECK (fsrs_step_index IS NULL OR fsrs_step_index >= 0), -- current learning or relearning step index when applicable
            fsrs_stability REAL, -- FSRS memory stability estimate
            fsrs_difficulty REAL, -- FSRS difficulty estimate
            fsrs_last_reviewed_at TEXT, -- timestamp of the most recent review incorporated into this card row
            fsrs_scheduled_days INTEGER CHECK (fsrs_scheduled_days IS NULL OR fsrs_scheduled_days >= 0), -- interval length that produced the current due_at
            client_updated_at TEXT NOT NULL, -- client-side LWW timestamp for the most recent local or synced card winner
            last_modified_by_device_id TEXT NOT NULL, -- device that produced the currently winning card row
            last_operation_id TEXT NOT NULL, -- client-generated operation identifier used as the deterministic final LWW tie-break
            updated_at TEXT NOT NULL, -- last time the local mirror row was written or merged
            deleted_at TEXT -- tombstone timestamp; non-NULL means the card is deleted but must still sync
        );

        CREATE TABLE IF NOT EXISTS decks (
            deck_id TEXT PRIMARY KEY, -- deck identifier generated locally so the row can be created offline
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE, -- workspace ownership for isolation and pull scoping
            name TEXT NOT NULL, -- user-visible deck name
            filter_definition_json TEXT NOT NULL, -- JSON-encoded deck filter definition mirrored to sync payloads
            created_at TEXT NOT NULL, -- original deck creation timestamp that must survive later updates
            client_updated_at TEXT NOT NULL, -- client-side LWW timestamp for the most recent local or synced deck winner
            last_modified_by_device_id TEXT NOT NULL, -- device that produced the currently winning deck row
            last_operation_id TEXT NOT NULL, -- client-generated operation identifier used as the deterministic final LWW tie-break
            updated_at TEXT NOT NULL, -- last time the local mirror row was written or merged
            deleted_at TEXT -- tombstone timestamp; non-NULL means the deck is deleted but must still sync
        );

        CREATE TABLE IF NOT EXISTS review_events (
            review_event_id TEXT PRIMARY KEY, -- immutable review event identifier generated locally for append-only sync
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE, -- workspace ownership for isolation and pull scoping
            card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE, -- card reviewed by this event
            device_id TEXT NOT NULL, -- device that recorded the review event
            client_event_id TEXT NOT NULL, -- client-generated review-event idempotency key reused on push retry
            rating INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 3), -- review rating from Again to Easy
            reviewed_at_client TEXT NOT NULL, -- timestamp captured on the device when the user answered
            reviewed_at_server TEXT NOT NULL, -- local mirror of the backend receive timestamp once synced; local writes use current device time until ack
            UNIQUE (workspace_id, device_id, client_event_id)
        );

        CREATE TABLE IF NOT EXISTS card_tags (
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE, -- workspace ownership for local tag queries and deck filters
            card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE, -- card that currently exposes the tag in its local winning row
            tag TEXT NOT NULL, -- normalized tag value extracted from cards.tags_json for indexed local reads
            PRIMARY KEY (workspace_id, card_id, tag)
        );

        CREATE TABLE IF NOT EXISTS outbox (
            operation_id TEXT PRIMARY KEY, -- unique local operation id used for idempotent sync push
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE, -- workspace that owns the pending sync operation
            device_id TEXT NOT NULL, -- device that created the pending sync operation
            entity_type TEXT NOT NULL, -- sync root targeted by the operation: card, deck, workspace_scheduler_settings, or review_event
            entity_id TEXT NOT NULL, -- identifier of the logical sync root targeted by the operation
            operation_type TEXT NOT NULL, -- mutation kind sent to the backend, such as upsert or append
            payload_json TEXT NOT NULL, -- serialized entity payload that can be uploaded without rereading application tables
            client_updated_at TEXT NOT NULL, -- client-side LWW timestamp associated with the pending operation
            created_at TEXT NOT NULL, -- when the pending operation entered the local outbox
            attempt_count INTEGER NOT NULL DEFAULT 0, -- retry counter for sync diagnostics and exponential backoff decisions
            last_error TEXT -- most recent sync failure message for debugging and user-facing diagnostics
        );

        CREATE TABLE IF NOT EXISTS sync_state (
            workspace_id TEXT PRIMARY KEY REFERENCES workspaces(workspace_id) ON DELETE CASCADE, -- workspace scope for the global change-feed checkpoint
            last_applied_change_id INTEGER NOT NULL DEFAULT 0, -- highest global sync.changes checkpoint already pulled into the local mirror
            updated_at TEXT NOT NULL -- last time the local pull cursor state changed
        );

        CREATE TABLE IF NOT EXISTS app_local_settings (
            settings_id INTEGER PRIMARY KEY CHECK (settings_id = 1),
            device_id TEXT NOT NULL,
            cloud_state TEXT NOT NULL CHECK (cloud_state IN ('disconnected', 'linking-ready', 'linked')),
            linked_user_id TEXT,
            linked_workspace_id TEXT,
            linked_email TEXT,
            onboarding_completed INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_created_at
            ON cards(workspace_id, created_at DESC, card_id ASC);

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_active
            ON cards(workspace_id, due_at)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_created_active
            ON cards(workspace_id, due_at, created_at DESC, card_id ASC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_effort_created_active
            ON cards(workspace_id, effort_level, created_at DESC, card_id ASC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_fsrs_last_reviewed_at
            ON cards(workspace_id, fsrs_last_reviewed_at DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_decks_workspace_created_at
            ON decks(workspace_id, created_at DESC, deck_id DESC);

        CREATE INDEX IF NOT EXISTS idx_card_tags_workspace_tag_card
            ON card_tags(workspace_id, tag, card_id);

        CREATE INDEX IF NOT EXISTS idx_card_tags_workspace_card_tag
            ON card_tags(workspace_id, card_id, tag);

        CREATE INDEX IF NOT EXISTS idx_review_events_workspace_card_time
            ON review_events(workspace_id, card_id, reviewed_at_server DESC);

        CREATE INDEX IF NOT EXISTS idx_outbox_workspace_created_at
            ON outbox(workspace_id, created_at ASC);
        """

        let resultCode = sqlite3_exec(connection, migrationSQL, nil, nil, nil)
        guard resultCode == SQLITE_OK else {
            throw LocalStoreError.database("Failed to run local migrations: \(self.lastErrorMessage())")
        }
    }

    private func migrateSchemaVersion4To5() throws {
        if try self.columnExists(tableName: "cards", columnName: "created_at") {
            return
        }

        try self.execute(
            sql: """
            ALTER TABLE cards
            ADD COLUMN created_at TEXT NOT NULL DEFAULT ''
            """,
            values: []
        )
        try self.execute(
            sql: """
            UPDATE cards
            SET created_at = updated_at
            WHERE created_at = ''
            """,
            values: []
        )
    }

    private func migrateSchemaVersion5To6() throws {
        try self.execute(
            sql: "DROP INDEX IF EXISTS idx_cards_workspace_updated_at",
            values: []
        )
        try self.execute(
            sql: "DROP INDEX IF EXISTS idx_decks_workspace_updated_active",
            values: []
        )
    }

    private func migrateSchemaVersion6To7() throws {}

    /**
     Rebuilds the normalized tag read model from canonical card rows so future
     local queries can use indexed tag filtering without hydrating all cards.
     */
    private func rebuildCardTagsReadModel() throws {
        try self.execute(
            sql: "DELETE FROM card_tags",
            values: []
        )
        try self.execute(
            sql: """
            INSERT INTO card_tags (workspace_id, card_id, tag)
            SELECT
                cards.workspace_id,
                cards.card_id,
                tag_value.value
            FROM cards
            JOIN json_each(cards.tags_json) AS tag_value
            WHERE cards.deleted_at IS NULL AND tag_value.value IS NOT NULL AND tag_value.value <> ''
            """,
            values: []
        )
    }

    private func ensureDefaultState() throws {
        let appSettingsCount = try self.scalarInt(
            sql: "SELECT COUNT(*) FROM app_local_settings",
            values: []
        )
        let deviceId: String
        if appSettingsCount == 0 {
            deviceId = UUID().uuidString.lowercased()
            try self.execute(
                sql: """
                INSERT INTO app_local_settings (
                    settings_id,
                    device_id,
                    cloud_state,
                    linked_user_id,
                    linked_workspace_id,
                    linked_email,
                    onboarding_completed,
                    updated_at
                )
                VALUES (1, ?, 'disconnected', NULL, NULL, NULL, 0, ?)
                """,
                values: [
                    .text(deviceId),
                    .text(currentIsoTimestamp())
                ]
            )
        } else {
            deviceId = try self.scalarText(
                sql: "SELECT device_id FROM app_local_settings WHERE settings_id = 1",
                values: []
            )
        }

        let workspaceCount = try self.scalarInt(
            sql: "SELECT COUNT(*) FROM workspaces",
            values: []
        )
        let workspaceId: String

        if workspaceCount == 0 {
            let now = currentIsoTimestamp()
            let operationId = UUID().uuidString.lowercased()
            workspaceId = UUID().uuidString.lowercased()
            try self.execute(
                sql: """
                INSERT INTO workspaces (
                    workspace_id,
                    name,
                    created_at,
                    fsrs_client_updated_at,
                    fsrs_last_modified_by_device_id,
                    fsrs_last_operation_id,
                    fsrs_updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(workspaceId),
                    .text("Personal"),
                    .text(now),
                    .text(now),
                    .text(deviceId),
                    .text(operationId),
                    .text(now)
                ]
            )
        } else {
            workspaceId = try self.scalarText(
                sql: "SELECT workspace_id FROM workspaces ORDER BY created_at ASC LIMIT 1",
                values: []
            )
        }

        let syncStateCount = try self.scalarInt(
            sql: "SELECT COUNT(*) FROM sync_state WHERE workspace_id = ?",
            values: [.text(workspaceId)]
        )
        if syncStateCount == 0 {
            try self.execute(
                sql: """
                INSERT INTO sync_state (
                    workspace_id,
                    last_applied_change_id,
                    updated_at
                )
                VALUES (?, 0, ?)
                """,
                values: [
                    .text(workspaceId),
                    .text(currentIsoTimestamp())
                ]
            )
        }

        let userSettingsCount = try self.scalarInt(
            sql: "SELECT COUNT(*) FROM user_settings",
            values: []
        )
        if userSettingsCount == 0 {
            let locale = Locale.current.language.languageCode?.identifier ?? "en"
            try self.execute(
                sql: """
                INSERT INTO user_settings (user_id, workspace_id, email, locale, created_at)
                VALUES (?, ?, NULL, ?, ?)
                """,
                values: [
                    .text("local-user"),
                    .text(workspaceId),
                    .text(locale),
                    .text(currentIsoTimestamp())
                ]
            )
        }
    }

    private func loadSchemaVersion() throws -> Int {
        let rows = try self.query(
            sql: "PRAGMA user_version",
            values: []
        ) { statement in
            Int(Self.columnInt64(statement: statement, index: 0))
        }

        guard let version = rows.first else {
            throw LocalStoreError.database("Failed to read SQLite schema version")
        }

        return version
    }

    private func setSchemaVersion(version: Int) throws {
        let resultCode = sqlite3_exec(connection, "PRAGMA user_version = \(version);", nil, nil, nil)
        guard resultCode == SQLITE_OK else {
            throw LocalStoreError.database("Failed to update SQLite schema version: \(self.lastErrorMessage())")
        }
    }

    private func hasPreFullFsrsSchema() throws -> Bool {
        if try self.tableExists(name: "cards") == false {
            return false
        }

        if try self.columnExists(tableName: "cards", columnName: "fsrs_card_state") == false {
            return true
        }

        if try self.columnExists(tableName: "workspaces", columnName: "fsrs_algorithm") == false {
            return true
        }

        return try self.tableExists(name: "workspace_scheduler_settings")
    }

    private func resetLocalSchema() throws {
        let resetSQL = """
        DROP TABLE IF EXISTS outbox;
        DROP TABLE IF EXISTS sync_state;
        DROP TABLE IF EXISTS review_events;
        DROP TABLE IF EXISTS decks;
        DROP TABLE IF EXISTS cards;
        DROP TABLE IF EXISTS workspace_scheduler_settings;
        DROP TABLE IF EXISTS user_settings;
        DROP TABLE IF EXISTS app_local_settings;
        DROP TABLE IF EXISTS workspaces;
        PRAGMA user_version = 0;
        """
        let resultCode = sqlite3_exec(connection, resetSQL, nil, nil, nil)
        guard resultCode == SQLITE_OK else {
            throw LocalStoreError.database("Failed to reset local schema: \(self.lastErrorMessage())")
        }
    }

    func resetForAccountDeletion() throws {
        try self.resetLocalSchema()
        try self.migrate()
        try self.ensureDefaultState()
    }

    private func tableExists(name: String) throws -> Bool {
        let rows = try self.query(
            sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
            values: [.text(name)]
        ) { statement in
            Self.columnText(statement: statement, index: 0)
        }

        return rows.isEmpty == false
    }

    private func columnExists(tableName: String, columnName: String) throws -> Bool {
        let columns = try self.query(
            sql: "PRAGMA table_info(\(tableName))",
            values: []
        ) { statement in
            Self.columnText(statement: statement, index: 1)
        }

        return columns.contains(columnName)
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
