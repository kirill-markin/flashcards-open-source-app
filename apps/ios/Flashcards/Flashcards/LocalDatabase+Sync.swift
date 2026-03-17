import Foundation

extension LocalDatabase {
    func loadOutboxEntries(workspaceId: String, limit: Int) throws -> [PersistedOutboxEntry] {
        try self.outboxStore.loadOutboxEntries(workspaceId: workspaceId, limit: limit)
    }

    func deleteOutboxEntries(operationIds: [String]) throws {
        try self.outboxStore.deleteOutboxEntries(operationIds: operationIds)
    }

    func clearCloudSyncState(workspaceId: String) throws {
        try self.core.inTransaction {
            _ = try self.core.execute(
                sql: "DELETE FROM outbox WHERE workspace_id = ?",
                values: [.text(workspaceId)]
            )

            let updatedRows = try self.core.execute(
                sql: """
                UPDATE sync_state
                SET last_applied_change_id = 0, updated_at = ?
                WHERE workspace_id = ?
                """,
                values: [
                    .text(nowIsoTimestamp()),
                    .text(workspaceId)
                ]
            )

            if updatedRows == 0 {
                try self.core.execute(
                    sql: """
                    INSERT INTO sync_state (workspace_id, last_applied_change_id, updated_at)
                    VALUES (?, 0, ?)
                    """,
                    values: [
                        .text(workspaceId),
                        .text(nowIsoTimestamp())
                    ]
                )
            }
        }
    }

    func deleteStaleReviewEventOutboxEntries(workspaceId: String) throws -> Int {
        try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            return try self.outboxStore.deleteStaleReviewEventOutboxEntries(
                workspaceId: workspaceId,
                currentDeviceId: cloudSettings.deviceId
            )
        }
    }

    func markOutboxEntriesFailed(operationIds: [String], message: String) throws {
        try self.outboxStore.markOutboxEntriesFailed(operationIds: operationIds, message: message)
    }

    func loadLastAppliedChangeId(workspaceId: String) throws -> Int64 {
        try self.outboxStore.loadLastAppliedChangeId(workspaceId: workspaceId)
    }

    func setLastAppliedChangeId(workspaceId: String, changeId: Int64) throws {
        try self.outboxStore.setLastAppliedChangeId(workspaceId: workspaceId, changeId: changeId)
    }

    func loadReviewEvents(workspaceId: String) throws -> [ReviewEvent] {
        try self.cardStore.loadReviewEvents(workspaceId: workspaceId)
    }

    func loadJournalMode() throws -> String {
        try self.core.scalarText(sql: "PRAGMA journal_mode;", values: [])
    }

    func bootstrapOutbox(workspaceId: String) throws {
        let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
        let pendingOperations = try self.outboxStore.loadOutboxEntries(workspaceId: workspaceId, limit: Int.max)
        let pendingOperationIds = Set(pendingOperations.map { entry in
            entry.operation.operationId
        })
        let pendingReviewEventIds = Set(pendingOperations.compactMap { entry in
            entry.operation.entityType == .reviewEvent ? entry.operation.entityId : nil
        })

        for card in try self.cardStore.loadCardsIncludingDeleted(workspaceId: workspaceId) {
            if pendingOperationIds.contains(card.lastOperationId) == false {
                try self.outboxStore.enqueueCardUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: card.lastOperationId,
                    clientUpdatedAt: card.clientUpdatedAt,
                    card: card
                )
            }
        }

        for deck in try self.deckStore.loadDecksIncludingDeleted(workspaceId: workspaceId) {
            if pendingOperationIds.contains(deck.lastOperationId) == false {
                try self.outboxStore.enqueueDeckUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: deck.lastOperationId,
                    clientUpdatedAt: deck.clientUpdatedAt,
                    deck: deck
                )
            }
        }

        let schedulerSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
        if pendingOperationIds.contains(schedulerSettings.lastOperationId) == false {
            try self.outboxStore.enqueueWorkspaceSchedulerSettingsUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: schedulerSettings.lastOperationId,
                clientUpdatedAt: schedulerSettings.clientUpdatedAt,
                settings: schedulerSettings
            )
        }

        for reviewEvent in try self.cardStore.loadReviewEvents(workspaceId: workspaceId) {
            if reviewEvent.deviceId != cloudSettings.deviceId {
                continue
            }

            if pendingReviewEventIds.contains(reviewEvent.reviewEventId) {
                continue
            }

            try self.outboxStore.enqueueReviewEventAppendOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: reviewEvent.reviewEventId,
                clientUpdatedAt: reviewEvent.reviewedAtClient,
                reviewEvent: reviewEvent
            )
        }
    }

    func applySyncChange(workspaceId: String, change: SyncChange) throws {
        try self.core.inTransaction {
            try self.syncApplier.applySyncChange(workspaceId: workspaceId, change: change)
        }
    }
}
