import Foundation

private struct DueAtMillisMigrationRow {
    let cardId: String
    let dueAt: String
}

struct LocalDatabaseMigrator {
    let core: DatabaseCore

    func migrate() throws {
        var schemaVersion = try self.loadSchemaVersion()
        let hasPreFullFsrsSchema = try self.hasPreFullFsrsSchema()
        if schemaVersion > 0 && schemaVersion < 4 {
            throw self.unsupportedLegacySchemaError(reason: "schema version \(schemaVersion)")
        } else if schemaVersion == 0 && hasPreFullFsrsSchema {
            throw self.unsupportedLegacySchemaError(reason: "pre-full-fsrs schema")
        }

        if schemaVersion == 0 {
            try self.runBaseSchemaMigrationSQL()
            try self.setSchemaVersion(version: LocalDatabaseSchema.currentVersion)
            return
        }

        let startingSchemaVersion = schemaVersion
        while schemaVersion < LocalDatabaseSchema.currentVersion {
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
            case 7:
                try self.migrateSchemaVersion7To8()
                schemaVersion = 8
            case 8:
                try self.migrateSchemaVersion8To9()
                schemaVersion = 9
            case 9:
                try self.migrateSchemaVersion9To10()
                schemaVersion = 10
            case 10:
                try self.migrateSchemaVersion10To11()
                schemaVersion = 11
            case 11:
                try self.migrateSchemaVersion11To12()
                schemaVersion = 12
            case 12:
                try self.migrateSchemaVersion12To13()
                schemaVersion = 13
            case 13:
                try self.migrateSchemaVersion13To14()
                schemaVersion = 14
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

    func resetLocalSchema() throws {
        try self.core.executeScript(
            sql: LocalDatabaseSchema.resetSQL,
            errorContext: "Failed to reset local schema"
        )
    }

    private func runBaseSchemaMigrationSQL() throws {
        try self.core.executeScript(
            sql: LocalDatabaseSchema.baseMigrationSQL,
            errorContext: "Failed to run local migrations"
        )
    }

    private func migrateSchemaVersion4To5() throws {
        if try self.core.columnExists(tableName: "cards", columnName: "created_at") {
            return
        }

        try self.core.execute(
            sql: """
            ALTER TABLE cards
            ADD COLUMN created_at TEXT NOT NULL DEFAULT ''
            """,
            values: []
        )
        try self.core.execute(
            sql: """
            UPDATE cards
            SET created_at = updated_at
            WHERE created_at = ''
            """,
            values: []
        )
    }

    private func migrateSchemaVersion5To6() throws {
        try self.core.execute(
            sql: "DROP INDEX IF EXISTS idx_cards_workspace_updated_at",
            values: []
        )
        try self.core.execute(
            sql: "DROP INDEX IF EXISTS idx_decks_workspace_updated_active",
            values: []
        )
    }

    private func migrateSchemaVersion6To7() throws {}

    /// The old single-feed sync cursor cannot be translated into the new hot-state
    /// cursor safely because the backend no longer replays the legacy change log.
    /// We preserve all local canonical tables and outbox rows, but force the first
    /// sync on the new app version to start from a fresh hot bootstrap.
    private func migrateSchemaVersion7To8() throws {
        try self.core.execute(
            sql: """
            CREATE TABLE sync_state_v8 (
                workspace_id TEXT PRIMARY KEY REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
                last_applied_hot_change_id INTEGER NOT NULL DEFAULT 0,
                last_applied_review_sequence_id INTEGER NOT NULL DEFAULT 0,
                has_hydrated_hot_state INTEGER NOT NULL DEFAULT 0,
                has_hydrated_review_history INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
            """,
            values: []
        )
        try self.core.execute(
            sql: """
            INSERT INTO sync_state_v8 (
                workspace_id,
                last_applied_hot_change_id,
                last_applied_review_sequence_id,
                has_hydrated_hot_state,
                has_hydrated_review_history,
                updated_at
            )
            SELECT
                workspace_id,
                0,
                0,
                0,
                0,
                updated_at
            FROM sync_state
            """,
            values: []
        )
        try self.core.execute(sql: "DROP TABLE sync_state", values: [])
        try self.core.execute(sql: "ALTER TABLE sync_state_v8 RENAME TO sync_state", values: [])
    }

    private func migrateSchemaVersion8To9() throws {
        try self.core.execute(
            sql: """
            CREATE TABLE app_local_settings_v9 (
                settings_id INTEGER PRIMARY KEY CHECK (settings_id = 1),
                installation_id TEXT NOT NULL,
                cloud_state TEXT NOT NULL CHECK (cloud_state IN ('disconnected', 'linking-ready', 'guest', 'linked')),
                linked_user_id TEXT,
                linked_workspace_id TEXT,
                linked_email TEXT,
                onboarding_completed INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
            """,
            values: []
        )
        try self.core.execute(
            sql: """
            INSERT INTO app_local_settings_v9 (
                settings_id,
                installation_id,
                cloud_state,
                linked_user_id,
                linked_workspace_id,
                linked_email,
                onboarding_completed,
                updated_at
            )
            -- Schema v8 stored the stable installation identity in the legacy
            -- device_id column. v9 keeps the same value and renames the local column.
            SELECT
                settings_id,
                device_id,
                cloud_state,
                linked_user_id,
                linked_workspace_id,
                linked_email,
                onboarding_completed,
                updated_at
            FROM app_local_settings
            """,
            values: []
        )
        try self.core.execute(sql: "DROP TABLE app_local_settings", values: [])
        try self.core.execute(sql: "ALTER TABLE app_local_settings_v9 RENAME TO app_local_settings", values: [])
    }

    private func migrateSchemaVersion9To10() throws {
        try self.core.execute(
            sql: """
            CREATE TABLE app_local_settings_v10 (
                settings_id INTEGER PRIMARY KEY CHECK (settings_id = 1),
                installation_id TEXT NOT NULL,
                cloud_state TEXT NOT NULL CHECK (cloud_state IN ('disconnected', 'linking-ready', 'guest', 'linked')),
                linked_user_id TEXT,
                linked_workspace_id TEXT,
                active_workspace_id TEXT,
                linked_email TEXT,
                onboarding_completed INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
            """,
            values: []
        )
        try self.core.execute(
            sql: """
            INSERT INTO app_local_settings_v10 (
                settings_id,
                installation_id,
                cloud_state,
                linked_user_id,
                linked_workspace_id,
                active_workspace_id,
                linked_email,
                onboarding_completed,
                updated_at
            )
            SELECT
                settings_id,
                installation_id,
                cloud_state,
                linked_user_id,
                linked_workspace_id,
                linked_workspace_id,
                linked_email,
                onboarding_completed,
                updated_at
            FROM app_local_settings
            """,
            values: []
        )
        try self.core.execute(sql: "DROP TABLE app_local_settings", values: [])
        try self.core.execute(sql: "ALTER TABLE app_local_settings_v10 RENAME TO app_local_settings", values: [])
    }

    private func migrateSchemaVersion10To11() throws {
        try self.core.execute(
            sql: """
            CREATE TABLE review_events_v11 (
                review_event_id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
                card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
                replica_id TEXT NOT NULL,
                client_event_id TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 3),
                reviewed_at_client TEXT NOT NULL,
                reviewed_at_server TEXT NOT NULL,
                UNIQUE (workspace_id, replica_id, client_event_id)
            )
            """,
            values: []
        )
        try self.core.execute(
            sql: """
            INSERT INTO review_events_v11 (
                review_event_id,
                workspace_id,
                card_id,
                replica_id,
                client_event_id,
                rating,
                reviewed_at_client,
                reviewed_at_server
            )
            -- Schema v10 stored the server-stamped replica id in the legacy
            -- device_id column. v11 keeps the same value and renames the local column.
            SELECT
                review_event_id,
                workspace_id,
                card_id,
                device_id,
                client_event_id,
                rating,
                reviewed_at_client,
                reviewed_at_server
            FROM review_events
            """,
            values: []
        )
        try self.core.execute(sql: "DROP TABLE review_events", values: [])
        try self.core.execute(sql: "ALTER TABLE review_events_v11 RENAME TO review_events", values: [])
        try self.core.execute(
            sql: "CREATE INDEX IF NOT EXISTS idx_review_events_workspace_card_time ON review_events(workspace_id, card_id, reviewed_at_server DESC)",
            values: []
        )

        try self.core.execute(
            sql: """
            CREATE TABLE outbox_v11 (
                operation_id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
                installation_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                operation_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                client_updated_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT
            )
            """,
            values: []
        )
        try self.core.execute(
            sql: """
            INSERT INTO outbox_v11 (
                operation_id,
                workspace_id,
                installation_id,
                entity_type,
                entity_id,
                operation_type,
                payload_json,
                client_updated_at,
                created_at,
                attempt_count,
                last_error
            )
            -- Schema v10 stored the stable installation identity in the legacy
            -- device_id column. v11 keeps the same value and renames the local column.
            SELECT
                operation_id,
                workspace_id,
                device_id,
                entity_type,
                entity_id,
                operation_type,
                payload_json,
                client_updated_at,
                created_at,
                attempt_count,
                last_error
            FROM outbox
            """,
            values: []
        )
        try self.core.execute(sql: "DROP TABLE outbox", values: [])
        try self.core.execute(sql: "ALTER TABLE outbox_v11 RENAME TO outbox", values: [])
        try self.core.execute(
            sql: "CREATE INDEX IF NOT EXISTS idx_outbox_workspace_created_at ON outbox(workspace_id, created_at ASC)",
            values: []
        )

        try self.core.execute(
            sql: """
            CREATE TABLE app_local_settings_v11 (
                settings_id INTEGER PRIMARY KEY CHECK (settings_id = 1),
                installation_id TEXT NOT NULL,
                cloud_state TEXT NOT NULL CHECK (cloud_state IN ('disconnected', 'linking-ready', 'guest', 'linked')),
                linked_user_id TEXT,
                linked_workspace_id TEXT,
                active_workspace_id TEXT,
                linked_email TEXT,
                onboarding_completed INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
            """,
            values: []
        )
        try self.core.execute(
            sql: """
            INSERT INTO app_local_settings_v11 (
                settings_id,
                installation_id,
                cloud_state,
                linked_user_id,
                linked_workspace_id,
                active_workspace_id,
                linked_email,
                onboarding_completed,
                updated_at
            )
            -- Schema v10 still used device_id as the local storage name for the
            -- stable installation identity. v11 renames that local column.
            SELECT
                settings_id,
                device_id,
                cloud_state,
                linked_user_id,
                linked_workspace_id,
                active_workspace_id,
                linked_email,
                onboarding_completed,
                updated_at
            FROM app_local_settings
            """,
            values: []
        )
        try self.core.execute(sql: "DROP TABLE app_local_settings", values: [])
        try self.core.execute(sql: "ALTER TABLE app_local_settings_v11 RENAME TO app_local_settings", values: [])
    }

    private func migrateSchemaVersion11To12() throws {
        try self.core.execute(
            sql: "CREATE INDEX IF NOT EXISTS idx_review_events_reviewed_at_client ON review_events(reviewed_at_client)",
            values: []
        )
    }

    private func migrateSchemaVersion12To13() throws {
        if try self.core.columnExists(tableName: "cards", columnName: "due_at_millis") == false {
            try self.core.execute(
                sql: """
                ALTER TABLE cards
                ADD COLUMN due_at_millis INTEGER
                """,
                values: []
            )
        }

        try self.populateDueAtMillisFromDueAtText()
        try self.core.execute(sql: "DROP INDEX IF EXISTS idx_cards_workspace_due_active", values: [])
        try self.core.execute(sql: "DROP INDEX IF EXISTS idx_cards_workspace_due_created_active", values: [])
        try self.createDueAtMillisIndexes()
    }

    private func migrateSchemaVersion13To14() throws {
        if try self.core.columnExists(tableName: "outbox", columnName: "review_schedule_impact") {
            try self.backfillLegacyOutboxReviewScheduleImpact()
            return
        }

        try self.core.execute(
            sql: """
            ALTER TABLE outbox
            ADD COLUMN review_schedule_impact INTEGER NOT NULL DEFAULT 1 CHECK (review_schedule_impact IN (0, 1))
            """,
            values: []
        )
        try self.backfillLegacyOutboxReviewScheduleImpact()
    }

    private func backfillLegacyOutboxReviewScheduleImpact() throws {
        try self.core.execute(
            sql: """
            UPDATE outbox
            SET review_schedule_impact = 0
            WHERE entity_type IN ('deck', 'workspace_scheduler_settings', 'review_event')
            """,
            values: []
        )
    }

    private func populateDueAtMillisFromDueAtText() throws {
        let rows = try self.core.query(
            sql: """
            SELECT card_id, due_at
            FROM cards
            WHERE due_at IS NOT NULL AND due_at_millis IS NULL
            """,
            values: []
        ) { statement in
            DueAtMillisMigrationRow(
                cardId: DatabaseCore.columnText(statement: statement, index: 0),
                dueAt: DatabaseCore.columnText(statement: statement, index: 1)
            )
        }

        for row in rows {
            guard let dueAtMillis = parseStrictIsoTimestampEpochMillis(value: row.dueAt) else {
                continue
            }

            try self.core.execute(
                sql: """
                UPDATE cards
                SET due_at_millis = ?
                WHERE card_id = ?
                """,
                values: [
                    .integer(dueAtMillis),
                    .text(row.cardId)
                ]
            )
        }
    }

    private func createDueAtMillisIndexes() throws {
        try self.core.execute(
            sql: """
            CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_millis_active
                ON cards(workspace_id, due_at_millis, created_at DESC, card_id ASC)
                WHERE deleted_at IS NULL AND due_at_millis IS NOT NULL
            """,
            values: []
        )
        try self.core.execute(
            sql: """
            CREATE INDEX IF NOT EXISTS idx_cards_workspace_new_due_active
                ON cards(workspace_id, created_at DESC, card_id ASC)
                WHERE deleted_at IS NULL AND due_at IS NULL
            """,
            values: []
        )
    }

    /**
     Rebuilds the normalized tag read model from canonical card rows so future
     local queries can use indexed tag filtering without hydrating all cards.
     */
    private func rebuildCardTagsReadModel() throws {
        try self.core.execute(
            sql: "DELETE FROM card_tags",
            values: []
        )
        try self.core.execute(
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

    private func loadSchemaVersion() throws -> Int {
        let rows = try self.core.query(
            sql: "PRAGMA user_version",
            values: []
        ) { statement in
            Int(DatabaseCore.columnInt64(statement: statement, index: 0))
        }

        guard let version = rows.first else {
            throw LocalStoreError.database("Failed to read SQLite schema version")
        }

        return version
    }

    private func setSchemaVersion(version: Int) throws {
        try self.core.executeScript(
            sql: "PRAGMA user_version = \(version);",
            errorContext: "Failed to update SQLite schema version"
        )
    }

    private func unsupportedLegacySchemaError(reason: String) -> LocalStoreError {
        LocalStoreError.database(
            "Legacy local schema upgrade is unsupported (\(reason)). Delete the local database and relaunch the app."
        )
    }

    private func hasPreFullFsrsSchema() throws -> Bool {
        if try self.core.tableExists(name: "cards") == false {
            return false
        }

        if try self.core.columnExists(tableName: "cards", columnName: "fsrs_card_state") == false {
            return true
        }

        if try self.core.columnExists(tableName: "workspaces", columnName: "fsrs_algorithm") == false {
            return true
        }

        return try self.core.tableExists(name: "workspace_scheduler_settings")
    }
}
