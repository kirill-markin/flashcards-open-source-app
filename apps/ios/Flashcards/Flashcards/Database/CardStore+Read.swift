import Foundation

extension CardStore {
    func loadCards(workspaceId: String) throws -> [Card] {
        let cards = try self.core.query(
            sql: """
            SELECT
            \(cardStoreSelectColumnsSQL)
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC, card_id ASC
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

    func loadActiveCardCount(workspaceId: String) throws -> Int {
        let counts = try self.core.query(
            sql: """
            SELECT COUNT(*)
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL
            """,
            values: [.text(workspaceId)]
        ) { statement in
            Int(DatabaseCore.columnInt64(statement: statement, index: 0))
        }

        return counts.first ?? 0
    }

    func loadCardsIncludingDeleted(workspaceId: String) throws -> [Card] {
        try self.core.query(
            sql: """
            SELECT
            \(cardStoreSelectColumnsSQL)
            FROM cards
            WHERE workspace_id = ?
            ORDER BY created_at DESC, card_id ASC
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
            \(cardStoreSelectColumnsSQL)
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
            \(cardStoreSelectColumnsSQL)
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
            \(cardStoreSelectColumnsSQL)
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
            SELECT review_event_id, workspace_id, card_id, replica_id, client_event_id, rating, reviewed_at_client, reviewed_at_server
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
                replicaId: DatabaseCore.columnText(statement: statement, index: 3),
                clientEventId: DatabaseCore.columnText(statement: statement, index: 4),
                rating: rating,
                reviewedAtClient: DatabaseCore.columnText(statement: statement, index: 6),
                reviewedAtServer: DatabaseCore.columnText(statement: statement, index: 7)
            )
        }
    }

    func hasAppWideReviewEvent(start: Date, end: Date) throws -> Bool {
        try self.core.scalarInt(
            sql: """
            SELECT EXISTS(
                SELECT 1
                FROM review_events
                WHERE reviewed_at_client >= ? AND reviewed_at_client < ?
            )
            """,
            values: [
                .text(formatIsoTimestamp(date: start)),
                .text(formatIsoTimestamp(date: end))
            ]
        ) == 1
    }

    func loadReviewCounts(
        workspaceId: String,
        reviewQueryDefinition: ReviewQueryDefinition,
        now: Date
    ) throws -> ReviewCounts {
        let querySQL = try self.makeReviewQuerySQL(reviewQueryDefinition: reviewQueryDefinition)

        let counts = try self.core.query(
            sql: """
            SELECT
                COUNT(*) AS total_count,
                COALESCE(
                    SUM(
                        CASE
                            WHEN due_at IS NULL OR due_at <= ? THEN 1
                            ELSE 0
                        END
                    ),
                    0
                ) AS due_count
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL\(querySQL.clause)
            """,
            values: [.text(formatIsoTimestamp(date: now)), .text(workspaceId)] + querySQL.values
        ) { statement in
            ReviewCounts(
                dueCount: Int(DatabaseCore.columnInt64(statement: statement, index: 1)),
                totalCount: Int(DatabaseCore.columnInt64(statement: statement, index: 0))
            )
        }

        guard let reviewCounts = counts.first else {
            throw LocalStoreError.database("Expected review counts query to return one row")
        }

        return reviewCounts
    }

    /**
     Loads the first review queue page directly from SQLite so the review tab
     can show the first card without hydrating all cards in memory.
     */
    func loadReviewHead(
        workspaceId: String,
        resolvedReviewFilter: ReviewFilter,
        reviewQueryDefinition: ReviewQueryDefinition,
        now: Date,
        limit: Int
    ) throws -> ReviewHeadLoadState {
        precondition(limit > 0, "Review head limit must be greater than zero")

        let pageRows = try self.loadReviewQueueRows(
            workspaceId: workspaceId,
            reviewQueryDefinition: reviewQueryDefinition,
            now: now,
            limit: limit,
            excludedCardIds: []
        )

        return ReviewHeadLoadState(
            resolvedReviewFilter: resolvedReviewFilter,
            seedReviewQueue: Array(pageRows.prefix(limit)),
            hasMoreCards: pageRows.count > limit
        )
    }

    /**
     Loads the next review queue chunk while excluding cards that are already
     present in the in-memory review queue.
     */
    func loadReviewQueueChunk(
        workspaceId: String,
        reviewQueryDefinition: ReviewQueryDefinition,
        now: Date,
        limit: Int,
        excludedCardIds: Set<String>
    ) throws -> ReviewQueueChunkLoadState {
        precondition(limit > 0, "Review queue chunk limit must be greater than zero")

        let pageRows = try self.loadReviewQueueRows(
            workspaceId: workspaceId,
            reviewQueryDefinition: reviewQueryDefinition,
            now: now,
            limit: limit,
            excludedCardIds: excludedCardIds
        )

        return ReviewQueueChunkLoadState(
            reviewQueueChunk: Array(pageRows.prefix(limit)),
            hasMoreCards: pageRows.count > limit
        )
    }

    func loadReviewTimelinePage(
        workspaceId: String,
        reviewQueryDefinition: ReviewQueryDefinition,
        now: Date,
        limit: Int,
        offset: Int
    ) throws -> ReviewTimelinePage {
        precondition(limit > 0, "Review timeline page limit must be greater than zero")
        precondition(offset >= 0, "Review timeline page offset must not be negative")

        let querySQL = try self.makeReviewQuerySQL(reviewQueryDefinition: reviewQueryDefinition)
        let pageRows = try self.core.query(
            sql: """
            SELECT
            \(cardStoreSelectColumnsSQL)
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL\(querySQL.clause)
            ORDER BY
                CASE
                    WHEN due_at <= ? THEN 0
                    WHEN due_at IS NULL THEN 1
                    ELSE 2
                END ASC,
                due_at ASC,
                created_at DESC,
                card_id ASC
            LIMIT ? OFFSET ?
            """,
            values: [.text(workspaceId)] + querySQL.values + [
                .text(formatIsoTimestamp(date: now)),
                .integer(Int64(limit + 1)),
                .integer(Int64(offset))
            ]
        ) { statement in
            try self.mapCard(statement: statement)
        }

        return ReviewTimelinePage(
            cards: Array(pageRows.prefix(limit)),
            hasMoreCards: pageRows.count > limit
        )
    }

    /**
     Loads the current cards screen snapshot directly from SQLite so the UI can
     search and filter without hydrating the full workspace into memory first.
     */
    func loadCardsListSnapshot(
        workspaceId: String,
        searchText: String,
        filter: CardFilter?
    ) throws -> CardsListSnapshot {
        let querySQL = try self.makeCardsListQuerySQL(searchText: searchText, filter: filter)
        let cards = try self.core.query(
            sql: """
            SELECT
            \(cardStoreSelectColumnsSQL)
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL\(querySQL.clause)
            ORDER BY updated_at DESC, card_id ASC
            """,
            values: [.text(workspaceId)] + querySQL.values
        ) { statement in
            try self.mapCard(statement: statement)
        }

        return CardsListSnapshot(
            cards: cards,
            totalCount: cards.count
        )
    }

    /**
     Returns the normalized tag counters used by settings and tag browsing
     screens without scanning all card rows in SwiftUI.
     */
    func loadWorkspaceTagsSummary(workspaceId: String) throws -> WorkspaceTagsSummary {
        let tags = try self.core.query(
            sql: """
            SELECT tag, COUNT(*) AS cards_count
            FROM card_tags
            WHERE workspace_id = ?
            GROUP BY tag
            ORDER BY tag COLLATE NOCASE ASC, tag ASC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            WorkspaceTagSummary(
                tag: DatabaseCore.columnText(statement: statement, index: 0),
                cardsCount: Int(DatabaseCore.columnInt64(statement: statement, index: 1))
            )
        }
        let totalCards = try self.core.scalarInt(
            sql: """
            SELECT COUNT(*)
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL
            """,
            values: [.text(workspaceId)]
        )

        return WorkspaceTagsSummary(tags: tags, totalCards: totalCards)
    }

    /**
     Computes deck counters inside SQLite so deck lists no longer depend on the
     eager in-memory cards snapshot.
     */
    func loadDeckCardStats(
        workspaceId: String,
        filterDefinition: DeckFilterDefinition,
        now: Date
    ) throws -> DeckCardStats {
        let querySQL = try self.makeDeckStatsQuerySQL(filterDefinition: filterDefinition)
        let rows = try self.core.query(
            sql: """
            SELECT
                COUNT(*) AS total_count,
                COALESCE(
                    SUM(
                        CASE
                            WHEN due_at IS NULL OR due_at <= ? THEN 1
                            ELSE 0
                        END
                    ),
                    0
                ) AS due_count,
                COALESCE(
                    SUM(
                        CASE
                            WHEN reps = 0 AND lapses = 0 THEN 1
                            ELSE 0
                        END
                    ),
                    0
                ) AS new_count,
                COALESCE(
                    SUM(
                        CASE
                            WHEN reps > 0 OR lapses > 0 THEN 1
                            ELSE 0
                        END
                    ),
                    0
                ) AS reviewed_count
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL\(querySQL.clause)
            """,
            values: [.text(formatIsoTimestamp(date: now)), .text(workspaceId)] + querySQL.values
        ) { statement in
            DeckCardStats(
                totalCards: Int(DatabaseCore.columnInt64(statement: statement, index: 0)),
                dueCards: Int(DatabaseCore.columnInt64(statement: statement, index: 1)),
                newCards: Int(DatabaseCore.columnInt64(statement: statement, index: 2)),
                reviewedCards: Int(DatabaseCore.columnInt64(statement: statement, index: 3))
            )
        }

        guard let deckCardStats = rows.first else {
            throw LocalStoreError.database("Expected deck stats query to return one row")
        }

        return deckCardStats
    }

    func loadWorkspaceOverviewSnapshot(
        workspaceId: String,
        workspaceName: String,
        deckCount: Int,
        now: Date
    ) throws -> WorkspaceOverviewSnapshot {
        let rows = try self.core.query(
            sql: """
            SELECT
                COUNT(*) AS total_count,
                COALESCE(
                    SUM(
                        CASE
                            WHEN due_at IS NULL OR due_at <= ? THEN 1
                            ELSE 0
                        END
                    ),
                    0
                ) AS due_count,
                COALESCE(
                    SUM(
                        CASE
                            WHEN reps = 0 AND lapses = 0 THEN 1
                            ELSE 0
                        END
                    ),
                    0
                ) AS new_count,
                COALESCE(
                    SUM(
                        CASE
                            WHEN reps > 0 OR lapses > 0 THEN 1
                            ELSE 0
                        END
                    ),
                    0
                ) AS reviewed_count
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL
            """,
            values: [.text(formatIsoTimestamp(date: now)), .text(workspaceId)]
        ) { statement in
            WorkspaceOverviewSnapshot(
                workspaceName: workspaceName,
                deckCount: deckCount,
                tagsCount: 0,
                totalCards: Int(DatabaseCore.columnInt64(statement: statement, index: 0)),
                dueCount: Int(DatabaseCore.columnInt64(statement: statement, index: 1)),
                newCount: Int(DatabaseCore.columnInt64(statement: statement, index: 2)),
                reviewedCount: Int(DatabaseCore.columnInt64(statement: statement, index: 3))
            )
        }

        guard var overview = rows.first else {
            throw LocalStoreError.database("Expected workspace overview query to return one row")
        }
        let tagsSummary = try self.loadWorkspaceTagsSummary(workspaceId: workspaceId)
        overview = WorkspaceOverviewSnapshot(
            workspaceName: overview.workspaceName,
            deckCount: overview.deckCount,
            tagsCount: tagsSummary.tags.count,
            totalCards: overview.totalCards,
            dueCount: overview.dueCount,
            newCount: overview.newCount,
            reviewedCount: overview.reviewedCount
        )
        return overview
    }

    func loadCardsMatchingDeck(
        workspaceId: String,
        filterDefinition: DeckFilterDefinition
    ) throws -> [Card] {
        let querySQL = try self.makeDeckStatsQuerySQL(filterDefinition: filterDefinition)
        return try self.core.query(
            sql: """
            SELECT
            \(cardStoreSelectColumnsSQL)
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL\(querySQL.clause)
            ORDER BY created_at DESC, card_id ASC
            """,
            values: [.text(workspaceId)] + querySQL.values
        ) { statement in
            try self.mapCard(statement: statement)
        }
    }
}
