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

private func withTemporaryReviewLoaderDatabase<Result>(
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
                "Failed to close temporary review loader database at \(databaseURL.path) after operation error: \(operationError.localizedDescription). Close error: \(error.localizedDescription)"
            )
        }
        throw operationError
    }

    try database.close()
    return result
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
        return try withTemporaryReviewLoaderDatabase(databaseURL: databaseURL) { database in
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
        return try withTemporaryReviewLoaderDatabase(databaseURL: databaseURL) { database in
            try database.loadReviewCounts(
                workspaceId: workspaceId,
                reviewQueryDefinition: reviewQueryDefinition,
                now: now
            )
        }
    }.value
}

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
        return try withTemporaryReviewLoaderDatabase(databaseURL: databaseURL) { database in
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
        return try withTemporaryReviewLoaderDatabase(databaseURL: databaseURL) { database in
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
        return try withTemporaryReviewLoaderDatabase(databaseURL: databaseURL) { database in
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
