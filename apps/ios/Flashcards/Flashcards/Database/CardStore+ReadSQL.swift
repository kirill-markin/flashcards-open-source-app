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

let cardStoreIsoSecondPrefixShapeSQL: String = """
substr(due_at, 1, 19) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
"""

// TODO: migrate review queue filtering and ordering to an indexed numeric due timestamp
// so SQLite does not have to mirror Swift ISO calendar validation for due_at text.
let cardStoreIsoDateTimeComponentRangeSQL: String = """
(
    substr(due_at, 6, 2) BETWEEN '01' AND '12'
    AND substr(due_at, 9, 2) BETWEEN '01' AND '31'
    AND CAST(substr(due_at, 9, 2) AS INTEGER) <= CASE
        WHEN substr(due_at, 6, 2) IN ('01', '03', '05', '07', '08', '10', '12') THEN 31
        WHEN substr(due_at, 6, 2) IN ('04', '06', '09', '11') THEN 30
        WHEN substr(due_at, 6, 2) = '02'
            AND (
                CAST(substr(due_at, 1, 4) AS INTEGER) % 400 = 0
                OR (
                    CAST(substr(due_at, 1, 4) AS INTEGER) % 4 = 0
                    AND CAST(substr(due_at, 1, 4) AS INTEGER) % 100 != 0
                )
            ) THEN 29
        WHEN substr(due_at, 6, 2) = '02' THEN 28
        ELSE 0
    END
    AND substr(due_at, 12, 2) BETWEEN '00' AND '23'
    AND substr(due_at, 15, 2) BETWEEN '00' AND '59'
    AND substr(due_at, 18, 2) BETWEEN '00' AND '59'
)
"""

let cardStoreCanonicalDueAtSQL: String = """
(
    length(due_at) = 24
    AND due_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
    AND \(cardStoreIsoDateTimeComponentRangeSQL)
)
"""

let cardStoreSupportedIsoDueAtSQL: String = """
(
    \(cardStoreCanonicalDueAtSQL)
    OR (
        length(due_at) = 20
        AND due_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
        AND \(cardStoreIsoDateTimeComponentRangeSQL)
    )
    OR (
        length(due_at) > 21
        AND \(cardStoreIsoSecondPrefixShapeSQL)
        AND \(cardStoreIsoDateTimeComponentRangeSQL)
        AND substr(due_at, 20, 1) = '.'
        AND substr(due_at, length(due_at), 1) = 'Z'
        AND substr(due_at, 21, length(due_at) - 21) NOT GLOB '*[^0-9]*'
    )
)
"""

let cardStoreNonCanonicalSupportedIsoDueAtSQL: String = """
(
    \(cardStoreSupportedIsoDueAtSQL)
    AND NOT \(cardStoreCanonicalDueAtSQL)
)
"""

let cardStoreDueAtSortKeySQL: String = """
CASE
    WHEN due_at IS NULL THEN NULL
    WHEN length(due_at) = 20
        AND due_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
        THEN substr(due_at, 1, 19) || '.000Z'
    WHEN \(cardStoreSupportedIsoDueAtSQL)
        THEN substr(due_at, 1, 20) || substr(substr(due_at, 21, length(due_at) - 21) || '000', 1, 3) || 'Z'
    ELSE NULL
END
"""

let cardStoreActiveReviewDueEligibilitySQL: String = """
(
    due_at IS NULL
    OR (
        due_at IS NOT NULL
        AND \(cardStoreSupportedIsoDueAtSQL)
        AND \(cardStoreDueAtSortKeySQL) <= ?
    )
)
"""

let cardStoreActiveDueBucketOrderSQL: String = "due_at ASC, created_at DESC, card_id ASC"

private enum ActiveReviewQueueSQLBucket {
    case recentDue(cutoff: String, now: String, lowerBound: String, upperBound: String)
    case oldDue(cutoff: String, upperBound: String)
    case new
}

private func makeIsoTimestampSecondPrefix(date: Date) -> String {
    String(formatIsoTimestamp(date: date).prefix(19))
}

private func makeIsoTimestampSecondUpperBound(date: Date) -> String {
    "\(makeIsoTimestampSecondPrefix(date: date))Z"
}

private func makeActiveReviewQueueCanonicalBucketSQL(bucket: ActiveReviewQueueSQLBucket) -> ReviewQuerySQL {
    switch bucket {
    case .recentDue(let cutoff, let now, _, _):
        return ReviewQuerySQL(
            clause: """
             AND due_at IS NOT NULL
             AND \(cardStoreCanonicalDueAtSQL)
             AND due_at >= ?
             AND due_at <= ?
            """,
            values: [
                .text(cutoff),
                .text(now)
            ]
        )
    case .oldDue(let cutoff, _):
        return ReviewQuerySQL(
            clause: """
             AND due_at IS NOT NULL
             AND \(cardStoreCanonicalDueAtSQL)
             AND due_at < ?
            """,
            values: [.text(cutoff)]
        )
    case .new:
        return ReviewQuerySQL(
            clause: " AND due_at IS NULL",
            values: []
        )
    }
}

private func makeActiveReviewQueueNonCanonicalCandidateUpperSortKey(
    canonicalRows: [Card],
    limit: Int
) -> String? {
    guard canonicalRows.count == limit else {
        return nil
    }

    return canonicalRows.last?.dueAt
}

private func makeActiveReviewQueueNonCanonicalBucketSQL(
    bucket: ActiveReviewQueueSQLBucket,
    candidateUpperSortKey: String?
) -> ReviewQuerySQL? {
    let candidateUpperSortKeyClause: String
    let candidateUpperSortKeyValues: [SQLiteValue]
    if let candidateUpperSortKey {
        candidateUpperSortKeyClause = """

             AND \(cardStoreDueAtSortKeySQL) <= ?
        """
        candidateUpperSortKeyValues = [.text(candidateUpperSortKey)]
    } else {
        candidateUpperSortKeyClause = ""
        candidateUpperSortKeyValues = []
    }

    switch bucket {
    case .recentDue(let cutoff, let now, let lowerBound, let upperBound):
        return ReviewQuerySQL(
            clause: """
             AND due_at IS NOT NULL
             AND \(cardStoreNonCanonicalSupportedIsoDueAtSQL)
             AND due_at >= ?
             AND due_at <= ?
             AND \(cardStoreDueAtSortKeySQL) >= ?
             AND \(cardStoreDueAtSortKeySQL) <= ?\(candidateUpperSortKeyClause)
            """,
            values: [
                .text(lowerBound),
                .text(upperBound),
                .text(cutoff),
                .text(now)
            ] + candidateUpperSortKeyValues
        )
    case .oldDue(let cutoff, let upperBound):
        return ReviewQuerySQL(
            clause: """
             AND due_at IS NOT NULL
             AND \(cardStoreNonCanonicalSupportedIsoDueAtSQL)
             AND due_at <= ?
             AND \(cardStoreDueAtSortKeySQL) < ?\(candidateUpperSortKeyClause)
            """,
            values: [
                .text(upperBound),
                .text(cutoff)
            ] + candidateUpperSortKeyValues
        )
    case .new:
        return nil
    }
}

private func makeActiveReviewQueueCanonicalBucketOrderSQL(bucket: ActiveReviewQueueSQLBucket) -> String {
    switch bucket {
    case .recentDue, .oldDue:
        return cardStoreActiveDueBucketOrderSQL
    case .new:
        return "created_at DESC, card_id ASC"
    }
}

private func makeActiveReviewQueueNonCanonicalBucketOrderSQL() -> String {
    "\(cardStoreDueAtSortKeySQL) ASC, created_at DESC, card_id ASC"
}

private func shouldLoadNonCanonicalActiveBucketRows(bucket: ActiveReviewQueueSQLBucket) -> Bool {
    switch bucket {
    case .recentDue, .oldDue:
        return true
    case .new:
        return false
    }
}

private func mergeActiveReviewQueueDueBucketRows(
    canonicalRows: [Card],
    nonCanonicalRows: [Card],
    now: Date,
    limit: Int
) -> [Card] {
    guard nonCanonicalRows.isEmpty == false else {
        return canonicalRows
    }

    let sortedRows = (canonicalRows + nonCanonicalRows).sorted { leftCard, rightCard in
        compareCardsForReviewOrder(leftCard: leftCard, rightCard: rightCard, now: now)
    }

    return Array(sortedRows.prefix(limit))
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
        let nowText = formatIsoTimestamp(date: now)
        let cutoffText = formatIsoTimestamp(date: now.addingTimeInterval(-recentDuePriorityWindow))
        var rows: [Card] = []

        for bucket in [
            ActiveReviewQueueSQLBucket.recentDue(
                cutoff: cutoffText,
                now: nowText,
                lowerBound: makeIsoTimestampSecondPrefix(date: now.addingTimeInterval(-recentDuePriorityWindow)),
                upperBound: makeIsoTimestampSecondUpperBound(date: now)
            ),
            ActiveReviewQueueSQLBucket.oldDue(
                cutoff: cutoffText,
                upperBound: makeIsoTimestampSecondUpperBound(date: now.addingTimeInterval(-recentDuePriorityWindow))
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
                now: now,
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
        now: Date,
        limit: Int
    ) throws -> [Card] {
        let canonicalBucketSQL = makeActiveReviewQueueCanonicalBucketSQL(bucket: bucket)
        let canonicalRows = try self.loadActiveReviewQueueRowsMatchingBucketSQL(
            workspaceId: workspaceId,
            querySQL: querySQL,
            excludedCardIdsClause: excludedCardIdsClause,
            excludedCardValues: excludedCardValues,
            bucketSQL: canonicalBucketSQL,
            orderSQL: makeActiveReviewQueueCanonicalBucketOrderSQL(bucket: bucket),
            limit: limit
        )

        guard shouldLoadNonCanonicalActiveBucketRows(bucket: bucket) else {
            return canonicalRows
        }

        let nonCanonicalCandidateUpperSortKey = makeActiveReviewQueueNonCanonicalCandidateUpperSortKey(
            canonicalRows: canonicalRows,
            limit: limit
        )
        guard let nonCanonicalBucketSQL = makeActiveReviewQueueNonCanonicalBucketSQL(
            bucket: bucket,
            candidateUpperSortKey: nonCanonicalCandidateUpperSortKey
        ) else {
            return canonicalRows
        }

        let nonCanonicalRows = try self.loadActiveReviewQueueRowsMatchingBucketSQL(
            workspaceId: workspaceId,
            querySQL: querySQL,
            excludedCardIdsClause: excludedCardIdsClause,
            excludedCardValues: excludedCardValues,
            bucketSQL: nonCanonicalBucketSQL,
            orderSQL: makeActiveReviewQueueNonCanonicalBucketOrderSQL(),
            limit: limit
        )

        return mergeActiveReviewQueueDueBucketRows(
            canonicalRows: canonicalRows,
            nonCanonicalRows: nonCanonicalRows,
            now: now,
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
