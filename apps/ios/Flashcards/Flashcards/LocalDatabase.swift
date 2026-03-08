import Foundation
import SQLite3

/**
 Local SQLite persistence mirrors the backend FSRS schema closely enough for
 offline-first scheduling. Hidden card scheduler state and the local
 workspaces row are the runtime source of truth on device.

 This file mirrors the backend scheduler-settings and review-persistence logic
 in `apps/backend/src/workspaceSchedulerSettings.ts` and
 `apps/backend/src/cards.ts`.
 If you change scheduler-state validation or review persistence here, make the
 same change in the backend mirror and update docs/fsrs-scheduling-logic.md.

 Source-of-truth docs: docs/fsrs-scheduling-logic.md
 */

private enum SQLiteValue {
    case integer(Int64)
    case real(Double)
    case text(String)
    case null
}

private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
private let localDatabaseSchemaVersion: Int = 2
// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::defaultWorkspaceSchedulerConfig.algorithm.
private let defaultSchedulerAlgorithm: String = "fsrs-6"

// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::WorkspaceSchedulerConfig and validation flow.
private struct ValidatedWorkspaceSchedulerSettingsInput {
    let algorithm: String
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
}

final class LocalDatabase {
    private let connection: OpaquePointer
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init() throws {
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.connection = try LocalDatabase.openConnection()
        sqlite3_busy_timeout(self.connection, 5_000)
        try self.enableForeignKeys()
        try self.migrate()
        try self.ensureDefaultState()
    }

    deinit {
        sqlite3_close(connection)
    }

    func loadStateSnapshot() throws -> AppStateSnapshot {
        let workspace = try self.loadWorkspace()
        let userSettings = try self.loadUserSettings(workspaceId: workspace.workspaceId)
        let schedulerSettings = try self.loadWorkspaceSchedulerSettings(workspaceId: workspace.workspaceId)
        let cloudSettings = try self.loadCloudSettings()
        let cards = try self.loadCards(workspaceId: workspace.workspaceId)
        let decks = try self.loadDecks(workspaceId: workspace.workspaceId)

        return AppStateSnapshot(
            workspace: workspace,
            userSettings: userSettings,
            schedulerSettings: schedulerSettings,
            cloudSettings: cloudSettings,
            cards: cards,
            decks: decks
        )
    }

    func saveCard(workspaceId: String, input: CardEditorInput, cardId: String?) throws {
        try validateCardInput(input: input)

        let now = currentIsoTimestamp()
        let nextServerVersion = try self.nextServerVersion()
        let tagsData = try self.encoder.encode(input.tags)
        guard let tagsJson = String(data: tagsData, encoding: .utf8) else {
            throw LocalStoreError.database("Failed to encode card tags")
        }

        if let cardId {
            let updatedRows = try self.execute(
                sql: """
                UPDATE cards
                SET front_text = ?, back_text = ?, tags_json = ?, effort_level = ?, updated_at = ?, server_version = ?
                WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
                """,
                values: [
                    .text(input.frontText),
                    .text(input.backText),
                    .text(tagsJson),
                    .text(input.effortLevel.rawValue),
                    .text(now),
                    .integer(nextServerVersion),
                    .text(workspaceId),
                    .text(cardId)
                ]
            )

            if updatedRows == 0 {
                throw LocalStoreError.notFound("Card not found")
            }

            return
        }

        let newCardId = UUID().uuidString.lowercased()
        try self.execute(
            sql: """
            INSERT INTO cards (
                card_id,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                reps,
                lapses,
                fsrs_card_state,
                fsrs_step_index,
                fsrs_stability,
                fsrs_difficulty,
                fsrs_last_reviewed_at,
                fsrs_scheduled_days,
                server_version,
                updated_at,
                deleted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, 'new', NULL, NULL, NULL, NULL, NULL, ?, ?, NULL)
            """,
            values: [
                .text(newCardId),
                .text(workspaceId),
                .text(input.frontText),
                .text(input.backText),
                .text(tagsJson),
                .text(input.effortLevel.rawValue),
                .integer(nextServerVersion),
                .text(now)
            ]
        )
    }

    func deleteCard(workspaceId: String, cardId: String) throws {
        let now = currentIsoTimestamp()
        let nextServerVersion = try self.nextServerVersion()
        let updatedRows = try self.execute(
            sql: """
            UPDATE cards
            SET deleted_at = ?, updated_at = ?, server_version = ?
            WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
            """,
            values: [
                .text(now),
                .text(now),
                .integer(nextServerVersion),
                .text(workspaceId),
                .text(cardId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.notFound("Card not found")
        }
    }

    func createDeck(workspaceId: String, input: DeckEditorInput) throws {
        try validateDeckInput(input: input)

        let filterData = try self.encoder.encode(input.filterDefinition)
        guard let filterJson = String(data: filterData, encoding: .utf8) else {
            throw LocalStoreError.database("Failed to encode deck filter definition")
        }

        let deckId = UUID().uuidString.lowercased()
        let now = currentIsoTimestamp()
        try self.execute(
            sql: """
            INSERT INTO decks (
                deck_id,
                workspace_id,
                name,
                filter_definition_json,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            values: [
                .text(deckId),
                .text(workspaceId),
                .text(input.name),
                .text(filterJson),
                .text(now),
                .text(now)
            ]
        )
    }

    func updateDeck(workspaceId: String, deckId: String, input: DeckEditorInput) throws {
        try validateDeckInput(input: input)

        let filterData = try self.encoder.encode(input.filterDefinition)
        guard let filterJson = String(data: filterData, encoding: .utf8) else {
            throw LocalStoreError.database("Failed to encode deck filter definition")
        }

        let updatedRows = try self.execute(
            sql: """
            UPDATE decks
            SET name = ?, filter_definition_json = ?, updated_at = ?
            WHERE workspace_id = ? AND deck_id = ?
            """,
            values: [
                .text(input.name),
                .text(filterJson),
                .text(currentIsoTimestamp()),
                .text(workspaceId),
                .text(deckId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.notFound("Deck not found")
        }
    }

    func deleteDeck(workspaceId: String, deckId: String) throws {
        let deletedRows = try self.execute(
            sql: "DELETE FROM decks WHERE workspace_id = ? AND deck_id = ?",
            values: [
                .text(workspaceId),
                .text(deckId)
            ]
        )

        if deletedRows == 0 {
            throw LocalStoreError.notFound("Deck not found")
        }
    }

    // Keep in sync with apps/backend/src/cards.ts::submitReview.
    func submitReview(workspaceId: String, reviewSubmission: ReviewSubmission) throws {
        try self.inTransaction {
            let card = try self.loadCard(workspaceId: workspaceId, cardId: reviewSubmission.cardId)
            let schedulerSettings = try self.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
            guard let reviewedAtClient = parseIsoTimestamp(value: reviewSubmission.reviewedAtClient) else {
                throw LocalStoreError.validation("reviewedAtClient must be a valid ISO timestamp")
            }
            let schedule = try computeReviewSchedule(
                card: card,
                settings: schedulerSettings,
                rating: reviewSubmission.rating,
                now: reviewedAtClient
            )
            let cloudSettings = try self.loadCloudSettings()
            let reviewEventId = UUID().uuidString.lowercased()
            let clientEventId = UUID().uuidString.lowercased()
            let reviewedAtServer = currentIsoTimestamp()

            try self.execute(
                sql: """
                INSERT INTO review_events (
                    review_event_id,
                    workspace_id,
                    card_id,
                    device_id,
                    client_event_id,
                    rating,
                    reviewed_at_client,
                    reviewed_at_server
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(reviewEventId),
                    .text(workspaceId),
                    .text(reviewSubmission.cardId),
                    .text(cloudSettings.deviceId),
                    .text(clientEventId),
                    .integer(Int64(reviewSubmission.rating.rawValue)),
                    .text(reviewSubmission.reviewedAtClient),
                    .text(reviewedAtServer)
                ]
            )

            let updatedRows = try self.execute(
                sql: """
                UPDATE cards
                SET due_at = ?, reps = ?, lapses = ?, fsrs_card_state = ?, fsrs_step_index = ?, fsrs_stability = ?, fsrs_difficulty = ?, fsrs_last_reviewed_at = ?, fsrs_scheduled_days = ?, updated_at = ?, server_version = ?
                WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
                """,
                values: [
                    .text(isoTimestamp(date: schedule.dueAt)),
                    .integer(Int64(schedule.reps)),
                    .integer(Int64(schedule.lapses)),
                    .text(schedule.fsrsCardState.rawValue),
                    schedule.fsrsStepIndex.map { stepIndex in
                        SQLiteValue.integer(Int64(stepIndex))
                    } ?? .null,
                    .real(schedule.fsrsStability),
                    .real(schedule.fsrsDifficulty),
                    .text(isoTimestamp(date: schedule.fsrsLastReviewedAt)),
                    .integer(Int64(schedule.fsrsScheduledDays)),
                    .text(reviewedAtServer),
                    .integer(try self.nextServerVersion()),
                    .text(workspaceId),
                    .text(reviewSubmission.cardId)
                ]
            )

            if updatedRows == 0 {
                throw LocalStoreError.notFound("Card not found")
            }
        }
    }

    // Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::updateWorkspaceSchedulerSettings.
    func updateWorkspaceSchedulerSettings(
        workspaceId: String,
        desiredRetention: Double,
        learningStepsMinutes: [Int],
        relearningStepsMinutes: [Int],
        maximumIntervalDays: Int,
        enableFuzz: Bool
    ) throws {
        let validatedInput = try validateWorkspaceSchedulerSettingsInput(
            desiredRetention: desiredRetention,
            learningStepsMinutes: learningStepsMinutes,
            relearningStepsMinutes: relearningStepsMinutes,
            maximumIntervalDays: maximumIntervalDays,
            enableFuzz: enableFuzz
        )
        let learningStepsJson = try self.encodeIntegerArray(validatedInput.learningStepsMinutes)
        let relearningStepsJson = try self.encodeIntegerArray(validatedInput.relearningStepsMinutes)
        let updatedRows = try self.execute(
            sql: """
            UPDATE workspaces
            SET fsrs_algorithm = ?, fsrs_desired_retention = ?, fsrs_learning_steps_minutes_json = ?, fsrs_relearning_steps_minutes_json = ?, fsrs_maximum_interval_days = ?, fsrs_enable_fuzz = ?, fsrs_updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .text(validatedInput.algorithm),
                .real(validatedInput.desiredRetention),
                .text(learningStepsJson),
                .text(relearningStepsJson),
                .integer(Int64(validatedInput.maximumIntervalDays)),
                .integer(validatedInput.enableFuzz ? 1 : 0),
                .text(currentIsoTimestamp()),
                .text(workspaceId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.database("Workspace row is missing")
        }
    }

    func updateCloudSettings(
        cloudState: CloudAccountState,
        linkedUserId: String?,
        linkedWorkspaceId: String?,
        linkedEmail: String?
    ) throws {
        let updatedRows = try self.execute(
            sql: """
            UPDATE app_local_settings
            SET cloud_state = ?, linked_user_id = ?, linked_workspace_id = ?, linked_email = ?, updated_at = ?
            WHERE settings_id = 1
            """,
            values: [
                .text(cloudState.rawValue),
                linkedUserId.map(SQLiteValue.text) ?? .null,
                linkedWorkspaceId.map(SQLiteValue.text) ?? .null,
                linkedEmail.map(SQLiteValue.text) ?? .null,
                .text(currentIsoTimestamp())
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.database("App local settings row is missing")
        }
    }

    private static func openConnection() throws -> OpaquePointer {
        let databasePath = try self.databasePath()
        var connection: OpaquePointer?
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        let resultCode = sqlite3_open_v2(databasePath, &connection, flags, nil)

        guard resultCode == SQLITE_OK, let connection else {
            let message = connection.map { connection in
                String(cString: sqlite3_errmsg(connection))
            } ?? "Unknown SQLite open error"
            if let connection {
                sqlite3_close(connection)
            }
            throw LocalStoreError.database("Failed to open local database: \(message)")
        }

        return connection
    }

    private static func databasePath() throws -> String {
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

        return databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false).path
    }

    private func enableForeignKeys() throws {
        let resultCode = sqlite3_exec(connection, "PRAGMA foreign_keys = ON;", nil, nil, nil)
        guard resultCode == SQLITE_OK else {
            throw LocalStoreError.database("Failed to enable SQLite foreign keys: \(self.lastErrorMessage())")
        }
    }

    private func migrate() throws {
        let schemaVersion = try self.loadSchemaVersion()
        let hasPreFullFsrsSchema = try self.hasPreFullFsrsSchema()
        if schemaVersion > 0 && schemaVersion < localDatabaseSchemaVersion {
            try self.resetLocalSchema()
        } else if schemaVersion == 0 && hasPreFullFsrsSchema {
            try self.resetLocalSchema()
        }

        let migrationSQL = """
        CREATE TABLE IF NOT EXISTS workspaces (
            workspace_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            fsrs_algorithm TEXT NOT NULL DEFAULT 'fsrs-6' CHECK (fsrs_algorithm = 'fsrs-6'),
            fsrs_desired_retention REAL NOT NULL DEFAULT 0.9 CHECK (fsrs_desired_retention > 0 AND fsrs_desired_retention < 1),
            fsrs_learning_steps_minutes_json TEXT NOT NULL DEFAULT '[1,10]',
            fsrs_relearning_steps_minutes_json TEXT NOT NULL DEFAULT '[10]',
            fsrs_maximum_interval_days INTEGER NOT NULL DEFAULT 36500 CHECK (fsrs_maximum_interval_days >= 1),
            fsrs_enable_fuzz INTEGER NOT NULL DEFAULT 1 CHECK (fsrs_enable_fuzz IN (0, 1)),
            fsrs_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            user_id TEXT PRIMARY KEY,
            workspace_id TEXT REFERENCES workspaces(workspace_id) ON DELETE SET NULL,
            email TEXT,
            locale TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cards (
            card_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            front_text TEXT NOT NULL,
            back_text TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            effort_level TEXT NOT NULL CHECK (effort_level IN ('fast', 'medium', 'long')),
            due_at TEXT,
            reps INTEGER NOT NULL CHECK (reps >= 0),
            lapses INTEGER NOT NULL CHECK (lapses >= 0),
            fsrs_card_state TEXT NOT NULL CHECK (fsrs_card_state IN ('new', 'learning', 'review', 'relearning')),
            fsrs_step_index INTEGER CHECK (fsrs_step_index IS NULL OR fsrs_step_index >= 0),
            fsrs_stability REAL,
            fsrs_difficulty REAL,
            fsrs_last_reviewed_at TEXT,
            fsrs_scheduled_days INTEGER CHECK (fsrs_scheduled_days IS NULL OR fsrs_scheduled_days >= 0),
            server_version INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS decks (
            deck_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            filter_definition_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS review_events (
            review_event_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
            card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
            device_id TEXT NOT NULL,
            client_event_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 3),
            reviewed_at_client TEXT NOT NULL,
            reviewed_at_server TEXT NOT NULL,
            UNIQUE (workspace_id, device_id, client_event_id)
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

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_server_version
            ON cards(workspace_id, server_version);

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_updated_at
            ON cards(workspace_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_active
            ON cards(workspace_id, due_at)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_fsrs_last_reviewed_at
            ON cards(workspace_id, fsrs_last_reviewed_at DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_decks_workspace_updated_at
            ON decks(workspace_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_review_events_workspace_card_time
            ON review_events(workspace_id, card_id, reviewed_at_server DESC);
        """

        let resultCode = sqlite3_exec(connection, migrationSQL, nil, nil, nil)
        guard resultCode == SQLITE_OK else {
            throw LocalStoreError.database("Failed to run local migrations: \(self.lastErrorMessage())")
        }

        try self.setSchemaVersion(version: localDatabaseSchemaVersion)
    }

    private func ensureDefaultState() throws {
        let workspaceCount = try self.scalarInt(
            sql: "SELECT COUNT(*) FROM workspaces",
            values: []
        )
        let workspaceId: String

        if workspaceCount == 0 {
            workspaceId = UUID().uuidString.lowercased()
            try self.execute(
                sql: "INSERT INTO workspaces (workspace_id, name, created_at) VALUES (?, ?, ?)",
                values: [
                    .text(workspaceId),
                    .text("Local Workspace"),
                    .text(currentIsoTimestamp())
                ]
            )
        } else {
            workspaceId = try self.scalarText(
                sql: "SELECT workspace_id FROM workspaces ORDER BY created_at ASC LIMIT 1",
                values: []
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

        let appSettingsCount = try self.scalarInt(
            sql: "SELECT COUNT(*) FROM app_local_settings",
            values: []
        )
        if appSettingsCount == 0 {
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
                    .text(UUID().uuidString.lowercased()),
                    .text(currentIsoTimestamp())
                ]
            )
        }
    }

    private func loadWorkspace() throws -> Workspace {
        let workspaces = try self.query(
            sql: """
            SELECT workspace_id, name, created_at
            FROM workspaces
            ORDER BY created_at ASC
            LIMIT 1
            """,
            values: []
        ) { statement in
            Workspace(
                workspaceId: Self.columnText(statement: statement, index: 0),
                name: Self.columnText(statement: statement, index: 1),
                createdAt: Self.columnText(statement: statement, index: 2)
            )
        }

        guard let workspace = workspaces.first else {
            throw LocalStoreError.database("Workspace row is missing")
        }

        return workspace
    }

    private func loadUserSettings(workspaceId: String) throws -> UserSettings {
        let rows = try self.query(
            sql: """
            SELECT user_id, workspace_id, email, locale, created_at
            FROM user_settings
            WHERE workspace_id = ?
            ORDER BY created_at ASC
            LIMIT 1
            """,
            values: [.text(workspaceId)]
        ) { statement in
            UserSettings(
                userId: Self.columnText(statement: statement, index: 0),
                workspaceId: Self.columnText(statement: statement, index: 1),
                email: Self.columnOptionalText(statement: statement, index: 2),
                locale: Self.columnText(statement: statement, index: 3),
                createdAt: Self.columnText(statement: statement, index: 4)
            )
        }

        guard let userSettings = rows.first else {
            throw LocalStoreError.database("User settings row is missing")
        }

        return userSettings
    }

    // Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::getWorkspaceSchedulerSettings and getWorkspaceSchedulerConfig.
    private func loadWorkspaceSchedulerSettings(workspaceId: String) throws -> WorkspaceSchedulerSettings {
        let settings = try self.query(
            sql: """
            SELECT
                fsrs_algorithm,
                fsrs_desired_retention,
                fsrs_learning_steps_minutes_json,
                fsrs_relearning_steps_minutes_json,
                fsrs_maximum_interval_days,
                fsrs_enable_fuzz,
                fsrs_updated_at
            FROM workspaces
            WHERE workspace_id = ?
            LIMIT 1
            """,
            values: [.text(workspaceId)]
        ) { statement in
            let algorithm = Self.columnText(statement: statement, index: 0)
            if algorithm != defaultSchedulerAlgorithm {
                throw LocalStoreError.database("Stored scheduler algorithm is invalid: \(algorithm)")
            }

            return WorkspaceSchedulerSettings(
                algorithm: algorithm,
                desiredRetention: Self.columnDouble(statement: statement, index: 1),
                learningStepsMinutes: try self.decodeIntegerArray(
                    json: Self.columnText(statement: statement, index: 2),
                    fieldName: "learningStepsMinutes"
                ),
                relearningStepsMinutes: try self.decodeIntegerArray(
                    json: Self.columnText(statement: statement, index: 3),
                    fieldName: "relearningStepsMinutes"
                ),
                maximumIntervalDays: Int(Self.columnInt64(statement: statement, index: 4)),
                enableFuzz: Self.columnInt64(statement: statement, index: 5) == 1,
                updatedAt: Self.columnText(statement: statement, index: 6)
            )
        }

        guard let schedulerSettings = settings.first else {
            throw LocalStoreError.database("Workspace row is missing")
        }

        return schedulerSettings
    }

    private func loadCards(workspaceId: String) throws -> [Card] {
        let cards = try self.query(
            sql: """
            SELECT
                card_id,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                reps,
                lapses,
                fsrs_card_state,
                fsrs_step_index,
                fsrs_stability,
                fsrs_difficulty,
                fsrs_last_reviewed_at,
                fsrs_scheduled_days,
                server_version,
                updated_at,
                deleted_at
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL
            ORDER BY updated_at DESC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            let tagsJson = Self.columnText(statement: statement, index: 4)
            let tagsData = Data(tagsJson.utf8)
            let tags = try self.decoder.decode([String].self, from: tagsData)
            let rawEffortLevel = Self.columnText(statement: statement, index: 5)
            guard let effortLevel = EffortLevel(rawValue: rawEffortLevel) else {
                throw LocalStoreError.database("Stored card effort level is invalid: \(rawEffortLevel)")
            }
            let rawFsrsCardState = Self.columnText(statement: statement, index: 9)
            guard let fsrsCardState = FsrsCardState(rawValue: rawFsrsCardState) else {
                throw LocalStoreError.database("Stored FSRS card state is invalid: \(rawFsrsCardState)")
            }

            return Card(
                cardId: Self.columnText(statement: statement, index: 0),
                workspaceId: Self.columnText(statement: statement, index: 1),
                frontText: Self.columnText(statement: statement, index: 2),
                backText: Self.columnText(statement: statement, index: 3),
                tags: tags,
                effortLevel: effortLevel,
                dueAt: Self.columnOptionalText(statement: statement, index: 6),
                reps: Int(Self.columnInt64(statement: statement, index: 7)),
                lapses: Int(Self.columnInt64(statement: statement, index: 8)),
                fsrsCardState: fsrsCardState,
                fsrsStepIndex: Self.columnOptionalInt(statement: statement, index: 10),
                fsrsStability: Self.columnOptionalDouble(statement: statement, index: 11),
                fsrsDifficulty: Self.columnOptionalDouble(statement: statement, index: 12),
                fsrsLastReviewedAt: Self.columnOptionalText(statement: statement, index: 13),
                fsrsScheduledDays: Self.columnOptionalInt(statement: statement, index: 14),
                serverVersion: Self.columnInt64(statement: statement, index: 15),
                updatedAt: Self.columnText(statement: statement, index: 16),
                deletedAt: Self.columnOptionalText(statement: statement, index: 17)
            )
        }

        var repairedCards: [Card] = []
        for card in cards {
            repairedCards.append(try self.validateOrResetLoadedCard(workspaceId: workspaceId, card: card))
        }

        return repairedCards
    }

    private func loadDecks(workspaceId: String) throws -> [Deck] {
        try self.query(
            sql: """
            SELECT deck_id, workspace_id, name, filter_definition_json, created_at, updated_at
            FROM decks
            WHERE workspace_id = ?
            ORDER BY updated_at DESC, created_at DESC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            let filterJson = Self.columnText(statement: statement, index: 3)
            let filterData = Data(filterJson.utf8)
            let filterDefinition = try self.decoder.decode(DeckFilterDefinition.self, from: filterData)

            return Deck(
                deckId: Self.columnText(statement: statement, index: 0),
                workspaceId: Self.columnText(statement: statement, index: 1),
                name: Self.columnText(statement: statement, index: 2),
                filterDefinition: filterDefinition,
                createdAt: Self.columnText(statement: statement, index: 4),
                updatedAt: Self.columnText(statement: statement, index: 5)
            )
        }
    }

    private func loadCloudSettings() throws -> CloudSettings {
        let settings = try self.query(
            sql: """
            SELECT device_id, cloud_state, linked_user_id, linked_workspace_id, linked_email, onboarding_completed, updated_at
            FROM app_local_settings
            WHERE settings_id = 1
            LIMIT 1
            """,
            values: []
        ) { statement in
            let rawCloudState = Self.columnText(statement: statement, index: 1)
            guard let cloudState = CloudAccountState(rawValue: rawCloudState) else {
                throw LocalStoreError.database("Stored cloud state is invalid: \(rawCloudState)")
            }

            return CloudSettings(
                deviceId: Self.columnText(statement: statement, index: 0),
                cloudState: cloudState,
                linkedUserId: Self.columnOptionalText(statement: statement, index: 2),
                linkedWorkspaceId: Self.columnOptionalText(statement: statement, index: 3),
                linkedEmail: Self.columnOptionalText(statement: statement, index: 4),
                onboardingCompleted: Self.columnInt64(statement: statement, index: 5) == 1,
                updatedAt: Self.columnText(statement: statement, index: 6)
            )
        }

        guard let cloudSettings = settings.first else {
            throw LocalStoreError.database("App local settings row is missing")
        }

        return cloudSettings
    }

    private func loadCard(workspaceId: String, cardId: String) throws -> Card {
        let cards = try self.query(
            sql: """
            SELECT
                card_id,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                reps,
                lapses,
                fsrs_card_state,
                fsrs_step_index,
                fsrs_stability,
                fsrs_difficulty,
                fsrs_last_reviewed_at,
                fsrs_scheduled_days,
                server_version,
                updated_at,
                deleted_at
            FROM cards
            WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
            LIMIT 1
            """,
            values: [
                .text(workspaceId),
                .text(cardId)
            ]
        ) { statement in
            let tagsJson = Self.columnText(statement: statement, index: 4)
            let tagsData = Data(tagsJson.utf8)
            let tags = try self.decoder.decode([String].self, from: tagsData)
            let rawEffortLevel = Self.columnText(statement: statement, index: 5)
            guard let effortLevel = EffortLevel(rawValue: rawEffortLevel) else {
                throw LocalStoreError.database("Stored card effort level is invalid: \(rawEffortLevel)")
            }
            let rawFsrsCardState = Self.columnText(statement: statement, index: 9)
            guard let fsrsCardState = FsrsCardState(rawValue: rawFsrsCardState) else {
                throw LocalStoreError.database("Stored FSRS card state is invalid: \(rawFsrsCardState)")
            }

            return Card(
                cardId: Self.columnText(statement: statement, index: 0),
                workspaceId: Self.columnText(statement: statement, index: 1),
                frontText: Self.columnText(statement: statement, index: 2),
                backText: Self.columnText(statement: statement, index: 3),
                tags: tags,
                effortLevel: effortLevel,
                dueAt: Self.columnOptionalText(statement: statement, index: 6),
                reps: Int(Self.columnInt64(statement: statement, index: 7)),
                lapses: Int(Self.columnInt64(statement: statement, index: 8)),
                fsrsCardState: fsrsCardState,
                fsrsStepIndex: Self.columnOptionalInt(statement: statement, index: 10),
                fsrsStability: Self.columnOptionalDouble(statement: statement, index: 11),
                fsrsDifficulty: Self.columnOptionalDouble(statement: statement, index: 12),
                fsrsLastReviewedAt: Self.columnOptionalText(statement: statement, index: 13),
                fsrsScheduledDays: Self.columnOptionalInt(statement: statement, index: 14),
                serverVersion: Self.columnInt64(statement: statement, index: 15),
                updatedAt: Self.columnText(statement: statement, index: 16),
                deletedAt: Self.columnOptionalText(statement: statement, index: 17)
            )
        }

        guard let card = cards.first else {
            throw LocalStoreError.notFound("Card not found")
        }

        return try self.validateOrResetLoadedCard(workspaceId: workspaceId, card: card)
    }

    private func validateOrResetLoadedCard(workspaceId: String, card: Card) throws -> Card {
        guard let invalidReason = invalidFsrsStateReason(card: card) else {
            return card
        }

        logFlashcardsError(
            domain: "cards",
            action: "reset_invalid_fsrs_state",
            metadata: [
                "workspaceId": workspaceId,
                "cardId": card.cardId,
                "reason": invalidReason,
                "repair": "reset"
            ]
        )

        let repairedCard = resetFsrsState(
            card: card,
            updatedAt: currentIsoTimestamp(),
            serverVersion: try self.nextServerVersion()
        )
        let updatedRows = try self.execute(
            sql: """
            UPDATE cards
            SET due_at = ?, reps = ?, lapses = ?, fsrs_card_state = ?, fsrs_step_index = ?, fsrs_stability = ?, fsrs_difficulty = ?, fsrs_last_reviewed_at = ?, fsrs_scheduled_days = ?, updated_at = ?, server_version = ?
            WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
            """,
            values: [
                .null,
                .integer(Int64(repairedCard.reps)),
                .integer(Int64(repairedCard.lapses)),
                .text(repairedCard.fsrsCardState.rawValue),
                .null,
                .null,
                .null,
                .null,
                .null,
                .text(repairedCard.updatedAt),
                .integer(repairedCard.serverVersion),
                .text(workspaceId),
                .text(card.cardId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.notFound("Card not found")
        }

        return repairedCard
    }

    private func nextServerVersion() throws -> Int64 {
        let maxServerVersion = try self.scalarInt(
            sql: "SELECT COALESCE(MAX(server_version), 0) FROM cards",
            values: []
        )

        return Int64(maxServerVersion + 1)
    }

    private func scalarInt(sql: String, values: [SQLiteValue]) throws -> Int {
        let results = try self.query(
            sql: sql,
            values: values
        ) { statement in
            Int(Self.columnInt64(statement: statement, index: 0))
        }

        guard let value = results.first else {
            throw LocalStoreError.database("Expected an integer result for SQL query")
        }

        return value
    }

    private func scalarText(sql: String, values: [SQLiteValue]) throws -> String {
        let results = try self.query(
            sql: sql,
            values: values
        ) { statement in
            Self.columnText(statement: statement, index: 0)
        }

        guard let value = results.first else {
            throw LocalStoreError.database("Expected a text result for SQL query")
        }

        return value
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

    private func encodeIntegerArray(_ values: [Int]) throws -> String {
        let data = try self.encoder.encode(values)
        guard let json = String(data: data, encoding: .utf8) else {
            throw LocalStoreError.database("Failed to encode integer array to JSON")
        }

        return json
    }

    private func decodeIntegerArray(json: String, fieldName: String) throws -> [Int] {
        let data = Data(json.utf8)
        let values = try self.decoder.decode([Int].self, from: data)
        _ = try validateSchedulerStepList(values: values, fieldName: fieldName)
        return values
    }

    @discardableResult
    private func execute(sql: String, values: [SQLiteValue]) throws -> Int {
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

    private func query<T>(
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

    private func inTransaction<T>(_ body: () throws -> T) throws -> T {
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

    private static func columnText(statement: OpaquePointer, index: Int32) -> String {
        guard let value = sqlite3_column_text(statement, index) else {
            return ""
        }

        return String(cString: value)
    }

    private static func columnOptionalText(statement: OpaquePointer, index: Int32) -> String? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else {
            return nil
        }

        return self.columnText(statement: statement, index: index)
    }

    private static func columnInt64(statement: OpaquePointer, index: Int32) -> Int64 {
        sqlite3_column_int64(statement, index)
    }

    private static func columnDouble(statement: OpaquePointer, index: Int32) -> Double {
        sqlite3_column_double(statement, index)
    }

    private static func columnOptionalInt(statement: OpaquePointer, index: Int32) -> Int? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else {
            return nil
        }

        return Int(self.columnInt64(statement: statement, index: index))
    }

    private static func columnOptionalDouble(statement: OpaquePointer, index: Int32) -> Double? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else {
            return nil
        }

        return sqlite3_column_double(statement, index)
    }
}

// Keep in sync with apps/backend/src/cards.ts::getInvalidFsrsStateReason.
func invalidFsrsStateReason(card: Card) -> String? {
    if card.fsrsCardState == .new {
        if card.dueAt != nil {
            return "New card must not persist dueAt"
        }

        if card.fsrsStepIndex != nil
            || card.fsrsStability != nil
            || card.fsrsDifficulty != nil
            || card.fsrsLastReviewedAt != nil
            || card.fsrsScheduledDays != nil {
            return "New card has persisted FSRS state"
        }

        return nil
    }

    if card.fsrsStability == nil
        || card.fsrsDifficulty == nil
        || card.fsrsLastReviewedAt == nil
        || card.fsrsScheduledDays == nil {
        return "Persisted FSRS card state is incomplete"
    }

    if card.fsrsCardState == .review && card.fsrsStepIndex != nil {
        return "Review card must not persist fsrsStepIndex"
    }

    if (card.fsrsCardState == .learning || card.fsrsCardState == .relearning) && card.fsrsStepIndex == nil {
        return "Learning or relearning card is missing fsrsStepIndex"
    }

    return nil
}

// Keep in sync with apps/backend/src/cards.ts repair semantics.
func resetFsrsState(card: Card, updatedAt: String, serverVersion: Int64) -> Card {
    Card(
        cardId: card.cardId,
        workspaceId: card.workspaceId,
        frontText: card.frontText,
        backText: card.backText,
        tags: card.tags,
        effortLevel: card.effortLevel,
        dueAt: nil,
        reps: 0,
        lapses: 0,
        fsrsCardState: .new,
        fsrsStepIndex: nil,
        fsrsStability: nil,
        fsrsDifficulty: nil,
        fsrsLastReviewedAt: nil,
        fsrsScheduledDays: nil,
        serverVersion: serverVersion,
        updatedAt: updatedAt,
        deletedAt: card.deletedAt
    )
}

private func validateCardInput(input: CardEditorInput) throws {
    let frontText = input.frontText.trimmingCharacters(in: .whitespacesAndNewlines)
    let backText = input.backText.trimmingCharacters(in: .whitespacesAndNewlines)

    if frontText.isEmpty {
        throw LocalStoreError.validation("Card front text must not be empty")
    }

    if backText.isEmpty {
        throw LocalStoreError.validation("Card back text must not be empty")
    }
}

private func validateDeckInput(input: DeckEditorInput) throws {
    if input.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        throw LocalStoreError.validation("Deck name must not be empty")
    }

    if input.filterDefinition.version != 1 {
        throw LocalStoreError.validation("Deck filter version must be 1")
    }
}

// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::parseSteps.
private func validateSchedulerStepList(values: [Int], fieldName: String) throws -> [Int] {
    if values.isEmpty {
        throw LocalStoreError.validation("\(fieldName) must not be empty")
    }

    for value in values {
        if value <= 0 || value >= 1_440 {
            throw LocalStoreError.validation("\(fieldName) must contain positive integer minutes under 1440")
        }
    }

    for index in 1..<values.count {
        if values[index] <= values[index - 1] {
            throw LocalStoreError.validation("\(fieldName) must be strictly increasing")
        }
    }

    return values
}

// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::validateWorkspaceSchedulerSettingsInput.
private func validateWorkspaceSchedulerSettingsInput(
    desiredRetention: Double,
    learningStepsMinutes: [Int],
    relearningStepsMinutes: [Int],
    maximumIntervalDays: Int,
    enableFuzz: Bool
) throws -> ValidatedWorkspaceSchedulerSettingsInput {
    if desiredRetention <= 0 || desiredRetention >= 1 {
        throw LocalStoreError.validation("desiredRetention must be greater than 0 and less than 1")
    }

    if maximumIntervalDays < 1 {
        throw LocalStoreError.validation("maximumIntervalDays must be a positive integer")
    }

    return ValidatedWorkspaceSchedulerSettingsInput(
        algorithm: defaultSchedulerAlgorithm,
        desiredRetention: desiredRetention,
        learningStepsMinutes: try validateSchedulerStepList(
            values: learningStepsMinutes,
            fieldName: "learningStepsMinutes"
        ),
        relearningStepsMinutes: try validateSchedulerStepList(
            values: relearningStepsMinutes,
            fieldName: "relearningStepsMinutes"
        ),
        maximumIntervalDays: maximumIntervalDays,
        enableFuzz: enableFuzz
    )
}
