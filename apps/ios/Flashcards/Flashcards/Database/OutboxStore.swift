import Foundation

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
    let installationId: String
    let clientEventId: String
    let rating: Int
    let reviewedAtClient: String
}

private struct ReviewEventOutboxCandidate {
    let operationId: String
    let payloadJson: String
}

private struct PendingReviewScheduleCardTotalDeltaEntry {
    let operationId: String
    let entityId: String
    let isInitialCreate: Bool
    let payloadJson: String
}

private struct PendingReviewScheduleCardTotalChange {
    let hasLocalCreate: Bool
    let finalIsDeleted: Bool
}

struct DeletedOutboxEntriesSummary: Hashable {
    let operationCount: Int
}

private struct SyncStateRow {
    let lastAppliedHotChangeId: Int64
    let lastAppliedReviewSequenceId: Int64
    let hasHydratedHotState: Bool
    let hasHydratedReviewHistory: Bool
}

struct OutboxStore {
    let core: DatabaseCore

    func loadOutboxEntries(workspaceId: String, limit: Int) throws -> [PersistedOutboxEntry] {
        try self.core.query(
            sql: """
            SELECT operation_id, workspace_id, entity_type, entity_id, operation_type, payload_json, client_updated_at, created_at, attempt_count, last_error, review_schedule_impact
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
            let entityTypeRaw = DatabaseCore.columnText(statement: statement, index: 2)
            guard let entityType = SyncEntityType(rawValue: entityTypeRaw) else {
                throw LocalStoreError.database("Stored outbox entity type is invalid: \(entityTypeRaw)")
            }

            let actionRaw = DatabaseCore.columnText(statement: statement, index: 4)
            guard let action = SyncAction(rawValue: actionRaw) else {
                throw LocalStoreError.database("Stored outbox action is invalid: \(actionRaw)")
            }

            let payloadJson = DatabaseCore.columnText(statement: statement, index: 5)
            let operationId = DatabaseCore.columnText(statement: statement, index: 0)
            let entityId = DatabaseCore.columnText(statement: statement, index: 3)
            let clientUpdatedAt = DatabaseCore.columnText(statement: statement, index: 6)

            return PersistedOutboxEntry(
                operationId: operationId,
                workspaceId: DatabaseCore.columnText(statement: statement, index: 1),
                createdAt: DatabaseCore.columnText(statement: statement, index: 7),
                attemptCount: Int(DatabaseCore.columnInt64(statement: statement, index: 8)),
                lastError: DatabaseCore.columnOptionalText(statement: statement, index: 9) ?? "",
                reviewScheduleImpact: DatabaseCore.columnInt64(statement: statement, index: 10) != 0,
                operation: try self.decodeOutboxOperation(
                    workspaceId: workspaceId,
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
            _ = try self.core.execute(
                sql: "DELETE FROM outbox WHERE operation_id = ?",
                values: [.text(operationId)]
            )
        }
    }

    func deleteAllOutboxEntries(workspaceId: String) throws {
        _ = try self.core.execute(
            sql: "DELETE FROM outbox WHERE workspace_id = ?",
            values: [.text(workspaceId)]
        )
    }

    func deleteStaleReviewEventOutboxEntries(
        workspaceId: String,
        currentInstallationId: String
    ) throws -> DeletedOutboxEntriesSummary {
        let candidates = try self.core.query(
            sql: """
            SELECT operation_id, payload_json
            FROM outbox
            WHERE workspace_id = ? AND entity_type = 'review_event'
            """,
            values: [.text(workspaceId)]
        ) { statement in
            ReviewEventOutboxCandidate(
                operationId: DatabaseCore.columnText(statement: statement, index: 0),
                payloadJson: DatabaseCore.columnText(statement: statement, index: 1)
            )
        }

        let staleCandidates = try candidates.filter { candidate in
            let payload = try self.core.decoder.decode(
                ReviewEventOutboxPayload.self,
                from: Data(candidate.payloadJson.utf8)
            )
            return payload.installationId != currentInstallationId
        }

        let staleOperationIds = staleCandidates.map(\.operationId)
        try self.deleteOutboxEntries(operationIds: staleOperationIds)
        return DeletedOutboxEntriesSummary(operationCount: staleOperationIds.count)
    }

    func hasPendingCardOperation(
        workspaceId: String,
        installationId: String
    ) throws -> Bool {
        try self.hasPendingReviewScheduleImpactingCardOperation(
            workspaceId: workspaceId,
            installationId: installationId
        )
    }

    func hasPendingReviewScheduleImpactingCardOperation(
        workspaceId: String,
        installationId: String
    ) throws -> Bool {
        try self.core.scalarInt(
            sql: """
            SELECT EXISTS(
                SELECT 1
                FROM outbox
                WHERE workspace_id = ?
                    AND installation_id = ?
                    AND entity_type = 'card'
                    AND review_schedule_impact = 1
                LIMIT 1
            )
            """,
            values: [
                .text(workspaceId),
                .text(installationId),
            ]
        ) == 1
    }

    func loadPendingReviewScheduleCardTotalDelta(
        workspaceId: String,
        installationId: String
    ) throws -> Int {
        let entries = try self.core.query(
            sql: """
            SELECT operation_id, entity_id, is_initial_create, payload_json
            FROM outbox
            WHERE workspace_id = ?
                AND installation_id = ?
                AND entity_type = 'card'
                AND operation_type = 'upsert'
                AND review_schedule_impact = 1
            ORDER BY created_at ASC, operation_id ASC
            """,
            values: [
                .text(workspaceId),
                .text(installationId),
            ]
        ) { statement in
            PendingReviewScheduleCardTotalDeltaEntry(
                operationId: DatabaseCore.columnText(statement: statement, index: 0),
                entityId: DatabaseCore.columnText(statement: statement, index: 1),
                isInitialCreate: DatabaseCore.columnInt64(statement: statement, index: 2) != 0,
                payloadJson: DatabaseCore.columnText(statement: statement, index: 3)
            )
        }

        var changesByCardId: [String: PendingReviewScheduleCardTotalChange] = [:]
        for entry in entries {
            let parsedChange = try self.parsePendingReviewScheduleCardTotalChange(entry: entry)
            let existingChange = changesByCardId[entry.entityId]
            changesByCardId[entry.entityId] = PendingReviewScheduleCardTotalChange(
                hasLocalCreate: existingChange?.hasLocalCreate == true || parsedChange.hasLocalCreate,
                finalIsDeleted: parsedChange.finalIsDeleted
            )
        }

        return changesByCardId.values.reduce(0) { total, change in
            if change.hasLocalCreate && change.finalIsDeleted {
                return total
            }
            if change.hasLocalCreate {
                return total + 1
            }
            if change.finalIsDeleted {
                return total - 1
            }

            return total
        }
    }

    func markOutboxEntriesFailed(operationIds: [String], message: String) throws {
        for operationId in operationIds {
            _ = try self.core.execute(
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

    func loadLastAppliedHotChangeId(workspaceId: String) throws -> Int64 {
        try self.loadSyncState(workspaceId: workspaceId).lastAppliedHotChangeId
    }

    func loadLastAppliedReviewSequenceId(workspaceId: String) throws -> Int64 {
        try self.loadSyncState(workspaceId: workspaceId).lastAppliedReviewSequenceId
    }

    func hasHydratedHotState(workspaceId: String) throws -> Bool {
        try self.loadSyncState(workspaceId: workspaceId).hasHydratedHotState
    }

    func hasHydratedReviewHistory(workspaceId: String) throws -> Bool {
        try self.loadSyncState(workspaceId: workspaceId).hasHydratedReviewHistory
    }

    private func loadSyncState(workspaceId: String) throws -> SyncStateRow {
        try self.ensureSyncStateExists(workspaceId: workspaceId)

        let values = try self.core.query(
            sql: """
            SELECT
                last_applied_hot_change_id,
                last_applied_review_sequence_id,
                has_hydrated_hot_state,
                has_hydrated_review_history
            FROM sync_state
            WHERE workspace_id = ?
            LIMIT 1
            """,
            values: [.text(workspaceId)]
        ) { statement in
            SyncStateRow(
                lastAppliedHotChangeId: DatabaseCore.columnInt64(statement: statement, index: 0),
                lastAppliedReviewSequenceId: DatabaseCore.columnInt64(statement: statement, index: 1),
                hasHydratedHotState: DatabaseCore.columnInt64(statement: statement, index: 2) != 0,
                hasHydratedReviewHistory: DatabaseCore.columnInt64(statement: statement, index: 3) != 0
            )
        }

        guard let syncState = values.first else {
            throw LocalStoreError.database("Sync state row is missing")
        }

        return syncState
    }

    private func ensureSyncStateExists(workspaceId: String) throws {
        let workspaceCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM workspaces WHERE workspace_id = ?",
            values: [.text(workspaceId)]
        )
        guard workspaceCount > 0 else {
            return
        }

        let syncStateCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM sync_state WHERE workspace_id = ?",
            values: [.text(workspaceId)]
        )
        if syncStateCount > 0 {
            return
        }

        try self.core.execute(
            sql: """
            INSERT INTO sync_state (
                workspace_id,
                last_applied_hot_change_id,
                last_applied_review_sequence_id,
                has_hydrated_hot_state,
                has_hydrated_review_history,
                updated_at
            )
            VALUES (?, 0, 0, 0, 0, ?)
            """,
            values: [
                .text(workspaceId),
                .text(nowIsoTimestamp())
            ]
        )
    }

    func setLastAppliedHotChangeId(workspaceId: String, changeId: Int64) throws {
        try self.updateSyncState(
            workspaceId: workspaceId,
            sql: """
            UPDATE sync_state
            SET last_applied_hot_change_id = ?, updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .integer(changeId),
                .text(nowIsoTimestamp()),
                .text(workspaceId)
            ]
        )
    }

    func setLastAppliedReviewSequenceId(workspaceId: String, reviewSequenceId: Int64) throws {
        try self.updateSyncState(
            workspaceId: workspaceId,
            sql: """
            UPDATE sync_state
            SET last_applied_review_sequence_id = ?, updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .integer(reviewSequenceId),
                .text(nowIsoTimestamp()),
                .text(workspaceId)
            ]
        )
    }

    func setHasHydratedHotState(workspaceId: String, hasHydratedHotState: Bool) throws {
        try self.updateSyncState(
            workspaceId: workspaceId,
            sql: """
            UPDATE sync_state
            SET has_hydrated_hot_state = ?, updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .integer(hasHydratedHotState ? 1 : 0),
                .text(nowIsoTimestamp()),
                .text(workspaceId)
            ]
        )
    }

    func setHasHydratedReviewHistory(workspaceId: String, hasHydratedReviewHistory: Bool) throws {
        try self.updateSyncState(
            workspaceId: workspaceId,
            sql: """
            UPDATE sync_state
            SET has_hydrated_review_history = ?, updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .integer(hasHydratedReviewHistory ? 1 : 0),
                .text(nowIsoTimestamp()),
                .text(workspaceId)
            ]
        )
    }

    private func updateSyncState(workspaceId: String, sql: String, values: [SQLiteValue]) throws {
        let updatedRows = try self.core.execute(
            sql: sql,
            values: values
        )

        if updatedRows == 0 {
            throw LocalStoreError.database("Sync state row is missing")
        }
    }

    // `isInitialCreate` is the explicit "this is the very first local upsert for
    // this card" bit consumed by loadPendingReviewScheduleCardTotalDelta. Callers
    // pass true exactly once per card (the create path) and false for every later
    // upsert (edits, tombstones, review-applied schedule writes). The bit is
    // persisted on the outbox row (see is_initial_create column, schema v15) so
    // pending card-total deltas read intent directly instead of inferring it from
    // a timestamp coincidence.
    func enqueueCardUpsertOperation(
        workspaceId: String,
        installationId: String,
        operationId: String,
        clientUpdatedAt: String,
        card: Card,
        isInitialCreate: Bool,
        reviewScheduleImpact: Bool
    ) throws {
        let payloadJson = try self.core.encodeJsonString(
            value: CardOutboxPayload(
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
            installationId: installationId,
            operationId: operationId,
            entityType: "card",
            entityId: card.cardId,
            operationType: "upsert",
            payloadJson: payloadJson,
            clientUpdatedAt: clientUpdatedAt,
            isInitialCreate: isInitialCreate,
            reviewScheduleImpact: reviewScheduleImpact
        )
    }

    func enqueueDeckUpsertOperation(
        workspaceId: String,
        installationId: String,
        operationId: String,
        clientUpdatedAt: String,
        deck: Deck
    ) throws {
        let payloadJson = try self.core.encodeJsonString(
            value: DeckOutboxPayload(
                deckId: deck.deckId,
                name: deck.name,
                filterDefinition: deck.filterDefinition,
                createdAt: deck.createdAt,
                deletedAt: deck.deletedAt
            )
        )
        try self.enqueueOutboxOperation(
            workspaceId: workspaceId,
            installationId: installationId,
            operationId: operationId,
            entityType: "deck",
            entityId: deck.deckId,
            operationType: "upsert",
            payloadJson: payloadJson,
            clientUpdatedAt: clientUpdatedAt,
            isInitialCreate: false,
            reviewScheduleImpact: false
        )
    }

    func enqueueWorkspaceSchedulerSettingsUpsertOperation(
        workspaceId: String,
        installationId: String,
        operationId: String,
        clientUpdatedAt: String,
        settings: WorkspaceSchedulerSettings
    ) throws {
        let payloadJson = try self.core.encodeJsonString(
            value: WorkspaceSchedulerSettingsOutboxPayload(
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
            installationId: installationId,
            operationId: operationId,
            entityType: "workspace_scheduler_settings",
            entityId: workspaceId,
            operationType: "upsert",
            payloadJson: payloadJson,
            clientUpdatedAt: clientUpdatedAt,
            isInitialCreate: false,
            reviewScheduleImpact: false
        )
    }

    // review_event outbox rows are structurally non-impacting: the row records
    // only the rating/timestamp pair for the review history stream. The card
    // schedule write that follows a review is enqueued separately on the matching
    // `card` upsert with reviewScheduleImpact: true (see LocalDatabase+Review.swift).
    // Pending-card-total deltas (loadPendingReviewScheduleCardTotalDelta) and the
    // post-acknowledge counters
    // (CloudSyncResult.acknowledgedReviewScheduleImpactingOperationCount,
    // cleanedUpReviewScheduleImpactingOperationCount) must never include
    // review_event rows. The v13→v14 backfill enforces this for legacy rows; new
    // rows enforce it via the literal `false` passed below.
    func enqueueReviewEventAppendOperation(
        workspaceId: String,
        installationId: String,
        operationId: String,
        clientUpdatedAt: String,
        reviewEvent: ReviewEvent
    ) throws {
        let payloadJson = try self.core.encodeJsonString(
            value: ReviewEventOutboxPayload(
                reviewEventId: reviewEvent.reviewEventId,
                cardId: reviewEvent.cardId,
                installationId: installationId,
                clientEventId: reviewEvent.clientEventId,
                rating: reviewEvent.rating.rawValue,
                reviewedAtClient: reviewEvent.reviewedAtClient
            )
        )
        try self.enqueueOutboxOperation(
            workspaceId: workspaceId,
            installationId: installationId,
            operationId: operationId,
            entityType: "review_event",
            entityId: reviewEvent.reviewEventId,
            operationType: "append",
            payloadJson: payloadJson,
            clientUpdatedAt: clientUpdatedAt,
            isInitialCreate: false,
            reviewScheduleImpact: false
        )
    }

    private func enqueueOutboxOperation(
        workspaceId: String,
        installationId: String,
        operationId: String,
        entityType: String,
        entityId: String,
        operationType: String,
        payloadJson: String,
        clientUpdatedAt: String,
        isInitialCreate: Bool,
        reviewScheduleImpact: Bool
    ) throws {
        try self.core.execute(
            sql: """
            INSERT INTO outbox (
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
                review_schedule_impact,
                is_initial_create,
                last_error
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
            """,
            values: [
                .text(operationId),
                .text(workspaceId),
                .text(installationId),
                .text(entityType),
                .text(entityId),
                .text(operationType),
                .text(payloadJson),
                .text(clientUpdatedAt),
                .text(nowIsoTimestamp()),
                .integer(reviewScheduleImpact ? 1 : 0),
                .integer(isInitialCreate ? 1 : 0)
            ]
        )
    }

    private func decodeOutboxOperation(
        workspaceId: String,
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
                payload: .card(
                    try self.decodeCardPayload(
                        workspaceId: workspaceId,
                        cardId: entityId,
                        payloadData: payloadData
                    )
                )
            )
        case .deck:
            return SyncOperation(
                operationId: operationId,
                entityType: entityType,
                entityId: entityId,
                action: action,
                clientUpdatedAt: clientUpdatedAt,
                payload: .deck(try self.core.decoder.decode(DeckSyncPayload.self, from: payloadData))
            )
        case .workspaceSchedulerSettings:
            return SyncOperation(
                operationId: operationId,
                entityType: entityType,
                entityId: entityId,
                action: action,
                clientUpdatedAt: clientUpdatedAt,
                payload: .workspaceSchedulerSettings(
                    try self.core.decoder.decode(WorkspaceSchedulerSettingsSyncPayload.self, from: payloadData)
                )
            )
        case .reviewEvent:
            return SyncOperation(
                operationId: operationId,
                entityType: entityType,
                entityId: entityId,
                action: action,
                clientUpdatedAt: clientUpdatedAt,
                payload: .reviewEvent(try self.core.decoder.decode(ReviewEventSyncPayload.self, from: payloadData))
            )
        }
    }

    private func decodeCardPayload(
        workspaceId: String,
        cardId: String,
        payloadData: Data
    ) throws -> CardSyncPayload {
        do {
            return try self.core.decoder.decode(CardSyncPayload.self, from: payloadData)
        } catch DecodingError.keyNotFound(let missingKey, _) where missingKey.stringValue == "createdAt" {
            let legacyPayload = try self.core.decoder.decode(CardOutboxPayload.self, from: payloadData)
            let createdAt = try self.loadCardCreatedAt(workspaceId: workspaceId, cardId: cardId)

            return CardSyncPayload(
                cardId: cardId,
                frontText: legacyPayload.frontText,
                backText: legacyPayload.backText,
                tags: legacyPayload.tags,
                effortLevel: legacyPayload.effortLevel,
                dueAt: legacyPayload.dueAt,
                createdAt: createdAt,
                reps: legacyPayload.reps,
                lapses: legacyPayload.lapses,
                fsrsCardState: legacyPayload.fsrsCardState,
                fsrsStepIndex: legacyPayload.fsrsStepIndex,
                fsrsStability: legacyPayload.fsrsStability,
                fsrsDifficulty: legacyPayload.fsrsDifficulty,
                fsrsLastReviewedAt: legacyPayload.fsrsLastReviewedAt,
                fsrsScheduledDays: legacyPayload.fsrsScheduledDays,
                deletedAt: legacyPayload.deletedAt
            )
        }
    }

    private func parsePendingReviewScheduleCardTotalChange(
        entry: PendingReviewScheduleCardTotalDeltaEntry
    ) throws -> PendingReviewScheduleCardTotalChange {
        let payload = try self.core.decoder.decode(
            CardOutboxPayload.self,
            from: Data(entry.payloadJson.utf8)
        )
        guard payload.cardId == entry.entityId else {
            throw LocalStoreError.database(
                "Pending card outbox entry \(entry.operationId) entityId \(entry.entityId) does not match payload cardId \(payload.cardId)"
            )
        }

        return PendingReviewScheduleCardTotalChange(
            hasLocalCreate: entry.isInitialCreate,
            finalIsDeleted: payload.deletedAt != nil
        )
    }

    private func loadCardCreatedAt(workspaceId: String, cardId: String) throws -> String {
        do {
            return try self.core.scalarText(
                sql: """
                SELECT created_at
                FROM cards
                WHERE workspace_id = ? AND card_id = ?
                LIMIT 1
                """,
                values: [
                    .text(workspaceId),
                    .text(cardId)
                ]
            )
        } catch {
            throw LocalStoreError.database(
                "Stored card outbox payload is missing createdAt and card \(cardId) in workspace \(workspaceId) could not be loaded"
            )
        }
    }
}
