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
    let deviceId: String
    let clientEventId: String
    let rating: Int
    let reviewedAtClient: String
}

private struct ReviewEventOutboxCandidate {
    let operationId: String
    let payloadJson: String
}

struct OutboxStore {
    let core: DatabaseCore

    func loadOutboxEntries(workspaceId: String, limit: Int) throws -> [PersistedOutboxEntry] {
        try self.core.query(
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

    func deleteStaleReviewEventOutboxEntries(workspaceId: String, currentDeviceId: String) throws -> Int {
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

        let staleOperationIds = try candidates.compactMap { candidate in
            let payload = try self.core.decoder.decode(
                ReviewEventOutboxPayload.self,
                from: Data(candidate.payloadJson.utf8)
            )
            return payload.deviceId == currentDeviceId ? nil : candidate.operationId
        }

        try self.deleteOutboxEntries(operationIds: staleOperationIds)
        return staleOperationIds.count
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

    func loadLastAppliedChangeId(workspaceId: String) throws -> Int64 {
        let values = try self.core.query(
            sql: "SELECT last_applied_change_id FROM sync_state WHERE workspace_id = ? LIMIT 1",
            values: [.text(workspaceId)]
        ) { statement in
            DatabaseCore.columnInt64(statement: statement, index: 0)
        }

        guard let lastAppliedChangeId = values.first else {
            throw LocalStoreError.database("Sync state row is missing")
        }

        return lastAppliedChangeId
    }

    func setLastAppliedChangeId(workspaceId: String, changeId: Int64) throws {
        let updatedRows = try self.core.execute(
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

    func enqueueCardUpsertOperation(
        workspaceId: String,
        deviceId: String,
        operationId: String,
        clientUpdatedAt: String,
        card: Card
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
            deviceId: deviceId,
            operationId: operationId,
            entityType: "card",
            entityId: card.cardId,
            operationType: "upsert",
            payloadJson: payloadJson,
            clientUpdatedAt: clientUpdatedAt
        )
    }

    func enqueueDeckUpsertOperation(
        workspaceId: String,
        deviceId: String,
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
            deviceId: deviceId,
            operationId: operationId,
            entityType: "deck",
            entityId: deck.deckId,
            operationType: "upsert",
            payloadJson: payloadJson,
            clientUpdatedAt: clientUpdatedAt
        )
    }

    func enqueueWorkspaceSchedulerSettingsUpsertOperation(
        workspaceId: String,
        deviceId: String,
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
            deviceId: deviceId,
            operationId: operationId,
            entityType: "workspace_scheduler_settings",
            entityId: workspaceId,
            operationType: "upsert",
            payloadJson: payloadJson,
            clientUpdatedAt: clientUpdatedAt
        )
    }

    func enqueueReviewEventAppendOperation(
        workspaceId: String,
        deviceId: String,
        operationId: String,
        clientUpdatedAt: String,
        reviewEvent: ReviewEvent
    ) throws {
        let payloadJson = try self.core.encodeJsonString(
            value: ReviewEventOutboxPayload(
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
        try self.core.execute(
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
