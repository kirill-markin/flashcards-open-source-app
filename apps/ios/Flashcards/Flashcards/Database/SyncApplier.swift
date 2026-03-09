import Foundation

struct SyncApplier {
    let core: DatabaseCore

    func applySyncChange(workspaceId: String, change: SyncChange) throws {
        let cardStore = CardStore(core: self.core)
        let deckStore = DeckStore(core: self.core)
        let workspaceSettingsStore = WorkspaceSettingsStore(core: self.core)

        switch change.payload {
        case .card(let card):
            let existingCard = try cardStore.loadOptionalCardIncludingDeleted(workspaceId: workspaceId, cardId: card.cardId)
            if let existingCard, compareLwwCard(left: existingCard, right: card) > 0 {
                return
            }

            try self.upsertRemoteCard(workspaceId: workspaceId, card: card, cardStore: cardStore)
        case .deck(let deck):
            let existingDeck = try deckStore.loadOptionalDeckIncludingDeleted(workspaceId: workspaceId, deckId: deck.deckId)
            if let existingDeck, compareLwwDeck(left: existingDeck, right: deck) > 0 {
                return
            }

            try self.upsertRemoteDeck(workspaceId: workspaceId, deck: deck, deckStore: deckStore)
        case .workspaceSchedulerSettings(let settings):
            let existingSettings = try workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
            if compareLwwWorkspaceSettings(left: existingSettings, right: settings) <= 0 {
                try self.upsertRemoteWorkspaceSettings(
                    workspaceId: workspaceId,
                    settings: settings,
                    workspaceSettingsStore: workspaceSettingsStore
                )
            }
        case .reviewEvent(let reviewEvent):
            try self.insertRemoteReviewEvent(workspaceId: workspaceId, reviewEvent: reviewEvent)
        }
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

        _ = try self.core.execute(
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

        _ = try self.core.execute(
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

    private func upsertRemoteWorkspaceSettings(
        workspaceId: String,
        settings: WorkspaceSchedulerSettings,
        workspaceSettingsStore: WorkspaceSettingsStore
    ) throws {
        _ = try self.core.execute(
            sql: """
            UPDATE workspaces
            SET fsrs_algorithm = ?, fsrs_desired_retention = ?, fsrs_learning_steps_minutes_json = ?, fsrs_relearning_steps_minutes_json = ?, fsrs_maximum_interval_days = ?, fsrs_enable_fuzz = ?, fsrs_client_updated_at = ?, fsrs_last_modified_by_device_id = ?, fsrs_last_operation_id = ?, fsrs_updated_at = ?
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
                .text(settings.lastModifiedByDeviceId),
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
