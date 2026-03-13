import Foundation

@MainActor
extension FlashcardsStore {
    func selectReviewFilter(reviewFilter: ReviewFilter) {
        self.startReviewLoad(reviewFilter: reviewFilter, now: Date())
    }

    func startReviewLoad(reviewFilter: ReviewFilter, now: Date) {
        let plan = self.reviewRuntime.startReviewLoad(
            publishedState: self.currentReviewPublishedState(),
            reviewFilter: reviewFilter,
            cards: self.cards,
            decks: self.decks,
            workspaceId: self.workspace?.workspaceId,
            databaseURL: self.localDatabaseURL,
            now: now
        )
        self.applyReviewPublishedState(reviewState: plan.publishedState)
        self.persistSelectedReviewFilter(reviewFilter: plan.publishedState.selectedReviewFilter)
        self.globalErrorMessage = ""

        if let countsRequest = plan.countsRequest {
            self.startReviewCountsLoad(request: countsRequest)
        }

        let headTask = Task { @MainActor in
            do {
                let reviewHeadState = try await self.dependencies.reviewHeadLoader(
                    plan.headRequest.reviewFilter,
                    plan.headRequest.decks,
                    plan.headRequest.cards,
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
        let reviewState = self.reviewRuntime.refreshPublishedState(
            publishedState: self.currentReviewPublishedState(),
            cards: self.cards,
            decks: self.decks,
            now: now
        )
        self.applyReviewPublishedState(reviewState: reviewState)
        self.persistSelectedReviewFilter(reviewFilter: reviewState.selectedReviewFilter)
        self.startReviewQueueChunkLoadIfNeeded(now: now)
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
        guard let request = self.reviewRuntime.makeReviewQueueChunkLoadRequestIfNeeded(
            publishedState: self.currentReviewPublishedState(),
            cards: self.cards,
            decks: self.decks,
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
                    request.reviewFilter,
                    request.decks,
                    request.cards,
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
            let updatedCard = try await reviewSubmissionExecutor.submitReview(
                workspaceId: request.workspaceId,
                submission: ReviewSubmission(
                    cardId: request.cardId,
                    rating: request.rating,
                    reviewedAtClient: request.reviewedAtClient
                )
            )
            self.applyCardMutation(card: updatedCard, now: Date())
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
