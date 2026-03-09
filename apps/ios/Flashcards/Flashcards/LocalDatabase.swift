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
private let localDatabaseSchemaVersion: Int = 4
// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::defaultWorkspaceSchedulerConfig.algorithm.
private let defaultSchedulerAlgorithm: String = defaultSchedulerSettingsConfig.algorithm

// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::WorkspaceSchedulerConfig and validation flow.
private struct ValidatedWorkspaceSchedulerSettingsInput {
    let algorithm: String
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
}

private struct CardOutboxPayload: Codable {
    let cardId: String
    let frontText: String
    let backText: String
    let tags: [String]
    let effortLevel: String
    let dueAt: String?
    let reps: Int
    let lapses: Int
    let fsrsCardState: String
    let fsrsStepIndex: Int?
    let fsrsStability: Double?
    let fsrsDifficulty: Double?
    let fsrsLastReviewedAt: String?
    let fsrsScheduledDays: Int?
    let deletedAt: String?
}

private struct DeckOutboxPayload: Codable {
    let deckId: String
    let name: String
    let filterDefinition: DeckFilterDefinition
    let createdAt: String
    let deletedAt: String?
}

private struct WorkspaceSchedulerSettingsOutboxPayload: Codable {
    let algorithm: String
    let desiredRetention: Double
    let learningStepsMinutes: [Int]
    let relearningStepsMinutes: [Int]
    let maximumIntervalDays: Int
    let enableFuzz: Bool
}

private struct ReviewEventOutboxPayload: Codable {
    let reviewEventId: String
    let cardId: String
    let deviceId: String
    let clientEventId: String
    let rating: Int
    let reviewedAtClient: String
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

        try self.inTransaction {
            let now = currentIsoTimestamp()
            let cloudSettings = try self.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let tagsData = try self.encoder.encode(input.tags)
            guard let tagsJson = String(data: tagsData, encoding: .utf8) else {
                throw LocalStoreError.database("Failed to encode card tags")
            }

            if let cardId {
                let updatedRows = try self.execute(
                    sql: """
                    UPDATE cards
                    SET front_text = ?, back_text = ?, tags_json = ?, effort_level = ?, client_updated_at = ?, last_modified_by_device_id = ?, last_operation_id = ?, updated_at = ?
                    WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
                    """,
                    values: [
                        .text(input.frontText),
                        .text(input.backText),
                        .text(tagsJson),
                        .text(input.effortLevel.rawValue),
                        .text(now),
                        .text(cloudSettings.deviceId),
                        .text(operationId),
                        .text(now),
                        .text(workspaceId),
                        .text(cardId)
                    ]
                )

                if updatedRows == 0 {
                    throw LocalStoreError.notFound("Card not found")
                }

                let updatedCard = try self.loadCard(workspaceId: workspaceId, cardId: cardId)
                try self.enqueueCardUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    clientUpdatedAt: now,
                    card: updatedCard
                )
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
                    client_updated_at,
                    last_modified_by_device_id,
                    last_operation_id,
                    updated_at,
                    deleted_at
                )
                VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, 'new', NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL)
                """,
                values: [
                    .text(newCardId),
                    .text(workspaceId),
                    .text(input.frontText),
                    .text(input.backText),
                    .text(tagsJson),
                    .text(input.effortLevel.rawValue),
                    .text(now),
                    .text(cloudSettings.deviceId),
                    .text(operationId),
                    .text(now)
                ]
            )

            let newCard = try self.loadCard(workspaceId: workspaceId, cardId: newCardId)
            try self.enqueueCardUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                card: newCard
            )
        }
    }

    func deleteCard(workspaceId: String, cardId: String) throws {
        try self.inTransaction {
            let now = currentIsoTimestamp()
            let cloudSettings = try self.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let updatedRows = try self.execute(
                sql: """
                UPDATE cards
                SET deleted_at = ?, client_updated_at = ?, last_modified_by_device_id = ?, last_operation_id = ?, updated_at = ?
                WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
                """,
                values: [
                    .text(now),
                    .text(now),
                    .text(cloudSettings.deviceId),
                    .text(operationId),
                    .text(now),
                    .text(workspaceId),
                    .text(cardId)
                ]
            )

            if updatedRows == 0 {
                throw LocalStoreError.notFound("Card not found")
            }

            let deletedCard = try self.loadCardIncludingDeleted(workspaceId: workspaceId, cardId: cardId)
            try self.enqueueCardUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                card: deletedCard
            )
        }
    }

    func createDeck(workspaceId: String, input: DeckEditorInput) throws {
        try validateDeckInput(input: input)

        try self.inTransaction {
            let filterData = try self.encoder.encode(input.filterDefinition)
            guard let filterJson = String(data: filterData, encoding: .utf8) else {
                throw LocalStoreError.database("Failed to encode deck filter definition")
            }

            let cloudSettings = try self.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
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
                    client_updated_at,
                    last_modified_by_device_id,
                    last_operation_id,
                    updated_at,
                    deleted_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                values: [
                    .text(deckId),
                    .text(workspaceId),
                    .text(input.name),
                    .text(filterJson),
                    .text(now),
                    .text(now),
                    .text(cloudSettings.deviceId),
                    .text(operationId),
                    .text(now)
                ]
            )

            let newDeck = try self.loadDeckIncludingDeleted(workspaceId: workspaceId, deckId: deckId)
            try self.enqueueDeckUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                deck: newDeck
            )
        }
    }

    func updateDeck(workspaceId: String, deckId: String, input: DeckEditorInput) throws {
        try validateDeckInput(input: input)

        try self.inTransaction {
            let filterData = try self.encoder.encode(input.filterDefinition)
            guard let filterJson = String(data: filterData, encoding: .utf8) else {
                throw LocalStoreError.database("Failed to encode deck filter definition")
            }

            let cloudSettings = try self.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let now = currentIsoTimestamp()
            let updatedRows = try self.execute(
                sql: """
                UPDATE decks
                SET name = ?, filter_definition_json = ?, client_updated_at = ?, last_modified_by_device_id = ?, last_operation_id = ?, updated_at = ?
                WHERE workspace_id = ? AND deck_id = ? AND deleted_at IS NULL
                """,
                values: [
                    .text(input.name),
                    .text(filterJson),
                    .text(now),
                    .text(cloudSettings.deviceId),
                    .text(operationId),
                    .text(now),
                    .text(workspaceId),
                    .text(deckId)
                ]
            )

            if updatedRows == 0 {
                throw LocalStoreError.notFound("Deck not found")
            }

            let updatedDeck = try self.loadDeckIncludingDeleted(workspaceId: workspaceId, deckId: deckId)
            try self.enqueueDeckUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                deck: updatedDeck
            )
        }
    }

    func deleteDeck(workspaceId: String, deckId: String) throws {
        try self.inTransaction {
            let cloudSettings = try self.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let now = currentIsoTimestamp()
            let deletedRows = try self.execute(
                sql: """
                UPDATE decks
                SET deleted_at = ?, client_updated_at = ?, last_modified_by_device_id = ?, last_operation_id = ?, updated_at = ?
                WHERE workspace_id = ? AND deck_id = ? AND deleted_at IS NULL
                """,
                values: [
                    .text(now),
                    .text(now),
                    .text(cloudSettings.deviceId),
                    .text(operationId),
                    .text(now),
                    .text(workspaceId),
                    .text(deckId)
                ]
            )

            if deletedRows == 0 {
                throw LocalStoreError.notFound("Deck not found")
            }

            let deletedDeck = try self.loadDeckIncludingDeleted(workspaceId: workspaceId, deckId: deckId)
            try self.enqueueDeckUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                deck: deletedDeck
            )
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
            let reviewEventOperationId = UUID().uuidString.lowercased()
            let cardOperationId = UUID().uuidString.lowercased()
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
                SET due_at = ?, reps = ?, lapses = ?, fsrs_card_state = ?, fsrs_step_index = ?, fsrs_stability = ?, fsrs_difficulty = ?, fsrs_last_reviewed_at = ?, fsrs_scheduled_days = ?, client_updated_at = ?, last_modified_by_device_id = ?, last_operation_id = ?, updated_at = ?
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
                    .text(reviewSubmission.reviewedAtClient),
                    .text(cloudSettings.deviceId),
                    .text(cardOperationId),
                    .text(reviewedAtServer),
                    .text(workspaceId),
                    .text(reviewSubmission.cardId)
                ]
            )

            if updatedRows == 0 {
                throw LocalStoreError.notFound("Card not found")
            }

            try self.enqueueReviewEventAppendOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: reviewEventOperationId,
                clientUpdatedAt: reviewSubmission.reviewedAtClient,
                reviewEvent: ReviewEvent(
                    reviewEventId: reviewEventId,
                    workspaceId: workspaceId,
                    cardId: reviewSubmission.cardId,
                    deviceId: cloudSettings.deviceId,
                    clientEventId: clientEventId,
                    rating: reviewSubmission.rating,
                    reviewedAtClient: reviewSubmission.reviewedAtClient,
                    reviewedAtServer: reviewedAtServer,
                )
            )

            let updatedCard = try self.loadCard(workspaceId: workspaceId, cardId: reviewSubmission.cardId)
            try self.enqueueCardUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: cardOperationId,
                clientUpdatedAt: reviewSubmission.reviewedAtClient,
                card: updatedCard
            )
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
        try self.inTransaction {
            let cloudSettings = try self.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let now = currentIsoTimestamp()
            let updatedRows = try self.execute(
                sql: """
                UPDATE workspaces
                SET fsrs_algorithm = ?, fsrs_desired_retention = ?, fsrs_learning_steps_minutes_json = ?, fsrs_relearning_steps_minutes_json = ?, fsrs_maximum_interval_days = ?, fsrs_enable_fuzz = ?, fsrs_client_updated_at = ?, fsrs_last_modified_by_device_id = ?, fsrs_last_operation_id = ?, fsrs_updated_at = ?
                WHERE workspace_id = ?
                """,
                values: [
                    .text(validatedInput.algorithm),
                    .real(validatedInput.desiredRetention),
                    .text(learningStepsJson),
                    .text(relearningStepsJson),
                    .integer(Int64(validatedInput.maximumIntervalDays)),
                    .integer(validatedInput.enableFuzz ? 1 : 0),
                    .text(now),
                    .text(cloudSettings.deviceId),
                    .text(operationId),
                    .text(now),
                    .text(workspaceId)
                ]
            )

            if updatedRows == 0 {
                throw LocalStoreError.database("Workspace row is missing")
            }

            let updatedSettings = try self.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
            try self.enqueueWorkspaceSchedulerSettingsUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                settings: updatedSettings
            )
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

    func loadOutboxEntries(workspaceId: String, limit: Int) throws -> [PersistedOutboxEntry] {
        try self.query(
            sql: """
            SELECT operation_id, workspace_id, entity_type, entity_id, operation_type, payload_json, client_updated_at, created_at, attempt_count, last_error
            FROM outbox
            WHERE workspace_id = ?
            ORDER BY created_at ASC
            LIMIT ?
            """,
            values: [
                .text(workspaceId),
                .integer(Int64(limit))
            ]
        ) { statement in
            let entityTypeRaw = Self.columnText(statement: statement, index: 2)
            guard let entityType = SyncEntityType(rawValue: entityTypeRaw) else {
                throw LocalStoreError.database("Stored outbox entity type is invalid: \(entityTypeRaw)")
            }

            let actionRaw = Self.columnText(statement: statement, index: 4)
            guard let action = SyncAction(rawValue: actionRaw) else {
                throw LocalStoreError.database("Stored outbox action is invalid: \(actionRaw)")
            }

            let payloadJson = Self.columnText(statement: statement, index: 5)
            let operationId = Self.columnText(statement: statement, index: 0)
            let entityId = Self.columnText(statement: statement, index: 3)
            let clientUpdatedAt = Self.columnText(statement: statement, index: 6)

            return PersistedOutboxEntry(
                operationId: operationId,
                workspaceId: Self.columnText(statement: statement, index: 1),
                createdAt: Self.columnText(statement: statement, index: 7),
                attemptCount: Int(Self.columnInt64(statement: statement, index: 8)),
                lastError: Self.columnOptionalText(statement: statement, index: 9) ?? "",
                operation: try self.decodeOutboxOperation(
                    operationId: operationId,
                    entityType: entityType,
                    entityId: entityId,
                    action: action,
                    clientUpdatedAt: clientUpdatedAt,
                    payloadJson: payloadJson
                )
            )
        }
    }

    func deleteOutboxEntries(operationIds: [String]) throws {
        for operationId in operationIds {
            _ = try self.execute(
                sql: "DELETE FROM outbox WHERE operation_id = ?",
                values: [.text(operationId)]
            )
        }
    }

    func markOutboxEntriesFailed(operationIds: [String], message: String) throws {
        for operationId in operationIds {
            _ = try self.execute(
                sql: """
                UPDATE outbox
                SET attempt_count = attempt_count + 1, last_error = ?
                WHERE operation_id = ?
                """,
                values: [
                    .text(message),
                    .text(operationId)
                ]
            )
        }
    }

    func loadLastAppliedChangeId(workspaceId: String) throws -> Int64 {
        let values = try self.query(
            sql: "SELECT last_applied_change_id FROM sync_state WHERE workspace_id = ? LIMIT 1",
            values: [.text(workspaceId)]
        ) { statement in
            Self.columnInt64(statement: statement, index: 0)
        }

        guard let lastAppliedChangeId = values.first else {
            throw LocalStoreError.database("Sync state row is missing")
        }

        return lastAppliedChangeId
    }

    func setLastAppliedChangeId(workspaceId: String, changeId: Int64) throws {
        let updatedRows = try self.execute(
            sql: """
            UPDATE sync_state
            SET last_applied_change_id = ?, updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .integer(changeId),
                .text(currentIsoTimestamp()),
                .text(workspaceId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.database("Sync state row is missing")
        }
    }

    func loadReviewEvents(workspaceId: String) throws -> [ReviewEvent] {
        try self.query(
            sql: """
            SELECT review_event_id, workspace_id, card_id, device_id, client_event_id, rating, reviewed_at_client, reviewed_at_server
            FROM review_events
            WHERE workspace_id = ?
            ORDER BY reviewed_at_server DESC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            let rawRating = Int(Self.columnInt64(statement: statement, index: 5))
            guard let rating = ReviewRating(rawValue: rawRating) else {
                throw LocalStoreError.database("Stored review rating is invalid: \(rawRating)")
            }

            return ReviewEvent(
                reviewEventId: Self.columnText(statement: statement, index: 0),
                workspaceId: Self.columnText(statement: statement, index: 1),
                cardId: Self.columnText(statement: statement, index: 2),
                deviceId: Self.columnText(statement: statement, index: 3),
                clientEventId: Self.columnText(statement: statement, index: 4),
                rating: rating,
                reviewedAtClient: Self.columnText(statement: statement, index: 6),
                reviewedAtServer: Self.columnText(statement: statement, index: 7)
            )
        }
    }

    func bootstrapOutbox(workspaceId: String) throws {
        let cloudSettings = try self.loadCloudSettings()
        let pendingOperations = try self.loadOutboxEntries(workspaceId: workspaceId, limit: Int.max)
        let pendingOperationIds = Set(pendingOperations.map { entry in
            entry.operation.operationId
        })

        for card in try self.loadCardsIncludingDeleted(workspaceId: workspaceId) {
            if pendingOperationIds.contains(card.lastOperationId) == false {
                try self.enqueueCardUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: card.lastOperationId,
                    clientUpdatedAt: card.clientUpdatedAt,
                    card: card
                )
            }
        }

        for deck in try self.loadDecksIncludingDeleted(workspaceId: workspaceId) {
            if pendingOperationIds.contains(deck.lastOperationId) == false {
                try self.enqueueDeckUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: deck.lastOperationId,
                    clientUpdatedAt: deck.clientUpdatedAt,
                    deck: deck
                )
            }
        }

        let schedulerSettings = try self.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
        if pendingOperationIds.contains(schedulerSettings.lastOperationId) == false {
            try self.enqueueWorkspaceSchedulerSettingsUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: schedulerSettings.lastOperationId,
                clientUpdatedAt: schedulerSettings.clientUpdatedAt,
                settings: schedulerSettings
            )
        }

        for reviewEvent in try self.loadReviewEvents(workspaceId: workspaceId) {
            if pendingOperationIds.contains(reviewEvent.reviewEventId) == false {
                try self.enqueueReviewEventAppendOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: reviewEvent.reviewEventId,
                    clientUpdatedAt: reviewEvent.reviewedAtClient,
                    reviewEvent: reviewEvent
                )
            }
        }
    }

    func relinkWorkspace(localWorkspaceId: String, linkedSession: CloudLinkedSession) throws {
        if localWorkspaceId == linkedSession.workspaceId {
            try self.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: linkedSession.workspaceId,
                linkedEmail: linkedSession.email
            )
            return
        }

        try self.inTransaction {
            let existingWorkspaceCount = try self.scalarInt(
                sql: "SELECT COUNT(*) FROM workspaces WHERE workspace_id = ?",
                values: [.text(linkedSession.workspaceId)]
            )

            if existingWorkspaceCount == 0 {
                let localWorkspace = try self.loadWorkspace()
                let currentSettings = try self.loadWorkspaceSchedulerSettings(workspaceId: localWorkspaceId)
                try self.execute(
                    sql: """
                    INSERT INTO workspaces (
                        workspace_id,
                        name,
                        created_at,
                        fsrs_algorithm,
                        fsrs_desired_retention,
                        fsrs_learning_steps_minutes_json,
                        fsrs_relearning_steps_minutes_json,
                        fsrs_maximum_interval_days,
                        fsrs_enable_fuzz,
                        fsrs_client_updated_at,
                        fsrs_last_modified_by_device_id,
                        fsrs_last_operation_id,
                        fsrs_updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    values: [
                        .text(linkedSession.workspaceId),
                        .text(localWorkspace.name),
                        .text(localWorkspace.createdAt),
                        .text(currentSettings.algorithm),
                        .real(currentSettings.desiredRetention),
                        .text(try self.encodeIntegerArray(currentSettings.learningStepsMinutes)),
                        .text(try self.encodeIntegerArray(currentSettings.relearningStepsMinutes)),
                        .integer(Int64(currentSettings.maximumIntervalDays)),
                        .integer(currentSettings.enableFuzz ? 1 : 0),
                        .text(currentSettings.clientUpdatedAt),
                        .text(currentSettings.lastModifiedByDeviceId),
                        .text(currentSettings.lastOperationId),
                        .text(currentSettings.updatedAt)
                    ]
                )
            }

            let workspaceScopedTables: [String] = ["user_settings", "cards", "decks", "review_events", "outbox", "sync_state"]
            for tableName in workspaceScopedTables {
                _ = try self.execute(
                    sql: "UPDATE \(tableName) SET workspace_id = ? WHERE workspace_id = ?",
                    values: [
                        .text(linkedSession.workspaceId),
                        .text(localWorkspaceId)
                    ]
                )
            }

            _ = try self.execute(
                sql: "DELETE FROM workspaces WHERE workspace_id = ?",
                values: [.text(localWorkspaceId)]
            )

            let syncStateCount = try self.scalarInt(
                sql: "SELECT COUNT(*) FROM sync_state WHERE workspace_id = ?",
                values: [.text(linkedSession.workspaceId)]
            )
            if syncStateCount == 0 {
                try self.execute(
                    sql: "INSERT INTO sync_state (workspace_id, last_applied_change_id, updated_at) VALUES (?, 0, ?)",
                    values: [
                        .text(linkedSession.workspaceId),
                        .text(currentIsoTimestamp())
                    ]
                )
            }

            try self.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: linkedSession.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    func applySyncChange(workspaceId: String, change: SyncChange) throws {
        try self.inTransaction {
            switch change.payload {
            case .card(let card):
                let existingCard = try self.loadOptionalCardIncludingDeleted(workspaceId: workspaceId, cardId: card.cardId)
                if let existingCard, compareLwwCard(left: existingCard, right: card) > 0 {
                    break
                }

                try self.upsertRemoteCard(workspaceId: workspaceId, card: card)
            case .deck(let deck):
                let existingDeck = try self.loadOptionalDeckIncludingDeleted(workspaceId: workspaceId, deckId: deck.deckId)
                if let existingDeck, compareLwwDeck(left: existingDeck, right: deck) > 0 {
                    break
                }

                try self.upsertRemoteDeck(workspaceId: workspaceId, deck: deck)
            case .workspaceSchedulerSettings(let settings):
                let existingSettings = try self.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
                if compareLwwWorkspaceSettings(left: existingSettings, right: settings) <= 0 {
                    try self.upsertRemoteWorkspaceSettings(workspaceId: workspaceId, settings: settings)
                }
            case .reviewEvent(let reviewEvent):
                try self.insertRemoteReviewEvent(workspaceId: workspaceId, reviewEvent: reviewEvent)
            }
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

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_updated_at
            ON cards(workspace_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_active
            ON cards(workspace_id, due_at)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_cards_workspace_fsrs_last_reviewed_at
            ON cards(workspace_id, fsrs_last_reviewed_at DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_decks_workspace_updated_active
            ON decks(workspace_id, updated_at DESC)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_review_events_workspace_card_time
            ON review_events(workspace_id, card_id, reviewed_at_server DESC);

        CREATE INDEX IF NOT EXISTS idx_outbox_workspace_created_at
            ON outbox(workspace_id, created_at ASC);
        """

        let resultCode = sqlite3_exec(connection, migrationSQL, nil, nil, nil)
        guard resultCode == SQLITE_OK else {
            throw LocalStoreError.database("Failed to run local migrations: \(self.lastErrorMessage())")
        }

        try self.setSchemaVersion(version: localDatabaseSchemaVersion)
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
                    .text("Local Workspace"),
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
                fsrs_client_updated_at,
                fsrs_last_modified_by_device_id,
                fsrs_last_operation_id,
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
                clientUpdatedAt: Self.columnText(statement: statement, index: 6),
                lastModifiedByDeviceId: Self.columnText(statement: statement, index: 7),
                lastOperationId: Self.columnText(statement: statement, index: 8),
                updatedAt: Self.columnText(statement: statement, index: 9)
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
                client_updated_at,
                last_modified_by_device_id,
                last_operation_id,
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
                clientUpdatedAt: Self.columnText(statement: statement, index: 15),
                lastModifiedByDeviceId: Self.columnText(statement: statement, index: 16),
                lastOperationId: Self.columnText(statement: statement, index: 17),
                updatedAt: Self.columnText(statement: statement, index: 18),
                deletedAt: Self.columnOptionalText(statement: statement, index: 19)
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
            SELECT deck_id, workspace_id, name, filter_definition_json, created_at, client_updated_at, last_modified_by_device_id, last_operation_id, updated_at, deleted_at
            FROM decks
            WHERE workspace_id = ? AND deleted_at IS NULL
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
                clientUpdatedAt: Self.columnText(statement: statement, index: 5),
                lastModifiedByDeviceId: Self.columnText(statement: statement, index: 6),
                lastOperationId: Self.columnText(statement: statement, index: 7),
                updatedAt: Self.columnText(statement: statement, index: 8),
                deletedAt: Self.columnOptionalText(statement: statement, index: 9)
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

    private func loadCardsIncludingDeleted(workspaceId: String) throws -> [Card] {
        try self.query(
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
                client_updated_at,
                last_modified_by_device_id,
                last_operation_id,
                updated_at,
                deleted_at
            FROM cards
            WHERE workspace_id = ?
            ORDER BY updated_at DESC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            try self.mapCard(statement: statement)
        }
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
                client_updated_at,
                last_modified_by_device_id,
                last_operation_id,
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
            try self.mapCard(statement: statement)
        }

        guard let card = cards.first else {
            throw LocalStoreError.notFound("Card not found")
        }

        return try self.validateOrResetLoadedCard(workspaceId: workspaceId, card: card)
    }

    private func loadCardIncludingDeleted(workspaceId: String, cardId: String) throws -> Card {
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
                client_updated_at,
                last_modified_by_device_id,
                last_operation_id,
                updated_at,
                deleted_at
            FROM cards
            WHERE workspace_id = ? AND card_id = ?
            LIMIT 1
            """,
            values: [
                .text(workspaceId),
                .text(cardId)
            ]
        ) { statement in
            try self.mapCard(statement: statement)
        }

        guard let card = cards.first else {
            throw LocalStoreError.notFound("Card not found")
        }

        return card
    }

    private func loadOptionalCardIncludingDeleted(workspaceId: String, cardId: String) throws -> Card? {
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
                client_updated_at,
                last_modified_by_device_id,
                last_operation_id,
                updated_at,
                deleted_at
            FROM cards
            WHERE workspace_id = ? AND card_id = ?
            LIMIT 1
            """,
            values: [
                .text(workspaceId),
                .text(cardId)
            ]
        ) { statement in
            try self.mapCard(statement: statement)
        }

        return cards.first
    }

    private func loadDeckIncludingDeleted(workspaceId: String, deckId: String) throws -> Deck {
        let decks = try self.query(
            sql: """
            SELECT deck_id, workspace_id, name, filter_definition_json, created_at, client_updated_at, last_modified_by_device_id, last_operation_id, updated_at, deleted_at
            FROM decks
            WHERE workspace_id = ? AND deck_id = ?
            LIMIT 1
            """,
            values: [
                .text(workspaceId),
                .text(deckId)
            ]
        ) { statement in
            try self.mapDeck(statement: statement)
        }

        guard let deck = decks.first else {
            throw LocalStoreError.notFound("Deck not found")
        }

        return deck
    }

    private func loadDecksIncludingDeleted(workspaceId: String) throws -> [Deck] {
        try self.query(
            sql: """
            SELECT deck_id, workspace_id, name, filter_definition_json, created_at, client_updated_at, last_modified_by_device_id, last_operation_id, updated_at, deleted_at
            FROM decks
            WHERE workspace_id = ?
            ORDER BY updated_at DESC, created_at DESC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            try self.mapDeck(statement: statement)
        }
    }

    private func loadOptionalDeckIncludingDeleted(workspaceId: String, deckId: String) throws -> Deck? {
        let decks = try self.query(
            sql: """
            SELECT deck_id, workspace_id, name, filter_definition_json, created_at, client_updated_at, last_modified_by_device_id, last_operation_id, updated_at, deleted_at
            FROM decks
            WHERE workspace_id = ? AND deck_id = ?
            LIMIT 1
            """,
            values: [
                .text(workspaceId),
                .text(deckId)
            ]
        ) { statement in
            try self.mapDeck(statement: statement)
        }

        return decks.first
    }

    private func encodePayloadJson<T: Encodable>(_ payload: T) throws -> String {
        let data = try self.encoder.encode(payload)
        guard let json = String(data: data, encoding: .utf8) else {
            throw LocalStoreError.database("Failed to encode sync payload JSON")
        }

        return json
    }

    private func decodeOutboxOperation(
        operationId: String,
        entityType: SyncEntityType,
        entityId: String,
        action: SyncAction,
        clientUpdatedAt: String,
        payloadJson: String
    ) throws -> SyncOperation {
        let payloadData = Data(payloadJson.utf8)

        switch entityType {
        case .card:
            return SyncOperation(
                operationId: operationId,
                entityType: entityType,
                entityId: entityId,
                action: action,
                clientUpdatedAt: clientUpdatedAt,
                payload: .card(try self.decoder.decode(CardSyncPayload.self, from: payloadData))
            )
        case .deck:
            return SyncOperation(
                operationId: operationId,
                entityType: entityType,
                entityId: entityId,
                action: action,
                clientUpdatedAt: clientUpdatedAt,
                payload: .deck(try self.decoder.decode(DeckSyncPayload.self, from: payloadData))
            )
        case .workspaceSchedulerSettings:
            return SyncOperation(
                operationId: operationId,
                entityType: entityType,
                entityId: entityId,
                action: action,
                clientUpdatedAt: clientUpdatedAt,
                payload: .workspaceSchedulerSettings(
                    try self.decoder.decode(WorkspaceSchedulerSettingsSyncPayload.self, from: payloadData)
                )
            )
        case .reviewEvent:
            return SyncOperation(
                operationId: operationId,
                entityType: entityType,
                entityId: entityId,
                action: action,
                clientUpdatedAt: clientUpdatedAt,
                payload: .reviewEvent(try self.decoder.decode(ReviewEventSyncPayload.self, from: payloadData))
            )
        }
    }

    private func mapCard(statement: OpaquePointer) throws -> Card {
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
            clientUpdatedAt: Self.columnText(statement: statement, index: 15),
            lastModifiedByDeviceId: Self.columnText(statement: statement, index: 16),
            lastOperationId: Self.columnText(statement: statement, index: 17),
            updatedAt: Self.columnText(statement: statement, index: 18),
            deletedAt: Self.columnOptionalText(statement: statement, index: 19)
        )
    }

    private func mapDeck(statement: OpaquePointer) throws -> Deck {
        let filterJson = Self.columnText(statement: statement, index: 3)
        let filterData = Data(filterJson.utf8)
        let filterDefinition = try self.decoder.decode(DeckFilterDefinition.self, from: filterData)

        return Deck(
            deckId: Self.columnText(statement: statement, index: 0),
            workspaceId: Self.columnText(statement: statement, index: 1),
            name: Self.columnText(statement: statement, index: 2),
            filterDefinition: filterDefinition,
            createdAt: Self.columnText(statement: statement, index: 4),
            clientUpdatedAt: Self.columnText(statement: statement, index: 5),
            lastModifiedByDeviceId: Self.columnText(statement: statement, index: 6),
            lastOperationId: Self.columnText(statement: statement, index: 7),
            updatedAt: Self.columnText(statement: statement, index: 8),
            deletedAt: Self.columnOptionalText(statement: statement, index: 9)
        )
    }

    private func upsertRemoteCard(workspaceId: String, card: Card) throws {
        let tagsJson = try self.encodePayloadJson(card.tags)
        let existingCard = try self.loadOptionalCardIncludingDeleted(workspaceId: workspaceId, cardId: card.cardId)

        if existingCard == nil {
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
                    client_updated_at,
                    last_modified_by_device_id,
                    last_operation_id,
                    updated_at,
                    deleted_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(card.cardId),
                    .text(workspaceId),
                    .text(card.frontText),
                    .text(card.backText),
                    .text(tagsJson),
                    .text(card.effortLevel.rawValue),
                    card.dueAt.map(SQLiteValue.text) ?? .null,
                    .integer(Int64(card.reps)),
                    .integer(Int64(card.lapses)),
                    .text(card.fsrsCardState.rawValue),
                    card.fsrsStepIndex.map { SQLiteValue.integer(Int64($0)) } ?? .null,
                    card.fsrsStability.map(SQLiteValue.real) ?? .null,
                    card.fsrsDifficulty.map(SQLiteValue.real) ?? .null,
                    card.fsrsLastReviewedAt.map(SQLiteValue.text) ?? .null,
                    card.fsrsScheduledDays.map { SQLiteValue.integer(Int64($0)) } ?? .null,
                    .text(card.clientUpdatedAt),
                    .text(card.lastModifiedByDeviceId),
                    .text(card.lastOperationId),
                    .text(card.updatedAt),
                    card.deletedAt.map(SQLiteValue.text) ?? .null
                ]
            )
            return
        }

        _ = try self.execute(
            sql: """
            UPDATE cards
            SET front_text = ?, back_text = ?, tags_json = ?, effort_level = ?, due_at = ?, reps = ?, lapses = ?, fsrs_card_state = ?, fsrs_step_index = ?, fsrs_stability = ?, fsrs_difficulty = ?, fsrs_last_reviewed_at = ?, fsrs_scheduled_days = ?, client_updated_at = ?, last_modified_by_device_id = ?, last_operation_id = ?, updated_at = ?, deleted_at = ?
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text(card.frontText),
                .text(card.backText),
                .text(tagsJson),
                .text(card.effortLevel.rawValue),
                card.dueAt.map(SQLiteValue.text) ?? .null,
                .integer(Int64(card.reps)),
                .integer(Int64(card.lapses)),
                .text(card.fsrsCardState.rawValue),
                card.fsrsStepIndex.map { SQLiteValue.integer(Int64($0)) } ?? .null,
                card.fsrsStability.map(SQLiteValue.real) ?? .null,
                card.fsrsDifficulty.map(SQLiteValue.real) ?? .null,
                card.fsrsLastReviewedAt.map(SQLiteValue.text) ?? .null,
                card.fsrsScheduledDays.map { SQLiteValue.integer(Int64($0)) } ?? .null,
                .text(card.clientUpdatedAt),
                .text(card.lastModifiedByDeviceId),
                .text(card.lastOperationId),
                .text(card.updatedAt),
                card.deletedAt.map(SQLiteValue.text) ?? .null,
                .text(workspaceId),
                .text(card.cardId)
            ]
        )
    }

    private func upsertRemoteDeck(workspaceId: String, deck: Deck) throws {
        let filterJson = try self.encodePayloadJson(deck.filterDefinition)
        let existingDeck = try self.loadOptionalDeckIncludingDeleted(workspaceId: workspaceId, deckId: deck.deckId)

        if existingDeck == nil {
            try self.execute(
                sql: """
                INSERT INTO decks (
                    deck_id,
                    workspace_id,
                    name,
                    filter_definition_json,
                    created_at,
                    client_updated_at,
                    last_modified_by_device_id,
                    last_operation_id,
                    updated_at,
                    deleted_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(deck.deckId),
                    .text(workspaceId),
                    .text(deck.name),
                    .text(filterJson),
                    .text(deck.createdAt),
                    .text(deck.clientUpdatedAt),
                    .text(deck.lastModifiedByDeviceId),
                    .text(deck.lastOperationId),
                    .text(deck.updatedAt),
                    deck.deletedAt.map(SQLiteValue.text) ?? .null
                ]
            )
            return
        }

        _ = try self.execute(
            sql: """
            UPDATE decks
            SET name = ?, filter_definition_json = ?, created_at = ?, client_updated_at = ?, last_modified_by_device_id = ?, last_operation_id = ?, updated_at = ?, deleted_at = ?
            WHERE workspace_id = ? AND deck_id = ?
            """,
            values: [
                .text(deck.name),
                .text(filterJson),
                .text(deck.createdAt),
                .text(deck.clientUpdatedAt),
                .text(deck.lastModifiedByDeviceId),
                .text(deck.lastOperationId),
                .text(deck.updatedAt),
                deck.deletedAt.map(SQLiteValue.text) ?? .null,
                .text(workspaceId),
                .text(deck.deckId)
            ]
        )
    }

    private func upsertRemoteWorkspaceSettings(workspaceId: String, settings: WorkspaceSchedulerSettings) throws {
        _ = try self.execute(
            sql: """
            UPDATE workspaces
            SET fsrs_algorithm = ?, fsrs_desired_retention = ?, fsrs_learning_steps_minutes_json = ?, fsrs_relearning_steps_minutes_json = ?, fsrs_maximum_interval_days = ?, fsrs_enable_fuzz = ?, fsrs_client_updated_at = ?, fsrs_last_modified_by_device_id = ?, fsrs_last_operation_id = ?, fsrs_updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .text(settings.algorithm),
                .real(settings.desiredRetention),
                .text(try self.encodeIntegerArray(settings.learningStepsMinutes)),
                .text(try self.encodeIntegerArray(settings.relearningStepsMinutes)),
                .integer(Int64(settings.maximumIntervalDays)),
                .integer(settings.enableFuzz ? 1 : 0),
                .text(settings.clientUpdatedAt),
                .text(settings.lastModifiedByDeviceId),
                .text(settings.lastOperationId),
                .text(settings.updatedAt),
                .text(workspaceId)
            ]
        )
    }

    private func insertRemoteReviewEvent(workspaceId: String, reviewEvent: ReviewEvent) throws {
        _ = try self.execute(
            sql: """
            INSERT OR IGNORE INTO review_events (
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
                .text(reviewEvent.reviewEventId),
                .text(workspaceId),
                .text(reviewEvent.cardId),
                .text(reviewEvent.deviceId),
                .text(reviewEvent.clientEventId),
                .integer(Int64(reviewEvent.rating.rawValue)),
                .text(reviewEvent.reviewedAtClient),
                .text(reviewEvent.reviewedAtServer)
            ]
        )
    }

    private func enqueueOutboxOperation(
        workspaceId: String,
        deviceId: String,
        operationId: String,
        entityType: String,
        entityId: String,
        operationType: String,
        payloadJson: String,
        clientUpdatedAt: String
    ) throws {
        try self.execute(
            sql: """
            INSERT INTO outbox (
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
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
            """,
            values: [
                .text(operationId),
                .text(workspaceId),
                .text(deviceId),
                .text(entityType),
                .text(entityId),
                .text(operationType),
                .text(payloadJson),
                .text(clientUpdatedAt),
                .text(currentIsoTimestamp())
            ]
        )
    }

    private func enqueueCardUpsertOperation(
        workspaceId: String,
        deviceId: String,
        operationId: String,
        clientUpdatedAt: String,
        card: Card
    ) throws {
        let payloadJson = try self.encodePayloadJson(
            CardOutboxPayload(
                cardId: card.cardId,
                frontText: card.frontText,
                backText: card.backText,
                tags: card.tags,
                effortLevel: card.effortLevel.rawValue,
                dueAt: card.dueAt,
                reps: card.reps,
                lapses: card.lapses,
                fsrsCardState: card.fsrsCardState.rawValue,
                fsrsStepIndex: card.fsrsStepIndex,
                fsrsStability: card.fsrsStability,
                fsrsDifficulty: card.fsrsDifficulty,
                fsrsLastReviewedAt: card.fsrsLastReviewedAt,
                fsrsScheduledDays: card.fsrsScheduledDays,
                deletedAt: card.deletedAt
            )
        )
        try self.enqueueOutboxOperation(
            workspaceId: workspaceId,
            deviceId: deviceId,
            operationId: operationId,
            entityType: "card",
            entityId: card.cardId,
            operationType: "upsert",
            payloadJson: payloadJson,
            clientUpdatedAt: clientUpdatedAt
        )
    }

    private func enqueueDeckUpsertOperation(
        workspaceId: String,
        deviceId: String,
        operationId: String,
        clientUpdatedAt: String,
        deck: Deck
    ) throws {
        let payloadJson = try self.encodePayloadJson(
            DeckOutboxPayload(
                deckId: deck.deckId,
                name: deck.name,
                filterDefinition: deck.filterDefinition,
                createdAt: deck.createdAt,
                deletedAt: deck.deletedAt
            )
        )
        try self.enqueueOutboxOperation(
            workspaceId: workspaceId,
            deviceId: deviceId,
            operationId: operationId,
            entityType: "deck",
            entityId: deck.deckId,
            operationType: "upsert",
            payloadJson: payloadJson,
            clientUpdatedAt: clientUpdatedAt
        )
    }

    private func enqueueWorkspaceSchedulerSettingsUpsertOperation(
        workspaceId: String,
        deviceId: String,
        operationId: String,
        clientUpdatedAt: String,
        settings: WorkspaceSchedulerSettings
    ) throws {
        let payloadJson = try self.encodePayloadJson(
            WorkspaceSchedulerSettingsOutboxPayload(
                algorithm: settings.algorithm,
                desiredRetention: settings.desiredRetention,
                learningStepsMinutes: settings.learningStepsMinutes,
                relearningStepsMinutes: settings.relearningStepsMinutes,
                maximumIntervalDays: settings.maximumIntervalDays,
                enableFuzz: settings.enableFuzz
            )
        )
        try self.enqueueOutboxOperation(
            workspaceId: workspaceId,
            deviceId: deviceId,
            operationId: operationId,
            entityType: "workspace_scheduler_settings",
            entityId: workspaceId,
            operationType: "upsert",
            payloadJson: payloadJson,
            clientUpdatedAt: clientUpdatedAt
        )
    }

    private func enqueueReviewEventAppendOperation(
        workspaceId: String,
        deviceId: String,
        operationId: String,
        clientUpdatedAt: String,
        reviewEvent: ReviewEvent
    ) throws {
        let payloadJson = try self.encodePayloadJson(
            ReviewEventOutboxPayload(
                reviewEventId: reviewEvent.reviewEventId,
                cardId: reviewEvent.cardId,
                deviceId: reviewEvent.deviceId,
                clientEventId: reviewEvent.clientEventId,
                rating: reviewEvent.rating.rawValue,
                reviewedAtClient: reviewEvent.reviewedAtClient
            )
        )
        try self.enqueueOutboxOperation(
            workspaceId: workspaceId,
            deviceId: deviceId,
            operationId: operationId,
            entityType: "review_event",
            entityId: reviewEvent.reviewEventId,
            operationType: "append",
            payloadJson: payloadJson,
            clientUpdatedAt: clientUpdatedAt
        )
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
            updatedAt: currentIsoTimestamp()
        )
        let updatedRows = try self.execute(
            sql: """
            UPDATE cards
            SET due_at = ?, reps = ?, lapses = ?, fsrs_card_state = ?, fsrs_step_index = ?, fsrs_stability = ?, fsrs_difficulty = ?, fsrs_last_reviewed_at = ?, fsrs_scheduled_days = ?, client_updated_at = ?, last_modified_by_device_id = ?, last_operation_id = ?, updated_at = ?
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
                .text(repairedCard.clientUpdatedAt),
                .text(repairedCard.lastModifiedByDeviceId),
                .text(repairedCard.lastOperationId),
                .text(repairedCard.updatedAt),
                .text(workspaceId),
                .text(card.cardId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.notFound("Card not found")
        }

        return repairedCard
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

    private static func columnOptionalInt64(statement: OpaquePointer, index: Int32) -> Int64? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else {
            return nil
        }

        return sqlite3_column_int64(statement, index)
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
func resetFsrsState(card: Card, updatedAt: String) -> Card {
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
        clientUpdatedAt: card.clientUpdatedAt,
        lastModifiedByDeviceId: card.lastModifiedByDeviceId,
        lastOperationId: card.lastOperationId,
        updatedAt: updatedAt,
        deletedAt: card.deletedAt
    )
}

private func compareLwwTuple(
    leftClientUpdatedAt: String,
    leftDeviceId: String,
    leftOperationId: String,
    rightClientUpdatedAt: String,
    rightDeviceId: String,
    rightOperationId: String
) -> Int {
    let timestampComparison = leftClientUpdatedAt.compare(rightClientUpdatedAt)
    if timestampComparison != .orderedSame {
        return timestampComparison == .orderedAscending ? -1 : 1
    }

    let deviceComparison = leftDeviceId.compare(rightDeviceId)
    if deviceComparison != .orderedSame {
        return deviceComparison == .orderedAscending ? -1 : 1
    }

    let operationComparison = leftOperationId.compare(rightOperationId)
    if operationComparison == .orderedAscending {
        return -1
    }

    if operationComparison == .orderedDescending {
        return 1
    }

    return 0
}

private func compareLwwCard(left: Card, right: Card) -> Int {
    compareLwwTuple(
        leftClientUpdatedAt: left.clientUpdatedAt,
        leftDeviceId: left.lastModifiedByDeviceId,
        leftOperationId: left.lastOperationId,
        rightClientUpdatedAt: right.clientUpdatedAt,
        rightDeviceId: right.lastModifiedByDeviceId,
        rightOperationId: right.lastOperationId
    )
}

private func compareLwwDeck(left: Deck, right: Deck) -> Int {
    compareLwwTuple(
        leftClientUpdatedAt: left.clientUpdatedAt,
        leftDeviceId: left.lastModifiedByDeviceId,
        leftOperationId: left.lastOperationId,
        rightClientUpdatedAt: right.clientUpdatedAt,
        rightDeviceId: right.lastModifiedByDeviceId,
        rightOperationId: right.lastOperationId
    )
}

private func compareLwwWorkspaceSettings(left: WorkspaceSchedulerSettings, right: WorkspaceSchedulerSettings) -> Int {
    compareLwwTuple(
        leftClientUpdatedAt: left.clientUpdatedAt,
        leftDeviceId: left.lastModifiedByDeviceId,
        leftOperationId: left.lastOperationId,
        rightClientUpdatedAt: right.clientUpdatedAt,
        rightDeviceId: right.lastModifiedByDeviceId,
        rightOperationId: right.lastOperationId
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
