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
            presentedReviewCard: displayedCurrent,
            pendingReviewCardIds: []
        )

        XCTAssertEqual(
            runtime.effectiveReviewQueue(publishedState: publishedState).map(\.cardId),
            [displayedCurrent.cardId, newlyDueHead.cardId, trailingCard.cardId]
        )
    }

    func testEffectiveReviewQueueUsesCanonicalSnapshotForPresentedCardWhenAvailable() {
        let runtime = makeRuntime()
        let staleDisplayedCurrent = makeCard(
            cardId: "displayed-current",
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let freshDisplayedCurrent = makeCard(
            cardId: "displayed-current",
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let nextCard = makeCard(
            cardId: "next-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let publishedState = makePublishedState(
            reviewQueue: [freshDisplayedCurrent, nextCard],
            presentedReviewCard: staleDisplayedCurrent,
            pendingReviewCardIds: []
        )

        let effectiveReviewQueue = runtime.effectiveReviewQueue(publishedState: publishedState)

        XCTAssertEqual(effectiveReviewQueue.map(\.cardId), [freshDisplayedCurrent.cardId, nextCard.cardId])
        XCTAssertEqual(effectiveReviewQueue.first?.updatedAt, freshDisplayedCurrent.updatedAt)
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
        let presentedCard = makeCard(
            cardId: "presented-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:00:00.000Z"
        )
        let pendingCard = makeCard(
            cardId: "pending-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:01:00.000Z"
        )
        let currentState = makePublishedState(
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

    func testReviewQueueChunkLoadRequestUsesCanonicalVisibleThresholdWithPinnedPresentedCard() throws {
        var runtime = makeRuntime()
        let firstCanonicalCard = makeCard(
            cardId: "first-canonical-card",
            dueAt: "2026-03-09T07:30:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let secondCanonicalCard = makeCard(
            cardId: "second-canonical-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T08:00:00.000Z"
        )
        let thirdCanonicalCard = makeCard(
            cardId: "third-canonical-card",
            dueAt: nil,
            updatedAt: "2026-03-09T08:30:00.000Z"
        )
        let fourthCanonicalCard = makeCard(
            cardId: "fourth-canonical-card",
            dueAt: nil,
            updatedAt: "2026-03-09T08:31:00.000Z"
        )
        let presentedCard = makeCard(
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
        let currentState = makePublishedState(
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
        let presentedCard = makeCard(
            cardId: "presented-card",
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
        var runtime = makeSmallRuntime()
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
        let canonicalThird = makeCard(
            cardId: "canonical-third",
            dueAt: nil,
            updatedAt: "2026-03-09T08:30:00.000Z"
        )
        let pendingCard = makeCard(
            cardId: "pending-card",
            dueAt: nil,
            updatedAt: "2026-03-09T08:31:00.000Z"
        )
        let presentedCard = makeCard(
            cardId: "presented-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:00:00.000Z"
        )
        let acceptedChunkCard = makeCard(
            cardId: "accepted-chunk-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:01:00.000Z"
        )
        let overflowChunkCard = makeCard(
            cardId: "overflow-chunk-card",
            dueAt: nil,
            updatedAt: "2026-03-09T09:02:00.000Z"
        )
        let currentState = makePublishedState(
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
            presentedReviewCard: currentCard,
            pendingReviewCardIds: []
        )
        let reviewContext = makeReviewSubmissionContextForTest(
            selectedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards
        )

        let nextState = try runtime.enqueueReviewSubmission(
            publishedState: publishedState,
            workspaceId: "workspace-1",
            cardId: currentCard.cardId,
            rating: .good,
            reviewContext: reviewContext,
            schedulerSettings: nil
        )

        XCTAssertEqual(runtime.state.pendingReviewRequests.first?.reviewContext, reviewContext)
        XCTAssertEqual(
            runtime.state.pendingReviewRequests.first?.reviewSessionSignature,
            makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [nextCard]
            )
        )
        XCTAssertEqual(nextState.presentedReviewCard?.cardId, nextCard.cardId)
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId), [nextCard.cardId])
    }

    func testReviewSubmissionContextMatchesAfterLaterOwnPendingSubmission() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let firstCard = makeCard(
            cardId: "first-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let secondCard = makeCard(
            cardId: "second-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let thirdCard = makeCard(
            cardId: "third-card",
            dueAt: nil,
            updatedAt: "2026-03-09T05:00:00.000Z"
        )
        let reviewContext = makeReviewSubmissionContextForTest(
            selectedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards
        )
        let initialState = makePublishedState(
            reviewQueue: [firstCard, secondCard, thirdCard],
            presentedReviewCard: firstCard,
            pendingReviewCardIds: []
        )
        let afterFirstSubmissionState = try runtime.enqueueReviewSubmission(
            publishedState: initialState,
            workspaceId: firstCard.workspaceId,
            cardId: firstCard.cardId,
            rating: .good,
            reviewContext: reviewContext,
            schedulerSettings: nil
        )
        let firstRequest = try XCTUnwrap(runtime.state.pendingReviewRequests.first { request in
            request.cardId == firstCard.cardId
        })

        let afterSecondSubmissionState = try runtime.enqueueReviewSubmission(
            publishedState: afterFirstSubmissionState,
            workspaceId: secondCard.workspaceId,
            cardId: secondCard.cardId,
            rating: .good,
            reviewContext: reviewContext,
            schedulerSettings: nil
        )
        let validationContext = makeRollbackValidationContext(
            currentWorkspaceId: firstCard.workspaceId,
            cards: [firstCard, secondCard, thirdCard],
            decks: [],
            now: now
        )

        XCTAssertEqual(
            firstRequest.reviewSessionSignature,
            makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [secondCard, thirdCard]
            )
        )
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: afterSecondSubmissionState).map(\.cardId), [thirdCard.cardId])
        XCTAssertTrue(runtime.reviewSubmissionRequestMatchesCurrentContext(
            publishedState: afterSecondSubmissionState,
            request: firstRequest,
            validationContext: validationContext
        ))

        let completedState = runtime.completeReviewSubmission(
            publishedState: afterSecondSubmissionState,
            request: firstRequest,
            validationContext: validationContext
        )
        XCTAssertEqual(completedState.pendingReviewCardIds, [secondCard.cardId])
        XCTAssertEqual(completedState.presentedReviewCard?.cardId, thirdCard.cardId)
    }

    func testFailReviewSubmissionAfterLaterOwnPendingSubmissionRestoresFirstCard() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let firstCard = makeCard(
            cardId: "first-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let secondCard = makeCard(
            cardId: "second-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let thirdCard = makeCard(
            cardId: "third-card",
            dueAt: nil,
            updatedAt: "2026-03-09T05:00:00.000Z"
        )
        let reviewContext = makeReviewSubmissionContextForTest(
            selectedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards
        )
        let initialState = makePublishedState(
            reviewQueue: [firstCard, secondCard, thirdCard],
            presentedReviewCard: firstCard,
            pendingReviewCardIds: []
        )
        let afterFirstSubmissionState = try runtime.enqueueReviewSubmission(
            publishedState: initialState,
            workspaceId: firstCard.workspaceId,
            cardId: firstCard.cardId,
            rating: .good,
            reviewContext: reviewContext,
            schedulerSettings: nil
        )
        let firstRequest = try XCTUnwrap(runtime.state.pendingReviewRequests.first { request in
            request.cardId == firstCard.cardId
        })
        let afterSecondSubmissionState = try runtime.enqueueReviewSubmission(
            publishedState: afterFirstSubmissionState,
            workspaceId: secondCard.workspaceId,
            cardId: secondCard.cardId,
            rating: .good,
            reviewContext: reviewContext,
            schedulerSettings: nil
        )

        let failedState = runtime.failReviewSubmission(
            publishedState: afterSecondSubmissionState,
            request: firstRequest,
            message: "Network failed",
            validationContext: makeRollbackValidationContext(
                currentWorkspaceId: firstCard.workspaceId,
                cards: [firstCard, secondCard, thirdCard],
                decks: [],
                now: now
            )
        )

        XCTAssertEqual(failedState.pendingReviewCardIds, [secondCard.cardId])
        XCTAssertEqual(failedState.reviewSubmissionFailure?.id, firstRequest.id)
        XCTAssertEqual(failedState.reviewSubmissionFailure?.message, "Network failed")
        XCTAssertEqual(failedState.presentedReviewCard?.cardId, firstCard.cardId)
        XCTAssertEqual(failedState.reviewQueue.map(\.cardId), [secondCard.cardId, thirdCard.cardId])
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: failedState).map(\.cardId), [firstCard.cardId, thirdCard.cardId])
    }

    func testCompleteReviewSubmissionFromStaleContextOnlyClearsMatchingPendingState() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCard = makeReviewCard(
            cardId: "submitted-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let currentCard = makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let otherPendingCard = makeReviewCard(
            cardId: "other-pending-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:30:00.000Z",
            deletedAt: nil
        )
        let existingFailure = ReviewSubmissionFailure(id: "existing-failure", message: "Existing failure")
        let publishedState = ReviewQueuePublishedState(
            selectedReviewFilter: .effort(level: .medium),
            reviewQueue: [currentCard, submittedCard],
            presentedReviewCard: currentCard,
            reviewCounts: ReviewCounts(dueCount: 7, totalCount: 9),
            isReviewHeadLoading: true,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: true,
            pendingReviewCardIds: [submittedCard.cardId, otherPendingCard.cardId],
            reviewSubmissionFailure: existingFailure
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCard.workspaceId,
            cardId: submittedCard.cardId,
            reviewContext: makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [currentCard]
            ),
            cardSnapshot: submittedCard,
            rating: .good,
            reviewedAtClient: "2026-03-09T09:00:00.000Z"
        )

        let nextState = runtime.completeReviewSubmission(
            publishedState: publishedState,
            request: request,
            validationContext: makeRollbackValidationContext(
                currentWorkspaceId: submittedCard.workspaceId,
                cards: [submittedCard, currentCard, otherPendingCard],
                decks: [],
                now: now
            )
        )

        XCTAssertEqual(nextState.selectedReviewFilter, publishedState.selectedReviewFilter)
        XCTAssertEqual(nextState.reviewQueue, publishedState.reviewQueue)
        XCTAssertEqual(nextState.presentedReviewCard, publishedState.presentedReviewCard)
        XCTAssertEqual(nextState.reviewCounts, publishedState.reviewCounts)
        XCTAssertEqual(nextState.isReviewHeadLoading, publishedState.isReviewHeadLoading)
        XCTAssertEqual(nextState.isReviewCountsLoading, publishedState.isReviewCountsLoading)
        XCTAssertEqual(nextState.isReviewQueueChunkLoading, publishedState.isReviewQueueChunkLoading)
        XCTAssertEqual(nextState.pendingReviewCardIds, [otherPendingCard.cardId])
        XCTAssertEqual(nextState.reviewSubmissionFailure, existingFailure)
    }

    func testFailReviewSubmissionReturnsLatestCurrentCardToPresentedPosition() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCardSnapshot = makeCard(
            cardId: "current-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let latestCurrentCard = makeCard(
            cardId: submittedCardSnapshot.cardId,
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T08:45:00.000Z"
        )
        let nextCard = makeCard(
            cardId: "next-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let publishedState = makePublishedState(
            reviewQueue: [nextCard],
            presentedReviewCard: nextCard,
            pendingReviewCardIds: [submittedCardSnapshot.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCardSnapshot.workspaceId,
            cardId: submittedCardSnapshot.cardId,
            reviewContext: makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [nextCard]
            ),
            cardSnapshot: submittedCardSnapshot,
            rating: .good,
            reviewedAtClient: "2026-03-09T09:00:00.000Z"
        )

        let nextState = runtime.failReviewSubmission(
            publishedState: publishedState,
            request: request,
            message: "Network failed",
            validationContext: makeRollbackValidationContext(
                currentWorkspaceId: submittedCardSnapshot.workspaceId,
                cards: [latestCurrentCard, nextCard],
                decks: [],
                now: now
            )
        )

        XCTAssertEqual(nextState.presentedReviewCard?.cardId, latestCurrentCard.cardId)
        XCTAssertEqual(nextState.presentedReviewCard?.updatedAt, latestCurrentCard.updatedAt)
        XCTAssertEqual(nextState.reviewQueue.map(\.cardId), [nextCard.cardId])
        XCTAssertEqual(
            runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId),
            [latestCurrentCard.cardId, nextCard.cardId]
        )
        XCTAssertEqual(
            runtime.effectiveReviewQueue(publishedState: nextState).first?.updatedAt,
            latestCurrentCard.updatedAt
        )
    }

    func testFailReviewSubmissionRestoresDeckFilterCardMatchedByNormalizedUnicodeTag() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCardSnapshot = makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: ["Éclair"],
            effortLevel: .fast,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let latestCurrentCard = makeReviewCard(
            cardId: submittedCardSnapshot.cardId,
            workspaceId: submittedCardSnapshot.workspaceId,
            tags: ["Éclair"],
            effortLevel: .fast,
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T08:45:00.000Z",
            deletedAt: nil
        )
        let nextCard = makeReviewCard(
            cardId: "next-card",
            workspaceId: submittedCardSnapshot.workspaceId,
            tags: ["plain"],
            effortLevel: .fast,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let deck = makeReviewDeck(
            deckId: "deck-1",
            workspaceId: submittedCardSnapshot.workspaceId,
            filterDefinition: buildDeckFilterDefinition(effortLevels: [], tags: ["éclair"]),
            updatedAt: "2026-03-09T08:30:00.000Z"
        )
        let publishedState = makePublishedState(
            selectedReviewFilter: .deck(deckId: deck.deckId),
            reviewQueue: [nextCard],
            presentedReviewCard: nextCard,
            pendingReviewCardIds: [submittedCardSnapshot.cardId]
        )
        let reviewContext = makeReviewSubmissionContext(
            selectedReviewFilter: .deck(deckId: deck.deckId),
            decks: [deck],
            cards: [submittedCardSnapshot, nextCard]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCardSnapshot.workspaceId,
            cardId: submittedCardSnapshot.cardId,
            reviewContext: reviewContext,
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .deck(deckId: deck.deckId),
                reviewQueue: [nextCard]
            ),
            cardSnapshot: submittedCardSnapshot,
            rating: .good,
            reviewedAtClient: "2026-03-09T09:00:00.000Z"
        )

        let nextState = runtime.failReviewSubmission(
            publishedState: publishedState,
            request: request,
            message: "Network failed",
            validationContext: makeRollbackValidationContext(
                currentWorkspaceId: submittedCardSnapshot.workspaceId,
                cards: [latestCurrentCard, nextCard],
                decks: [deck],
                now: now
            )
        )

        XCTAssertEqual(nextState.presentedReviewCard?.cardId, latestCurrentCard.cardId)
        XCTAssertEqual(nextState.presentedReviewCard?.updatedAt, latestCurrentCard.updatedAt)
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId), [latestCurrentCard.cardId, nextCard.cardId])
    }

    func testFailReviewSubmissionFallsBackWhenSnapshotDoesNotMatchCurrentFilter() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let currentCard = makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .fast,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let nextCard = makeReviewCard(
            cardId: "next-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let publishedState = makePublishedState(
            selectedReviewFilter: .effort(level: .medium),
            reviewQueue: [nextCard],
            presentedReviewCard: nextCard,
            pendingReviewCardIds: [currentCard.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: currentCard.workspaceId,
            cardId: currentCard.cardId,
            reviewContext: makeReviewSubmissionContextForTest(
                selectedReviewFilter: .effort(level: .medium),
                reviewQueryDefinition: .deck(
                    filterDefinition: buildDeckFilterDefinition(
                        effortLevels: [.medium],
                        tags: []
                    )
                )
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .effort(level: .medium),
                reviewQueue: [nextCard]
            ),
            cardSnapshot: currentCard,
            rating: .good,
            reviewedAtClient: "2026-03-09T09:00:00.000Z"
        )

        let nextState = runtime.failReviewSubmission(
            publishedState: publishedState,
            request: request,
            message: "Network failed",
            validationContext: makeRollbackValidationContext(
                currentWorkspaceId: currentCard.workspaceId,
                cards: [currentCard, nextCard],
                decks: [],
                now: now
            )
        )

        XCTAssertEqual(nextState.presentedReviewCard?.cardId, nextCard.cardId)
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId), [nextCard.cardId])
    }

    func testFailReviewSubmissionFromStaleSelectedFilterClearsPendingWithoutPinningRollbackCard() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCard = makeReviewCard(
            cardId: "submitted-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let currentCard = makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let publishedState = makePublishedState(
            selectedReviewFilter: .effort(level: .medium),
            reviewQueue: [currentCard],
            presentedReviewCard: currentCard,
            pendingReviewCardIds: [submittedCard.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCard.workspaceId,
            cardId: submittedCard.cardId,
            reviewContext: makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [currentCard]
            ),
            cardSnapshot: submittedCard,
            rating: .good,
            reviewedAtClient: "2026-03-09T09:00:00.000Z"
        )

        let nextState = runtime.failReviewSubmission(
            publishedState: publishedState,
            request: request,
            message: "Network failed",
            validationContext: makeRollbackValidationContext(
                currentWorkspaceId: submittedCard.workspaceId,
                cards: [submittedCard, currentCard],
                decks: [],
                now: now
            )
        )

        XCTAssertEqual(nextState.presentedReviewCard?.cardId, currentCard.cardId)
        XCTAssertEqual(nextState.reviewQueue.map(\.cardId), [currentCard.cardId])
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId), [currentCard.cardId])
        XCTAssertFalse(nextState.pendingReviewCardIds.contains(submittedCard.cardId))
        XCTAssertNil(nextState.reviewSubmissionFailure)
    }

    func testFailReviewSubmissionFromStaleDeckFilterDefinitionKeepsCurrentCanonicalQueue() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let oldFilterDefinition = buildDeckFilterDefinition(effortLevels: [], tags: ["old"])
        let currentFilterDefinition = buildDeckFilterDefinition(effortLevels: [], tags: ["new"])
        let submittedCard = makeReviewCard(
            cardId: "submitted-card",
            workspaceId: "test-workspace",
            tags: ["new"],
            effortLevel: .medium,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let currentCard = makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: ["new"],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let currentDeck = makeReviewDeck(
            deckId: "deck-1",
            workspaceId: "test-workspace",
            filterDefinition: currentFilterDefinition,
            updatedAt: "2026-03-09T08:30:00.000Z"
        )
        let publishedState = makePublishedState(
            selectedReviewFilter: .deck(deckId: currentDeck.deckId),
            reviewQueue: [submittedCard, currentCard],
            presentedReviewCard: currentCard,
            pendingReviewCardIds: [submittedCard.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCard.workspaceId,
            cardId: submittedCard.cardId,
            reviewContext: makeReviewSubmissionContextForTest(
                selectedReviewFilter: .deck(deckId: currentDeck.deckId),
                reviewQueryDefinition: .deck(filterDefinition: oldFilterDefinition)
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .deck(deckId: currentDeck.deckId),
                reviewQueue: [currentCard]
            ),
            cardSnapshot: submittedCard,
            rating: .good,
            reviewedAtClient: "2026-03-09T09:00:00.000Z"
        )

        let nextState = runtime.failReviewSubmission(
            publishedState: publishedState,
            request: request,
            message: "Network failed",
            validationContext: makeRollbackValidationContext(
                currentWorkspaceId: submittedCard.workspaceId,
                cards: [submittedCard, currentCard],
                decks: [currentDeck],
                now: now
            )
        )

        XCTAssertEqual(nextState.presentedReviewCard?.cardId, currentCard.cardId)
        XCTAssertEqual(nextState.reviewQueue.map(\.cardId), [submittedCard.cardId, currentCard.cardId])
        XCTAssertEqual(
            runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId),
            [currentCard.cardId, submittedCard.cardId]
        )
        XCTAssertFalse(nextState.pendingReviewCardIds.contains(submittedCard.cardId))
        XCTAssertNil(nextState.reviewSubmissionFailure)
    }

    func testFailReviewSubmissionFromStaleContextOnlyClearsMatchingPendingState() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCard = makeReviewCard(
            cardId: "submitted-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let currentCard = makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let otherPendingCard = makeReviewCard(
            cardId: "other-pending-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:30:00.000Z",
            deletedAt: nil
        )
        let publishedState = ReviewQueuePublishedState(
            selectedReviewFilter: .effort(level: .medium),
            reviewQueue: [currentCard, submittedCard],
            presentedReviewCard: currentCard,
            reviewCounts: ReviewCounts(dueCount: 7, totalCount: 9),
            isReviewHeadLoading: true,
            isReviewCountsLoading: true,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: [submittedCard.cardId, otherPendingCard.cardId],
            reviewSubmissionFailure: nil
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCard.workspaceId,
            cardId: submittedCard.cardId,
            reviewContext: makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [currentCard]
            ),
            cardSnapshot: submittedCard,
            rating: .good,
            reviewedAtClient: "2026-03-09T09:00:00.000Z"
        )

        let nextState = runtime.failReviewSubmission(
            publishedState: publishedState,
            request: request,
            message: "Network failed",
            validationContext: makeRollbackValidationContext(
                currentWorkspaceId: submittedCard.workspaceId,
                cards: [submittedCard, currentCard, otherPendingCard],
                decks: [],
                now: now
            )
        )

        XCTAssertEqual(nextState.selectedReviewFilter, publishedState.selectedReviewFilter)
        XCTAssertEqual(nextState.reviewQueue, publishedState.reviewQueue)
        XCTAssertEqual(nextState.presentedReviewCard, publishedState.presentedReviewCard)
        XCTAssertEqual(nextState.reviewCounts, publishedState.reviewCounts)
        XCTAssertEqual(nextState.isReviewHeadLoading, publishedState.isReviewHeadLoading)
        XCTAssertEqual(nextState.isReviewCountsLoading, publishedState.isReviewCountsLoading)
        XCTAssertEqual(nextState.isReviewQueueChunkLoading, publishedState.isReviewQueueChunkLoading)
        XCTAssertEqual(nextState.pendingReviewCardIds, [otherPendingCard.cardId])
        XCTAssertNil(nextState.reviewSubmissionFailure)
    }

    func testFailReviewSubmissionFromStaleReviewSessionClearsPendingWithoutPinningRollbackCard() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCard = makeReviewCard(
            cardId: "submitted-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let oldNextCard = makeReviewCard(
            cardId: "old-next-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let currentCard = makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:30:00.000Z",
            deletedAt: nil
        )
        let otherPendingCard = makeReviewCard(
            cardId: "other-pending-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:45:00.000Z",
            deletedAt: nil
        )
        let publishedState = ReviewQueuePublishedState(
            selectedReviewFilter: .allCards,
            reviewQueue: [currentCard],
            presentedReviewCard: currentCard,
            reviewCounts: ReviewCounts(dueCount: 5, totalCount: 8),
            isReviewHeadLoading: false,
            isReviewCountsLoading: true,
            isReviewQueueChunkLoading: true,
            pendingReviewCardIds: [submittedCard.cardId, otherPendingCard.cardId],
            reviewSubmissionFailure: nil
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCard.workspaceId,
            cardId: submittedCard.cardId,
            reviewContext: makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [oldNextCard]
            ),
            cardSnapshot: submittedCard,
            rating: .good,
            reviewedAtClient: "2026-03-09T09:00:00.000Z"
        )

        let nextState = runtime.failReviewSubmission(
            publishedState: publishedState,
            request: request,
            message: "Network failed",
            validationContext: makeRollbackValidationContext(
                currentWorkspaceId: submittedCard.workspaceId,
                cards: [submittedCard, currentCard, otherPendingCard],
                decks: [],
                now: now
            )
        )

        XCTAssertEqual(nextState.selectedReviewFilter, publishedState.selectedReviewFilter)
        XCTAssertEqual(nextState.reviewQueue, publishedState.reviewQueue)
        XCTAssertEqual(nextState.presentedReviewCard, publishedState.presentedReviewCard)
        XCTAssertEqual(nextState.reviewCounts, publishedState.reviewCounts)
        XCTAssertEqual(nextState.isReviewHeadLoading, publishedState.isReviewHeadLoading)
        XCTAssertEqual(nextState.isReviewCountsLoading, publishedState.isReviewCountsLoading)
        XCTAssertEqual(nextState.isReviewQueueChunkLoading, publishedState.isReviewQueueChunkLoading)
        XCTAssertEqual(nextState.pendingReviewCardIds, [otherPendingCard.cardId])
        XCTAssertNil(nextState.reviewSubmissionFailure)
    }

    func testFailReviewSubmissionFallsBackWhenSnapshotWorkspaceIsNoLongerCurrent() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let currentCard = makeReviewCard(
            cardId: "current-card",
            workspaceId: "previous-workspace",
            tags: [],
            effortLevel: .fast,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let nextCard = makeReviewCard(
            cardId: "next-card",
            workspaceId: "current-workspace",
            tags: [],
            effortLevel: .fast,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let publishedState = makePublishedState(
            selectedReviewFilter: .allCards,
            reviewQueue: [nextCard],
            presentedReviewCard: nextCard,
            pendingReviewCardIds: [currentCard.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: currentCard.workspaceId,
            cardId: currentCard.cardId,
            reviewContext: makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [nextCard]
            ),
            cardSnapshot: currentCard,
            rating: .good,
            reviewedAtClient: "2026-03-09T09:00:00.000Z"
        )

        let nextState = runtime.failReviewSubmission(
            publishedState: publishedState,
            request: request,
            message: "Network failed",
            validationContext: makeRollbackValidationContext(
                currentWorkspaceId: nextCard.workspaceId,
                cards: [nextCard],
                decks: [],
                now: now
            )
        )

        XCTAssertEqual(nextState.presentedReviewCard?.cardId, nextCard.cardId)
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId), [nextCard.cardId])
    }

    func testFailReviewSubmissionRemovesInvalidSubmittedCardFromCanonicalQueue() throws {
        var runtime = makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCardSnapshot = makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .fast,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let futureCurrentCard = makeReviewCard(
            cardId: submittedCardSnapshot.cardId,
            workspaceId: submittedCardSnapshot.workspaceId,
            tags: [],
            effortLevel: .fast,
            dueAt: "2026-03-10T08:00:00.000Z",
            updatedAt: "2026-03-09T08:30:00.000Z",
            deletedAt: nil
        )
        let nextCard = makeReviewCard(
            cardId: "next-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .fast,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let publishedState = makePublishedState(
            selectedReviewFilter: .allCards,
            reviewQueue: [submittedCardSnapshot, nextCard],
            presentedReviewCard: nextCard,
            pendingReviewCardIds: [submittedCardSnapshot.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCardSnapshot.workspaceId,
            cardId: submittedCardSnapshot.cardId,
            reviewContext: makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [nextCard]
            ),
            cardSnapshot: submittedCardSnapshot,
            rating: .good,
            reviewedAtClient: "2026-03-09T09:00:00.000Z"
        )

        let nextState = runtime.failReviewSubmission(
            publishedState: publishedState,
            request: request,
            message: "Network failed",
            validationContext: makeRollbackValidationContext(
                currentWorkspaceId: submittedCardSnapshot.workspaceId,
                cards: [futureCurrentCard, nextCard],
                decks: [],
                now: now
            )
        )

        XCTAssertEqual(nextState.presentedReviewCard?.cardId, nextCard.cardId)
        XCTAssertEqual(nextState.reviewQueue.map(\.cardId), [nextCard.cardId])
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId), [nextCard.cardId])
    }
}

private func makeRuntime() -> ReviewQueueRuntime {
    ReviewQueueRuntime(
        reviewSeedQueueSize: 8,
        reviewQueueReplenishmentThreshold: 4
    )
}

private func makeSmallRuntime() -> ReviewQueueRuntime {
    ReviewQueueRuntime(
        reviewSeedQueueSize: 4,
        reviewQueueReplenishmentThreshold: 4
    )
}

private func makeRollbackValidationContext(
    currentWorkspaceId: String,
    cards: [Card],
    decks: [Deck],
    now: Date
) -> ReviewSubmissionRollbackValidationContext {
    ReviewSubmissionRollbackValidationContext(
        currentWorkspaceId: currentWorkspaceId,
        cards: cards,
        decks: decks,
        schedulerSettings: nil,
        now: now
    )
}

private func makeReviewSubmissionSessionSignatureForTest(
    selectedReviewFilter: ReviewFilter,
    reviewQueue: [Card]
) -> ReviewSessionSignature {
    makeReviewSessionSignature(
        selectedReviewFilter: selectedReviewFilter,
        reviewQueue: reviewQueue,
        schedulerSettings: nil,
        seedQueueSize: 8
    )
}

private func makeReviewSubmissionContextForTest(
    selectedReviewFilter: ReviewFilter,
    reviewQueryDefinition: ReviewQueryDefinition
) -> ReviewSubmissionContext {
    ReviewSubmissionContext(
        selectedReviewFilter: selectedReviewFilter,
        reviewQueryDefinition: reviewQueryDefinition
    )
}

private func makePublishedState(
    reviewQueue: [Card],
    presentedReviewCard: Card?,
    pendingReviewCardIds: Set<String>
) -> ReviewQueuePublishedState {
    makePublishedState(
        selectedReviewFilter: .allCards,
        reviewQueue: reviewQueue,
        presentedReviewCard: presentedReviewCard,
        pendingReviewCardIds: pendingReviewCardIds
    )
}

private func makePublishedState(
    selectedReviewFilter: ReviewFilter,
    reviewQueue: [Card],
    presentedReviewCard: Card?,
    pendingReviewCardIds: Set<String>
) -> ReviewQueuePublishedState {
    ReviewQueuePublishedState(
        selectedReviewFilter: selectedReviewFilter,
        reviewQueue: reviewQueue,
        presentedReviewCard: presentedReviewCard,
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

private func makeReviewCard(
    cardId: String,
    workspaceId: String,
    tags: [String],
    effortLevel: EffortLevel,
    dueAt: String?,
    updatedAt: String,
    deletedAt: String?
) -> Card {
    Card(
        cardId: cardId,
        workspaceId: workspaceId,
        frontText: "Front \(cardId)",
        backText: "Back \(cardId)",
        tags: tags,
        effortLevel: effortLevel,
        dueAt: dueAt,
        createdAt: updatedAt,
        reps: 0,
        lapses: 0,
        fsrsCardState: .new,
        fsrsStepIndex: nil,
        fsrsStability: nil,
        fsrsDifficulty: nil,
        fsrsLastReviewedAt: nil,
        fsrsScheduledDays: nil,
        clientUpdatedAt: updatedAt,
        lastModifiedByReplicaId: "replica",
        lastOperationId: "operation",
        updatedAt: updatedAt,
        deletedAt: deletedAt
    )
}

private func makeReviewDeck(
    deckId: String,
    workspaceId: String,
    filterDefinition: DeckFilterDefinition,
    updatedAt: String
) -> Deck {
    Deck(
        deckId: deckId,
        workspaceId: workspaceId,
        name: "Deck \(deckId)",
        filterDefinition: filterDefinition,
        createdAt: updatedAt,
        clientUpdatedAt: updatedAt,
        lastModifiedByReplicaId: "replica",
        lastOperationId: "operation",
        updatedAt: updatedAt,
        deletedAt: nil
    )
}
