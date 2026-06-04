import XCTest
@testable import Flashcards

final class ReviewQueueSubmissionRollbackTests: XCTestCase {
    private typealias Support = ReviewQueueRuntimeTestSupport

    func testFailReviewSubmissionAfterLaterOwnPendingSubmissionRestoresFirstCard() throws {
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

        let failedState = runtime.failReviewSubmission(
            publishedState: afterSecondSubmissionState,
            request: firstRequest,
            message: "Network failed",
            validationContext: Support.makeRollbackValidationContext(
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

    func testFailReviewSubmissionReturnsLatestCurrentCardToPresentedPosition() throws {
        var runtime = Support.makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCardSnapshot = Support.makeCard(
            cardId: "current-card",
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z"
        )
        let latestCurrentCard = Support.makeCard(
            cardId: submittedCardSnapshot.cardId,
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T08:45:00.000Z"
        )
        let nextCard = Support.makeCard(
            cardId: "next-card",
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z"
        )
        let publishedState = Support.makePublishedState(
            reviewQueue: [nextCard],
            presentedReviewCard: nextCard,
            pendingReviewCardIds: [submittedCardSnapshot.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCardSnapshot.workspaceId,
            cardId: submittedCardSnapshot.cardId,
            reviewContext: Support.makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: Support.makeReviewSubmissionSessionSignatureForTest(
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
            validationContext: Support.makeRollbackValidationContext(
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
        var runtime = Support.makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCardSnapshot = Support.makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: ["Éclair"],
            effortLevel: .fast,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let latestCurrentCard = Support.makeReviewCard(
            cardId: submittedCardSnapshot.cardId,
            workspaceId: submittedCardSnapshot.workspaceId,
            tags: ["Éclair"],
            effortLevel: .fast,
            dueAt: "2026-03-09T08:30:00.000Z",
            updatedAt: "2026-03-09T08:45:00.000Z",
            deletedAt: nil
        )
        let nextCard = Support.makeReviewCard(
            cardId: "next-card",
            workspaceId: submittedCardSnapshot.workspaceId,
            tags: ["plain"],
            effortLevel: .fast,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let deck = Support.makeReviewDeck(
            deckId: "deck-1",
            workspaceId: submittedCardSnapshot.workspaceId,
            filterDefinition: buildDeckFilterDefinition(effortLevels: [], tags: ["éclair"]),
            updatedAt: "2026-03-09T08:30:00.000Z"
        )
        let publishedState = Support.makePublishedState(
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
            reviewSessionSignature: Support.makeReviewSubmissionSessionSignatureForTest(
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
            validationContext: Support.makeRollbackValidationContext(
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
        var runtime = Support.makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let currentCard = Support.makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .fast,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let nextCard = Support.makeReviewCard(
            cardId: "next-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let publishedState = Support.makePublishedState(
            selectedReviewFilter: .effort(level: .medium),
            reviewQueue: [nextCard],
            presentedReviewCard: nextCard,
            pendingReviewCardIds: [currentCard.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: currentCard.workspaceId,
            cardId: currentCard.cardId,
            reviewContext: Support.makeReviewSubmissionContextForTest(
                selectedReviewFilter: .effort(level: .medium),
                reviewQueryDefinition: .deck(
                    filterDefinition: buildDeckFilterDefinition(
                        effortLevels: [.medium],
                        tags: []
                    )
                )
            ),
            reviewSessionSignature: Support.makeReviewSubmissionSessionSignatureForTest(
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
            validationContext: Support.makeRollbackValidationContext(
                currentWorkspaceId: currentCard.workspaceId,
                cards: [currentCard, nextCard],
                decks: [],
                now: now
            )
        )

        XCTAssertEqual(nextState.presentedReviewCard?.cardId, nextCard.cardId)
        XCTAssertEqual(runtime.effectiveReviewQueue(publishedState: nextState).map(\.cardId), [nextCard.cardId])
    }

    func testFailReviewSubmissionFallsBackWhenSnapshotWorkspaceIsNoLongerCurrent() throws {
        var runtime = Support.makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let currentCard = Support.makeReviewCard(
            cardId: "current-card",
            workspaceId: "previous-workspace",
            tags: [],
            effortLevel: .fast,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let nextCard = Support.makeReviewCard(
            cardId: "next-card",
            workspaceId: "current-workspace",
            tags: [],
            effortLevel: .fast,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let publishedState = Support.makePublishedState(
            selectedReviewFilter: .allCards,
            reviewQueue: [nextCard],
            presentedReviewCard: nextCard,
            pendingReviewCardIds: [currentCard.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: currentCard.workspaceId,
            cardId: currentCard.cardId,
            reviewContext: Support.makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: Support.makeReviewSubmissionSessionSignatureForTest(
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
            validationContext: Support.makeRollbackValidationContext(
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
        var runtime = Support.makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCardSnapshot = Support.makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .fast,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let futureCurrentCard = Support.makeReviewCard(
            cardId: submittedCardSnapshot.cardId,
            workspaceId: submittedCardSnapshot.workspaceId,
            tags: [],
            effortLevel: .fast,
            dueAt: "2026-03-10T08:00:00.000Z",
            updatedAt: "2026-03-09T08:30:00.000Z",
            deletedAt: nil
        )
        let nextCard = Support.makeReviewCard(
            cardId: "next-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .fast,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let publishedState = Support.makePublishedState(
            selectedReviewFilter: .allCards,
            reviewQueue: [submittedCardSnapshot, nextCard],
            presentedReviewCard: nextCard,
            pendingReviewCardIds: [submittedCardSnapshot.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCardSnapshot.workspaceId,
            cardId: submittedCardSnapshot.cardId,
            reviewContext: Support.makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: Support.makeReviewSubmissionSessionSignatureForTest(
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
            validationContext: Support.makeRollbackValidationContext(
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
