import Foundation

extension LocalDatabase {
    func loadBootstrapSnapshot() throws -> AppBootstrapSnapshot {
        let workspace = try self.workspaceSettingsStore.loadWorkspace()
        return AppBootstrapSnapshot(
            workspace: workspace,
            userSettings: try self.workspaceSettingsStore.loadUserSettings(),
            schedulerSettings: try self.workspaceSettingsStore.loadWorkspaceSchedulerSettings(workspaceId: workspace.workspaceId),
            cloudSettings: try self.workspaceSettingsStore.loadCloudSettings()
        )
    }

    func loadCachedWorkspaces() throws -> [Workspace] {
        try self.workspaceSettingsStore.loadCachedWorkspaces()
    }

    func loadAIChatContext() throws -> AIChatContext {
        let bootstrapSnapshot = try self.loadBootstrapSnapshot()
        return AIChatContext(
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
}
