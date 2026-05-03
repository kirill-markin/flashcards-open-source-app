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
    last_modified_by_replica_id,
    last_operation_id,
    updated_at,
    deleted_at
"""

let cardStoreActiveReviewDueEligibilitySQL: String = """
(
    due_at IS NULL
    OR (
        due_at IS NOT NULL
        AND due_at_millis IS NOT NULL
        AND due_at_millis <= ?
    )
)
"""

let cardStoreActiveDueBucketOrderSQL: String = "due_at_millis ASC, created_at DESC, card_id ASC"

private enum ActiveReviewQueueSQLBucket {
    case recentDue(cutoffMillis: Int64, nowMillis: Int64)
    case oldDue(cutoffMillis: Int64)
    case new
}

private func makeActiveReviewQueueBucketSQL(bucket: ActiveReviewQueueSQLBucket) -> ReviewQuerySQL {
    switch bucket {
    case .recentDue(let cutoffMillis, let nowMillis):
        return ReviewQuerySQL(
            clause: """
             AND due_at IS NOT NULL
             AND due_at_millis IS NOT NULL
             AND due_at_millis >= ?
             AND due_at_millis <= ?
            """,
            values: [
                .integer(cutoffMillis),
                .integer(nowMillis)
            ]
        )
    case .oldDue(let cutoffMillis):
        return ReviewQuerySQL(
            clause: """
             AND due_at IS NOT NULL
             AND due_at_millis IS NOT NULL
             AND due_at_millis < ?
            """,
            values: [.integer(cutoffMillis)]
        )
    case .new:
        return ReviewQuerySQL(
            clause: " AND due_at IS NULL",
            values: []
        )
    }
}

private func makeActiveReviewQueueBucketOrderSQL(bucket: ActiveReviewQueueSQLBucket) -> String {
    switch bucket {
    case .recentDue, .oldDue:
        return cardStoreActiveDueBucketOrderSQL
    case .new:
        return "created_at DESC, card_id ASC"
    }
}

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
        // - apps/ios/Flashcards/Flashcards/Review/ReviewQuerySupport.swift::compareCardsForReviewOrder
        // - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/ReviewSupport.kt::sortCardsForReviewQueue
        // - apps/web/src/appData/domain.ts::compareCardsForReviewOrder
        // Ordering contract: recent due cards within the inclusive one-hour window first, then older due cards,
        // then nil dueAt new cards. Future and malformed dueAt values are excluded from the active queue.
        // If this changes, mirror the same change across all three clients in the same change.
        let targetLimit = limit + 1
        let nowMillis = epochMillis(date: now)
        let cutoffMillis = epochMillis(date: now.addingTimeInterval(-recentDuePriorityWindow))
        var rows: [Card] = []

        for bucket in [
            ActiveReviewQueueSQLBucket.recentDue(
                cutoffMillis: cutoffMillis,
                nowMillis: nowMillis
            ),
            ActiveReviewQueueSQLBucket.oldDue(
                cutoffMillis: cutoffMillis
            ),
            ActiveReviewQueueSQLBucket.new
        ] {
            let remainingLimit = targetLimit - rows.count
            guard remainingLimit > 0 else {
                break
            }

            rows += try self.loadActiveReviewQueueBucketRows(
                workspaceId: workspaceId,
                querySQL: querySQL,
                excludedCardIdsClause: excludedCardIdsClause,
                excludedCardValues: excludedCardValues,
                bucket: bucket,
                limit: remainingLimit
            )
        }

        return rows
    }

    private func loadActiveReviewQueueBucketRows(
        workspaceId: String,
        querySQL: ReviewQuerySQL,
        excludedCardIdsClause: String,
        excludedCardValues: [SQLiteValue],
        bucket: ActiveReviewQueueSQLBucket,
        limit: Int
    ) throws -> [Card] {
        let bucketSQL = makeActiveReviewQueueBucketSQL(bucket: bucket)
        return try self.loadActiveReviewQueueRowsMatchingBucketSQL(
            workspaceId: workspaceId,
            querySQL: querySQL,
            excludedCardIdsClause: excludedCardIdsClause,
            excludedCardValues: excludedCardValues,
            bucketSQL: bucketSQL,
            orderSQL: makeActiveReviewQueueBucketOrderSQL(bucket: bucket),
            limit: limit
        )
    }

    private func loadActiveReviewQueueRowsMatchingBucketSQL(
        workspaceId: String,
        querySQL: ReviewQuerySQL,
        excludedCardIdsClause: String,
        excludedCardValues: [SQLiteValue],
        bucketSQL: ReviewQuerySQL,
        orderSQL: String,
        limit: Int
    ) throws -> [Card] {
        return try self.core.query(
            sql: """
            SELECT
            \(cardStoreSelectColumnsSQL)
            FROM cards
            WHERE workspace_id = ?
                AND deleted_at IS NULL\(bucketSQL.clause)\(querySQL.clause)\(excludedCardIdsClause)
            ORDER BY \(orderSQL)
            LIMIT ?
            """,
            values: [
                .text(workspaceId)
            ] + bucketSQL.values + querySQL.values + excludedCardValues + [
                .integer(Int64(limit))
            ]
        ) { statement in
            try self.mapCard(statement: statement)
        }
    }
}
