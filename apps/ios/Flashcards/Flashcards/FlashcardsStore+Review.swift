import Foundation

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
            self.globalErrorMessage = localizedMessage(error: error)
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
                self.globalErrorMessage = localizedMessage(error: error)
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
                self.globalErrorMessage = localizedMessage(error: error)
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
            self.globalErrorMessage = localizedMessage(error: error)
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
                self.globalErrorMessage = localizedMessage(error: error)
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

        Task { @MainActor in
            await self.processPendingReviewRequests()
        }
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
            self.refreshLocalReadModels(now: Date())
            self.applyReviewPublishedState(
                reviewState: self.reviewRuntime.completeReviewSubmission(
                    publishedState: self.currentReviewPublishedState(),
                    request: request
                )
            )
            self.triggerCloudSyncIfLinked()
        } catch {
            self.handleReviewSubmissionFailure(request: request, submissionError: error)
        }
    }

    func handleReviewSubmissionFailure(request: ReviewSubmissionRequest, submissionError: Error) {
        let submissionErrorMessage = localizedMessage(error: submissionError)
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
            let reloadErrorMessage = localizedMessage(error: error)
            self.applyReviewPublishedState(
                reviewState: self.reviewRuntime.failReviewSubmission(
                    publishedState: self.currentReviewPublishedState(),
                    request: request,
                    message: "\(submissionErrorMessage)\n\nReload failed: \(reloadErrorMessage)"
                )
            )
        }
    }
}
