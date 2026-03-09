import Foundation

struct CardStore {
    let core: DatabaseCore

    func validateCardInput(input: CardEditorInput) throws {
        let frontText = input.frontText.trimmingCharacters(in: .whitespacesAndNewlines)
        let backText = input.backText.trimmingCharacters(in: .whitespacesAndNewlines)

        if frontText.isEmpty {
            throw LocalStoreError.validation("Card front text must not be empty")
        }

        if backText.isEmpty {
            throw LocalStoreError.validation("Card back text must not be empty")
        }
    }

    func loadCards(workspaceId: String) throws -> [Card] {
        let cards = try self.core.query(
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
            try self.mapCard(statement: statement)
        }

        var repairedCards: [Card] = []
        for card in cards {
            repairedCards.append(try self.validateOrResetLoadedCard(workspaceId: workspaceId, card: card))
        }

        return repairedCards
    }

    func loadCardsIncludingDeleted(workspaceId: String) throws -> [Card] {
        try self.core.query(
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

    func loadCard(workspaceId: String, cardId: String) throws -> Card {
        let cards = try self.core.query(
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

    func loadCardIncludingDeleted(workspaceId: String, cardId: String) throws -> Card {
        let cards = try self.core.query(
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

    func loadOptionalCardIncludingDeleted(workspaceId: String, cardId: String) throws -> Card? {
        let cards = try self.core.query(
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

    func loadReviewEvents(workspaceId: String) throws -> [ReviewEvent] {
        try self.core.query(
            sql: """
            SELECT review_event_id, workspace_id, card_id, device_id, client_event_id, rating, reviewed_at_client, reviewed_at_server
            FROM review_events
            WHERE workspace_id = ?
            ORDER BY reviewed_at_server DESC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            let rawRating = Int(DatabaseCore.columnInt64(statement: statement, index: 5))
            guard let rating = ReviewRating(rawValue: rawRating) else {
                throw LocalStoreError.database("Stored review rating is invalid: \(rawRating)")
            }

            return ReviewEvent(
                reviewEventId: DatabaseCore.columnText(statement: statement, index: 0),
                workspaceId: DatabaseCore.columnText(statement: statement, index: 1),
                cardId: DatabaseCore.columnText(statement: statement, index: 2),
                deviceId: DatabaseCore.columnText(statement: statement, index: 3),
                clientEventId: DatabaseCore.columnText(statement: statement, index: 4),
                rating: rating,
                reviewedAtClient: DatabaseCore.columnText(statement: statement, index: 6),
                reviewedAtServer: DatabaseCore.columnText(statement: statement, index: 7)
            )
        }
    }

    func saveCard(
        workspaceId: String,
        input: CardEditorInput,
        cardId: String?,
        deviceId: String,
        operationId: String,
        now: String
    ) throws -> Card {
        let tagsJson = try self.core.encodeJsonString(value: input.tags)

        if let cardId {
            let updatedRows = try self.core.execute(
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
                    .text(deviceId),
                    .text(operationId),
                    .text(now),
                    .text(workspaceId),
                    .text(cardId)
                ]
            )

            if updatedRows == 0 {
                throw LocalStoreError.notFound("Card not found")
            }

            return try self.loadCard(workspaceId: workspaceId, cardId: cardId)
        }

        let newCardId = UUID().uuidString.lowercased()
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
                .text(deviceId),
                .text(operationId),
                .text(now)
            ]
        )

        return try self.loadCard(workspaceId: workspaceId, cardId: newCardId)
    }

    func deleteCard(
        workspaceId: String,
        cardId: String,
        deviceId: String,
        operationId: String,
        now: String
    ) throws -> Card {
        let updatedRows = try self.core.execute(
            sql: """
            UPDATE cards
            SET deleted_at = ?, client_updated_at = ?, last_modified_by_device_id = ?, last_operation_id = ?, updated_at = ?
            WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
            """,
            values: [
                .text(now),
                .text(now),
                .text(deviceId),
                .text(operationId),
                .text(now),
                .text(workspaceId),
                .text(cardId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.notFound("Card not found")
        }

        return try self.loadCardIncludingDeleted(workspaceId: workspaceId, cardId: cardId)
    }

    func appendReviewEvent(
        workspaceId: String,
        cardId: String,
        rating: ReviewRating,
        reviewedAtClient: String,
        deviceId: String,
        reviewEventId: String,
        clientEventId: String,
        reviewedAtServer: String
    ) throws -> ReviewEvent {
        try self.core.execute(
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
                .text(cardId),
                .text(deviceId),
                .text(clientEventId),
                .integer(Int64(rating.rawValue)),
                .text(reviewedAtClient),
                .text(reviewedAtServer)
            ]
        )

        return ReviewEvent(
            reviewEventId: reviewEventId,
            workspaceId: workspaceId,
            cardId: cardId,
            deviceId: deviceId,
            clientEventId: clientEventId,
            rating: rating,
            reviewedAtClient: reviewedAtClient,
            reviewedAtServer: reviewedAtServer
        )
    }

    func applyReviewSchedule(
        workspaceId: String,
        cardId: String,
        reviewSubmission: ReviewSubmission,
        schedule: ReviewSchedule,
        deviceId: String,
        operationId: String,
        reviewedAtServer: String
    ) throws -> Card {
        let updatedRows = try self.core.execute(
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
                .text(deviceId),
                .text(operationId),
                .text(reviewedAtServer),
                .text(workspaceId),
                .text(cardId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.notFound("Card not found")
        }

        return try self.loadCard(workspaceId: workspaceId, cardId: cardId)
    }

    func mapCard(statement: OpaquePointer) throws -> Card {
        let tagsJson = DatabaseCore.columnText(statement: statement, index: 4)
        let tagsData = Data(tagsJson.utf8)
        let tags = try self.core.decoder.decode([String].self, from: tagsData)
        let rawEffortLevel = DatabaseCore.columnText(statement: statement, index: 5)
        guard let effortLevel = EffortLevel(rawValue: rawEffortLevel) else {
            throw LocalStoreError.database("Stored card effort level is invalid: \(rawEffortLevel)")
        }
        let rawFsrsCardState = DatabaseCore.columnText(statement: statement, index: 9)
        guard let fsrsCardState = FsrsCardState(rawValue: rawFsrsCardState) else {
            throw LocalStoreError.database("Stored FSRS card state is invalid: \(rawFsrsCardState)")
        }

        return Card(
            cardId: DatabaseCore.columnText(statement: statement, index: 0),
            workspaceId: DatabaseCore.columnText(statement: statement, index: 1),
            frontText: DatabaseCore.columnText(statement: statement, index: 2),
            backText: DatabaseCore.columnText(statement: statement, index: 3),
            tags: tags,
            effortLevel: effortLevel,
            dueAt: DatabaseCore.columnOptionalText(statement: statement, index: 6),
            reps: Int(DatabaseCore.columnInt64(statement: statement, index: 7)),
            lapses: Int(DatabaseCore.columnInt64(statement: statement, index: 8)),
            fsrsCardState: fsrsCardState,
            fsrsStepIndex: DatabaseCore.columnOptionalInt(statement: statement, index: 10),
            fsrsStability: DatabaseCore.columnOptionalDouble(statement: statement, index: 11),
            fsrsDifficulty: DatabaseCore.columnOptionalDouble(statement: statement, index: 12),
            fsrsLastReviewedAt: DatabaseCore.columnOptionalText(statement: statement, index: 13),
            fsrsScheduledDays: DatabaseCore.columnOptionalInt(statement: statement, index: 14),
            clientUpdatedAt: DatabaseCore.columnText(statement: statement, index: 15),
            lastModifiedByDeviceId: DatabaseCore.columnText(statement: statement, index: 16),
            lastOperationId: DatabaseCore.columnText(statement: statement, index: 17),
            updatedAt: DatabaseCore.columnText(statement: statement, index: 18),
            deletedAt: DatabaseCore.columnOptionalText(statement: statement, index: 19)
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
        let updatedRows = try self.core.execute(
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
