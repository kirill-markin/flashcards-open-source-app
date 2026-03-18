import Foundation

private enum ReviewStateReconcileTrigger {
    case cloudSync
    case localReview
}

@MainActor
extension FlashcardsStore {
    func selectReviewFilter(reviewFilter: ReviewFilter) {
        self.extendCloudSyncFastPolling(now: Date())
        self.startReviewLoad(reviewFilter: reviewFilter, now: Date())
    }

    func startReviewLoad(reviewFilter: ReviewFilter, now: Date) {
        guard let database = self.database else {
            self.globalErrorMessage = "Local database is unavailable"
            return
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            self.globalErrorMessage = "Workspace is unavailable"
            return
        }

        let resolvedReviewQuery: ResolvedReviewQuery
        do {
            resolvedReviewQuery = try database.loadResolvedReviewQuery(
                workspaceId: workspaceId,
                reviewFilter: reviewFilter
            )
        } catch {
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            return
        }

        let plan = self.reviewRuntime.startReviewLoad(
            publishedState: self.currentReviewPublishedState(),
            resolvedReviewQuery: resolvedReviewQuery,
            workspaceId: workspaceId,
            databaseURL: database.databaseURL,
            now: now
        )
        self.applyReviewPublishedState(reviewState: plan.publishedState)
        self.persistSelectedReviewFilter(reviewFilter: plan.publishedState.selectedReviewFilter)
        self.globalErrorMessage = ""

        self.startReviewCountsLoad(request: plan.countsRequest)

        let headTask = Task { @MainActor in
            do {
                let reviewHeadState = try await self.dependencies.reviewHeadLoader(
                    plan.headRequest.databaseURL,
                    plan.headRequest.workspaceId,
                    plan.headRequest.resolvedReviewFilter,
                    plan.headRequest.reviewQueryDefinition,
                    plan.headRequest.now,
                    plan.headRequest.seedQueueSize
                )
                guard let nextReviewState = self.reviewRuntime.applyReviewHeadLoadSuccess(
                    publishedState: self.currentReviewPublishedState(),
                    reviewHeadState: reviewHeadState,
                    requestId: plan.headRequest.requestId,
                    sourceVersion: plan.headRequest.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
                self.persistSelectedReviewFilter(reviewFilter: nextReviewState.selectedReviewFilter)
                self.startReviewQueueChunkLoadIfNeeded(now: plan.headRequest.now)
            } catch is CancellationError {
                return
            } catch {
                guard let nextReviewState = self.reviewRuntime.applyReviewHeadLoadFailure(
                    publishedState: self.currentReviewPublishedState(),
                    requestId: plan.headRequest.requestId,
                    sourceVersion: plan.headRequest.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
        self.reviewRuntime.setActiveReviewLoadTask(
            task: headTask,
            requestId: plan.headRequest.requestId
        )
    }

    func refreshReviewState(now: Date) {
        self.startReviewLoad(reviewFilter: self.selectedReviewFilter, now: now)
    }

    func refreshReviewState(now: Date, mode: ReviewRefreshMode) async throws -> Bool {
        switch mode {
        case .blockingReset:
            self.startReviewLoad(reviewFilter: self.selectedReviewFilter, now: now)
            return true
        case .backgroundReconcile:
            return try await self.reconcileReviewState(
                now: now,
                trigger: .cloudSync
            )
        }
    }

    func startReviewCountsLoad(request: ReviewCountsLoadRequest) {
        self.reviewRuntime.startReviewCountsLoad(request: request)
        let countsTask = Task { @MainActor in
            do {
                let reviewCounts = try await self.dependencies.reviewCountsLoader(
                    request.databaseURL,
                    request.workspaceId,
                    request.reviewQueryDefinition,
                    request.now
                )
                guard let nextReviewState = self.reviewRuntime.applyReviewCountsLoadSuccess(
                    publishedState: self.currentReviewPublishedState(),
                    reviewCounts: reviewCounts,
                    requestId: request.requestId,
                    sourceVersion: request.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
            } catch is CancellationError {
                return
            } catch {
                guard let nextReviewState = self.reviewRuntime.applyReviewCountsLoadFailure(
                    publishedState: self.currentReviewPublishedState(),
                    requestId: request.requestId,
                    sourceVersion: request.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
        self.reviewRuntime.setActiveReviewCountsTask(task: countsTask, requestId: request.requestId)
    }

    func startReviewQueueChunkLoadIfNeeded(now: Date) {
        guard let databaseURL = self.localDatabaseURL else {
            return
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            return
        }

        let resolvedReviewQuery: ResolvedReviewQuery
        do {
            resolvedReviewQuery = try requireLocalDatabase(database: self.database).loadResolvedReviewQuery(
                workspaceId: workspaceId,
                reviewFilter: self.selectedReviewFilter
            )
        } catch {
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            return
        }

        guard let request = self.reviewRuntime.makeReviewQueueChunkLoadRequestIfNeeded(
            publishedState: self.currentReviewPublishedState(),
            databaseURL: databaseURL,
            workspaceId: workspaceId,
            reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
            now: now
        ) else {
            return
        }

        let loadingReviewState = self.reviewRuntime.markReviewQueueChunkLoading(
            publishedState: self.currentReviewPublishedState(),
            requestId: request.requestId
        )
        self.applyReviewPublishedState(reviewState: loadingReviewState)
        let queueChunkTask = Task { @MainActor in
            do {
                let queueChunkLoadState = try await self.dependencies.reviewQueueChunkLoader(
                    request.databaseURL,
                    request.workspaceId,
                    request.reviewQueryDefinition,
                    request.excludedCardIds,
                    request.now,
                    request.chunkSize
                )
                guard let nextReviewState = self.reviewRuntime.applyReviewQueueChunkLoadSuccess(
                    publishedState: self.currentReviewPublishedState(),
                    queueChunkLoadState: queueChunkLoadState,
                    requestId: request.requestId,
                    sourceVersion: request.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
                self.startReviewQueueChunkLoadIfNeeded(now: request.now)
            } catch is CancellationError {
                return
            } catch {
                guard let nextReviewState = self.reviewRuntime.applyReviewQueueChunkLoadFailure(
                    publishedState: self.currentReviewPublishedState(),
                    requestId: request.requestId,
                    sourceVersion: request.sourceVersion
                ) else {
                    return
                }

                self.applyReviewPublishedState(reviewState: nextReviewState)
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
        self.reviewRuntime.setActiveReviewQueueChunkTask(
            task: queueChunkTask,
            requestId: request.requestId
        )
    }

    func persistSelectedReviewFilter(reviewFilter: ReviewFilter) {
        do {
            let persistedReviewFilter = makePersistedReviewFilter(reviewFilter: reviewFilter)
            let data = try self.encoder.encode(persistedReviewFilter)
            self.userDefaults.set(data, forKey: selectedReviewFilterUserDefaultsKey)
        } catch {
            self.userDefaults.removeObject(forKey: selectedReviewFilterUserDefaultsKey)
        }
    }

    func startReviewProcessorIfNeeded() {
        guard self.reviewRuntime.startReviewProcessorIfNeeded() else {
            return
        }

        let processorTask = Task { @MainActor in
            await self.processPendingReviewRequests()
        }
        self.reviewRuntime.setActiveReviewProcessorTask(task: processorTask)
    }

    func processPendingReviewRequests() async {
        defer {
            let shouldRestart = self.reviewRuntime.finishReviewProcessor()
            if shouldRestart {
                self.startReviewProcessorIfNeeded()
            }
        }

        while let request = self.reviewRuntime.dequeuePendingReviewRequest() {
            await self.processReviewSubmissionRequest(request: request)
        }
    }

    func processReviewSubmissionRequest(request: ReviewSubmissionRequest) async {
        guard let reviewSubmissionExecutor = self.dependencies.reviewSubmissionExecutor else {
            self.handleReviewSubmissionFailure(
                request: request,
                submissionError: self.reviewRuntime.reviewSubmissionExecutorUnavailableError()
            )
            return
        }

        do {
            _ = try await reviewSubmissionExecutor.submitReview(
                workspaceId: request.workspaceId,
                submission: ReviewSubmission(
                    cardId: request.cardId,
                    rating: request.rating,
                    reviewedAtClient: request.reviewedAtClient
                )
            )
            let now = Date()
            let didRefreshBootstrapSnapshot = try self.refreshBootstrapSnapshotWithoutReset(now: now)
            let didReconcileReviewState = try await self.reconcileReviewState(
                now: now,
                trigger: .localReview
            )
            self.applyReviewPublishedState(
                reviewState: self.reviewRuntime.completeReviewSubmission(
                    publishedState: self.currentReviewPublishedState(),
                    request: request
                )
            )
            if didRefreshBootstrapSnapshot || didReconcileReviewState {
                self.localReadVersion += 1
            }
            self.triggerCloudSyncIfLinked()
        } catch {
            self.handleReviewSubmissionFailure(request: request, submissionError: error)
        }
    }

    func handleReviewSubmissionFailure(request: ReviewSubmissionRequest, submissionError: Error) {
        let submissionErrorMessage = Flashcards.errorMessage(error: submissionError)
        do {
            try self.reload()
            self.applyReviewPublishedState(
                reviewState: self.reviewRuntime.failReviewSubmission(
                    publishedState: self.currentReviewPublishedState(),
                    request: request,
                    message: submissionErrorMessage
                )
            )
        } catch {
            let reloadErrorMessage = Flashcards.errorMessage(error: error)
            self.applyReviewPublishedState(
                reviewState: self.reviewRuntime.failReviewSubmission(
                    publishedState: self.currentReviewPublishedState(),
                    request: request,
                    message: "\(submissionErrorMessage)\n\nReload failed: \(reloadErrorMessage)"
                )
            )
        }
    }

    private func reconcileReviewState(
        now: Date,
        trigger: ReviewStateReconcileTrigger
    ) async throws -> Bool {
        guard self.isReviewHeadLoading == false else {
            return false
        }
        guard let database = self.database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let resolvedReviewQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspaceId,
            reviewFilter: self.selectedReviewFilter
        )
        let currentReviewState = self.currentReviewPublishedState()
        let currentEffectiveQueue = self.reviewRuntime.effectiveReviewQueue(publishedState: currentReviewState)
        let currentCardId = currentReviewCard(reviewQueue: currentEffectiveQueue)?.cardId
        let currentSignature = makeReviewSessionSignature(
            selectedReviewFilter: currentReviewState.selectedReviewFilter,
            reviewQueue: currentReviewState.reviewQueue,
            schedulerSettings: self.schedulerSettings,
            seedQueueSize: reviewSeedQueueSize
        )
        let databaseURL = database.databaseURL
        let reviewHeadLoader = self.dependencies.reviewHeadLoader
        let reviewCountsLoader = self.dependencies.reviewCountsLoader

        async let reviewHeadTask = reviewHeadLoader(
            databaseURL,
            workspaceId,
            resolvedReviewQuery.reviewFilter,
            resolvedReviewQuery.queryDefinition,
            now,
            reviewSeedQueueSize
        )
        async let reviewCountsTask = reviewCountsLoader(
            databaseURL,
            workspaceId,
            resolvedReviewQuery.queryDefinition,
            now
        )

        let reviewHeadState = try await reviewHeadTask
        let reviewCounts = try await reviewCountsTask

        guard workspaceId == self.workspace?.workspaceId else {
            return false
        }
        guard resolvedReviewQuery.reviewFilter == self.selectedReviewFilter else {
            return false
        }

        let nextSignature = makeReviewSessionSignature(
            selectedReviewFilter: reviewHeadState.resolvedReviewFilter,
            reviewQueue: reviewHeadState.seedReviewQueue,
            schedulerSettings: self.schedulerSettings,
            seedQueueSize: reviewSeedQueueSize
        )
        let shouldReplaceSeedQueue = currentSignature != nextSignature
        let didChangeReviewCounts = currentReviewState.reviewCounts != reviewCounts

        guard shouldReplaceSeedQueue || didChangeReviewCounts else {
            return false
        }

        let nextReviewState = self.reviewRuntime.applyBackgroundReviewRefresh(
            publishedState: currentReviewState,
            reviewHeadState: reviewHeadState,
            reviewCounts: reviewCounts,
            shouldReplaceSeedQueue: shouldReplaceSeedQueue
        )
        self.applyReviewPublishedState(reviewState: nextReviewState)
        self.persistSelectedReviewFilter(reviewFilter: nextReviewState.selectedReviewFilter)
        self.startReviewQueueChunkLoadIfNeeded(now: now)

        let nextEffectiveQueue = self.reviewRuntime.effectiveReviewQueue(publishedState: nextReviewState)
        let nextCardId = currentReviewCard(reviewQueue: nextEffectiveQueue)?.cardId
        if case .cloudSync = trigger, let currentCardId, currentCardId != nextCardId {
            self.reviewOverlayBanner = ReviewOverlayBanner(
                id: UUID().uuidString.lowercased(),
                message: "This review updated on another device."
            )
        }

        return true
    }
}
