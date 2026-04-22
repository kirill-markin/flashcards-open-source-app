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
    presentedCardId: String?,
    pendingReviewCardIds: Set<String>
) -> ReviewQueuePublishedState {
    ReviewQueuePublishedState(
        selectedReviewFilter: .allCards,
        reviewQueue: reviewQueue,
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
