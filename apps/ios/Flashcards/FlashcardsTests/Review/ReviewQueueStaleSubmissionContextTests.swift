import XCTest
@testable import Flashcards

final class ReviewQueueStaleSubmissionContextTests: XCTestCase {
    private typealias Support = ReviewQueueRuntimeTestSupport

    func testCompleteReviewSubmissionFromStaleContextOnlyClearsMatchingPendingState() throws {
        var runtime = Support.makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCard = Support.makeReviewCard(
            cardId: "submitted-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let currentCard = Support.makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let otherPendingCard = Support.makeReviewCard(
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
            reviewContext: Support.makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: Support.makeReviewSubmissionSessionSignatureForTest(
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
            validationContext: Support.makeRollbackValidationContext(
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

    func testFailReviewSubmissionFromStaleSelectedFilterClearsPendingWithoutPinningRollbackCard() throws {
        var runtime = Support.makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCard = Support.makeReviewCard(
            cardId: "submitted-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let currentCard = Support.makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let publishedState = Support.makePublishedState(
            selectedReviewFilter: .effort(level: .medium),
            reviewQueue: [currentCard],
            presentedReviewCard: currentCard,
            pendingReviewCardIds: [submittedCard.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCard.workspaceId,
            cardId: submittedCard.cardId,
            reviewContext: Support.makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: Support.makeReviewSubmissionSessionSignatureForTest(
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
            validationContext: Support.makeRollbackValidationContext(
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
        var runtime = Support.makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let oldFilterDefinition = buildDeckFilterDefinition(effortLevels: [], tags: ["old"])
        let currentFilterDefinition = buildDeckFilterDefinition(effortLevels: [], tags: ["new"])
        let submittedCard = Support.makeReviewCard(
            cardId: "submitted-card",
            workspaceId: "test-workspace",
            tags: ["new"],
            effortLevel: .medium,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let currentCard = Support.makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: ["new"],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let currentDeck = Support.makeReviewDeck(
            deckId: "deck-1",
            workspaceId: "test-workspace",
            filterDefinition: currentFilterDefinition,
            updatedAt: "2026-03-09T08:30:00.000Z"
        )
        let publishedState = Support.makePublishedState(
            selectedReviewFilter: .deck(deckId: currentDeck.deckId),
            reviewQueue: [submittedCard, currentCard],
            presentedReviewCard: currentCard,
            pendingReviewCardIds: [submittedCard.cardId]
        )
        let request = ReviewSubmissionRequest(
            id: "request-1",
            workspaceId: submittedCard.workspaceId,
            cardId: submittedCard.cardId,
            reviewContext: Support.makeReviewSubmissionContextForTest(
                selectedReviewFilter: .deck(deckId: currentDeck.deckId),
                reviewQueryDefinition: .deck(filterDefinition: oldFilterDefinition)
            ),
            reviewSessionSignature: Support.makeReviewSubmissionSessionSignatureForTest(
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
            validationContext: Support.makeRollbackValidationContext(
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
        var runtime = Support.makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCard = Support.makeReviewCard(
            cardId: "submitted-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let currentCard = Support.makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let otherPendingCard = Support.makeReviewCard(
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
            reviewContext: Support.makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: Support.makeReviewSubmissionSessionSignatureForTest(
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
            validationContext: Support.makeRollbackValidationContext(
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
        var runtime = Support.makeRuntime()
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T09:00:00.000Z"))
        let submittedCard = Support.makeReviewCard(
            cardId: "submitted-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: "2026-03-09T08:00:00.000Z",
            updatedAt: "2026-03-09T07:00:00.000Z",
            deletedAt: nil
        )
        let oldNextCard = Support.makeReviewCard(
            cardId: "old-next-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:00:00.000Z",
            deletedAt: nil
        )
        let currentCard = Support.makeReviewCard(
            cardId: "current-card",
            workspaceId: "test-workspace",
            tags: [],
            effortLevel: .medium,
            dueAt: nil,
            updatedAt: "2026-03-09T06:30:00.000Z",
            deletedAt: nil
        )
        let otherPendingCard = Support.makeReviewCard(
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
            reviewContext: Support.makeReviewSubmissionContextForTest(
                selectedReviewFilter: .allCards,
                reviewQueryDefinition: .allCards
            ),
            reviewSessionSignature: Support.makeReviewSubmissionSessionSignatureForTest(
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
            validationContext: Support.makeRollbackValidationContext(
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
}
