import Foundation

private let workspaceForkReviewEventSelectBatchSize: Int = 500

private struct WorkspaceForkReviewEventRow {
    let sourceReviewEventId: String
    let sourceCardId: String
    let replicaId: String
    let clientEventId: String
    let rating: Int64
    let reviewedAtClient: String
    let reviewedAtServer: String
}

struct WorkspaceForker {
    let core: DatabaseCore
    let workspaceSettingsStore: WorkspaceSettingsStore
    let shellStore: WorkspaceShellStore
    let outboxRewriter: WorkspaceOutboxRewriter

    func preserveLocalDataForEmptyRemoteWorkspace(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String
    ) throws {
        let localWorkspace = try self.workspaceSettingsStore.loadWorkspace()
        let currentSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: sourceWorkspaceId)
        let forkMappings = try self.loadWorkspaceForkIdMappings(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId
        )

        try self.shellStore.deleteWorkspaceIfExists(workspaceId: destinationWorkspaceId)
        try self.shellStore.insertWorkspaceFromLocalSettings(
            workspaceId: destinationWorkspaceId,
            name: localWorkspace.name,
            createdAt: localWorkspace.createdAt,
            settings: currentSettings
        )

        try self.insertForkedCards(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId,
            forkMappings: forkMappings
        )
        try self.insertForkedDecks(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId,
            forkMappings: forkMappings
        )
        try self.insertForkedCardTags(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId,
            forkMappings: forkMappings
        )
        try self.insertForkedReviewEvents(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId,
            forkMappings: forkMappings
        )
        try self.outboxRewriter.rewriteOutboxForWorkspaceFork(
            sourceWorkspaceId: sourceWorkspaceId,
            destinationWorkspaceId: destinationWorkspaceId,
            forkMappings: forkMappings
        )

        try self.shellStore.updateAccountWorkspaceReference(workspaceId: destinationWorkspaceId)
        try self.shellStore.deleteWorkspaceIfExists(workspaceId: sourceWorkspaceId)
        try self.shellStore.resetSyncState(workspaceId: destinationWorkspaceId)
    }

    func replaceLocalShellForNonEmptyRemoteWorkspace(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String
    ) throws {
        let sourceWorkspace = try self.workspaceSettingsStore.loadWorkspace()
        try self.shellStore.deleteWorkspaceIfExists(workspaceId: destinationWorkspaceId)
        try self.shellStore.insertWorkspaceShell(
            workspace: CloudWorkspaceSummary(
                workspaceId: destinationWorkspaceId,
                name: sourceWorkspace.name,
                createdAt: sourceWorkspace.createdAt,
                isSelected: true
            )
        )
        try self.shellStore.resetSyncState(workspaceId: destinationWorkspaceId)
        try self.shellStore.updateAccountWorkspaceReference(workspaceId: destinationWorkspaceId)
        try self.shellStore.deleteWorkspaceIfExists(workspaceId: sourceWorkspaceId)
    }

    private func loadWorkspaceForkIdMappings(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String
    ) throws -> WorkspaceForkIdMappings {
        let cardIds = try self.loadEntityIds(
            sql: "SELECT card_id FROM cards WHERE workspace_id = ? ORDER BY card_id ASC",
            workspaceId: sourceWorkspaceId
        )
        let deckIds = try self.loadEntityIds(
            sql: "SELECT deck_id FROM decks WHERE workspace_id = ? ORDER BY deck_id ASC",
            workspaceId: sourceWorkspaceId
        )
        let reviewEventIds = try self.loadEntityIds(
            sql: "SELECT review_event_id FROM review_events WHERE workspace_id = ? ORDER BY review_event_id ASC",
            workspaceId: sourceWorkspaceId
        )

        return WorkspaceForkIdMappings(
            cardIdsBySourceId: Dictionary(uniqueKeysWithValues: cardIds.map { cardId in
                (
                    cardId,
                    forkedCardIdForWorkspace(
                        sourceWorkspaceId: sourceWorkspaceId,
                        destinationWorkspaceId: destinationWorkspaceId,
                        sourceCardId: cardId
                    )
                )
            }),
            deckIdsBySourceId: Dictionary(uniqueKeysWithValues: deckIds.map { deckId in
                (
                    deckId,
                    forkedDeckIdForWorkspace(
                        sourceWorkspaceId: sourceWorkspaceId,
                        destinationWorkspaceId: destinationWorkspaceId,
                        sourceDeckId: deckId
                    )
                )
            }),
            reviewEventIdsBySourceId: Dictionary(uniqueKeysWithValues: reviewEventIds.map { reviewEventId in
                (
                    reviewEventId,
                    forkedReviewEventIdForWorkspace(
                        sourceWorkspaceId: sourceWorkspaceId,
                        destinationWorkspaceId: destinationWorkspaceId,
                        sourceReviewEventId: reviewEventId
                    )
                )
            })
        )
    }

    private func loadEntityIds(sql: String, workspaceId: String) throws -> [String] {
        try self.core.query(
            sql: sql,
            values: [.text(workspaceId)]
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 0)
        }
    }

    private func insertForkedCards(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String,
        forkMappings: WorkspaceForkIdMappings
    ) throws {
        for (sourceCardId, destinationCardId) in forkMappings.cardIdsBySourceId {
            try self.core.execute(
                sql: """
                INSERT INTO cards (
                    card_id,
                    workspace_id,
                    front_text,
                    back_text,
                    tags_json,
                    effort_level,
                    due_at,
                    due_at_millis,
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
                    ?,
                    front_text,
                    back_text,
                    tags_json,
                    effort_level,
                    due_at,
                    due_at_millis,
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
                    .text(destinationCardId),
                    .text(destinationWorkspaceId),
                    .text(sourceWorkspaceId),
                    .text(sourceCardId)
                ]
            )
        }
    }

    private func insertForkedDecks(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String,
        forkMappings: WorkspaceForkIdMappings
    ) throws {
        for (sourceDeckId, destinationDeckId) in forkMappings.deckIdsBySourceId {
            try self.core.execute(
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
                    ?,
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
                    .text(destinationDeckId),
                    .text(destinationWorkspaceId),
                    .text(sourceWorkspaceId),
                    .text(sourceDeckId)
                ]
            )
        }
    }

    private func insertForkedCardTags(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String,
        forkMappings: WorkspaceForkIdMappings
    ) throws {
        let cardTags = try self.core.query(
            sql: """
            SELECT card_id, tag
            FROM card_tags
            WHERE workspace_id = ?
            ORDER BY card_id ASC, tag ASC
            """,
            values: [.text(sourceWorkspaceId)]
        ) { statement in
            (
                DatabaseCore.columnText(statement: statement, index: 0),
                DatabaseCore.columnText(statement: statement, index: 1)
            )
        }

        for (sourceCardId, tag) in cardTags {
            try self.core.execute(
                sql: """
                INSERT INTO card_tags (workspace_id, card_id, tag)
                VALUES (?, ?, ?)
                """,
                values: [
                    .text(destinationWorkspaceId),
                    .text(try forkMappings.cardIdsBySourceId.requireMappedId(entityType: "card", sourceId: sourceCardId)),
                    .text(tag)
                ]
            )
        }
    }

    private func insertForkedReviewEvents(
        sourceWorkspaceId: String,
        destinationWorkspaceId: String,
        forkMappings: WorkspaceForkIdMappings
    ) throws {
        let sourceReviewEventIds: [String] = forkMappings.reviewEventIdsBySourceId.keys.sorted()
        let sourceReviewEvents: [WorkspaceForkReviewEventRow] = try self.loadWorkspaceForkReviewEvents(
            sourceWorkspaceId: sourceWorkspaceId,
            sourceReviewEventIds: sourceReviewEventIds
        )

        for sourceReviewEvent in sourceReviewEvents {
            let destinationReviewEventId: String = try forkMappings.reviewEventIdsBySourceId.requireMappedId(
                entityType: "review_event",
                sourceId: sourceReviewEvent.sourceReviewEventId
            )
            let destinationCardId: String = try forkMappings.cardIdsBySourceId.requireMappedId(
                entityType: "card",
                sourceId: sourceReviewEvent.sourceCardId
            )
            try self.core.execute(
                sql: """
                INSERT INTO review_events (
                    review_event_id,
                    workspace_id,
                    card_id,
                    replica_id,
                    client_event_id,
                    rating,
                    reviewed_at_client,
                    reviewed_at_server
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(destinationReviewEventId),
                    .text(destinationWorkspaceId),
                    .text(destinationCardId),
                    .text(sourceReviewEvent.replicaId),
                    .text(sourceReviewEvent.clientEventId),
                    .integer(sourceReviewEvent.rating),
                    .text(sourceReviewEvent.reviewedAtClient),
                    .text(sourceReviewEvent.reviewedAtServer)
                ]
            )
        }
    }

    private func loadWorkspaceForkReviewEvents(
        sourceWorkspaceId: String,
        sourceReviewEventIds: [String]
    ) throws -> [WorkspaceForkReviewEventRow] {
        guard sourceReviewEventIds.isEmpty == false else {
            return []
        }

        var rows: [WorkspaceForkReviewEventRow] = []
        var batchStartIndex: Int = 0
        while batchStartIndex < sourceReviewEventIds.count {
            let batchEndIndex: Int = min(
                batchStartIndex + workspaceForkReviewEventSelectBatchSize,
                sourceReviewEventIds.count
            )
            let batchReviewEventIds: [String] = Array(sourceReviewEventIds[batchStartIndex..<batchEndIndex])
            rows.append(contentsOf: try self.loadWorkspaceForkReviewEventBatch(
                sourceWorkspaceId: sourceWorkspaceId,
                sourceReviewEventIds: batchReviewEventIds
            ))
            batchStartIndex = batchEndIndex
        }

        return rows
    }

    private func loadWorkspaceForkReviewEventBatch(
        sourceWorkspaceId: String,
        sourceReviewEventIds: [String]
    ) throws -> [WorkspaceForkReviewEventRow] {
        guard sourceReviewEventIds.isEmpty == false else {
            return []
        }

        let placeholders: String = sourceReviewEventIds.map { _ in "?" }.joined(separator: ", ")
        let rows: [WorkspaceForkReviewEventRow] = try self.core.query(
            sql: """
            SELECT review_event_id, card_id, replica_id, client_event_id, rating, reviewed_at_client, reviewed_at_server
            FROM review_events
            WHERE workspace_id = ? AND review_event_id IN (\(placeholders))
            ORDER BY review_event_id ASC
            """,
            values: [.text(sourceWorkspaceId)] + sourceReviewEventIds.map { sourceReviewEventId in
                .text(sourceReviewEventId)
            }
        ) { statement in
            WorkspaceForkReviewEventRow(
                sourceReviewEventId: DatabaseCore.columnText(statement: statement, index: 0),
                sourceCardId: DatabaseCore.columnText(statement: statement, index: 1),
                replicaId: DatabaseCore.columnText(statement: statement, index: 2),
                clientEventId: DatabaseCore.columnText(statement: statement, index: 3),
                rating: DatabaseCore.columnInt64(statement: statement, index: 4),
                reviewedAtClient: DatabaseCore.columnText(statement: statement, index: 5),
                reviewedAtServer: DatabaseCore.columnText(statement: statement, index: 6)
            )
        }

        let loadedReviewEventIds: Set<String> = Set(rows.map(\.sourceReviewEventId))
        let missingReviewEventIds: [String] = sourceReviewEventIds.filter { sourceReviewEventId in
            loadedReviewEventIds.contains(sourceReviewEventId) == false
        }
        guard missingReviewEventIds.isEmpty else {
            throw LocalStoreError.database(
                "Workspace identity fork is missing source review_event rows: \(missingReviewEventIds.joined(separator: ", "))"
            )
        }

        return rows
    }
}
