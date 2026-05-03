import XCTest
@testable import Flashcards

final class ReviewQueueRuntimeTests: XCTestCase {
    func testEffectiveReviewQueueKeepsPresentedCardFirstWhenStillVisible() {
        let runtime = makeRuntime()
        let displayedCurrent = makeCard(
            cardId: "displayed-current",
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let newlyDueHead = makeCard(
            cardId: "newly-due-head",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let trailingCard = makeCard(
            cardId: "trailing-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let publishedState = makePublishedState(
            reviewQueue: [newlyDueHead, displayedCurrent, trailingCard],
            reviewQueueCanonicalCount: 3,
            presentedCardId: displayedCurrent.cardId,
            pendingReviewCardIds: []
        )

        XCTAssertEqual(
            runtime.effectiveReviewQueue(publishedState: publishedState).map(\.cardId),
            [displayedCurrent.cardId, newlyDueHead.cardId, trailingCard.cardId]
        )
    }

    func testApplyBackgroundReviewRefreshPreservesPresentedCardWhenItRemainsVisible() {
        var runtime = makeRuntime()
        let displayedCurrent = makeCard(
            cardId: "displayed-current",
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let previousHead = makeCard(
            cardId: "previous-head",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let newlyDueHead = makeCard(
            cardId: "newly-due-head",
            dueAt: "2026-03-09T07:30:00.000Z",
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let currentState = makePublishedState(
            reviewQueue: [previousHead, displayedCurrent],
            reviewQueueCanonicalCount: 2,
            presentedCardId: displayedCurrent.cardId,
            pendingReviewCardIds: []
        )
        let reviewHeadState = ReviewHeadLoadState(
            resolvedReviewFilter: .allCards,
            seedReviewQueue: [newlyDueHead, previousHead, displayedCurrent],
            hasMoreCards: false
        )

        let nextState = runtime.applyBackgroundReviewRefresh(
            publishedState: currentState,
            selectedReviewFilter: reviewHeadState.resolvedReviewFilter,
            reviewCounts: ReviewCounts(dueCount: 3, totalCount: 3),
            reviewQueue: reviewHeadState.seedReviewQueue,
            reviewQueueCanonicalCount: reviewHeadState.seedReviewQueue.count,
            hasMoreCards: reviewHeadState.hasMoreCards
        )

        XCTAssertEqual(nextState.presentedCardId, displayedCurrent.cardId)
        XCTAssertEqual(
            runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId),
            [displayedCurrent.cardId, newlyDueHead.cardId, previousHead.cardId]
        )
    }

    func testBackgroundRefreshUsesEntirePublishedQueueForChunkExclusion() throws {
        var runtime = makeRuntime()
        let seedHead = makeCard(
            cardId: "seed-head",
            dueAt: "2026-03-09T07:30:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let secondSeedCard = makeCard(
            cardId: "second-seed-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let preservedTailCard = makeCard(
            cardId: "preserved-tail-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:00:00.000Z"
        )
        let currentState = makePublishedState(
            reviewQueue: [seedHead, secondSeedCard, preservedTailCard],
            reviewQueueCanonicalCount: 2,
            presentedCardId: seedHead.cardId,
            pendingReviewCardIds: []
        )
        let reviewHeadState = ReviewHeadLoadState(
            resolvedReviewFilter: .allCards,
            seedReviewQueue: [seedHead, secondSeedCard],
            hasMoreCards: true
        )

        let nextState = runtime.applyBackgroundReviewRefresh(
            publishedState: currentState,
            selectedReviewFilter: reviewHeadState.resolvedReviewFilter,
            reviewCounts: ReviewCounts(dueCount: 3, totalCount: 3),
            reviewQueue: currentState.reviewQueue,
            reviewQueueCanonicalCount: reviewHeadState.seedReviewQueue.count,
            hasMoreCards: reviewHeadState.hasMoreCards
        )
        let request = runtime.makeReviewQueueChunkLoadRequestIfNeeded(
            publishedState: nextState,
            databaseURL: URL(fileURLWithPath: "/tmp/review.sqlite"),
            workspaceId: "workspace-1",
            reviewQueryDefinition: .allCards,
            now: Date(timeIntervalSince1970: 1_773_408_000)
        )

        XCTAssertEqual(
            request?.excludedCardIds,
            Set([seedHead.cardId, secondSeedCard.cardId, preservedTailCard.cardId])
        )
    }

    func testReviewQueueChunkLoadInsertsChunkBeforePreservedTail() throws {
        var runtime = makeRuntime()
        let canonicalHead = makeCard(
            cardId: "canonical-head",
            dueAt: "2026-03-09T07:30:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let canonicalSecond = makeCard(
            cardId: "canonical-second",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let preservedTailCard = makeCard(
            cardId: "preserved-tail-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:00:00.000Z"
        )
        let chunkHead = makeCard(
            cardId: "chunk-head",
            dueAt: nil,
            updatedAt: "2026-03-09T09:01:00.000Z"
        )
        let chunkSecond = makeCard(
            cardId: "chunk-second",
            dueAt: nil,
            updatedAt: "2026-03-09T09:02:00.000Z"
        )
        let currentState = makePublishedState(
            reviewQueue: [canonicalHead, canonicalSecond, preservedTailCard],
            reviewQueueCanonicalCount: 2,
            presentedCardId: preservedTailCard.cardId,
            pendingReviewCardIds: []
        )
        let loadingState = runtime.markReviewQueueChunkLoading(
            publishedState: currentState,
            requestId: "chunk-1"
        )

        let nextState = try XCTUnwrap(runtime.applyReviewQueueChunkLoadSuccess(
            publishedState: loadingState,
            queueChunkLoadState: ReviewQueueChunkLoadState(
                reviewQueueChunk: [chunkHead, chunkSecond],
                hasMoreCards: false
            ),
            requestId: "chunk-1",
            sourceVersion: 0
        ))

        XCTAssertEqual(
            nextState.reviewQueue.map(\.cardId),
            [
                canonicalHead.cardId,
                canonicalSecond.cardId,
                chunkHead.cardId,
                chunkSecond.cardId,
                preservedTailCard.cardId
            ]
        )
        XCTAssertEqual(nextState.reviewQueueCanonicalCount, 4)
        XCTAssertEqual(nextState.presentedCardId, preservedTailCard.cardId)
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).first?.cardId, preservedTailCard.cardId)
    }

    func testEnqueueReviewSubmissionAdvancesPresentedCardToNextVisibleCard() throws {
        var runtime = makeRuntime()
        let currentCard = makeCard(
            cardId: "current-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let nextCard = makeCard(
            cardId: "next-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let publishedState = makePublishedState(
            reviewQueue: [currentCard, nextCard],
            reviewQueueCanonicalCount: 2,
            presentedCardId: currentCard.cardId,
            pendingReviewCardIds: []
        )

        let nextState = try runtime.enqueueReviewSubmission(
            publishedState: publishedState,
            workspaceId: "workspace-1",
            cardId: currentCard.cardId,
            rating: .good
        )

        XCTAssertEqual(nextState.presentedCardId, nextCard.cardId)
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId), [nextCard.cardId])
    }

    func testFailReviewSubmissionReturnsFailedCardToPresentedPosition() {
        var runtime = makeRuntime()
        let currentCard = makeCard(
            cardId: "current-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let nextCard = makeCard(
            cardId: "next-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let publishedState = makePublishedState(
            reviewQueue: [currentCard, nextCard],
            reviewQueueCanonicalCount: 2,
            presentedCardId: nextCard.cardId,
            pendingReviewCardIds: [currentCard.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: "workspace-1",
            cardId: currentCard.cardId,
            rating: .good,
            reviewedAtClient: "2026-03-09T09:00:00.000Z"
        )

        let nextState = runtime.failReviewSubmission(
            publishedState: publishedState,
            request: request,
            message: "Network failed"
        )

        XCTAssertEqual(nextState.presentedCardId, currentCard.cardId)
        XCTAssertEqual(
            runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId),
            [currentCard.cardId, nextCard.cardId]
        )
    }
}

private func makeRuntime() -> ReviewQueueRuntime {
    ReviewQueueRuntime(
        initialSelectedReviewFilter: .allCards,
        reviewSeedQueueSize: 8,
        reviewQueueReplenishmentThreshold: 4
    )
}

private func makePublishedState(
    reviewQueue: [Card],
    reviewQueueCanonicalCount: Int,
    presentedCardId: String?,
    pendingReviewCardIds: Set<String>
) -> ReviewQueuePublishedState {
    ReviewQueuePublishedState(
        selectedReviewFilter: .allCards,
        reviewQueue: reviewQueue,
        reviewQueueCanonicalCount: reviewQueueCanonicalCount,
        presentedCardId: presentedCardId,
        reviewCounts: ReviewCounts(dueCount: reviewQueue.count, totalCount: reviewQueue.count),
        isReviewHeadLoading: false,
        isReviewCountsLoading: false,
        isReviewQueueChunkLoading: false,
        pendingReviewCardIds: pendingReviewCardIds,
        reviewSubmissionFailure: nil
    )
}

private func makeCard(
    cardId: String,
    dueAt: String?,
    updatedAt: String
) -> Card {
    FsrsSchedulerTestSupport.makeTestCard(
        cardId: cardId,
        tags: [],
        effortLevel: .fast,
        dueAt: dueAt,
        updatedAt: updatedAt
    )
}
