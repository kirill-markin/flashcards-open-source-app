import Foundation

private struct ReviewQuerySQL {
    let clause: String
    let values: [SQLiteValue]
}

struct CardStore {
    let core: DatabaseCore

    func validateCardInput(input: CardEditorInput) throws {
        let frontText = input.frontText.trimmingCharacters(in: .whitespacesAndNewlines)

        if frontText.isEmpty {
            throw LocalStoreError.validation("Card front text must not be empty")
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
            values: [.text(isoTimestamp(date: now)), .text(workspaceId)] + querySQL.values
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
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL\(querySQL.clause)
            ORDER BY
                CASE
                    WHEN due_at IS NULL THEN 0
                    WHEN due_at <= ? THEN 1
                    ELSE 2
                END ASC,
                due_at ASC,
                created_at DESC,
                card_id ASC
            LIMIT ? OFFSET ?
            """,
            values: [.text(workspaceId)] + querySQL.values + [
                .text(isoTimestamp(date: now)),
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
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL\(querySQL.clause)
            ORDER BY created_at DESC, card_id ASC
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
            values: [.text(isoTimestamp(date: now)), .text(workspaceId)] + querySQL.values
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
            values: [.text(isoTimestamp(date: now)), .text(workspaceId)]
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
            FROM cards
            WHERE workspace_id = ? AND deleted_at IS NULL\(querySQL.clause)
            ORDER BY created_at DESC, card_id ASC
            """,
            values: [.text(workspaceId)] + querySQL.values
        ) { statement in
            try self.mapCard(statement: statement)
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
                SET front_text = ?, back_text = ?, tags_json = ?, effort_level = ?, client_updated_at = ?, last_modified_by_device_id = ?, last_operation_id = ?, updated_at = ?
                WHERE workspace_id = ? AND card_id = ? AND deleted_at IS NULL
                """,
                values: [
                    .text(normalizedInput.frontText),
                    .text(normalizedInput.backText),
                    .text(tagsJson),
                    .text(normalizedInput.effortLevel.rawValue),
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
                last_modified_by_device_id,
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
                .text(deviceId),
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
        let rawFsrsCardState = DatabaseCore.columnText(statement: statement, index: 10)
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
            createdAt: DatabaseCore.columnText(statement: statement, index: 7),
            reps: Int(DatabaseCore.columnInt64(statement: statement, index: 8)),
            lapses: Int(DatabaseCore.columnInt64(statement: statement, index: 9)),
            fsrsCardState: fsrsCardState,
            fsrsStepIndex: DatabaseCore.columnOptionalInt(statement: statement, index: 11),
            fsrsStability: DatabaseCore.columnOptionalDouble(statement: statement, index: 12),
            fsrsDifficulty: DatabaseCore.columnOptionalDouble(statement: statement, index: 13),
            fsrsLastReviewedAt: DatabaseCore.columnOptionalText(statement: statement, index: 14),
            fsrsScheduledDays: DatabaseCore.columnOptionalInt(statement: statement, index: 15),
            clientUpdatedAt: DatabaseCore.columnText(statement: statement, index: 16),
            lastModifiedByDeviceId: DatabaseCore.columnText(statement: statement, index: 17),
            lastOperationId: DatabaseCore.columnText(statement: statement, index: 18),
            updatedAt: DatabaseCore.columnText(statement: statement, index: 19),
            deletedAt: DatabaseCore.columnOptionalText(statement: statement, index: 20)
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

    private func makeReviewQuerySQL(reviewQueryDefinition: ReviewQueryDefinition) throws -> ReviewQuerySQL {
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

    private func makeCardsListQuerySQL(searchText: String, filter: CardFilter?) throws -> ReviewQuerySQL {
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

    private func makeDeckStatsQuerySQL(filterDefinition: DeckFilterDefinition) throws -> ReviewQuerySQL {
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

    private func loadReviewQueueRows(
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

        return try self.core.query(
            sql: """
            SELECT
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
                .text(isoTimestamp(date: now))
            ] + querySQL.values + excludedCardValues + [
                .text(isoTimestamp(date: now)),
                .integer(Int64(limit + 1))
            ]
        ) { statement in
            try self.mapCard(statement: statement)
        }
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
        lastModifiedByDeviceId: card.lastModifiedByDeviceId,
        lastOperationId: card.lastOperationId,
        updatedAt: updatedAt,
        deletedAt: card.deletedAt
    )
}
