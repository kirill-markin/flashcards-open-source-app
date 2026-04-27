import Foundation

private let publicSyncConflictReIdMaxAttempts: Int = 5

struct PublicSyncConflictRepairer {
    let core: DatabaseCore
    let outboxRewriter: WorkspaceOutboxRewriter

    static func validateRecoverable(syncConflict: CloudSyncConflictDetails) throws {
        guard syncConflict.recoverable else {
            throw LocalStoreError.validation(
                "Public sync conflict is not recoverable for \(syncConflict.entityType.rawValue) \(syncConflict.entityId)"
            )
        }
    }

    func repairLocalIdForPublicSyncConflict(
        workspaceId: String,
        syncConflict: CloudSyncConflictDetails
    ) throws -> PublicSyncConflictReIdRecovery {
        try Self.validateRecoverable(syncConflict: syncConflict)

        let replacementEntityId: String = try self.makeFreshPublicSyncConflictEntityId(
            entityType: syncConflict.entityType
        )

        switch syncConflict.entityType {
        case .card:
            try self.rewriteLocalCardIdForPublicSyncConflict(
                workspaceId: workspaceId,
                sourceCardId: syncConflict.entityId,
                replacementCardId: replacementEntityId
            )
        case .deck:
            try self.rewriteLocalDeckIdForPublicSyncConflict(
                workspaceId: workspaceId,
                sourceDeckId: syncConflict.entityId,
                replacementDeckId: replacementEntityId
            )
        case .reviewEvent:
            try self.rewriteLocalReviewEventIdForPublicSyncConflict(
                workspaceId: workspaceId,
                sourceReviewEventId: syncConflict.entityId,
                replacementReviewEventId: replacementEntityId
            )
        case .workspaceSchedulerSettings:
            throw LocalStoreError.validation(
                "Public sync conflict recovery cannot re-id workspace scheduler settings for workspace \(workspaceId)"
            )
        }

        return PublicSyncConflictReIdRecovery(
            entityType: syncConflict.entityType,
            sourceEntityId: syncConflict.entityId,
            replacementEntityId: replacementEntityId
        )
    }

    private func makeFreshPublicSyncConflictEntityId(entityType: SyncEntityType) throws -> String {
        var attemptIndex: Int = 0
        while attemptIndex < publicSyncConflictReIdMaxAttempts {
            let candidateId: String = UUID().uuidString.lowercased()
            if try self.publicSyncConflictEntityExists(entityType: entityType, entityId: candidateId) == false {
                return candidateId
            }

            attemptIndex += 1
        }

        throw LocalStoreError.database(
            "Failed to generate a fresh local id for \(entityType.rawValue) after \(publicSyncConflictReIdMaxAttempts) attempts"
        )
    }

    private func publicSyncConflictEntityExists(entityType: SyncEntityType, entityId: String) throws -> Bool {
        switch entityType {
        case .card:
            return try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM cards WHERE card_id = ?",
                values: [.text(entityId)]
            ) > 0
        case .deck:
            return try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM decks WHERE deck_id = ?",
                values: [.text(entityId)]
            ) > 0
        case .reviewEvent:
            return try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM review_events WHERE review_event_id = ?",
                values: [.text(entityId)]
            ) > 0
        case .workspaceSchedulerSettings:
            return try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM workspaces WHERE workspace_id = ?",
                values: [.text(entityId)]
            ) > 0
        }
    }

    private func rewriteLocalCardIdForPublicSyncConflict(
        workspaceId: String,
        sourceCardId: String,
        replacementCardId: String
    ) throws {
        let insertedRows: Int = try self.core.execute(
            sql: """
            INSERT INTO cards (
                card_id,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                created_at,
                reps,
                lapses,
                fsrs_card_state,
                fsrs_step_index,
                fsrs_stability,
                fsrs_difficulty,
                fsrs_last_reviewed_at,
                fsrs_scheduled_days,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            )
            SELECT
                ?,
                workspace_id,
                front_text,
                back_text,
                tags_json,
                effort_level,
                due_at,
                created_at,
                reps,
                lapses,
                fsrs_card_state,
                fsrs_step_index,
                fsrs_stability,
                fsrs_difficulty,
                fsrs_last_reviewed_at,
                fsrs_scheduled_days,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            FROM cards
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text(replacementCardId),
                .text(workspaceId),
                .text(sourceCardId)
            ]
        )
        guard insertedRows == 1 else {
            throw LocalStoreError.database(
                "Public sync conflict recovery could not find local card \(sourceCardId) in workspace \(workspaceId)"
            )
        }

        _ = try self.core.execute(
            sql: """
            UPDATE card_tags
            SET card_id = ?
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text(replacementCardId),
                .text(workspaceId),
                .text(sourceCardId)
            ]
        )
        _ = try self.core.execute(
            sql: """
            UPDATE review_events
            SET card_id = ?
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text(replacementCardId),
                .text(workspaceId),
                .text(sourceCardId)
            ]
        )
        try self.outboxRewriter.rewriteOutboxForCardPublicSyncConflict(
            workspaceId: workspaceId,
            sourceCardId: sourceCardId,
            replacementCardId: replacementCardId
        )

        let deletedRows: Int = try self.core.execute(
            sql: "DELETE FROM cards WHERE workspace_id = ? AND card_id = ?",
            values: [
                .text(workspaceId),
                .text(sourceCardId)
            ]
        )
        guard deletedRows == 1 else {
            throw LocalStoreError.database(
                "Public sync conflict recovery could not remove source card \(sourceCardId) in workspace \(workspaceId)"
            )
        }
    }

    private func rewriteLocalDeckIdForPublicSyncConflict(
        workspaceId: String,
        sourceDeckId: String,
        replacementDeckId: String
    ) throws {
        let insertedRows: Int = try self.core.execute(
            sql: """
            INSERT INTO decks (
                deck_id,
                workspace_id,
                name,
                filter_definition_json,
                created_at,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            )
            SELECT
                ?,
                workspace_id,
                name,
                filter_definition_json,
                created_at,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            FROM decks
            WHERE workspace_id = ? AND deck_id = ?
            """,
            values: [
                .text(replacementDeckId),
                .text(workspaceId),
                .text(sourceDeckId)
            ]
        )
        guard insertedRows == 1 else {
            throw LocalStoreError.database(
                "Public sync conflict recovery could not find local deck \(sourceDeckId) in workspace \(workspaceId)"
            )
        }

        try self.outboxRewriter.rewriteOutboxForDeckPublicSyncConflict(
            workspaceId: workspaceId,
            sourceDeckId: sourceDeckId,
            replacementDeckId: replacementDeckId
        )

        let deletedRows: Int = try self.core.execute(
            sql: "DELETE FROM decks WHERE workspace_id = ? AND deck_id = ?",
            values: [
                .text(workspaceId),
                .text(sourceDeckId)
            ]
        )
        guard deletedRows == 1 else {
            throw LocalStoreError.database(
                "Public sync conflict recovery could not remove source deck \(sourceDeckId) in workspace \(workspaceId)"
            )
        }
    }

    private func rewriteLocalReviewEventIdForPublicSyncConflict(
        workspaceId: String,
        sourceReviewEventId: String,
        replacementReviewEventId: String
    ) throws {
        let updatedRows: Int = try self.core.execute(
            sql: """
            UPDATE review_events
            SET review_event_id = ?
            WHERE workspace_id = ? AND review_event_id = ?
            """,
            values: [
                .text(replacementReviewEventId),
                .text(workspaceId),
                .text(sourceReviewEventId)
            ]
        )
        guard updatedRows == 1 else {
            throw LocalStoreError.database(
                "Public sync conflict recovery could not find local review_event \(sourceReviewEventId) in workspace \(workspaceId)"
            )
        }

        try self.outboxRewriter.rewriteOutboxForReviewEventPublicSyncConflict(
            workspaceId: workspaceId,
            sourceReviewEventId: sourceReviewEventId,
            replacementReviewEventId: replacementReviewEventId
        )
    }
}
