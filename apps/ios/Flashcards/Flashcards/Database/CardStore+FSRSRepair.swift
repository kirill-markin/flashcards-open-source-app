import Foundation

extension CardStore {
    func validateOrResetLoadedCard(workspaceId: String, card: Card) throws -> Card {
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
            updatedAt: nowIsoTimestamp()
        )
        let updatedRows = try self.core.execute(
            sql: """
            UPDATE cards
            SET due_at = ?, reps = ?, lapses = ?, fsrs_card_state = ?, fsrs_step_index = ?, fsrs_stability = ?, fsrs_difficulty = ?, fsrs_last_reviewed_at = ?, fsrs_scheduled_days = ?, client_updated_at = ?, last_modified_by_replica_id = ?, last_operation_id = ?, updated_at = ?
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
                .text(repairedCard.lastModifiedByReplicaId),
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
        createdAt: card.createdAt,
        reps: 0,
        lapses: 0,
        fsrsCardState: .new,
        fsrsStepIndex: nil,
        fsrsStability: nil,
        fsrsDifficulty: nil,
        fsrsLastReviewedAt: nil,
        fsrsScheduledDays: nil,
        clientUpdatedAt: card.clientUpdatedAt,
        lastModifiedByReplicaId: card.lastModifiedByReplicaId,
        lastOperationId: card.lastOperationId,
        updatedAt: updatedAt,
        deletedAt: card.deletedAt
    )
}
