import Foundation

struct ReviewQueuePublishedState: Hashable {
    let selectedReviewFilter: ReviewFilter
    let reviewQueue: [Card]
    let presentedReviewCard: Card?
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
    var activeReviewProcessorTask: Task<Void, Never>?
    var pendingReviewRequests: [ReviewSubmissionRequest]
    var isReviewProcessorRunning: Bool
    var reviewSourceVersion: Int
    var hasMoreReviewQueueCards: Bool
}

struct ReviewHeadLoadRequest {
    let requestId: String
    let sourceVersion: Int
    let databaseURL: URL
    let workspaceId: String
    let resolvedReviewFilter: ReviewFilter
    let reviewQueryDefinition: ReviewQueryDefinition
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
    let databaseURL: URL
    let workspaceId: String
    let reviewQueryDefinition: ReviewQueryDefinition
    let excludedCardIds: Set<String>
    let now: Date
    let chunkSize: Int
}

struct ReviewSubmissionRollbackValidationContext: Hashable {
    let currentWorkspaceId: String
    let cards: [Card]
    let decks: [Deck]
    let schedulerSettings: WorkspaceSchedulerSettings?
    let now: Date
}

struct ReviewLoadPlan {
    let publishedState: ReviewQueuePublishedState
    let headRequest: ReviewHeadLoadRequest
    let countsRequest: ReviewCountsLoadRequest
}

struct ReviewQueueRuntime {
    private let reviewSeedQueueSize: Int
    private let reviewQueueReplenishmentThreshold: Int
    private(set) var state: ReviewQueueRuntimeState

    init(
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
            activeReviewProcessorTask: nil,
            pendingReviewRequests: [],
            isReviewProcessorRunning: false,
            reviewSourceVersion: 0,
            hasMoreReviewQueueCards: false
        )
    }

    static func makeInitialPublishedState(selectedReviewFilter: ReviewFilter) -> ReviewQueuePublishedState {
        ReviewQueuePublishedState(
            selectedReviewFilter: selectedReviewFilter,
            reviewQueue: [],
            presentedReviewCard: nil,
            reviewCounts: ReviewCounts(dueCount: 0, totalCount: 0),
            isReviewHeadLoading: false,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: [],
            reviewSubmissionFailure: nil
        )
    }

    func effectiveReviewQueue(publishedState: ReviewQueuePublishedState) -> [Card] {
        let visibleReviewQueue = self.visibleReviewQueue(publishedState: publishedState)
        guard let presentedReviewCard = self.resolvePresentedReviewCard(
            reviewQueue: publishedState.reviewQueue,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            preferredPresentedReviewCard: publishedState.presentedReviewCard
        ) else {
            return visibleReviewQueue
        }

        return [presentedReviewCard] + visibleReviewQueue.filter { card in
            card.cardId != presentedReviewCard.cardId
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
            case .tag(let exactTagNames):
                let exactTagNameSet = Set<String>(exactTagNames)
                isIncluded = card.tags.contains { tag in
                    exactTagNameSet.contains(tag)
                }
            }

            if isIncluded {
                result += 1
            }
        }
    }

    mutating func startReviewLoad(
        publishedState: ReviewQueuePublishedState,
        resolvedReviewQuery: ResolvedReviewQuery,
        workspaceId: String,
        databaseURL: URL,
        now: Date
    ) -> ReviewLoadPlan {
        self.cancelActiveReviewLoads()

        let requestId = UUID().uuidString.lowercased()
        let sourceVersion = self.state.reviewSourceVersion

        let nextPublishedState = ReviewQueuePublishedState(
            selectedReviewFilter: resolvedReviewQuery.reviewFilter,
            reviewQueue: [],
            presentedReviewCard: nil,
            reviewCounts: ReviewCounts(dueCount: 0, totalCount: 0),
            isReviewHeadLoading: true,
            isReviewCountsLoading: true,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: nil
        )
        self.state.activeReviewLoadRequestId = requestId
        self.state.hasMoreReviewQueueCards = false

        let headRequest = ReviewHeadLoadRequest(
            requestId: requestId,
            sourceVersion: sourceVersion,
            databaseURL: databaseURL,
            workspaceId: workspaceId,
            resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
            reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
            now: now,
            seedQueueSize: self.reviewSeedQueueSize
        )

        let countsRequest = ReviewCountsLoadRequest(
            databaseURL: databaseURL,
            workspaceId: workspaceId,
            reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
            now: now,
            requestId: requestId,
            sourceVersion: sourceVersion
        )

        return ReviewLoadPlan(
            publishedState: nextPublishedState,
            headRequest: headRequest,
            countsRequest: countsRequest
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

        self.state.hasMoreReviewQueueCards = reviewHeadState.hasMoreCards
        self.clearActiveReviewLoad(requestId: requestId)

        return ReviewQueuePublishedState(
            selectedReviewFilter: reviewHeadState.resolvedReviewFilter,
            reviewQueue: reviewHeadState.seedReviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: reviewHeadState.seedReviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
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
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
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
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
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
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func applyBackgroundReviewRefresh(
        publishedState: ReviewQueuePublishedState,
        selectedReviewFilter: ReviewFilter,
        reviewCounts: ReviewCounts,
        reviewQueue: [Card],
        presentedReviewCard: Card?,
        hasMoreCards: Bool
    ) -> ReviewQueuePublishedState {
        self.state.hasMoreReviewQueueCards = hasMoreCards

        return ReviewQueuePublishedState(
            selectedReviewFilter: selectedReviewFilter,
            reviewQueue: reviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: reviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: presentedReviewCard
            ),
            reviewCounts: reviewCounts,
            isReviewHeadLoading: false,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: publishedState.pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func makeReviewQueueChunkLoadRequestIfNeeded(
        publishedState: ReviewQueuePublishedState,
        databaseURL: URL,
        workspaceId: String,
        reviewQueryDefinition: ReviewQueryDefinition,
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
        let visibleReviewQueue = self.visibleReviewQueue(publishedState: publishedState)
        guard visibleReviewQueue.count <= self.reviewQueueReplenishmentThreshold else {
            return nil
        }
        let remainingCapacity = self.reviewSeedQueueSize - visibleReviewQueue.count
        guard remainingCapacity > 0 else {
            return nil
        }

        let requestId = UUID().uuidString.lowercased()
        let sourceVersion = self.state.reviewSourceVersion
        self.state.activeReviewQueueChunkRequestId = requestId

        return ReviewQueueChunkLoadRequest(
            requestId: requestId,
            sourceVersion: sourceVersion,
            databaseURL: databaseURL,
            workspaceId: workspaceId,
            reviewQueryDefinition: reviewQueryDefinition,
            excludedCardIds: self.makeExcludedReviewCardIds(publishedState: publishedState),
            now: now,
            chunkSize: remainingCapacity
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
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
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

        self.clearActiveReviewQueueChunkLoad(requestId: requestId)

        let currentVisibleReviewQueue = Array(
            self.visibleReviewQueue(publishedState: publishedState).prefix(self.reviewSeedQueueSize)
        )
        let remainingCapacity = max(0, self.reviewSeedQueueSize - currentVisibleReviewQueue.count)
        let excludedCardIds = self.makeExcludedReviewCardIds(publishedState: publishedState)
        var acceptedCardIds = excludedCardIds
        let appendableChunk = queueChunkLoadState.reviewQueueChunk.filter { card in
            guard acceptedCardIds.contains(card.cardId) == false else {
                return false
            }
            acceptedCardIds.insert(card.cardId)
            return true
        }
        let appendedChunk = Array(appendableChunk.prefix(remainingCapacity))
        let didDropAppendableCardsForCapacity = appendableChunk.count > appendedChunk.count
        self.state.hasMoreReviewQueueCards = queueChunkLoadState.hasMoreCards || didDropAppendableCardsForCapacity
        let visibleNextReviewQueue = Array((currentVisibleReviewQueue + appendedChunk).prefix(self.reviewSeedQueueSize))
        // Preserve pending-but-still-canonical cards so an in-flight submission can be
        // rescued on failure. They stay hidden from the effective queue via
        // visibleReviewQueue at read time, so the visible window still respects the seed
        // queue size limit.
        let pendingCanonicalReviewCards = publishedState.reviewQueue.filter { card in
            publishedState.pendingReviewCardIds.contains(card.cardId)
        }
        let nextReviewQueue = pendingCanonicalReviewCards + visibleNextReviewQueue

        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: nextReviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: nextReviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
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
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: publishedState.pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
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
        reviewContext: ReviewSubmissionContext,
        schedulerSettings: WorkspaceSchedulerSettings?
    ) throws -> ReviewQueuePublishedState {
        guard publishedState.pendingReviewCardIds.contains(cardId) == false else {
            throw LocalStoreError.validation("Review submission is already pending for this card")
        }
        guard let cardSnapshot = self.effectiveReviewQueue(publishedState: publishedState).first(where: { card in
            card.cardId == cardId
        }) else {
            throw LocalStoreError.validation("Review submission card is not available in the current review queue")
        }

        let request = ReviewSubmissionRequest(
            id: UUID().uuidString.lowercased(),
            workspaceId: workspaceId,
            cardId: cardId,
            reviewContext: reviewContext,
            reviewSessionSignature: self.makeReviewSubmissionSessionSignature(
                publishedState: publishedState,
                submittedCardId: cardId,
                schedulerSettings: schedulerSettings
            ),
            cardSnapshot: cardSnapshot,
            rating: rating,
            reviewedAtClient: nowIsoTimestamp()
        )
        self.state.pendingReviewRequests.append(request)

        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.insert(cardId)
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
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
        self.state.activeReviewProcessorTask = nil
        self.state.isReviewProcessorRunning = false
        return self.state.pendingReviewRequests.isEmpty == false
    }

    mutating func setActiveReviewProcessorTask(task: Task<Void, Never>) {
        self.state.activeReviewProcessorTask = task
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

    func reviewSubmissionRequestMatchesCurrentContext(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> Bool {
        self.isStaleReviewSubmissionContext(
            publishedState: publishedState,
            request: request,
            validationContext: validationContext
        ) == false
    }

    mutating func completeReviewSubmission(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> ReviewQueuePublishedState {
        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.remove(request.cardId)
        if self.isStaleReviewSubmissionContext(
            publishedState: publishedState,
            request: request,
            validationContext: validationContext
        ) {
            return self.makeStaleReviewSubmissionState(
                publishedState: publishedState,
                pendingReviewCardIds: pendingReviewCardIds
            )
        }

        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    mutating func completeStaleReviewSubmission(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest
    ) -> ReviewQueuePublishedState {
        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.remove(request.cardId)
        return self.makeStaleReviewSubmissionState(
            publishedState: publishedState,
            pendingReviewCardIds: pendingReviewCardIds
        )
    }

    mutating func failReviewSubmission(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest,
        message: String,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> ReviewQueuePublishedState {
        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.remove(request.cardId)
        if self.isStaleReviewSubmissionContext(
            publishedState: publishedState,
            request: request,
            validationContext: validationContext
        ) {
            return self.makeStaleReviewSubmissionState(
                publishedState: publishedState,
                pendingReviewCardIds: pendingReviewCardIds
            )
        }

        let rollbackCard = validationContext.flatMap { context in
            self.validReviewSubmissionRollbackCard(
                request: request,
                currentWorkspaceId: context.currentWorkspaceId,
                selectedReviewFilter: request.reviewContext.selectedReviewFilter,
                cards: context.cards,
                decks: context.decks,
                pendingReviewCardIds: pendingReviewCardIds,
                now: context.now
            )
        }
        let nextReviewQueue = publishedState.reviewQueue.filter { card in
            card.cardId != request.cardId
        }
        let presentedReviewCard = self.resolvePresentedReviewCard(
            reviewQueue: nextReviewQueue,
            pendingReviewCardIds: pendingReviewCardIds,
            preferredPresentedReviewCard: rollbackCard
        )
        return ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: nextReviewQueue,
            presentedReviewCard: presentedReviewCard,
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
        self.state.activeReviewProcessorTask?.cancel()
        self.state.activeReviewProcessorTask = nil
        self.state.pendingReviewRequests = []
        self.state.isReviewProcessorRunning = false
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

    private func visibleReviewQueue(publishedState: ReviewQueuePublishedState) -> [Card] {
        publishedState.reviewQueue.filter { card in
            publishedState.pendingReviewCardIds.contains(card.cardId) == false
        }
    }

    private func makeExcludedReviewCardIds(publishedState: ReviewQueuePublishedState) -> Set<String> {
        var reviewQueueCardIds = Set(publishedState.reviewQueue.map(\.cardId))
        if let presentedReviewCard = publishedState.presentedReviewCard {
            reviewQueueCardIds.insert(presentedReviewCard.cardId)
        }
        let pendingSnapshotCardIds = Set(self.state.pendingReviewRequests.map(\.cardId))

        return reviewQueueCardIds
            .union(publishedState.pendingReviewCardIds)
            .union(pendingSnapshotCardIds)
    }

    private func resolvePresentedReviewCard(
        reviewQueue: [Card],
        pendingReviewCardIds: Set<String>,
        preferredPresentedReviewCard: Card?
    ) -> Card? {
        let visibleReviewQueue = reviewQueue.filter { card in
            pendingReviewCardIds.contains(card.cardId) == false
        }
        guard let preferredPresentedReviewCard else {
            return visibleReviewQueue.first
        }
        guard pendingReviewCardIds.contains(preferredPresentedReviewCard.cardId) == false else {
            return visibleReviewQueue.first
        }
        if let canonicalPresentedReviewCard = visibleReviewQueue.first(where: { card in
            card.cardId == preferredPresentedReviewCard.cardId
        }) {
            return canonicalPresentedReviewCard
        }

        return preferredPresentedReviewCard
    }

    private func makeReviewSubmissionSessionSignature(
        publishedState: ReviewQueuePublishedState,
        submittedCardId: String,
        schedulerSettings: WorkspaceSchedulerSettings?
    ) -> ReviewSessionSignature {
        var pendingReviewCardIds = publishedState.pendingReviewCardIds
        pendingReviewCardIds.insert(submittedCardId)
        let postSubmissionState = ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            presentedReviewCard: self.resolvePresentedReviewCard(
                reviewQueue: publishedState.reviewQueue,
                pendingReviewCardIds: pendingReviewCardIds,
                preferredPresentedReviewCard: publishedState.presentedReviewCard
            ),
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )

        return makeReviewSessionSignature(
            selectedReviewFilter: postSubmissionState.selectedReviewFilter,
            reviewQueue: self.effectiveReviewQueue(publishedState: postSubmissionState),
            schedulerSettings: schedulerSettings,
            seedQueueSize: self.reviewSeedQueueSize
        )
    }

    private func isStaleReviewSubmissionContext(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> Bool {
        if let validationContext, request.workspaceId != validationContext.currentWorkspaceId {
            return true
        }
        guard request.reviewContext.selectedReviewFilter == publishedState.selectedReviewFilter else {
            return true
        }
        guard self.reviewSubmissionSessionMatchesCurrentState(
            publishedState: publishedState,
            request: request,
            validationContext: validationContext
        ) else {
            return true
        }
        guard let validationContext else {
            return false
        }

        let currentReviewContext = makeReviewSubmissionContext(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            decks: validationContext.decks,
            cards: validationContext.cards
        )
        return currentReviewContext != request.reviewContext
    }

    private func reviewSubmissionSessionMatchesCurrentState(
        publishedState: ReviewQueuePublishedState,
        request: ReviewSubmissionRequest,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> Bool {
        let currentReviewSessionSignature = makeReviewSessionSignature(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: self.effectiveReviewQueue(publishedState: publishedState),
            schedulerSettings: validationContext?.schedulerSettings,
            seedQueueSize: self.reviewSeedQueueSize
        )
        guard request.reviewSessionSignature.selectedReviewFilter == currentReviewSessionSignature.selectedReviewFilter else {
            return false
        }
        let comparableRequestSeedQueue = self.makeComparableReviewSubmissionSeedQueue(
            request: request,
            pendingReviewCardIds: publishedState.pendingReviewCardIds
        )
        guard comparableRequestSeedQueue.isEmpty == false else {
            guard currentReviewSessionSignature.seedQueue.isEmpty else {
                return false
            }
            guard let validationContext else {
                return true
            }
            let currentSchedulerSettingsUpdatedAt = validationContext.schedulerSettings?.updatedAt ?? "no-scheduler-settings"
            return request.reviewSessionSignature.schedulerSettingsUpdatedAt == currentSchedulerSettingsUpdatedAt
        }
        guard currentReviewSessionSignature.seedQueue.starts(with: comparableRequestSeedQueue) else {
            return false
        }
        guard let validationContext else {
            return true
        }

        let currentSchedulerSettingsUpdatedAt = validationContext.schedulerSettings?.updatedAt ?? "no-scheduler-settings"
        return request.reviewSessionSignature.schedulerSettingsUpdatedAt == currentSchedulerSettingsUpdatedAt
    }

    private func makeComparableReviewSubmissionSeedQueue(
        request: ReviewSubmissionRequest,
        pendingReviewCardIds: Set<String>
    ) -> [ReviewSessionCardSignature] {
        var ignoredPendingCardIds: Set<String> = pendingReviewCardIds
        ignoredPendingCardIds.remove(request.cardId)
        guard ignoredPendingCardIds.isEmpty == false else {
            return request.reviewSessionSignature.seedQueue
        }

        return request.reviewSessionSignature.seedQueue.filter { cardSignature in
            ignoredPendingCardIds.contains(cardSignature.cardId) == false
        }
    }

    private func makeStaleReviewSubmissionState(
        publishedState: ReviewQueuePublishedState,
        pendingReviewCardIds: Set<String>
    ) -> ReviewQueuePublishedState {
        ReviewQueuePublishedState(
            selectedReviewFilter: publishedState.selectedReviewFilter,
            reviewQueue: publishedState.reviewQueue,
            presentedReviewCard: publishedState.presentedReviewCard,
            reviewCounts: publishedState.reviewCounts,
            isReviewHeadLoading: publishedState.isReviewHeadLoading,
            isReviewCountsLoading: publishedState.isReviewCountsLoading,
            isReviewQueueChunkLoading: publishedState.isReviewQueueChunkLoading,
            pendingReviewCardIds: pendingReviewCardIds,
            reviewSubmissionFailure: publishedState.reviewSubmissionFailure
        )
    }

    private func validReviewSubmissionRollbackCard(
        request: ReviewSubmissionRequest,
        currentWorkspaceId: String,
        selectedReviewFilter: ReviewFilter,
        cards: [Card],
        decks: [Deck],
        pendingReviewCardIds: Set<String>,
        now: Date
    ) -> Card? {
        guard request.workspaceId == currentWorkspaceId else {
            return nil
        }
        guard pendingReviewCardIds.contains(request.cardId) == false else {
            return nil
        }
        guard let currentCard = cards.first(where: { card in
            card.cardId == request.cardId && card.workspaceId == currentWorkspaceId
        }) else {
            return nil
        }
        guard currentCard.deletedAt == nil else {
            return nil
        }
        guard cardsMatchingReviewFilter(
            reviewFilter: selectedReviewFilter,
            decks: decks,
            cards: cards
        ).contains(where: { card in
            card.cardId == currentCard.cardId && card.workspaceId == currentWorkspaceId
        }) else {
            return nil
        }
        guard isActiveReviewOrderBucket(bucket: makeReviewOrderRank(card: currentCard, now: now).bucket) else {
            return nil
        }

        return currentCard
    }
}
