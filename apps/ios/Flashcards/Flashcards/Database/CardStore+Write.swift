import Foundation

extension CardStore {
    func validateCardInput(input: CardEditorInput) throws {
        let frontText = input.frontText.trimmingCharacters(in: .whitespacesAndNewlines)

        if frontText.isEmpty {
            throw LocalStoreError.validation("Card front text must not be empty")
        }
    }

    func saveCard(
        workspaceId: String,
        input: CardEditorInput,
        cardId: String?,
        installationId: String,
        operationId: String,
        now: String
    ) throws -> Card {
        let normalizedInput = CardEditorInput(
            frontText: input.frontText.trimmingCharacters(in: .whitespacesAndNewlines),
            backText: input.backText.trimmingCharacters(in: .whitespacesAndNewlines),
            tags: input.tags,
            effortLevel: input.effortLevel
        )
        let tagsJson = try self.core.encodeJsonString(value: normalizedInput.tags)

        if let cardId {
            let updatedRows = try self.core.execute(
                sql: """
                UPDATE cards
                SET front_text = ?, back_text = ?, tags_json = ?, effort_level = ?, client_updated_at = ?, last_modified_by_replica_id = ?, last_operation_id = ?, updated_at = ?
                WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
                """,
                values: [
                    .text(normalizedInput.frontText),
                    .text(normalizedInput.backText),
                    .text(tagsJson),
                    .text(normalizedInput.effortLevel.rawValue),
                    .text(now),
                    .text(installationId),
                    .text(operationId),
                    .text(now),
                    .text(workspaceId),
                    .text(cardId)
                ]
            )

            if updatedRows == 0 {
                throw LocalStoreError.notFound("Card not found")
            }

            try self.replaceCardTagsReadModel(
                workspaceId: workspaceId,
                cardId: cardId,
                tags: normalizedInput.tags
            )

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
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 0, 'new', NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL)
            """,
            values: [
                .text(newCardId),
                .text(workspaceId),
                .text(normalizedInput.frontText),
                .text(normalizedInput.backText),
                .text(tagsJson),
                .text(normalizedInput.effortLevel.rawValue),
                .text(now),
                .text(now),
                .text(installationId),
                .text(operationId),
                .text(now)
            ]
        )
        try self.replaceCardTagsReadModel(
            workspaceId: workspaceId,
            cardId: newCardId,
            tags: normalizedInput.tags
        )

        return try self.loadCard(workspaceId: workspaceId, cardId: newCardId)
    }

    func deleteCard(
        workspaceId: String,
        cardId: String,
        installationId: String,
        operationId: String,
        now: String
    ) throws -> Card {
        let updatedRows = try self.core.execute(
            sql: """
            UPDATE cards
            SET deleted_at = ?, client_updated_at = ?, last_modified_by_replica_id = ?, last_operation_id = ?, updated_at = ?
            WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
            """,
            values: [
                .text(now),
                .text(now),
                .text(installationId),
                .text(operationId),
                .text(now),
                .text(workspaceId),
                .text(cardId)
            ]
        )

        if updatedRows == 0 {
            throw LocalStoreError.notFound("Card not found")
        }

        try self.replaceCardTagsReadModel(
            workspaceId: workspaceId,
            cardId: cardId,
            tags: []
        )

        return try self.loadCardIncludingDeleted(workspaceId: workspaceId, cardId: cardId)
    }

    func appendReviewEvent(
        workspaceId: String,
        cardId: String,
        rating: ReviewRating,
        reviewedAtClient: String,
        installationId: String,
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
                replica_id,
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
                .text(installationId),
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
            replicaId: installationId,
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
        installationId: String,
        operationId: String,
        reviewedAtServer: String
    ) throws -> Card {
        let updatedRows = try self.core.execute(
            sql: """
            UPDATE cards
            SET due_at = ?, reps = ?, lapses = ?, fsrs_card_state = ?, fsrs_step_index = ?, fsrs_stability = ?, fsrs_difficulty = ?, fsrs_last_reviewed_at = ?, fsrs_scheduled_days = ?, client_updated_at = ?, last_modified_by_replica_id = ?, last_operation_id = ?, updated_at = ?
            WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
            """,
            values: [
                .text(formatIsoTimestamp(date: schedule.dueAt)),
                .integer(Int64(schedule.reps)),
                .integer(Int64(schedule.lapses)),
                .text(schedule.fsrsCardState.rawValue),
                schedule.fsrsStepIndex.map { stepIndex in
                    SQLiteValue.integer(Int64(stepIndex))
                } ?? .null,
                .real(schedule.fsrsStability),
                .real(schedule.fsrsDifficulty),
                .text(formatIsoTimestamp(date: schedule.fsrsLastReviewedAt)),
                .integer(Int64(schedule.fsrsScheduledDays)),
                .text(reviewSubmission.reviewedAtClient),
                .text(installationId),
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

    func replaceCardTagsReadModel(
        workspaceId: String,
        cardId: String,
        tags: [String]
    ) throws {
        try self.core.execute(
            sql: """
            DELETE FROM card_tags
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [.text(workspaceId), .text(cardId)]
        )

        for tag in tags where tag.isEmpty == false {
            try self.core.execute(
                sql: """
                INSERT INTO card_tags (workspace_id, card_id, tag)
                VALUES (?, ?, ?)
                """,
                values: [.text(workspaceId), .text(cardId), .text(tag)]
            )
        }
    }
}
