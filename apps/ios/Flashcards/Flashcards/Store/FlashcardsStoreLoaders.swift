import Foundation

typealias ReviewHeadLoader = @Sendable (
    _ databaseURL: URL,
    _ workspaceId: String,
    _ resolvedReviewFilter: ReviewFilter,
    _ reviewQueryDefinition: ReviewQueryDefinition,
    _ now: Date,
    _ seedQueueSize: Int
) async throws -> ReviewHeadLoadState

typealias ReviewCountsLoader = @Sendable (
    _ databaseURL: URL,
    _ workspaceId: String,
    _ reviewQueryDefinition: ReviewQueryDefinition,
    _ now: Date
) async throws -> ReviewCounts

typealias ReviewQueueChunkLoader = @Sendable (
    _ databaseURL: URL,
    _ workspaceId: String,
    _ reviewQueryDefinition: ReviewQueryDefinition,
    _ excludedCardIds: Set<String>,
    _ now: Date,
    _ chunkSize: Int
) async throws -> ReviewQueueChunkLoadState

typealias ReviewQueueWindowLoader = @Sendable (
    _ databaseURL: URL,
    _ workspaceId: String,
    _ reviewQueryDefinition: ReviewQueryDefinition,
    _ now: Date,
    _ limit: Int
) async throws -> ReviewQueueWindowLoadState

typealias ReviewTimelinePageLoader = @Sendable (
    _ databaseURL: URL,
    _ workspaceId: String,
    _ reviewQueryDefinition: ReviewQueryDefinition,
    _ now: Date,
    _ limit: Int,
    _ offset: Int
) async throws -> ReviewTimelinePage

let reviewSeedQueueSize: Int = 8
let reviewQueueReplenishmentThreshold: Int = 4

struct LoadedBootstrapSnapshot: Sendable {
    let snapshot: AppBootstrapSnapshot
    let cards: [Card]
    let decks: [Deck]
}

private func withTemporaryLocalLoaderDatabase<Result>(
    databaseURL: URL,
    operation: (LocalDatabase) throws -> Result
) throws -> Result {
    let database = try LocalDatabase(databaseURL: databaseURL)
    let result: Result
    do {
        result = try operation(database)
    } catch {
        let operationError = error
        do {
            try database.close()
        } catch {
            throw LocalStoreError.database(
                "Failed to close temporary local loader database at \(databaseURL.path) after operation error: \(operationError.localizedDescription). Close error: \(error.localizedDescription)"
            )
        }
        throw operationError
    }

    try database.close()
    return result
}

func defaultBootstrapSnapshotLoader(
    databaseURL: URL
) async throws -> LoadedBootstrapSnapshot {
    try await Task.detached(priority: .userInitiated) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            try database.core.inReadTransaction {
                let snapshot = try database.loadBootstrapSnapshot()
                return LoadedBootstrapSnapshot(
                    snapshot: snapshot,
                    cards: try database.loadActiveCards(workspaceId: snapshot.workspace.workspaceId),
                    decks: try database.loadActiveDecks(workspaceId: snapshot.workspace.workspaceId)
                )
            }
        }
    }.value
}

func loadActiveCardInBackground(
    databaseURL: URL,
    workspaceId: String,
    cardId: String
) async throws -> Card {
    try await Task.detached(priority: .userInitiated) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            try database.loadActiveCard(workspaceId: workspaceId, cardId: cardId)
        }
    }.value
}

func defaultReviewHeadLoader(
    databaseURL: URL,
    workspaceId: String,
    resolvedReviewFilter: ReviewFilter,
    reviewQueryDefinition: ReviewQueryDefinition,
    now: Date,
    seedQueueSize: Int
) async throws -> ReviewHeadLoadState {
    try await Task.detached(priority: .userInitiated) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            try database.loadReviewHead(
                workspaceId: workspaceId,
                resolvedReviewFilter: resolvedReviewFilter,
                reviewQueryDefinition: reviewQueryDefinition,
                now: now,
                limit: seedQueueSize
            )
        }
    }.value
}

func defaultReviewCountsLoader(
    databaseURL: URL,
    workspaceId: String,
    reviewQueryDefinition: ReviewQueryDefinition,
    now: Date
) async throws -> ReviewCounts {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            try database.loadReviewCounts(
                workspaceId: workspaceId,
                reviewQueryDefinition: reviewQueryDefinition,
                now: now
            )
        }
    }.value
}

func loadNextReviewDueAtInBackground(
    databaseURL: URL,
    workspaceId: String,
    reviewQueryDefinition: ReviewQueryDefinition,
    now: Date
) async throws -> Date? {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            try database.loadReviewUpcomingDueDates(
                workspaceId: workspaceId,
                reviewQueryDefinition: reviewQueryDefinition,
                now: now,
                limit: 1
            ).first
        }
    }.value
}

func loadWorkspaceReviewDueInBackground(
    databaseURL: URL,
    workspaceId: String,
    previous: WorkspaceReviewDueState?,
    now: Date
) async throws -> ReviewDueBadgeSnapshot {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            guard let previous else {
                return try database.loadWorkspaceReviewDueBadgeSnapshot(workspaceId: workspaceId, now: now)
            }
            return try database.core.inReadTransaction {
                let newlyDueCount = try database.loadWorkspaceReviewDueAdvance(
                    workspaceId: workspaceId,
                    countedThrough: previous.countedThrough,
                    now: now
                )
                let nextDueAt = try database.loadReviewUpcomingDueDates(
                    workspaceId: workspaceId,
                    reviewQueryDefinition: .allCards,
                    now: now,
                    limit: 1
                ).first
                return ReviewDueBadgeSnapshot(dueCount: previous.count + newlyDueCount, nextDueAt: nextDueAt)
            }
        }
    }.value
}

#if !targetEnvironment(macCatalyst)
struct WidgetSnapshotDatabaseRead: Sendable {
    let dueCount: Int
    let upcomingDueAt: [Date]
    let upcomingDueDayCounts: [Int]
    let reviewHeadCard: Card?
}

func loadWidgetSnapshotDatabaseReadInBackground(
    databaseURL: URL,
    workspaceId: String,
    reviewFilter: ReviewFilter,
    isReviewCardPresented: Bool,
    upcomingDueLimit: Int,
    upcomingDueDayBoundaries: [Date],
    now: Date
) async throws -> WidgetSnapshotDatabaseRead {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            // The ready count and the future due times must partition the same read snapshot.
            try database.core.inReadTransaction {
                let reviewHeadCard: Card?
                if isReviewCardPresented {
                    reviewHeadCard = nil
                } else {
                    let resolvedReviewQuery = try database.loadResolvedReviewQuery(
                        workspaceId: workspaceId,
                        reviewFilter: reviewFilter
                    )
                    reviewHeadCard = try database.loadReviewHead(
                        workspaceId: workspaceId,
                        resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
                        reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
                        now: now,
                        limit: 1
                    ).seedReviewQueue.first
                }
                return WidgetSnapshotDatabaseRead(
                    dueCount: try database.loadWorkspaceReviewDueBadgeSnapshot(workspaceId: workspaceId, now: now).dueCount,
                    upcomingDueAt: try database.loadReviewUpcomingDueDates(
                        workspaceId: workspaceId,
                        reviewQueryDefinition: .allCards,
                        now: now,
                        limit: upcomingDueLimit
                    ),
                    upcomingDueDayCounts: try database.loadReviewDueCounts(
                        workspaceId: workspaceId,
                        reviewQueryDefinition: .allCards,
                        intervalBoundaries: upcomingDueDayBoundaries
                    ),
                    reviewHeadCard: reviewHeadCard
                )
            }
        }
    }.value
}
#endif

func defaultReviewQueueChunkLoader(
    databaseURL: URL,
    workspaceId: String,
    reviewQueryDefinition: ReviewQueryDefinition,
    excludedCardIds: Set<String>,
    now: Date,
    chunkSize: Int
) async throws -> ReviewQueueChunkLoadState {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            try database.loadReviewQueueChunk(
                workspaceId: workspaceId,
                reviewQueryDefinition: reviewQueryDefinition,
                now: now,
                limit: chunkSize,
                excludedCardIds: excludedCardIds
            )
        }
    }.value
}

func defaultReviewQueueWindowLoader(
    databaseURL: URL,
    workspaceId: String,
    reviewQueryDefinition: ReviewQueryDefinition,
    now: Date,
    limit: Int
) async throws -> ReviewQueueWindowLoadState {
    return try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            try database.loadReviewQueueWindow(
                workspaceId: workspaceId,
                reviewQueryDefinition: reviewQueryDefinition,
                now: now,
                limit: limit
            )
        }
    }.value
}

func defaultReviewTimelinePageLoader(
    databaseURL: URL,
    workspaceId: String,
    reviewQueryDefinition: ReviewQueryDefinition,
    now: Date,
    limit: Int,
    offset: Int
) async throws -> ReviewTimelinePage {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            try database.loadReviewTimelinePage(
                workspaceId: workspaceId,
                reviewQueryDefinition: reviewQueryDefinition,
                now: now,
                limit: limit,
                offset: offset
            )
        }
    }.value
}

func loadProgressReviewedAtClientSourcesInBackground(
    databaseURL: URL,
    workspaceIds: [String],
    installationId: String?
) async throws -> ProgressReviewedAtClientSources {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            try database.core.inReadTransaction {
                try readProgressReviewedAtClientSources(
                    database: database,
                    workspaceIds: workspaceIds,
                    installationId: installationId
                )
            }
        }
    }.value
}

func loadWorkspaceTagCountInBackground(
    databaseURL: URL,
    workspaceId: String
) async throws -> Int {
    try Task.checkCancellation()
    return try await Task.detached(priority: .utility) {
        let core = try DatabaseCore(readOnlyDatabaseURL: databaseURL)
        let count = try CardStore(core: core).loadWorkspaceTagCount(workspaceId: workspaceId)
        try core.close()
        return count
    }.value
}

func loadWorkspaceTagsSummaryInBackground(
    databaseURL: URL,
    workspaceId: String
) async throws -> WorkspaceTagsSummary {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return try withTemporaryLocalLoaderDatabase(databaseURL: databaseURL) { database in
            try database.core.inReadTransaction {
                try database.loadWorkspaceTagsSummary(workspaceId: workspaceId)
            }
        }
    }.value
}
