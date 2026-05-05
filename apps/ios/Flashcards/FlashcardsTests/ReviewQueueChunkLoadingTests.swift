import XCTest
@testable import Flashcards

final class ReviewQueueChunkLoadingTests: XCTestCase {
    private typealias Support = ReviewQueueRuntimeTestSupport

    func testReviewQueueChunkLoadRequestUsesCanonicalVisibleThresholdWithPinnedPresentedCard() throws {
        var runtime = Support.makeRuntime()
        let firstCanonicalCard = Support.makeCard(
            cardId: "first-canonical-card",
            dueAt: "2026-03-09T07:30:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let secondCanonicalCard = Support.makeCard(
            cardId: "second-canonical-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let thirdCanonicalCard = Support.makeCard(
            cardId: "third-canonical-card",
            dueAt: nil,
            updatedAt: "2026-03-09T08:30:00.000Z"
        )
        let fourthCanonicalCard = Support.makeCard(
            cardId: "fourth-canonical-card",
            dueAt: nil,
            updatedAt: "2026-03-09T08:31:00.000Z"
        )
        let presentedCard = Support.makeCard(
            cardId: "presented-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:00:00.000Z"
        )
        let canonicalReviewQueue = [
            firstCanonicalCard,
            secondCanonicalCard,
            thirdCanonicalCard,
            fourthCanonicalCard
        ]
        let currentState = Support.makePublishedState(
            reviewQueue: canonicalReviewQueue,
            presentedReviewCard: presentedCard,
            pendingReviewCardIds: []
        )

        let nextState = runtime.applyBackgroundReviewRefresh(
            publishedState: currentState,
            selectedReviewFilter: .allCards,
            reviewCounts: ReviewCounts(dueCount: 5, totalCount: 5),
            reviewQueue: canonicalReviewQueue,
            presentedReviewCard: presentedCard,
            hasMoreCards: true
        )
        let request = try XCTUnwrap(runtime.makeReviewQueueChunkLoadRequestIfNeeded(
            publishedState: nextState,
            databaseURL: URL(fileURLWithPath: "/tmp/review.sqlite"),
            workspaceId: "workspace-1",
            reviewQueryDefinition: .allCards,
            now: Date(timeIntervalSince1970: 1_773_408_000)
        ))

        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).count, 5)
        XCTAssertEqual(request.chunkSize, 4)
        XCTAssertEqual(
            request.excludedCardIds,
            Set((canonicalReviewQueue + [presentedCard]).map(\.cardId))
        )
    }

    func testReviewQueueChunkLoadAppendsChunkToCanonicalQueueOnly() throws {
        var runtime = Support.makeRuntime()
        let canonicalHead = Support.makeCard(
            cardId: "canonical-head",
            dueAt: "2026-03-09T07:30:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let canonicalSecond = Support.makeCard(
            cardId: "canonical-second",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let presentedCard = Support.makeCard(
            cardId: "presented-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:00:00.000Z"
        )
        let chunkHead = Support.makeCard(
            cardId: "chunk-head",
            dueAt: nil,
            updatedAt: "2026-03-09T09:01:00.000Z"
        )
        let chunkSecond = Support.makeCard(
            cardId: "chunk-second",
            dueAt: nil,
            updatedAt: "2026-03-09T09:02:00.000Z"
        )
        let currentState = Support.makePublishedState(
            reviewQueue: [canonicalHead, canonicalSecond],
            presentedReviewCard: presentedCard,
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
            [canonicalHead.cardId, canonicalSecond.cardId, chunkHead.cardId, chunkSecond.cardId]
        )
        XCTAssertEqual(nextState.presentedReviewCard?.cardId, presentedCard.cardId)
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).first?.cardId, presentedCard.cardId)
    }

    func testReviewQueueChunkLoadPreservesPendingCardsInCanonicalQueueAndCapsVisibleWindow() throws {
        // Pending cards are preserved in the canonical reviewQueue and filtered out only at
        // read time via visibleReviewQueue. This guards against losing pending-but-still-canonical
        // cards if rollback is needed after submission failure.
        var runtime = Support.makeSmallRuntime()
        let canonicalHead = Support.makeCard(
            cardId: "canonical-head",
            dueAt: "2026-03-09T07:30:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let canonicalSecond = Support.makeCard(
            cardId: "canonical-second",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let canonicalThird = Support.makeCard(
            cardId: "canonical-third",
            dueAt: nil,
            updatedAt: "2026-03-09T08:30:00.000Z"
        )
        let pendingCard = Support.makeCard(
            cardId: "pending-card",
            dueAt: nil,
            updatedAt: "2026-03-09T08:31:00.000Z"
        )
        let presentedCard = Support.makeCard(
            cardId: "presented-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:00:00.000Z"
        )
        let acceptedChunkCard = Support.makeCard(
            cardId: "accepted-chunk-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:01:00.000Z"
        )
        let overflowChunkCard = Support.makeCard(
            cardId: "overflow-chunk-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:02:00.000Z"
        )
        let currentState = Support.makePublishedState(
            reviewQueue: [canonicalHead, canonicalSecond, canonicalThird, pendingCard],
            presentedReviewCard: presentedCard,
            pendingReviewCardIds: [pendingCard.cardId]
        )
        let replenishableState = runtime.applyBackgroundReviewRefresh(
            publishedState: currentState,
            selectedReviewFilter: .allCards,
            reviewCounts: ReviewCounts(dueCount: 5, totalCount: 5),
            reviewQueue: currentState.reviewQueue,
            presentedReviewCard: presentedCard,
            hasMoreCards: true
        )
        let request = try XCTUnwrap(runtime.makeReviewQueueChunkLoadRequestIfNeeded(
            publishedState: replenishableState,
            databaseURL: URL(fileURLWithPath: "/tmp/review.sqlite"),
            workspaceId: "workspace-1",
            reviewQueryDefinition: .allCards,
            now: Date(timeIntervalSince1970: 1_773_408_000)
        ))
        let loadingState = runtime.markReviewQueueChunkLoading(
            publishedState: replenishableState,
            requestId: request.requestId
        )

        let nextState = try XCTUnwrap(runtime.applyReviewQueueChunkLoadSuccess(
            publishedState: loadingState,
            queueChunkLoadState: ReviewQueueChunkLoadState(
                reviewQueueChunk: [
                    canonicalSecond,
                    pendingCard,
                    presentedCard,
                    acceptedChunkCard,
                    overflowChunkCard
                ],
                hasMoreCards: false
            ),
            requestId: request.requestId,
            sourceVersion: request.sourceVersion
        ))

        XCTAssertEqual(request.chunkSize, 1)
        // Pending card is preserved in the canonical reviewQueue (prepended) so a failed
        // submission can be rolled back. The visible window still respects reviewSeedQueueSize.
        XCTAssertEqual(
            nextState.reviewQueue.map(\.cardId),
            [
                pendingCard.cardId,
                canonicalHead.cardId,
                canonicalSecond.cardId,
                canonicalThird.cardId,
                acceptedChunkCard.cardId
            ]
        )
        XCTAssertEqual(nextState.reviewQueue.count, 5)
        XCTAssertEqual(nextState.pendingReviewCardIds, [pendingCard.cardId])
        XCTAssertEqual(nextState.presentedReviewCard?.cardId, presentedCard.cardId)
        // The read-side effective queue filters pending cards out and is capped by the
        // seed queue size (presented card is prepended ahead of the visible window).
        XCTAssertEqual(
            runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId),
            [
                presentedCard.cardId,
                canonicalHead.cardId,
                canonicalSecond.cardId,
                canonicalThird.cardId,
                acceptedChunkCard.cardId
            ]
        )
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).first?.cardId, presentedCard.cardId)
    }
}
