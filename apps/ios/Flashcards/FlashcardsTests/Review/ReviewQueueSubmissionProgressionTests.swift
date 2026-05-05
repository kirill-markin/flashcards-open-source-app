import XCTest
@testable import Flashcards

final class ReviewQueueSubmissionProgressionTests: XCTestCase {
    private typealias Support = ReviewQueueRuntimeTestSupport

    func testEnqueueReviewSubmissionAdvancesPresentedCardToNextVisibleCard() throws {
        var runtime = Support.makeRuntime()
        let currentCard = Support.makeCard(
            cardId: "current-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let nextCard = Support.makeCard(
            cardId: "next-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let publishedState = Support.makePublishedState(
            reviewQueue: [currentCard, nextCard],
            presentedReviewCard: currentCard,
            pendingReviewCardIds: []
        )
        let reviewContext = Support.makeReviewSubmissionContextForTest(
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
            Support.makeReviewSubmissionSessionSignatureForTest(
                selectedReviewFilter: .allCards,
                reviewQueue: [nextCard]
            )
        )
        XCTAssertEqual(nextState.presentedReviewCard?.cardId, nextCard.cardId)
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId), [nextCard.cardId])
    }

    func testReviewSubmissionContextMatchesAfterLaterOwnPendingSubmission() throws {
        var runtime = Support.makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let firstCard = Support.makeCard(
            cardId: "first-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let secondCard = Support.makeCard(
            cardId: "second-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let thirdCard = Support.makeCard(
            cardId: "third-card",
            dueAt: nil,
            updatedAt: "2026-03-09T05:00:00.000Z"
        )
        let reviewContext = Support.makeReviewSubmissionContextForTest(
            selectedReviewFilter: .allCards,
            reviewQueryDefinition: .allCards
        )
        let initialState = Support.makePublishedState(
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
        let validationContext = Support.makeRollbackValidationContext(
            currentWorkspaceId: firstCard.workspaceId,
            cards: [firstCard, secondCard, thirdCard],
            decks: [],
            now: now
        )

        XCTAssertEqual(
            firstRequest.reviewSessionSignature,
            Support.makeReviewSubmissionSessionSignatureForTest(
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
}
