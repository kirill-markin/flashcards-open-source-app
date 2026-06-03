import Foundation
@testable import Flashcards

extension ProgressStoreTestCase {
    @discardableResult
    func addNewReviewScheduleCard(
        database: LocalDatabase,
        workspaceId: String
    ) throws -> Card {
        try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
    }

    @discardableResult
    func addDueReviewScheduleCard(
        database: LocalDatabase,
        workspaceId: String,
        dueAt: Date
    ) throws -> Card {
        let card = try self.addNewReviewScheduleCard(
            database: database,
            workspaceId: workspaceId
        )
        let dueAtText = formatIsoTimestamp(date: dueAt)
        try database.core.execute(
            sql: """
            UPDATE cards
            SET due_at = ?,
                due_at_millis = ?,
                reps = 1,
                fsrs_card_state = 'review',
                fsrs_stability = 1.0,
                fsrs_difficulty = 5.0,
                fsrs_last_reviewed_at = ?,
                fsrs_last_reviewed_at_millis = ?,
                fsrs_scheduled_days = 1
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text(dueAtText),
                .integer(epochMillis(date: dueAt)),
                .text(dueAtText),
                .integer(epochMillis(date: dueAt)),
                .text(workspaceId),
                .text(card.cardId),
            ]
        )
        return card
    }

    func markReviewScheduleCardWithInvalidDueAt(
        database: LocalDatabase,
        workspaceId: String,
        cardId: String
    ) throws {
        try database.core.execute(
            sql: """
            UPDATE cards
            SET due_at = ?, due_at_millis = NULL
            WHERE workspace_id = ? AND card_id = ?
            """,
            values: [
                .text("2026-04-18T08:00:00.000Z"),
                .text(workspaceId),
                .text(cardId),
            ]
        )
    }
}
