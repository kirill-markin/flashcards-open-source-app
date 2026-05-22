import Foundation

private func makeDueAtMillisSQLiteValue(dueAt: String?) -> SQLiteValue {
    guard let dueAt else {
        return .null
    }
    guard let dueAtMillis = parseStrictIsoTimestampEpochMillis(value: dueAt) else {
        return .null
    }

    return .integer(dueAtMillis)
}

struct SyncApplyResult: Hashable, Sendable {
    let didApply: Bool
    let reviewScheduleImpact: Bool

    static let skipped = SyncApplyResult(didApply: false, reviewScheduleImpact: false)
}

struct SyncApplier {
    let core: DatabaseCore

    /// Applies one hot-state bootstrap entry by merging canonical mutable state
    /// into the local mirror with the same LWW comparator as the backend.
    func applySyncBootstrapEntry(workspaceId: String, entry: SyncBootstrapEntry) throws -> SyncApplyResult {
        let cardStore = CardStore(core: self.core)
        let deckStore = DeckStore(core: self.core)
        let workspaceSettingsStore = WorkspaceSettingsStore(core: self.core)

        switch entry.payload {
        case .card(let card):
            let existingCard = try cardStore.loadOptionalCardIncludingDeleted(workspaceId: workspaceId, cardId: card.cardId)
            if let existingCard, compareLwwCard(left: existingCard, right: card) > 0 {
                return .skipped
            }

            let reviewScheduleImpact = remoteCardReviewScheduleImpact(existingCard: existingCard, remoteCard: card)
            try self.upsertRemoteCard(workspaceId: workspaceId, card: card, cardStore: cardStore)
            return SyncApplyResult(didApply: true, reviewScheduleImpact: reviewScheduleImpact)
        case .deck(let deck):
            let existingDeck = try deckStore.loadOptionalDeckIncludingDeleted(workspaceId: workspaceId, deckId: deck.deckId)
            if let existingDeck, compareLwwDeck(left: existingDeck, right: deck) > 0 {
                return .skipped
            }

            try self.upsertRemoteDeck(workspaceId: workspaceId, deck: deck, deckStore: deckStore)
            return SyncApplyResult(didApply: true, reviewScheduleImpact: false)
        case .workspaceSchedulerSettings(let settings):
            let existingSettings = try workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
            if compareLwwWorkspaceSettings(left: existingSettings, right: settings) <= 0 {
                try self.upsertRemoteWorkspaceSettings(
                    workspaceId: workspaceId,
                    settings: settings,
                    workspaceSettingsStore: workspaceSettingsStore
                )
                return SyncApplyResult(didApply: true, reviewScheduleImpact: false)
            }

            return .skipped
        }
    }

    /// Applies one hot-state delta change. Review history is intentionally
    /// excluded from this lane and handled through its own append-only flow.
    func applySyncChange(workspaceId: String, change: SyncChange) throws -> SyncApplyResult {
        let entryPayload: SyncBootstrapEntryPayload
        switch change.payload {
        case .card(let card):
            entryPayload = .card(card)
        case .deck(let deck):
            entryPayload = .deck(deck)
        case .workspaceSchedulerSettings(let settings):
            entryPayload = .workspaceSchedulerSettings(settings)
        }

        return try self.applySyncBootstrapEntry(
            workspaceId: workspaceId,
            entry: SyncBootstrapEntry(
                entityType: change.entityType,
                entityId: change.entityId,
                action: change.action,
                payload: entryPayload
            )
        )
    }

    /// Applies one immutable review-history event and ignores duplicates created
    /// by retries or cross-device imports.
    func applyReviewHistoryEvent(workspaceId: String, reviewEvent: ReviewEvent) throws {
        try self.insertRemoteReviewEvent(workspaceId: workspaceId, reviewEvent: reviewEvent)
    }

    private func upsertRemoteCard(
        workspaceId: String,
        card: Card,
        cardStore: CardStore
    ) throws {
        let tagsJson = try self.core.encodeJsonString(value: card.tags)
        let existingCard = try cardStore.loadOptionalCardIncludingDeleted(workspaceId: workspaceId, cardId: card.cardId)

        if existingCard == nil {
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
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(card.cardId),
                    .text(workspaceId),
                    .text(card.frontText),
                    .text(card.backText),
                    .text(tagsJson),
                    .text(card.effortLevel.rawValue),
                    card.dueAt.map(SQLiteValue.text) ?? .null,
                    makeDueAtMillisSQLiteValue(dueAt: card.dueAt),
                    .text(card.createdAt),
                    .integer(Int64(card.reps)),
                    .integer(Int64(card.lapses)),
                    .text(card.fsrsCardState.rawValue),
                    card.fsrsStepIndex.map { SQLiteValue.integer(Int64($0)) } ?? .null,
                    card.fsrsStability.map(SQLiteValue.real) ?? .null,
                    card.fsrsDifficulty.map(SQLiteValue.real) ?? .null,
                    card.fsrsLastReviewedAt.map(SQLiteValue.text) ?? .null,
                    card.fsrsScheduledDays.map { SQLiteValue.integer(Int64($0)) } ?? .null,
                    .text(card.clientUpdatedAt),
                    .text(card.lastModifiedByReplicaId),
                    .text(card.lastOperationId),
                    .text(card.updatedAt),
                    card.deletedAt.map(SQLiteValue.text) ?? .null
                ]
            )
            try cardStore.replaceCardTagsReadModel(
                workspaceId: workspaceId,
                cardId: card.cardId,
                tags: card.deletedAt == nil ? card.tags : []
            )
            return
        }

        _ = try self.core.execute(
            sql: """
            UPDATE cards
            SET front_text = ?, back_text = ?, tags_json = ?, effort_level = ?, due_at = ?, due_at_millis = ?, created_at = ?, reps = ?, lapses = ?, fsrs_card_state = ?, fsrs_step_index = ?, fsrs_stability = ?, fsrs_difficulty = ?, fsrs_last_reviewed_at = ?, fsrs_scheduled_days = ?, client_updated_at = ?, last_modified_by_replica_id = ?, last_operation_id = ?, updated_at = ?, deleted_at = ?
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text(card.frontText),
                .text(card.backText),
                .text(tagsJson),
                .text(card.effortLevel.rawValue),
                card.dueAt.map(SQLiteValue.text) ?? .null,
                makeDueAtMillisSQLiteValue(dueAt: card.dueAt),
                .text(card.createdAt),
                .integer(Int64(card.reps)),
                .integer(Int64(card.lapses)),
                .text(card.fsrsCardState.rawValue),
                card.fsrsStepIndex.map { SQLiteValue.integer(Int64($0)) } ?? .null,
                card.fsrsStability.map(SQLiteValue.real) ?? .null,
                card.fsrsDifficulty.map(SQLiteValue.real) ?? .null,
                card.fsrsLastReviewedAt.map(SQLiteValue.text) ?? .null,
                card.fsrsScheduledDays.map { SQLiteValue.integer(Int64($0)) } ?? .null,
                .text(card.clientUpdatedAt),
                .text(card.lastModifiedByReplicaId),
                .text(card.lastOperationId),
                .text(card.updatedAt),
                card.deletedAt.map(SQLiteValue.text) ?? .null,
                .text(workspaceId),
                .text(card.cardId)
            ]
        )
        try cardStore.replaceCardTagsReadModel(
            workspaceId: workspaceId,
            cardId: card.cardId,
            tags: card.deletedAt == nil ? card.tags : []
        )
    }

    private func upsertRemoteDeck(
        workspaceId: String,
        deck: Deck,
        deckStore: DeckStore
    ) throws {
        let filterJson = try self.core.encodeJsonString(value: deck.filterDefinition)
        let existingDeck = try deckStore.loadOptionalDeckIncludingDeleted(workspaceId: workspaceId, deckId: deck.deckId)

        if existingDeck == nil {
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
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    .text(deck.deckId),
                    .text(workspaceId),
                    .text(deck.name),
                    .text(filterJson),
                    .text(deck.createdAt),
                    .text(deck.clientUpdatedAt),
                    .text(deck.lastModifiedByReplicaId),
                    .text(deck.lastOperationId),
                    .text(deck.updatedAt),
                    deck.deletedAt.map(SQLiteValue.text) ?? .null
                ]
            )
            return
        }

        _ = try self.core.execute(
            sql: """
            UPDATE decks
            SET name = ?, filter_definition_json = ?, created_at = ?, client_updated_at = ?, last_modified_by_replica_id = ?, last_operation_id = ?, updated_at = ?, deleted_at = ?
            WHERE workspace_id = ? AND deck_id = ?
            """,
            values: [
                .text(deck.name),
                .text(filterJson),
                .text(deck.createdAt),
                .text(deck.clientUpdatedAt),
                .text(deck.lastModifiedByReplicaId),
                .text(deck.lastOperationId),
                .text(deck.updatedAt),
                deck.deletedAt.map(SQLiteValue.text) ?? .null,
                .text(workspaceId),
                .text(deck.deckId)
            ]
        )
    }

    private func upsertRemoteWorkspaceSettings(
        workspaceId: String,
        settings: WorkspaceSchedulerSettings,
        workspaceSettingsStore: WorkspaceSettingsStore
    ) throws {
        _ = try self.core.execute(
            sql: """
            UPDATE workspaces
            SET fsrs_algorithm = ?, fsrs_desired_retention = ?, fsrs_learning_steps_minutes_json = ?, fsrs_relearning_steps_minutes_json = ?, fsrs_maximum_interval_days = ?, fsrs_enable_fuzz = ?, fsrs_client_updated_at = ?, fsrs_last_modified_by_replica_id = ?, fsrs_last_operation_id = ?, fsrs_updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .text(settings.algorithm),
                .real(settings.desiredRetention),
                .text(try workspaceSettingsStore.encodeIntegerArray(values: settings.learningStepsMinutes)),
                .text(try workspaceSettingsStore.encodeIntegerArray(values: settings.relearningStepsMinutes)),
                .integer(Int64(settings.maximumIntervalDays)),
                .integer(settings.enableFuzz ? 1 : 0),
                .text(settings.clientUpdatedAt),
                .text(settings.lastModifiedByReplicaId),
                .text(settings.lastOperationId),
                .text(settings.updatedAt),
                .text(workspaceId)
            ]
        )
    }

    private func insertRemoteReviewEvent(workspaceId: String, reviewEvent: ReviewEvent) throws {
        _ = try self.core.execute(
            sql: """
            INSERT OR IGNORE INTO review_events (
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
                .text(reviewEvent.reviewEventId),
                .text(workspaceId),
                .text(reviewEvent.cardId),
                .text(reviewEvent.replicaId),
                .text(reviewEvent.clientEventId),
                .integer(Int64(reviewEvent.rating.rawValue)),
                .text(reviewEvent.reviewedAtClient),
                .text(reviewEvent.reviewedAtServer)
            ]
        )
    }
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
        leftDeviceId: left.lastModifiedByReplicaId,
        leftOperationId: left.lastOperationId,
        rightClientUpdatedAt: right.clientUpdatedAt,
        rightDeviceId: right.lastModifiedByReplicaId,
        rightOperationId: right.lastOperationId
    )
}

private func compareLwwDeck(left: Deck, right: Deck) -> Int {
    compareLwwTuple(
        leftClientUpdatedAt: left.clientUpdatedAt,
        leftDeviceId: left.lastModifiedByReplicaId,
        leftOperationId: left.lastOperationId,
        rightClientUpdatedAt: right.clientUpdatedAt,
        rightDeviceId: right.lastModifiedByReplicaId,
        rightOperationId: right.lastOperationId
    )
}

private func compareLwwWorkspaceSettings(left: WorkspaceSchedulerSettings, right: WorkspaceSchedulerSettings) -> Int {
    compareLwwTuple(
        leftClientUpdatedAt: left.clientUpdatedAt,
        leftDeviceId: left.lastModifiedByReplicaId,
        leftOperationId: left.lastOperationId,
        rightClientUpdatedAt: right.clientUpdatedAt,
        rightDeviceId: right.lastModifiedByReplicaId,
        rightOperationId: right.lastOperationId
    )
}

private func remoteCardReviewScheduleImpact(existingCard: Card?, remoteCard: Card) -> Bool {
    guard let existingCard else {
        return remoteCard.deletedAt == nil
    }

    return existingCard.dueAt != remoteCard.dueAt
        || existingCard.deletedAt != remoteCard.deletedAt
        || existingCard.reps != remoteCard.reps
        || existingCard.lapses != remoteCard.lapses
        || existingCard.fsrsCardState != remoteCard.fsrsCardState
        || existingCard.fsrsStepIndex != remoteCard.fsrsStepIndex
        || existingCard.fsrsStability != remoteCard.fsrsStability
        || existingCard.fsrsDifficulty != remoteCard.fsrsDifficulty
        || existingCard.fsrsLastReviewedAt != remoteCard.fsrsLastReviewedAt
        || existingCard.fsrsScheduledDays != remoteCard.fsrsScheduledDays
}
