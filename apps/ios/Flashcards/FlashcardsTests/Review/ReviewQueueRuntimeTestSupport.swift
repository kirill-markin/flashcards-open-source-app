import Foundation
@testable import Flashcards

enum ReviewQueueRuntimeTestSupport {
    static func makeRuntime() -> ReviewQueueRuntime {
        ReviewQueueRuntime(
            reviewSeedQueueSize: 8,
            reviewQueueReplenishmentThreshold: 4
        )
    }

    static func makeSmallRuntime() -> ReviewQueueRuntime {
        ReviewQueueRuntime(
            reviewSeedQueueSize: 4,
            reviewQueueReplenishmentThreshold: 4
        )
    }

    static func makeRollbackValidationContext(
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

    static func makeReviewSubmissionSessionSignatureForTest(
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

    static func makeReviewSubmissionContextForTest(
        selectedReviewFilter: ReviewFilter,
        reviewQueryDefinition: ReviewQueryDefinition
    ) -> ReviewSubmissionContext {
        ReviewSubmissionContext(
            selectedReviewFilter: selectedReviewFilter,
            reviewQueryDefinition: reviewQueryDefinition
        )
    }

    static func makePublishedState(
        reviewQueue: [Card],
        presentedReviewCard: Card?,
        pendingReviewCardIds: Set<String>
    ) -> ReviewQueuePublishedState {
        Self.makePublishedState(
            selectedReviewFilter: .allCards,
            reviewQueue: reviewQueue,
            presentedReviewCard: presentedReviewCard,
            pendingReviewCardIds: pendingReviewCardIds
        )
    }

    static func makePublishedState(
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

    static func makeCard(
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

    static func makeReviewCard(
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

    static func makeReviewDeck(
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
}
