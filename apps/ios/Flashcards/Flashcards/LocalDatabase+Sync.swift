import Foundation

extension LocalDatabase {
    /// Loads the next FIFO outbox page for one batched push request.
    func loadOutboxEntries(workspaceId: String, limit: Int) throws -> [PersistedOutboxEntry] {
        try self.outboxStore.loadOutboxEntries(workspaceId: workspaceId, limit: limit)
    }

    func deleteOutboxEntries(operationIds: [String]) throws {
        try self.outboxStore.deleteOutboxEntries(operationIds: operationIds)
    }

    func deleteAllOutboxEntries(workspaceId: String) throws {
        try self.outboxStore.deleteAllOutboxEntries(workspaceId: workspaceId)
    }

    func clearCloudSyncState(workspaceId: String) throws {
        try self.core.inTransaction {
            try self.outboxStore.deleteAllOutboxEntries(workspaceId: workspaceId)

            let updatedRows = try self.core.execute(
                sql: """
                UPDATE sync_state
                SET
                    last_applied_hot_change_id = 0,
                    last_applied_review_sequence_id = 0,
                    has_hydrated_hot_state = 0,
                    has_hydrated_review_history = 0,
                    updated_at = ?
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

    func loadLastAppliedHotChangeId(workspaceId: String) throws -> Int64 {
        try self.outboxStore.loadLastAppliedHotChangeId(workspaceId: workspaceId)
    }

    func setLastAppliedHotChangeId(workspaceId: String, changeId: Int64) throws {
        try self.outboxStore.setLastAppliedHotChangeId(workspaceId: workspaceId, changeId: changeId)
    }

    func loadLastAppliedReviewSequenceId(workspaceId: String) throws -> Int64 {
        try self.outboxStore.loadLastAppliedReviewSequenceId(workspaceId: workspaceId)
    }

    func setLastAppliedReviewSequenceId(workspaceId: String, reviewSequenceId: Int64) throws {
        try self.outboxStore.setLastAppliedReviewSequenceId(
            workspaceId: workspaceId,
            reviewSequenceId: reviewSequenceId
        )
    }

    func hasHydratedHotState(workspaceId: String) throws -> Bool {
        try self.outboxStore.hasHydratedHotState(workspaceId: workspaceId)
    }

    func setHasHydratedHotState(workspaceId: String, hasHydratedHotState: Bool) throws {
        try self.outboxStore.setHasHydratedHotState(
            workspaceId: workspaceId,
            hasHydratedHotState: hasHydratedHotState
        )
    }

    func hasHydratedReviewHistory(workspaceId: String) throws -> Bool {
        try self.outboxStore.hasHydratedReviewHistory(workspaceId: workspaceId)
    }

    func setHasHydratedReviewHistory(workspaceId: String, hasHydratedReviewHistory: Bool) throws {
        try self.outboxStore.setHasHydratedReviewHistory(
            workspaceId: workspaceId,
            hasHydratedReviewHistory: hasHydratedReviewHistory
        )
    }

    func loadReviewEvents(workspaceId: String) throws -> [ReviewEvent] {
        try self.cardStore.loadReviewEvents(workspaceId: workspaceId)
    }

    func loadJournalMode() throws -> String {
        try self.core.scalarText(sql: "PRAGMA journal_mode;", values: [])
    }

    /// Exports the current mutable workspace winners for empty-remote bootstrap.
    func loadHotBootstrapEntries(workspaceId: String) throws -> [SyncBootstrapEntry] {
        let cards = try self.cardStore.loadCardsIncludingDeleted(workspaceId: workspaceId).map { card in
            SyncBootstrapEntry(
                entityType: .card,
                entityId: card.cardId,
                action: .upsert,
                payload: .card(card)
            )
        }
        let decks = try self.deckStore.loadDecksIncludingDeleted(workspaceId: workspaceId).map { deck in
            SyncBootstrapEntry(
                entityType: .deck,
                entityId: deck.deckId,
                action: .upsert,
                payload: .deck(deck)
            )
        }
        let schedulerSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
        let schedulerEntry = SyncBootstrapEntry(
            entityType: .workspaceSchedulerSettings,
            entityId: workspaceId,
            action: .upsert,
            payload: .workspaceSchedulerSettings(schedulerSettings)
        )

        return cards + decks + [schedulerEntry]
    }

    /// Applies one bootstrap entry from the hot current-state lane.
    func applySyncBootstrapEntry(workspaceId: String, entry: SyncBootstrapEntry) throws {
        try self.core.inTransaction {
            try self.syncApplier.applySyncBootstrapEntry(workspaceId: workspaceId, entry: entry)
        }
    }

    /// Applies one immutable review-history event from background pull/import.
    ///
    /// Review history is no longer part of hot change replay. Keep this path
    /// aligned with:
    /// - `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`
    /// - `apps/ios/Flashcards/FlashcardsTests/LocalDatabaseSyncApplicationTests.swift`
    func applyReviewHistoryEvent(workspaceId: String, reviewEvent: ReviewEvent) throws {
        try self.core.inTransaction {
            try self.syncApplier.applyReviewHistoryEvent(workspaceId: workspaceId, reviewEvent: reviewEvent)
        }
    }

    /// Applies one hot current-state change from `/sync/pull`.
    ///
    /// If you add another hot entity type here, update the pull contract in
    /// `apps/backend/src/sync.ts` and the iOS sync tests that assert hot-state
    /// application semantics.
    func applySyncChange(workspaceId: String, change: SyncChange) throws {
        try self.core.inTransaction {
            try self.syncApplier.applySyncChange(workspaceId: workspaceId, change: change)
        }
    }
}
