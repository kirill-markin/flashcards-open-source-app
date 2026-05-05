import XCTest
@testable import Flashcards

final class ReviewQueueCompositionTests: XCTestCase {
    private typealias Support = ReviewQueueRuntimeTestSupport

    func testEffectiveReviewQueueKeepsPresentedCardFirstWhenStillVisible() {
        let runtime = Support.makeRuntime()
        let displayedCurrent = Support.makeCard(
            cardId: "displayed-current",
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let newlyDueHead = Support.makeCard(
            cardId: "newly-due-head",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let trailingCard = Support.makeCard(
            cardId: "trailing-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let publishedState = Support.makePublishedState(
            reviewQueue: [newlyDueHead, displayedCurrent, trailingCard],
            presentedReviewCard: displayedCurrent,
            pendingReviewCardIds: []
        )

        XCTAssertEqual(
            runtime.effectiveReviewQueue(publishedState: publishedState).map(\.cardId),
            [displayedCurrent.cardId, newlyDueHead.cardId, trailingCard.cardId]
        )
    }

    func testEffectiveReviewQueueUsesCanonicalSnapshotForPresentedCardWhenAvailable() {
        let runtime = Support.makeRuntime()
        let staleDisplayedCurrent = Support.makeCard(
            cardId: "displayed-current",
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let freshDisplayedCurrent = Support.makeCard(
            cardId: "displayed-current",
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let nextCard = Support.makeCard(
            cardId: "next-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let publishedState = Support.makePublishedState(
            reviewQueue: [freshDisplayedCurrent, nextCard],
            presentedReviewCard: staleDisplayedCurrent,
            pendingReviewCardIds: []
        )

        let effectiveReviewQueue = runtime.effectiveReviewQueue(publishedState: publishedState)

        XCTAssertEqual(effectiveReviewQueue.map(\.cardId), [freshDisplayedCurrent.cardId, nextCard.cardId])
        XCTAssertEqual(effectiveReviewQueue.first?.updatedAt, freshDisplayedCurrent.updatedAt)
    }
}
