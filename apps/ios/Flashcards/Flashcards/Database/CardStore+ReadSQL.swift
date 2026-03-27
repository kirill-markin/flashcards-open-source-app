import Foundation

let cardStoreSelectColumnsSQL: String = """
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
    last_modified_by_device_id,
    last_operation_id,
    updated_at,
    deleted_at
"""

extension CardStore {
    func makeReviewQuerySQL(reviewQueryDefinition: ReviewQueryDefinition) throws -> ReviewQuerySQL {
        switch reviewQueryDefinition {
        case .allCards:
            return ReviewQuerySQL(clause: "", values: [])
        case .tag(let tag):
            return ReviewQuerySQL(
                clause: """
                 AND EXISTS (
                    SELECT 1
                    FROM card_tags
                    WHERE card_tags.workspace_id = cards.workspace_id
                        AND card_tags.card_id = cards.card_id
                        AND card_tags.tag = ?
                )
                """,
                values: [.text(tag)]
            )
        case .deck(let filterDefinition):
            var predicates: [String] = []
            var values: [SQLiteValue] = []

            if filterDefinition.effortLevels.isEmpty == false {
                let effortPlaceholders = Array(
                    repeating: "?",
                    count: filterDefinition.effortLevels.count
                ).joined(separator: ", ")
                predicates.append("cards.effort_level IN (\(effortPlaceholders))")
                values.append(contentsOf: filterDefinition.effortLevels.map { effortLevel in
                    .text(effortLevel.rawValue)
                })
            }

            if filterDefinition.tags.isEmpty == false {
                let tagPlaceholders = Array(
                    repeating: "?",
                    count: filterDefinition.tags.count
                ).joined(separator: ", ")
                predicates.append(
                    """
                    EXISTS (
                        SELECT 1
                        FROM card_tags
                        WHERE card_tags.workspace_id = cards.workspace_id
                            AND card_tags.card_id = cards.card_id
                            AND card_tags.tag IN (\(tagPlaceholders))
                    )
                    """
                )
                values.append(contentsOf: filterDefinition.tags.map { tag in
                    .text(tag)
                })
            }

            guard predicates.isEmpty == false else {
                return ReviewQuerySQL(clause: "", values: [])
            }

            return ReviewQuerySQL(
                clause: " AND " + predicates.joined(separator: " AND "),
                values: values
            )
        }
    }

    func makeCardsListQuerySQL(searchText: String, filter: CardFilter?) throws -> ReviewQuerySQL {
        var predicates: [String] = []
        var values: [SQLiteValue] = []
        let normalizedSearchText = searchText.trimmingCharacters(in: .whitespacesAndNewlines)

        if normalizedSearchText.isEmpty == false {
            predicates.append("(LOWER(front_text) LIKE ? OR LOWER(back_text) LIKE ?)")
            let pattern = "%\(normalizedSearchText.lowercased())%"
            values.append(.text(pattern))
            values.append(.text(pattern))
        }

        if let filter, filter.effort.isEmpty == false {
            let effortPlaceholders = Array(repeating: "?", count: filter.effort.count).joined(separator: ", ")
            predicates.append("effort_level IN (\(effortPlaceholders))")
            values.append(contentsOf: filter.effort.map { effortLevel in
                .text(effortLevel.rawValue)
            })
        }

        if let filter, filter.tags.isEmpty == false {
            let tagPlaceholders = Array(repeating: "?", count: filter.tags.count).joined(separator: ", ")
            predicates.append(
                """
                EXISTS (
                    SELECT 1
                    FROM card_tags
                    WHERE card_tags.workspace_id = cards.workspace_id
                        AND card_tags.card_id = cards.card_id
                        AND card_tags.tag IN (\(tagPlaceholders))
                )
                """
            )
            values.append(contentsOf: filter.tags.map { tag in
                .text(tag)
            })
        }

        guard predicates.isEmpty == false else {
            return ReviewQuerySQL(clause: "", values: [])
        }

        return ReviewQuerySQL(
            clause: " AND " + predicates.joined(separator: " AND "),
            values: values
        )
    }

    func makeDeckStatsQuerySQL(filterDefinition: DeckFilterDefinition) throws -> ReviewQuerySQL {
        var predicates: [String] = []
        var values: [SQLiteValue] = []

        if filterDefinition.effortLevels.isEmpty == false {
            let effortPlaceholders = Array(repeating: "?", count: filterDefinition.effortLevels.count).joined(separator: ", ")
            predicates.append("effort_level IN (\(effortPlaceholders))")
            values.append(contentsOf: filterDefinition.effortLevels.map { effortLevel in
                .text(effortLevel.rawValue)
            })
        }

        if filterDefinition.tags.isEmpty == false {
            let tagPlaceholders = Array(repeating: "?", count: filterDefinition.tags.count).joined(separator: ", ")
            predicates.append(
                """
                EXISTS (
                    SELECT 1
                    FROM card_tags
                    WHERE card_tags.workspace_id = cards.workspace_id
                        AND card_tags.card_id = cards.card_id
                        AND card_tags.tag IN (\(tagPlaceholders))
                )
                """
            )
            values.append(contentsOf: filterDefinition.tags.map { tag in
                .text(tag)
            })
        }

        guard predicates.isEmpty == false else {
            return ReviewQuerySQL(clause: "", values: [])
        }

        return ReviewQuerySQL(
            clause: " AND " + predicates.joined(separator: " AND "),
            values: values
        )
    }

    func loadReviewQueueRows(
        workspaceId: String,
        reviewQueryDefinition: ReviewQueryDefinition,
        now: Date,
        limit: Int,
        excludedCardIds: Set<String>
    ) throws -> [Card] {
        let querySQL = try self.makeReviewQuerySQL(reviewQueryDefinition: reviewQueryDefinition)
        let excludedCardIdsClause: String
        let excludedCardValues: [SQLiteValue]
        if excludedCardIds.isEmpty {
            excludedCardIdsClause = ""
            excludedCardValues = []
        } else {
            let placeholders = Array(repeating: "?", count: excludedCardIds.count).joined(separator: ", ")
            excludedCardIdsClause = " AND card_id NOT IN (\(placeholders))"
            excludedCardValues = excludedCardIds.sorted().map(SQLiteValue.text)
        }

        // Keep review queue ordering aligned with:
        // - apps/ios/Flashcards/Flashcards/ReviewQuerySupport.swift::compareCardsForReviewOrder
        // - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/ReviewSupport.kt::sortCardsForReviewQueue
        // - apps/web/src/appData/domain.ts::compareCardsForReviewOrder
        // Ordering contract: due cards first, then earlier dueAt, then newer createdAt, then cardId ascending.
        // If this changes, mirror the same change across all three clients in the same change.
        return try self.core.query(
            sql: """
            SELECT
            \(cardStoreSelectColumnsSQL)
            FROM cards
            WHERE workspace_id = ?
                AND deleted_at IS NULL
                AND (due_at IS NULL OR due_at <= ?)\(querySQL.clause)\(excludedCardIdsClause)
            ORDER BY
                CASE
                    WHEN due_at IS NULL THEN 0
                    WHEN due_at <= ? THEN 1
                    ELSE 2
                END ASC,
                due_at ASC,
                created_at DESC,
                card_id ASC
            LIMIT ?
            """,
            values: [
                .text(workspaceId),
                .text(formatIsoTimestamp(date: now))
            ] + querySQL.values + excludedCardValues + [
                .text(formatIsoTimestamp(date: now)),
                .integer(Int64(limit + 1))
            ]
        ) { statement in
            try self.mapCard(statement: statement)
        }
    }
}
