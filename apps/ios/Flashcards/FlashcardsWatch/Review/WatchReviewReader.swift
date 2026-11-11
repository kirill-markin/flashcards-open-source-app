import Foundation

struct WatchReviewSnapshotRequest: Sendable {
    let requestedReviewFilter: ReviewFilter
    /// The shown and prepared next cards, reread so a kept card shows its latest edit or leaves review.
    let keptCardIds: [String]
    let now: Date
    let seedQueueSize: Int
}

/// One consistent read of everything the watch Review screen shows; bounded by the seed queue size.
struct WatchReviewSnapshot: Sendable {
    let workspaceId: String
    let resolvedReviewQuery: ResolvedReviewQuery
    let reviewHead: ReviewHeadLoadState
    let reviewCounts: ReviewCounts
    let nextDueAt: Date?
    let schedulerSettings: WorkspaceSchedulerSettings
    /// The kept cards that still exist; a deleted card is absent.
    let keptCards: [Card]
    let decks: [Deck]
}

/// Reads the watch's review data off the main actor through its own connection, as
/// `ReviewSubmissionExecutor` writes through its own.
actor WatchReviewReader {
    private let databaseURL: URL
    private var database: LocalDatabase?

    init(databaseURL: URL) {
        self.databaseURL = databaseURL
        self.database = nil
    }

    func loadSnapshot(request: WatchReviewSnapshotRequest) throws -> WatchReviewSnapshot {
        let database = try self.resolvedDatabase()
        return try database.core.inReadTransaction {
            let workspaceId = try database.workspaceSettingsStore.loadWorkspace().workspaceId
            // A deck that no longer exists resolves to all cards, as on iPhone.
            let resolvedReviewQuery = try database.loadResolvedReviewQuery(
                workspaceId: workspaceId,
                reviewFilter: request.requestedReviewFilter
            )
            let keptCards = try request.keptCardIds.compactMap { cardId in
                try loadActiveCardIfPresent(database: database, workspaceId: workspaceId, cardId: cardId)
            }
            return WatchReviewSnapshot(
                workspaceId: workspaceId,
                resolvedReviewQuery: resolvedReviewQuery,
                reviewHead: try database.loadReviewHead(
                    workspaceId: workspaceId,
                    resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
                    reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
                    now: request.now,
                    limit: request.seedQueueSize
                ),
                reviewCounts: try database.loadReviewCounts(
                    workspaceId: workspaceId,
                    reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
                    now: request.now
                ),
                nextDueAt: try database.loadReviewUpcomingDueDates(
                    workspaceId: workspaceId,
                    reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
                    now: request.now,
                    limit: 1
                ).first,
                schedulerSettings: try database.workspaceSettingsStore.loadWorkspaceSchedulerSettings(
                    workspaceId: workspaceId
                ),
                keptCards: keptCards,
                decks: try database.loadActiveDecks(workspaceId: workspaceId)
            )
        }
    }

    /// The runtime resolves the review filter from every active card's tags, as on iPhone, so a failed
    /// rating's card can return only after a read of the whole workspace.
    func loadRollbackValidationContext(now: Date) throws -> ReviewSubmissionRollbackValidationContext {
        let database = try self.resolvedDatabase()
        return try database.core.inReadTransaction {
            let workspaceId = try database.workspaceSettingsStore.loadWorkspace().workspaceId
            return ReviewSubmissionRollbackValidationContext(
                currentWorkspaceId: workspaceId,
                cards: try database.loadActiveCards(workspaceId: workspaceId),
                decks: try database.loadActiveDecks(workspaceId: workspaceId),
                schedulerSettings: try database.workspaceSettingsStore.loadWorkspaceSchedulerSettings(
                    workspaceId: workspaceId
                ),
                now: now
            )
        }
    }

    private func resolvedDatabase() throws -> LocalDatabase {
        if let database = self.database {
            return database
        }

        let database = try LocalDatabase(databaseURL: self.databaseURL)
        self.database = database
        return database
    }
}

private func loadActiveCardIfPresent(database: LocalDatabase, workspaceId: String, cardId: String) throws -> Card? {
    do {
        return try database.loadActiveCard(workspaceId: workspaceId, cardId: cardId)
    } catch LocalStoreError.notFound {
        return nil
    }
}
