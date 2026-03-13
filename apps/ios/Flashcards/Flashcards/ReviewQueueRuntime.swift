import Foundation

struct ReviewQueuePublishedState: Hashable {
    let selectedReviewFilter: ReviewFilter
    let reviewQueue: [Card]
    let reviewCounts: ReviewCounts
    let isReviewHeadLoading: Bool
    let isReviewCountsLoading: Bool
    let isReviewQueueChunkLoading: Bool
    let pendingReviewCardIds: Set<String>
    let reviewSubmissionFailure: ReviewSubmissionFailure?
}

struct ReviewQueueRuntimeState {
    var activeReviewLoadTask: Task<Void, Never>?
    var activeReviewLoadRequestId: String?
    var activeReviewCountsTask: Task<Void, Never>?
    var activeReviewCountsRequestId: String?
    var activeReviewQueueChunkTask: Task<Void, Never>?
    var activeReviewQueueChunkRequestId: String?
    var pendingReviewRequests: [ReviewSubmissionRequest]
    var isReviewProcessorRunning: Bool
    var reviewSourceVersion: Int
    var loadedReviewCardIds: Set<String>
    var hasMoreReviewQueueCards: Bool
}

struct ReviewHeadLoadRequest {
    let requestId: String
    let sourceVersion: Int
    let reviewFilter: ReviewFilter
    let decks: [Deck]
    let cards: [Card]
    let now: Date
    let seedQueueSize: Int
}

struct ReviewCountsLoadRequest {
    let databaseURL: URL
    let workspaceId: String
    let reviewQueryDefinition: ReviewQueryDefinition
    let now: Date
    let requestId: String
    let sourceVersion: Int
}

struct ReviewQueueChunkLoadRequest {
    let requestId: String
    let sourceVersion: Int
    let reviewFilter: ReviewFilter
    let decks: [Deck]
    let cards: [Card]
    let excludedCardIds: Set<String>
    let now: Date
    let chunkSize: Int
}

struct ReviewLoadPlan {
    let publishedState: ReviewQueuePublishedState
    let headRequest: ReviewHeadLoadRequest
    let countsRequest: ReviewCountsLoadRequest?
}

struct ReviewQueueRuntime {
    private let reviewSeedQueueSize: Int
    private let reviewQueueReplenishmentThreshold: Int
    private(set) var state: ReviewQueueRuntimeState

    init(
        initialSelectedReviewFilter: ReviewFilter,
        reviewSeedQueueSize: Int,
        reviewQueueReplenishmentThreshold: Int
    ) {
        self.reviewSeedQueueSize = reviewSeedQueueSize
        self.reviewQueueReplenishmentThreshold = reviewQueueReplenishmentThreshold
        self.state = ReviewQueueRuntimeState(
            activeReviewLoadTask: nil,
            activeReviewLoadRequestId: nil,
            activeReviewCountsTask: nil,
            activeReviewCountsRequestId: nil,
            activeReviewQueueChunkTask: nil,
            activeReviewQueueChunkRequestId: nil,
            pendingReviewRequests: [],
            isReviewProcessorRunning: false,
            reviewSourceVersion: 0,
            loadedReviewCardIds: [],
            hasMoreReviewQueueCards: false
        )
        _ = initialSelectedReviewFilter
    }

    static func makeInitialPublishedState(selectedReviewFilter: ReviewFilter) -> ReviewQueuePublishedState {
        ReviewQueuePublishedState(
            selectedReviewFilter: selectedReviewFilter,
            reviewQueue: [],
            reviewCounts: ReviewCounts(dueCount: 0, totalCount: 0),
            isReviewHeadLoading: false,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: [],
            reviewSubmissionFailure: nil
        )
    }

    func effectiveReviewQueue(publishedState: ReviewQueuePublishedState) -> [Card] {
        publishedState.reviewQueue.filter { card in
            publishedState.pendingReviewCardIds.contains(card.cardId) == false
        }
    }

    func pendingReviewCount(
        publishedState: ReviewQueuePublishedState,
        cards: [Card],
        decks: [Deck]
    ) -> Int {
        let resolvedReviewQuery = resolveReviewQuery(
            reviewFilter: publishedState.selectedReviewFilter,
            decks: decks,
            cards: cards
        )

        return publishedState.pendingReviewCardIds.reduce(into: 0) { result, cardId in
            guard let card = cards.first(where: { existingCard in
                existingCard.cardId == cardId
            }) else {
                return
            }
            guard card.deletedAt == nil else {
                return
            }

            let isIncluded: Bool
            switch resolvedReviewQuery.queryDefinition {
            case .allCards:
                isIncluded = true
            case .deck(let filterDefinition):
                isIncluded = matchesDeckFilterDefinition(filterDefinition: filterDefinition, card: card)
            case .tag(let tag):
                isIncluded = card.tags.contains(tag)
            }

            if isIncluded {
                result += 1
            }
        }
    }

    mutating func startReviewLoad(
        publishedState: ReviewQueuePublishedState,
        reviewFilter: ReviewFilter,
        cards: [Card],
        decks: [Deck],
        workspaceId: String?,
        databaseURL: URL?,
        now: Date
    ) -> ReviewLoadPlan {
        self.cancelActiveReviewLoads()

        let requestId = UUID().uuidString.lowercased()
        let sourceVersion = self.state.reviewSourceVersion
        let resolvedReviewQuery = resolveReviewQuery(
            reviewFilter: reviewFilter,
            decks: decks,
            cards: cards
        )

        let nextPublishedState = ReviewQueuePublishedState(
            selectedReviewFilter: resolvedReviewQuery.reviewFilter,
            reviewQueue: [],
            reviewCounts: ReviewCounts(dueCount: 0, totalCount: 0),
            isReviewHeadLoading: true,
            isReviewCountsLoading: true,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: nil
        )
        self.state.activeReviewLoadRequestId = requestId
        self.state.loadedReviewCardIds = []
        self.state.hasMoreReviewQueueCards = false

        let headRequest = ReviewHeadLoadRequest(
            requestId: requestId,
            sourceVersion: sourceVersion,
            reviewFilter: resolvedReviewQuery.reviewFilter,
            decks: decks,
            cards: cards,
            now: now,
            seedQueueSize: self.reviewSeedQueueSize
        )

        let countsRequest: ReviewCountsLoadRequest?
        if let workspaceId, let databaseURL {
            countsRequest = ReviewCountsLoadRequest(
                databaseURL: databaseURL,
                workspaceId: workspaceId,
                reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
                now: now,
                requestId: requestId,
                sourceVersion: sourceVersion
            )
        } else {
            countsRequest = nil
        }

        return ReviewLoadPlan(
            publishedState: countsRequest == nil
                ? ReviewQueuePublishedState(
                    selectedReviewFilter: nextPublishedState.selectedReviewFilter,
                    reviewQueue: nextPublishedState.reviewQueue,
                    reviewCounts: nextPublishedState.reviewCounts,
                    isReviewHeadLoading: nextPublishedState.isReviewHeadLoading,
                    isReviewCountsLoading: false,
                    isReviewQueueChunkLoading: nextPublishedState.isReviewQueueChunkLoading,
                    pendingReviewCardIds: nextPublishedState.pendingReviewCardIds,
                    reviewSubmissionFailure: nextPublishedState.reviewSubmissionFailure
                )
                : nextPublishedState,
            headRequest: headRequest,
            countsRequest: countsRequest
        )
    }

    mutating func refreshPublishedState(
        publishedState: ReviewQueuePublishedState,
        cards: [Card],
        decks: [Deck],
        now: Date
    ) -> ReviewQueuePublishedState {
        self.state.reviewSourceVersion += 1
        self.cancelActiveReviewLoads()

        let resolvedReviewQuery = resolveReviewQuery(
            reviewFilter: publishedState.selectedReviewFilter,
            decks: decks,
            cards: cards
        )
        let reviewHeadState = makeReviewHeadLoadState(
            reviewFilter: resolvedReviewQuery.reviewFilter,
            decks: decks,
            cards: cards,
            now: now,
            seedQueueSize: self.reviewSeedQueueSize
        )

        self.state.loadedReviewCardIds = Set(reviewHeadState.seedReviewQueue.map(\.cardId))
        self.state.hasMoreReviewQueueCards = reviewHeadState.hasMoreCards

        return ReviewQueuePublishedState(
            selectedReviewFilter: reviewHeadState.resolvedReviewFilter,
            reviewQueue: reviewHeadState.seedReviewQueue,
            reviewCounts: makeReviewCounts(
                reviewFilter: resolvedReviewQuery.reviewFilter,
                decks: decks,
                cards: cards,
                now: now
            ),
            isReviewHeadLoading: false,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func setActiveReviewLoadTask(task: Task<Void, Never>, requestId: String) {
        self.state.activeReviewLoadTask = task
        self.state.activeReviewLoadRequestId = requestId
    }

    mutating func applyReviewHeadLoadSuccess(
        publishedState: ReviewQueuePublishedState,
        reviewHeadState: ReviewHeadLoadState,
        requestId: String,
        sourceVersion: Int
    ) -> ReviewQueuePublishedState? {
        guard self.shouldApplyReviewLoadResult(requestId: requestId, sourceVersion: sourceVersion) else {
            return nil
        }

        self.state.loadedReviewCardIds = Set(reviewHeadState.seedReviewQueue.map(\.cardId))
        self.state.hasMoreReviewQueueCards = reviewHeadState.hasMoreCards
        self.clearActiveReviewLoad(requestId: requestId)

        return ReviewQueuePublishedState(
            selectedReviewFilter: reviewHeadState.resolvedReviewFilter,
            reviewQueue: reviewHeadState.seedReviewQueue,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: false,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func applyReviewHeadLoadFailure(
        publishedState: ReviewQueuePublishedState,
        requestId: String,
        sourceVersion: Int
    ) -> ReviewQueuePublishedState? {
        guard self.shouldApplyReviewLoadResult(requestId: requestId, sourceVersion: sourceVersion) else {
            return nil
        }

        self.clearActiveReviewLoad(requestId: requestId)
        self.cancelActiveReviewCountsLoad()

        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: false,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func startReviewCountsLoad(request: ReviewCountsLoadRequest) {
        self.cancelActiveReviewCountsLoad()
        self.state.activeReviewCountsRequestId = request.requestId
    }

    mutating func setActiveReviewCountsTask(task: Task<Void, Never>, requestId: String) {
        self.state.activeReviewCountsTask = task
        self.state.activeReviewCountsRequestId = requestId
    }

    mutating func applyReviewCountsLoadSuccess(
        publishedState: ReviewQueuePublishedState,
        reviewCounts: ReviewCounts,
        requestId: String,
        sourceVersion: Int
    ) -> ReviewQueuePublishedState? {
        guard self.shouldApplyReviewCountsResult(requestId: requestId, sourceVersion: sourceVersion) else {
            return nil
        }

        self.clearActiveReviewCountsLoad(requestId: requestId)
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            reviewCounts: reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func applyReviewCountsLoadFailure(
        publishedState: ReviewQueuePublishedState,
        requestId: String,
        sourceVersion: Int
    ) -> ReviewQueuePublishedState? {
        guard self.shouldApplyReviewCountsResult(requestId: requestId, sourceVersion: sourceVersion) else {
            return nil
        }

        self.clearActiveReviewCountsLoad(requestId: requestId)
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func makeReviewQueueChunkLoadRequestIfNeeded(
        publishedState: ReviewQueuePublishedState,
        cards: [Card],
        decks: [Deck],
        now: Date
    ) -> ReviewQueueChunkLoadRequest? {
        guard publishedState.isReviewHeadLoading == false else {
            return nil
        }
        guard publishedState.isReviewQueueChunkLoading == false else {
            return nil
        }
        guard self.state.hasMoreReviewQueueCards else {
            return nil
        }
        guard self.effectiveReviewQueue(publishedState: publishedState).count <= self.reviewQueueReplenishmentThreshold else {
            return nil
        }

        let requestId = UUID().uuidString.lowercased()
        let sourceVersion = self.state.reviewSourceVersion
        self.state.activeReviewQueueChunkRequestId = requestId

        return ReviewQueueChunkLoadRequest(
            requestId: requestId,
            sourceVersion: sourceVersion,
            reviewFilter: publishedState.selectedReviewFilter,
            decks: decks,
            cards: cards,
            excludedCardIds: self.state.loadedReviewCardIds,
            now: now,
            chunkSize: self.reviewSeedQueueSize
        )
    }

    mutating func markReviewQueueChunkLoading(
        publishedState: ReviewQueuePublishedState,
        requestId: String
    ) -> ReviewQueuePublishedState {
        self.state.activeReviewQueueChunkRequestId = requestId
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: true,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func setActiveReviewQueueChunkTask(task: Task<Void, Never>, requestId: String) {
        self.state.activeReviewQueueChunkTask = task
        self.state.activeReviewQueueChunkRequestId = requestId
    }

    mutating func applyReviewQueueChunkLoadSuccess(
        publishedState: ReviewQueuePublishedState,
        queueChunkLoadState: ReviewQueueChunkLoadState,
        requestId: String,
        sourceVersion: Int
    ) -> ReviewQueuePublishedState? {
        guard self.shouldApplyReviewQueueChunkResult(requestId: requestId, sourceVersion: sourceVersion) else {
            return nil
        }

        self.state.loadedReviewCardIds.formUnion(queueChunkLoadState.reviewQueueChunk.map(\.cardId))
        self.state.hasMoreReviewQueueCards = queueChunkLoadState.hasMoreCards
        self.clearActiveReviewQueueChunkLoad(requestId: requestId)

        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue + queueChunkLoadState.reviewQueueChunk,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func applyReviewQueueChunkLoadFailure(
        publishedState: ReviewQueuePublishedState,
        requestId: String,
        sourceVersion: Int
    ) -> ReviewQueuePublishedState? {
        guard self.shouldApplyReviewQueueChunkResult(requestId: requestId, sourceVersion: sourceVersion) else {
            return nil
        }

        self.clearActiveReviewQueueChunkLoad(requestId: requestId)
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func enqueueReviewSubmission(
        publishedState: ReviewQueuePublishedState,
        workspaceId: String,
        cardId: String,
        rating: ReviewRating,
        cards: [Card]
    ) throws -> ReviewQueuePublishedState {
        guard cards.contains(where: { card in
            card.cardId == cardId && card.deletedAt == nil
        }) else {
            throw LocalStoreError.notFound("Card not found")
        }
        guard publishedState.pendingReviewCardIds.contains(cardId) == false else {
            throw LocalStoreError.validation("Review submission is already pending for this card")
        }

        let request = ReviewSubmissionRequest(
            id: UUID().uuidString.lowercased(),
            workspaceId: workspaceId,
            cardId: cardId,
            rating: rating,
            reviewedAtClient: currentIsoTimestamp()
        )
        self.state.pendingReviewRequests.append(request)

        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.insert(cardId)
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: pendingReviewCardIds,
            reviewSubmissionFailure: nil
        )
    }

    mutating func startReviewProcessorIfNeeded() -> Bool {
        guard self.state.isReviewProcessorRunning == false else {
            return false
        }

        self.state.isReviewProcessorRunning = true
        return true
    }

    mutating func finishReviewProcessor() -> Bool {
        self.state.isReviewProcessorRunning = false
        return self.state.pendingReviewRequests.isEmpty == false
    }

    mutating func dequeuePendingReviewRequest() -> ReviewSubmissionRequest? {
        guard self.state.pendingReviewRequests.isEmpty == false else {
            return nil
        }

        return self.state.pendingReviewRequests.removeFirst()
    }

    func reviewSubmissionExecutorUnavailableError() -> Error {
        LocalStoreError.uninitialized("Review submission executor is unavailable")
    }

    mutating func completeReviewSubmission(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest
    ) -> ReviewQueuePublishedState {
        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.remove(request.cardId)
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func failReviewSubmission(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest,
        message: String
    ) -> ReviewQueuePublishedState {
        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.remove(request.cardId)
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: pendingReviewCardIds,
            reviewSubmissionFailure: ReviewSubmissionFailure(
                id: request.id,
                message: message
            )
        )
    }

    mutating func cancelForAccountDeletion() {
        self.cancelActiveReviewLoads()
        self.state.pendingReviewRequests = []
        self.state.isReviewProcessorRunning = false
        self.state.loadedReviewCardIds = []
        self.state.hasMoreReviewQueueCards = false
    }

    private func shouldApplyReviewLoadResult(requestId: String, sourceVersion: Int) -> Bool {
        guard Task.isCancelled == false else {
            return false
        }
        guard self.state.activeReviewLoadRequestId == requestId else {
            return false
        }

        return self.state.reviewSourceVersion == sourceVersion
    }

    private func shouldApplyReviewCountsResult(requestId: String, sourceVersion: Int) -> Bool {
        guard Task.isCancelled == false else {
            return false
        }
        guard self.state.activeReviewCountsRequestId == requestId else {
            return false
        }

        return self.state.reviewSourceVersion == sourceVersion
    }

    private func shouldApplyReviewQueueChunkResult(requestId: String, sourceVersion: Int) -> Bool {
        guard Task.isCancelled == false else {
            return false
        }
        guard self.state.activeReviewQueueChunkRequestId == requestId else {
            return false
        }

        return self.state.reviewSourceVersion == sourceVersion
    }

    private mutating func cancelActiveReviewLoad() {
        self.state.activeReviewLoadTask?.cancel()
        self.state.activeReviewLoadTask = nil
        self.state.activeReviewLoadRequestId = nil
    }

    private mutating func cancelActiveReviewCountsLoad() {
        self.state.activeReviewCountsTask?.cancel()
        self.state.activeReviewCountsTask = nil
        self.state.activeReviewCountsRequestId = nil
    }

    private mutating func cancelActiveReviewQueueChunkLoad() {
        self.state.activeReviewQueueChunkTask?.cancel()
        self.state.activeReviewQueueChunkTask = nil
        self.state.activeReviewQueueChunkRequestId = nil
    }

    private mutating func cancelActiveReviewLoads() {
        self.cancelActiveReviewLoad()
        self.cancelActiveReviewCountsLoad()
        self.cancelActiveReviewQueueChunkLoad()
    }

    private mutating func clearActiveReviewLoad(requestId: String) {
        guard self.state.activeReviewLoadRequestId == requestId else {
            return
        }

        self.state.activeReviewLoadTask = nil
        self.state.activeReviewLoadRequestId = nil
    }

    private mutating func clearActiveReviewCountsLoad(requestId: String) {
        guard self.state.activeReviewCountsRequestId == requestId else {
            return
        }

        self.state.activeReviewCountsTask = nil
        self.state.activeReviewCountsRequestId = nil
    }

    private mutating func clearActiveReviewQueueChunkLoad(requestId: String) {
        guard self.state.activeReviewQueueChunkRequestId == requestId else {
            return
        }

        self.state.activeReviewQueueChunkTask = nil
        self.state.activeReviewQueueChunkRequestId = nil
    }
}
