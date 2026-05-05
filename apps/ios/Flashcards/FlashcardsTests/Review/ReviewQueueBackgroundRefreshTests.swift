import XCTest
@testable import Flashcards

final class ReviewQueueBackgroundRefreshTests: XCTestCase {
    private typealias Support = ReviewQueueRuntimeTestSupport

    func testApplyBackgroundReviewRefreshPreservesPresentedCardWhenItRemainsVisible() {
        var runtime = Support.makeRuntime()
        let displayedCurrent = Support.makeCard(
            cardId: "displayed-current",
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let previousHead = Support.makeCard(
            cardId: "previous-head",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let newlyDueHead = Support.makeCard(
            cardId: "newly-due-head",
            dueAt: "2026-03-09T07:30:00.000Z",
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let currentState = Support.makePublishedState(
            reviewQueue: [previousHead, displayedCurrent],
            presentedReviewCard: displayedCurrent,
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
            presentedReviewCard: displayedCurrent,
            hasMoreCards: reviewHeadState.hasMoreCards
        )

        XCTAssertEqual(nextState.presentedReviewCard?.cardId, displayedCurrent.cardId)
        XCTAssertEqual(
            runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId),
            [displayedCurrent.cardId, newlyDueHead.cardId, previousHead.cardId]
        )
    }

    func testBackgroundRefreshUsesCanonicalPresentedAndPendingCardsForChunkExclusion() throws {
        var runtime = Support.makeRuntime()
        let seedHead = Support.makeCard(
            cardId: "seed-head",
            dueAt: "2026-03-09T07:30:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let secondSeedCard = Support.makeCard(
            cardId: "second-seed-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let presentedCard = Support.makeCard(
            cardId: "presented-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:00:00.000Z"
        )
        let pendingCard = Support.makeCard(
            cardId: "pending-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:01:00.000Z"
        )
        let currentState = Support.makePublishedState(
            reviewQueue: [seedHead, secondSeedCard],
            presentedReviewCard: presentedCard,
            pendingReviewCardIds: [pendingCard.cardId]
        )

        let nextState = runtime.applyBackgroundReviewRefresh(
            publishedState: currentState,
            selectedReviewFilter: .allCards,
            reviewCounts: ReviewCounts(dueCount: 4, totalCount: 4),
            reviewQueue: [seedHead, secondSeedCard],
            presentedReviewCard: presentedCard,
            hasMoreCards: true
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
            Set([seedHead.cardId, secondSeedCard.cardId, presentedCard.cardId, pendingCard.cardId])
        )
    }
}
