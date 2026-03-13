import Foundation

typealias ReviewHeadLoader = @Sendable (
    _ reviewFilter: ReviewFilter,
    _ decks: [Deck],
    _ cards: [Card],
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
    _ reviewFilter: ReviewFilter,
    _ decks: [Deck],
    _ cards: [Card],
    _ excludedCardIds: Set<String>,
    _ now: Date,
    _ chunkSize: Int
) async throws -> ReviewQueueChunkLoadState

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

func defaultReviewHeadLoader(
    reviewFilter: ReviewFilter,
    decks: [Deck],
    cards: [Card],
    now: Date,
    seedQueueSize: Int
) async throws -> ReviewHeadLoadState {
    try await Task.detached(priority: .userInitiated) {
        try Task.checkCancellation()
        return makeReviewHeadLoadState(
            reviewFilter: reviewFilter,
            decks: decks,
            cards: cards,
            now: now,
            seedQueueSize: seedQueueSize
        )
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
        let database = try LocalDatabase(databaseURL: databaseURL)
        return try database.loadReviewCounts(
            workspaceId: workspaceId,
            reviewQueryDefinition: reviewQueryDefinition,
            now: now
        )
    }.value
}

func defaultReviewQueueChunkLoader(
    reviewFilter: ReviewFilter,
    decks: [Deck],
    cards: [Card],
    excludedCardIds: Set<String>,
    now: Date,
    chunkSize: Int
) async throws -> ReviewQueueChunkLoadState {
    try await Task.detached(priority: .utility) {
        try Task.checkCancellation()
        return makeReviewQueueChunkLoadState(
            reviewFilter: reviewFilter,
            decks: decks,
            cards: cards,
            now: now,
            limit: chunkSize,
            excludedCardIds: excludedCardIds
        )
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
        let database = try LocalDatabase(databaseURL: databaseURL)
        return try database.loadReviewTimelinePage(
            workspaceId: workspaceId,
            reviewQueryDefinition: reviewQueryDefinition,
            now: now,
            limit: limit,
            offset: offset
        )
    }.value
}
