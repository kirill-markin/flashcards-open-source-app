import Foundation

/**
 Local SQLite persistence mirrors the backend FSRS schema closely enough for
 offline-first scheduling. Hidden card scheduler state and the local
 workspaces row are the runtime source of truth on device.

 This file mirrors the backend scheduler-settings and review-persistence logic
 in `apps/backend/src/workspaceSchedulerSettings.ts` and
 `apps/backend/src/cards.ts`.
 If you change scheduler-state validation or review persistence here, make the
 same change in the backend mirror and update docs/fsrs-scheduling-logic.md.

 Source-of-truth docs: docs/fsrs-scheduling-logic.md
 */
final class LocalDatabase {
    let databaseURL: URL
    let core: DatabaseCore
    let cardStore: CardStore
    let deckStore: DeckStore
    let outboxStore: OutboxStore
    private let syncApplier: SyncApplier
    let workspaceSettingsStore: WorkspaceSettingsStore

    init() throws {
        let core = try DatabaseCore()
        self.databaseURL = core.databaseURL
        self.core = core
        self.cardStore = CardStore(core: core)
        self.deckStore = DeckStore(core: core)
        self.outboxStore = OutboxStore(core: core)
        self.syncApplier = SyncApplier(core: core)
        self.workspaceSettingsStore = WorkspaceSettingsStore(core: core)
    }

    init(databaseURL: URL) throws {
        let core = try DatabaseCore(databaseURL: databaseURL)
        self.databaseURL = core.databaseURL
        self.core = core
        self.cardStore = CardStore(core: core)
        self.deckStore = DeckStore(core: core)
        self.outboxStore = OutboxStore(core: core)
        self.syncApplier = SyncApplier(core: core)
        self.workspaceSettingsStore = WorkspaceSettingsStore(core: core)
    }

    func loadBootstrapSnapshot() throws -> AppBootstrapSnapshot {
        let workspace = try self.workspaceSettingsStore.loadWorkspace()
        return AppBootstrapSnapshot(
            workspace: workspace,
            userSettings: try self.workspaceSettingsStore.loadUserSettings(workspaceId: workspace.workspaceId),
            schedulerSettings: try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: workspace.workspaceId),
            cloudSettings: try self.workspaceSettingsStore.loadCloudSettings()
        )
    }

    func loadAIChatLocalContext() throws -> AIChatLocalContext {
        let bootstrapSnapshot = try self.loadBootstrapSnapshot()
        return AIChatLocalContext(
            workspace: bootstrapSnapshot.workspace,
            schedulerSettings: bootstrapSnapshot.schedulerSettings,
            totalActiveCards: try self.cardStore.loadActiveCardCount(workspaceId: bootstrapSnapshot.workspace.workspaceId)
        )
    }

    func loadActiveCards(workspaceId: String) throws -> [Card] {
        try self.cardStore.loadCards(workspaceId: workspaceId)
    }

    func loadActiveCard(workspaceId: String, cardId: String) throws -> Card {
        try self.cardStore.loadCard(workspaceId: workspaceId, cardId: cardId)
    }

    func loadActiveCardCount(workspaceId: String) throws -> Int {
        try self.cardStore.loadActiveCardCount(workspaceId: workspaceId)
    }

    func loadActiveDecks(workspaceId: String) throws -> [Deck] {
        try self.deckStore.loadDecks(workspaceId: workspaceId)
    }

    func loadResolvedReviewQuery(
        workspaceId: String,
        reviewFilter: ReviewFilter
    ) throws -> ResolvedReviewQuery {
        switch reviewFilter {
        case .allCards:
            return ResolvedReviewQuery(
                reviewFilter: .allCards,
                queryDefinition: .allCards
            )
        case .deck(let deckId):
            guard let deck = try self.loadOptionalDeck(workspaceId: workspaceId, deckId: deckId) else {
                return ResolvedReviewQuery(
                    reviewFilter: .allCards,
                    queryDefinition: .allCards
                )
            }

            return ResolvedReviewQuery(
                reviewFilter: .deck(deckId: deckId),
                queryDefinition: .deck(filterDefinition: deck.filterDefinition)
            )
        case .tag(let tag):
            return ResolvedReviewQuery(
                reviewFilter: .tag(tag: tag),
                queryDefinition: .tag(tag: tag)
            )
        }
    }

    func loadReviewCounts(
        workspaceId: String,
        reviewQueryDefinition: ReviewQueryDefinition,
        now: Date
    ) throws -> ReviewCounts {
        try self.cardStore.loadReviewCounts(
            workspaceId: workspaceId,
            reviewQueryDefinition: reviewQueryDefinition,
            now: now
        )
    }

    func loadReviewTimelinePage(
        workspaceId: String,
        reviewQueryDefinition: ReviewQueryDefinition,
        now: Date,
        limit: Int,
        offset: Int
    ) throws -> ReviewTimelinePage {
        try self.cardStore.loadReviewTimelinePage(
            workspaceId: workspaceId,
            reviewQueryDefinition: reviewQueryDefinition,
            now: now,
            limit: limit,
            offset: offset
        )
    }

    func loadReviewHead(
        workspaceId: String,
        resolvedReviewFilter: ReviewFilter,
        reviewQueryDefinition: ReviewQueryDefinition,
        now: Date,
        limit: Int
    ) throws -> ReviewHeadLoadState {
        try self.cardStore.loadReviewHead(
            workspaceId: workspaceId,
            resolvedReviewFilter: resolvedReviewFilter,
            reviewQueryDefinition: reviewQueryDefinition,
            now: now,
            limit: limit
        )
    }

    func loadReviewQueueChunk(
        workspaceId: String,
        reviewQueryDefinition: ReviewQueryDefinition,
        now: Date,
        limit: Int,
        excludedCardIds: Set<String>
    ) throws -> ReviewQueueChunkLoadState {
        try self.cardStore.loadReviewQueueChunk(
            workspaceId: workspaceId,
            reviewQueryDefinition: reviewQueryDefinition,
            now: now,
            limit: limit,
            excludedCardIds: excludedCardIds
        )
    }

    func loadCardsListSnapshot(
        workspaceId: String,
        searchText: String,
        filter: CardFilter?
    ) throws -> CardsListSnapshot {
        try self.cardStore.loadCardsListSnapshot(
            workspaceId: workspaceId,
            searchText: searchText,
            filter: filter
        )
    }

    func loadDecksListSnapshot(
        workspaceId: String,
        now: Date
    ) throws -> DecksListSnapshot {
        let decks = try self.deckStore.loadDecks(workspaceId: workspaceId)
        let allCardsStats = try self.cardStore.loadDeckCardStats(
            workspaceId: workspaceId,
            filterDefinition: DeckFilterDefinition(version: 2, effortLevels: [], tags: []),
            now: now
        )
        let deckSummaries = try decks.map { deck in
            let stats = try self.cardStore.loadDeckCardStats(
                workspaceId: workspaceId,
                filterDefinition: deck.filterDefinition,
                now: now
            )
            return DeckSummary(
                deckId: deck.deckId,
                name: deck.name,
                filterDefinition: deck.filterDefinition,
                createdAt: deck.createdAt,
                totalCards: stats.totalCards,
                dueCards: stats.dueCards,
                newCards: stats.newCards,
                reviewedCards: stats.reviewedCards
            )
        }

        return DecksListSnapshot(
            deckSummaries: deckSummaries,
            allCardsStats: allCardsStats
        )
    }

    func loadDeck(workspaceId: String, deckId: String) throws -> Deck {
        try self.deckStore.loadDeck(workspaceId: workspaceId, deckId: deckId)
    }

    func loadOptionalDeck(workspaceId: String, deckId: String) throws -> Deck? {
        let deck = try self.deckStore.loadOptionalDeckIncludingDeleted(workspaceId: workspaceId, deckId: deckId)
        guard let deck, deck.deletedAt == nil else {
            return nil
        }

        return deck
    }

    func loadWorkspaceTagsSummary(workspaceId: String) throws -> WorkspaceTagsSummary {
        try self.cardStore.loadWorkspaceTagsSummary(workspaceId: workspaceId)
    }

    func loadWorkspaceOverviewSnapshot(
        workspaceId: String,
        workspaceName: String,
        now: Date
    ) throws -> WorkspaceOverviewSnapshot {
        let deckCount = try self.deckStore.loadDecks(workspaceId: workspaceId).count
        return try self.cardStore.loadWorkspaceOverviewSnapshot(
            workspaceId: workspaceId,
            workspaceName: workspaceName,
            deckCount: deckCount,
            now: now
        )
    }

    func loadCardsMatchingDeck(
        workspaceId: String,
        filterDefinition: DeckFilterDefinition
    ) throws -> [Card] {
        try self.cardStore.loadCardsMatchingDeck(
            workspaceId: workspaceId,
            filterDefinition: filterDefinition
        )
    }

    func saveCard(workspaceId: String, input: CardEditorInput, cardId: String?) throws -> Card {
        try self.cardStore.validateCardInput(input: input)

        return try self.core.inTransaction {
            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let persistedCard = try self.cardStore.saveCard(
                workspaceId: workspaceId,
                input: input,
                cardId: cardId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                now: now
            )
            try self.outboxStore.enqueueCardUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                card: persistedCard
            )
            return persistedCard
        }
    }

    func createCards(workspaceId: String, inputs: [CardEditorInput]) throws -> [Card] {
        try self.validateCardBatchCount(count: inputs.count)
        for input in inputs {
            try self.cardStore.validateCardInput(input: input)
        }

        return try self.core.inTransaction {
            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            var createdCards: [Card] = []
            createdCards.reserveCapacity(inputs.count)

            for input in inputs {
                let operationId = UUID().uuidString.lowercased()
                let persistedCard = try self.cardStore.saveCard(
                    workspaceId: workspaceId,
                    input: input,
                    cardId: nil,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    now: now
                )
                try self.outboxStore.enqueueCardUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    clientUpdatedAt: now,
                    card: persistedCard
                )
                createdCards.append(persistedCard)
            }

            return createdCards
        }
    }

    func deleteCard(workspaceId: String, cardId: String) throws -> Card {
        return try self.core.inTransaction {
            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let deletedCard = try self.cardStore.deleteCard(
                workspaceId: workspaceId,
                cardId: cardId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                now: now
            )
            try self.outboxStore.enqueueCardUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                card: deletedCard
            )
            return deletedCard
        }
    }

    func updateCards(workspaceId: String, updates: [CardUpdateInput]) throws -> [Card] {
        try self.validateCardBatchCount(count: updates.count)
        try self.validateUniqueCardIds(cardIds: updates.map { update in
            update.cardId
        })
        for update in updates {
            try self.cardStore.validateCardInput(input: update.input)
        }

        return try self.core.inTransaction {
            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            var updatedCards: [Card] = []
            updatedCards.reserveCapacity(updates.count)

            for update in updates {
                let operationId = UUID().uuidString.lowercased()
                let persistedCard = try self.cardStore.saveCard(
                    workspaceId: workspaceId,
                    input: update.input,
                    cardId: update.cardId,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    now: now
                )
                try self.outboxStore.enqueueCardUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    clientUpdatedAt: now,
                    card: persistedCard
                )
                updatedCards.append(persistedCard)
            }

            return updatedCards
        }
    }

    func deleteCards(workspaceId: String, cardIds: [String]) throws -> BulkDeleteCardsResult {
        try self.validateCardBatchCount(count: cardIds.count)
        try self.validateUniqueCardIds(cardIds: cardIds)

        return try self.core.inTransaction {
            let now = nowIsoTimestamp()
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()

            for cardId in cardIds {
                let operationId = UUID().uuidString.lowercased()
                let deletedCard = try self.cardStore.deleteCard(
                    workspaceId: workspaceId,
                    cardId: cardId,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    now: now
                )
                try self.outboxStore.enqueueCardUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    clientUpdatedAt: now,
                    card: deletedCard
                )
            }

            return BulkDeleteCardsResult(
                deletedCardIds: cardIds,
                deletedCount: cardIds.count
            )
        }
    }

    func createDeck(workspaceId: String, input: DeckEditorInput) throws -> Deck {
        try self.deckStore.validateDeckInput(input: input)

        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let now = nowIsoTimestamp()
            let newDeck = try self.deckStore.createDeck(
                workspaceId: workspaceId,
                input: input,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                now: now
            )
            try self.outboxStore.enqueueDeckUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                deck: newDeck
            )
            return newDeck
        }
    }

    func createDecks(workspaceId: String, inputs: [DeckEditorInput]) throws -> [Deck] {
        try self.validateDeckBatchCount(count: inputs.count)
        for input in inputs {
            try self.deckStore.validateDeckInput(input: input)
        }

        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let now = nowIsoTimestamp()
            var createdDecks: [Deck] = []
            createdDecks.reserveCapacity(inputs.count)

            for input in inputs {
                let operationId = UUID().uuidString.lowercased()
                let newDeck = try self.deckStore.createDeck(
                    workspaceId: workspaceId,
                    input: input,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    now: now
                )
                try self.outboxStore.enqueueDeckUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    clientUpdatedAt: now,
                    deck: newDeck
                )
                createdDecks.append(newDeck)
            }

            return createdDecks
        }
    }

    func updateDeck(workspaceId: String, deckId: String, input: DeckEditorInput) throws -> Deck {
        try self.deckStore.validateDeckInput(input: input)

        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let now = nowIsoTimestamp()
            let updatedDeck = try self.deckStore.updateDeck(
                workspaceId: workspaceId,
                deckId: deckId,
                input: input,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                now: now
            )
            try self.outboxStore.enqueueDeckUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                deck: updatedDeck
            )
            return updatedDeck
        }
    }

    func updateDecks(workspaceId: String, updates: [DeckUpdateInput]) throws -> [Deck] {
        try self.validateDeckBatchCount(count: updates.count)
        try self.validateUniqueDeckIds(deckIds: updates.map { update in
            update.deckId
        })
        for update in updates {
            try self.deckStore.validateDeckInput(input: update.input)
        }

        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let now = nowIsoTimestamp()
            var updatedDecks: [Deck] = []
            updatedDecks.reserveCapacity(updates.count)

            for update in updates {
                let operationId = UUID().uuidString.lowercased()
                let updatedDeck = try self.deckStore.updateDeck(
                    workspaceId: workspaceId,
                    deckId: update.deckId,
                    input: update.input,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    now: now
                )
                try self.outboxStore.enqueueDeckUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    clientUpdatedAt: now,
                    deck: updatedDeck
                )
                updatedDecks.append(updatedDeck)
            }

            return updatedDecks
        }
    }

    func deleteDeck(workspaceId: String, deckId: String) throws -> Deck {
        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let now = nowIsoTimestamp()
            let deletedDeck = try self.deckStore.deleteDeck(
                workspaceId: workspaceId,
                deckId: deckId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                now: now
            )
            try self.outboxStore.enqueueDeckUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                deck: deletedDeck
            )
            return deletedDeck
        }
    }

    func deleteDecks(workspaceId: String, deckIds: [String]) throws -> BulkDeleteDecksResult {
        try self.validateDeckBatchCount(count: deckIds.count)
        try self.validateUniqueDeckIds(deckIds: deckIds)

        return try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let now = nowIsoTimestamp()

            for deckId in deckIds {
                let operationId = UUID().uuidString.lowercased()
                let deletedDeck = try self.deckStore.deleteDeck(
                    workspaceId: workspaceId,
                    deckId: deckId,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    now: now
                )
                try self.outboxStore.enqueueDeckUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: operationId,
                    clientUpdatedAt: now,
                    deck: deletedDeck
                )
            }

            return BulkDeleteDecksResult(
                deletedDeckIds: deckIds,
                deletedCount: deckIds.count
            )
        }
    }

    // Keep in sync with apps/backend/src/cards.ts::submitReview.
    func submitReview(workspaceId: String, reviewSubmission: ReviewSubmission) throws -> Card {
        return try self.core.inTransaction {
            let card = try self.cardStore.loadCard(workspaceId: workspaceId, cardId: reviewSubmission.cardId)
            let schedulerSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
            guard let reviewedAtClient = parseIsoTimestamp(value: reviewSubmission.reviewedAtClient) else {
                throw LocalStoreError.validation("reviewedAtClient must be a valid ISO timestamp")
            }
            let schedule = try computeReviewSchedule(
                card: card,
                settings: schedulerSettings,
                rating: reviewSubmission.rating,
                now: reviewedAtClient
            )
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let reviewEventOperationId = UUID().uuidString.lowercased()
            let cardOperationId = UUID().uuidString.lowercased()
            let reviewEventId = UUID().uuidString.lowercased()
            let clientEventId = UUID().uuidString.lowercased()
            let reviewedAtServer = nowIsoTimestamp()

            let reviewEvent = try self.cardStore.appendReviewEvent(
                workspaceId: workspaceId,
                cardId: reviewSubmission.cardId,
                rating: reviewSubmission.rating,
                reviewedAtClient: reviewSubmission.reviewedAtClient,
                deviceId: cloudSettings.deviceId,
                reviewEventId: reviewEventId,
                clientEventId: clientEventId,
                reviewedAtServer: reviewedAtServer
            )

            let updatedCard = try self.cardStore.applyReviewSchedule(
                workspaceId: workspaceId,
                cardId: reviewSubmission.cardId,
                reviewSubmission: reviewSubmission,
                schedule: schedule,
                deviceId: cloudSettings.deviceId,
                operationId: cardOperationId,
                reviewedAtServer: reviewedAtServer
            )

            try self.outboxStore.enqueueReviewEventAppendOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: reviewEventOperationId,
                clientUpdatedAt: reviewSubmission.reviewedAtClient,
                reviewEvent: reviewEvent
            )

            try self.outboxStore.enqueueCardUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: cardOperationId,
                clientUpdatedAt: reviewSubmission.reviewedAtClient,
                card: updatedCard
            )
            return updatedCard
        }
    }

    // Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::updateWorkspaceSchedulerSettings.
    func updateWorkspaceSchedulerSettings(
        workspaceId: String,
        desiredRetention: Double,
        learningStepsMinutes: [Int],
        relearningStepsMinutes: [Int],
        maximumIntervalDays: Int,
        enableFuzz: Bool
    ) throws {
        try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            let operationId = UUID().uuidString.lowercased()
            let now = nowIsoTimestamp()
            let updatedSettings = try self.workspaceSettingsStore.updateWorkspaceSchedulerSettings(
                workspaceId: workspaceId,
                desiredRetention: desiredRetention,
                learningStepsMinutes: learningStepsMinutes,
                relearningStepsMinutes: relearningStepsMinutes,
                maximumIntervalDays: maximumIntervalDays,
                enableFuzz: enableFuzz,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                now: now
            )
            try self.outboxStore.enqueueWorkspaceSchedulerSettingsUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: operationId,
                clientUpdatedAt: now,
                settings: updatedSettings
            )
        }
    }

    func updateCloudSettings(
        cloudState: CloudAccountState,
        linkedUserId: String?,
        linkedWorkspaceId: String?,
        linkedEmail: String?
    ) throws {
        try self.workspaceSettingsStore.updateCloudSettings(
            cloudState: cloudState,
            linkedUserId: linkedUserId,
            linkedWorkspaceId: linkedWorkspaceId,
            linkedEmail: linkedEmail
        )
    }

    func updateWorkspaceName(workspaceId: String, name: String) throws -> Workspace {
        try self.workspaceSettingsStore.updateWorkspaceName(workspaceId: workspaceId, name: name)
    }

    func loadOutboxEntries(workspaceId: String, limit: Int) throws -> [PersistedOutboxEntry] {
        try self.outboxStore.loadOutboxEntries(workspaceId: workspaceId, limit: limit)
    }

    func deleteOutboxEntries(operationIds: [String]) throws {
        try self.outboxStore.deleteOutboxEntries(operationIds: operationIds)
    }

    func clearCloudSyncState(workspaceId: String) throws {
        try self.core.inTransaction {
            _ = try self.core.execute(
                sql: "DELETE FROM outbox WHERE workspace_id = ?",
                values: [.text(workspaceId)]
            )

            let updatedRows = try self.core.execute(
                sql: """
                UPDATE sync_state
                SET last_applied_change_id = 0, updated_at = ?
                WHERE workspace_id = ?
                """,
                values: [
                    .text(nowIsoTimestamp()),
                    .text(workspaceId)
                ]
            )

            if updatedRows == 0 {
                try self.core.execute(
                    sql: """
                    INSERT INTO sync_state (workspace_id, last_applied_change_id, updated_at)
                    VALUES (?, 0, ?)
                    """,
                    values: [
                        .text(workspaceId),
                        .text(nowIsoTimestamp())
                    ]
                )
            }
        }
    }

    func deleteStaleReviewEventOutboxEntries(workspaceId: String) throws -> Int {
        try self.core.inTransaction {
            let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
            return try self.outboxStore.deleteStaleReviewEventOutboxEntries(
                workspaceId: workspaceId,
                currentDeviceId: cloudSettings.deviceId
            )
        }
    }

    func markOutboxEntriesFailed(operationIds: [String], message: String) throws {
        try self.outboxStore.markOutboxEntriesFailed(operationIds: operationIds, message: message)
    }

    func loadLastAppliedChangeId(workspaceId: String) throws -> Int64 {
        try self.outboxStore.loadLastAppliedChangeId(workspaceId: workspaceId)
    }

    func setLastAppliedChangeId(workspaceId: String, changeId: Int64) throws {
        try self.outboxStore.setLastAppliedChangeId(workspaceId: workspaceId, changeId: changeId)
    }

    func loadReviewEvents(workspaceId: String) throws -> [ReviewEvent] {
        try self.cardStore.loadReviewEvents(workspaceId: workspaceId)
    }

    func loadJournalMode() throws -> String {
        try self.core.scalarText(sql: "PRAGMA journal_mode;", values: [])
    }

    func bootstrapOutbox(workspaceId: String) throws {
        let cloudSettings = try self.workspaceSettingsStore.loadCloudSettings()
        let pendingOperations = try self.outboxStore.loadOutboxEntries(workspaceId: workspaceId, limit: Int.max)
        let pendingOperationIds = Set(pendingOperations.map { entry in
            entry.operation.operationId
        })
        let pendingReviewEventIds = Set(pendingOperations.compactMap { entry in
            entry.operation.entityType == .reviewEvent ? entry.operation.entityId : nil
        })

        for card in try self.cardStore.loadCardsIncludingDeleted(workspaceId: workspaceId) {
            if pendingOperationIds.contains(card.lastOperationId) == false {
                try self.outboxStore.enqueueCardUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: card.lastOperationId,
                    clientUpdatedAt: card.clientUpdatedAt,
                    card: card
                )
            }
        }

        for deck in try self.deckStore.loadDecksIncludingDeleted(workspaceId: workspaceId) {
            if pendingOperationIds.contains(deck.lastOperationId) == false {
                try self.outboxStore.enqueueDeckUpsertOperation(
                    workspaceId: workspaceId,
                    deviceId: cloudSettings.deviceId,
                    operationId: deck.lastOperationId,
                    clientUpdatedAt: deck.clientUpdatedAt,
                    deck: deck
                )
            }
        }

        let schedulerSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: workspaceId)
        if pendingOperationIds.contains(schedulerSettings.lastOperationId) == false {
            try self.outboxStore.enqueueWorkspaceSchedulerSettingsUpsertOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: schedulerSettings.lastOperationId,
                clientUpdatedAt: schedulerSettings.clientUpdatedAt,
                settings: schedulerSettings
            )
        }

        for reviewEvent in try self.cardStore.loadReviewEvents(workspaceId: workspaceId) {
            if reviewEvent.deviceId != cloudSettings.deviceId {
                continue
            }

            if pendingReviewEventIds.contains(reviewEvent.reviewEventId) {
                continue
            }

            try self.outboxStore.enqueueReviewEventAppendOperation(
                workspaceId: workspaceId,
                deviceId: cloudSettings.deviceId,
                operationId: reviewEvent.reviewEventId,
                clientUpdatedAt: reviewEvent.reviewedAtClient,
                reviewEvent: reviewEvent
            )
        }
    }

    func relinkWorkspace(localWorkspaceId: String, linkedSession: CloudLinkedSession) throws {
        if localWorkspaceId == linkedSession.workspaceId {
            try self.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: linkedSession.workspaceId,
                linkedEmail: linkedSession.email
            )
            return
        }

        try self.core.inTransaction {
            let existingWorkspaceCount = try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM workspaces WHERE workspace_id = ?",
                values: [.text(linkedSession.workspaceId)]
            )

            if existingWorkspaceCount == 0 {
                let localWorkspace = try self.workspaceSettingsStore.loadWorkspace()
                let currentSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: localWorkspaceId)
                try self.core.execute(
                    sql: """
                    INSERT INTO workspaces (
                        workspace_id,
                        name,
                        created_at,
                        fsrs_algorithm,
                        fsrs_desired_retention,
                        fsrs_learning_steps_minutes_json,
                        fsrs_relearning_steps_minutes_json,
                        fsrs_maximum_interval_days,
                        fsrs_enable_fuzz,
                        fsrs_client_updated_at,
                        fsrs_last_modified_by_device_id,
                        fsrs_last_operation_id,
                        fsrs_updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    values: [
                        .text(linkedSession.workspaceId),
                        .text(localWorkspace.name),
                        .text(localWorkspace.createdAt),
                        .text(currentSettings.algorithm),
                        .real(currentSettings.desiredRetention),
                        .text(try self.workspaceSettingsStore.encodeIntegerArray(values: currentSettings.learningStepsMinutes)),
                        .text(try self.workspaceSettingsStore.encodeIntegerArray(values: currentSettings.relearningStepsMinutes)),
                        .integer(Int64(currentSettings.maximumIntervalDays)),
                        .integer(currentSettings.enableFuzz ? 1 : 0),
                        .text(currentSettings.clientUpdatedAt),
                        .text(currentSettings.lastModifiedByDeviceId),
                        .text(currentSettings.lastOperationId),
                        .text(currentSettings.updatedAt)
                    ]
                )
            }

            let workspaceScopedTables: [String] = ["user_settings", "cards", "decks", "review_events", "outbox", "sync_state"]
            for tableName in workspaceScopedTables {
                _ = try self.core.execute(
                    sql: "UPDATE \(tableName) SET workspace_id = ? WHERE workspace_id = ?",
                    values: [
                        .text(linkedSession.workspaceId),
                        .text(localWorkspaceId)
                    ]
                )
            }

            _ = try self.core.execute(
                sql: "DELETE FROM workspaces WHERE workspace_id = ?",
                values: [.text(localWorkspaceId)]
            )

            let syncStateCount = try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM sync_state WHERE workspace_id = ?",
                values: [.text(linkedSession.workspaceId)]
            )
            if syncStateCount == 0 {
                try self.core.execute(
                    sql: "INSERT INTO sync_state (workspace_id, last_applied_change_id, updated_at) VALUES (?, 0, ?)",
                    values: [
                        .text(linkedSession.workspaceId),
                        .text(nowIsoTimestamp())
                    ]
                )
            }

            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: linkedSession.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    func replaceLocalWorkspaceAfterRemoteDelete(
        localWorkspaceId: String,
        replacementWorkspace: CloudWorkspaceSummary,
        linkedSession: CloudLinkedSession
    ) throws {
        let currentSettings = try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: localWorkspaceId)

        try self.core.inTransaction {
            let existingReplacementWorkspaceCount = try self.core.scalarInt(
                sql: "SELECT COUNT(*) FROM workspaces WHERE workspace_id = ?",
                values: [.text(replacementWorkspace.workspaceId)]
            )

            if existingReplacementWorkspaceCount == 0 {
                try self.core.execute(
                    sql: """
                    INSERT INTO workspaces (
                        workspace_id,
                        name,
                        created_at,
                        fsrs_algorithm,
                        fsrs_desired_retention,
                        fsrs_learning_steps_minutes_json,
                        fsrs_relearning_steps_minutes_json,
                        fsrs_maximum_interval_days,
                        fsrs_enable_fuzz,
                        fsrs_client_updated_at,
                        fsrs_last_modified_by_device_id,
                        fsrs_last_operation_id,
                        fsrs_updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    values: [
                        .text(replacementWorkspace.workspaceId),
                        .text(replacementWorkspace.name),
                        .text(replacementWorkspace.createdAt),
                        .text(currentSettings.algorithm),
                        .real(currentSettings.desiredRetention),
                        .text(try self.workspaceSettingsStore.encodeIntegerArray(values: currentSettings.learningStepsMinutes)),
                        .text(try self.workspaceSettingsStore.encodeIntegerArray(values: currentSettings.relearningStepsMinutes)),
                        .integer(Int64(currentSettings.maximumIntervalDays)),
                        .integer(currentSettings.enableFuzz ? 1 : 0),
                        .text(currentSettings.clientUpdatedAt),
                        .text(currentSettings.lastModifiedByDeviceId),
                        .text(currentSettings.lastOperationId),
                        .text(currentSettings.updatedAt)
                    ]
                )
            } else {
                _ = try self.core.execute(
                    sql: """
                    UPDATE workspaces
                    SET name = ?, created_at = ?
                    WHERE workspace_id = ?
                    """,
                    values: [
                        .text(replacementWorkspace.name),
                        .text(replacementWorkspace.createdAt),
                        .text(replacementWorkspace.workspaceId)
                    ]
                )
            }

            let workspaceScopedTables: [String] = ["cards", "decks", "review_events", "outbox", "sync_state"]
            for tableName in workspaceScopedTables {
                _ = try self.core.execute(
                    sql: "DELETE FROM \(tableName) WHERE workspace_id = ?",
                    values: [.text(localWorkspaceId)]
                )
                _ = try self.core.execute(
                    sql: "DELETE FROM \(tableName) WHERE workspace_id = ?",
                    values: [.text(replacementWorkspace.workspaceId)]
                )
            }

            _ = try self.core.execute(
                sql: """
                UPDATE user_settings
                SET workspace_id = ?
                WHERE workspace_id = ?
                """,
                values: [
                    .text(replacementWorkspace.workspaceId),
                    .text(localWorkspaceId)
                ]
            )

            _ = try self.core.execute(
                sql: "DELETE FROM workspaces WHERE workspace_id = ?",
                values: [.text(localWorkspaceId)]
            )

            try self.core.execute(
                sql: """
                INSERT OR REPLACE INTO sync_state (workspace_id, last_applied_change_id, updated_at)
                VALUES (?, 0, ?)
                """,
                values: [
                    .text(replacementWorkspace.workspaceId),
                    .text(nowIsoTimestamp())
                ]
            )

            try self.workspaceSettingsStore.updateCloudSettings(
                cloudState: .linked,
                linkedUserId: linkedSession.userId,
                linkedWorkspaceId: replacementWorkspace.workspaceId,
                linkedEmail: linkedSession.email
            )
        }
    }

    func applySyncChange(workspaceId: String, change: SyncChange) throws {
        try self.core.inTransaction {
            try self.syncApplier.applySyncChange(workspaceId: workspaceId, change: change)
        }
    }

    func resetForAccountDeletion() throws {
        try self.core.resetForAccountDeletion()
    }

    func validateCardBatchCount(count: Int) throws {
        if count < 1 {
            throw LocalStoreError.validation("Card batch must contain at least one item")
        }

        if count > 100 {
            throw LocalStoreError.validation("Card batch must contain at most 100 items")
        }
    }

    func validateUniqueCardIds(cardIds: [String]) throws {
        let uniqueCardIds = Set(cardIds)
        if uniqueCardIds.count != cardIds.count {
            throw LocalStoreError.validation("Card batch must not contain duplicate cardId values")
        }
    }

    func validateDeckBatchCount(count: Int) throws {
        if count < 1 {
            throw LocalStoreError.validation("Deck batch must contain at least one item")
        }

        if count > 100 {
            throw LocalStoreError.validation("Deck batch must contain at most 100 items")
        }
    }

    func validateUniqueDeckIds(deckIds: [String]) throws {
        let uniqueDeckIds = Set(deckIds)
        if uniqueDeckIds.count != deckIds.count {
            throw LocalStoreError.validation("Deck batch must not contain duplicate deckId values")
        }
    }
}
