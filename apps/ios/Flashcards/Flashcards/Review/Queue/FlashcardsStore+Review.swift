import Foundation

private enum ReviewStateReconcileTrigger {
    case cloudSyncSilently
    case cloudSyncWithVisibleChangeBanner
    case localReview
}

@MainActor
extension FlashcardsStore {
    func selectReviewFilter(reviewFilter: ReviewFilter) {
        self.extendCloudSyncFastPolling(now: Date())
        self.startReviewLoad(reviewFilter: reviewFilter, now: Date())
        self.reconcileReviewNotifications(trigger: .filterChanged, now: Date())
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
        case .backgroundReconcileSilently:
            return try await self.reconcileReviewState(
                now: now,
                trigger: .cloudSyncSilently
            )
        case .backgroundReconcileWithVisibleChangeBanner:
            return try await self.reconcileReviewState(
                now: now,
                trigger: .cloudSyncWithVisibleChangeBanner
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
        guard let workspaceId = self.workspace?.workspaceId else {
            return
        }

        do {
            let persistedReviewFilter = makePersistedReviewFilter(reviewFilter: reviewFilter)
            let data = try self.encoder.encode(persistedReviewFilter)
            self.userDefaults.set(data, forKey: makeSelectedReviewFilterUserDefaultsKey(workspaceId: workspaceId))
        } catch {
            self.userDefaults.removeObject(forKey: makeSelectedReviewFilterUserDefaultsKey(workspaceId: workspaceId))
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
            try self.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade()
            _ = try await reviewSubmissionExecutor.submitReview(
                workspaceId: request.workspaceId,
                submission: ReviewSubmission(
                    cardId: request.cardId,
                    rating: request.rating,
                    reviewedAtClient: request.reviewedAtClient
                )
            )
            let now = Date()
            guard self.reviewSubmissionRequestMatchesCurrentContext(request: request, now: now) else {
                self.applyStaleReviewSubmissionCompletion(request: request)
                return
            }

            let bootstrapRefreshOutcome = try self.refreshBootstrapSnapshotWithoutReset(now: now)
            let didReconcileReviewState = try await self.reconcileReviewState(
                now: now,
                trigger: .localReview
            )
            let completionValidationContext = self.makeReviewSubmissionRollbackValidationContext(now: now)
            guard self.reviewSubmissionRequestMatchesCurrentContext(
                request: request,
                validationContext: completionValidationContext
            ) else {
                self.applyStaleReviewSubmissionCompletion(request: request)
                return
            }

            self.applyReviewPublishedState(
                reviewState: self.reviewRuntime.completeReviewSubmission(
                    publishedState: self.currentReviewPublishedState(),
                    request: request,
                    validationContext: completionValidationContext
                )
            )
            self.handleProgressLocalMutation(
                now: now,
                reviewedAtClient: request.reviewedAtClient
            )
            if bootstrapRefreshOutcome.didChange || didReconcileReviewState {
                self.localReadVersion += 1
            }
            let reviewedAt = parseIsoTimestamp(value: request.reviewedAtClient) ?? now
            self.handleSuccessfulReviewNotificationTrigger(
                reviewedAt: reviewedAt,
                now: now
            )
            self.handleSuccessfulReviewHardReminder(
                rating: request.rating,
                now: now
            )
            self.triggerCloudSyncIfLinked(
                trigger: CloudSyncTrigger(
                    source: .localMutation,
                    now: now,
                    extendsFastPolling: true,
                    allowsVisibleChangeBanner: false,
                    surfacesGlobalErrorMessage: false
                )
            )
        } catch {
            self.handleReviewSubmissionFailure(request: request, submissionError: error)
        }
    }

    private func reviewSubmissionRequestMatchesCurrentContext(
        request: ReviewSubmissionRequest,
        now: Date
    ) -> Bool {
        self.reviewSubmissionRequestMatchesCurrentContext(
            request: request,
            validationContext: self.makeReviewSubmissionRollbackValidationContext(now: now)
        )
    }

    private func reviewSubmissionRequestMatchesCurrentContext(
        request: ReviewSubmissionRequest,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> Bool {
        guard let validationContext else {
            return false
        }
        return self.reviewRuntime.reviewSubmissionRequestMatchesCurrentContext(
            publishedState: self.currentReviewPublishedState(),
            request: request,
            validationContext: validationContext
        )
    }

    private func applyStaleReviewSubmissionCompletion(request: ReviewSubmissionRequest) {
        self.applyReviewPublishedState(
            reviewState: self.reviewRuntime.completeStaleReviewSubmission(
                publishedState: self.currentReviewPublishedState(),
                request: request
            )
        )
    }

    func handleReviewSubmissionFailure(request: ReviewSubmissionRequest, submissionError: Error) {
        let submissionErrorMessage = Flashcards.errorMessage(error: submissionError)
        let now = Date()
        // Capture the pre-refresh validation context once so the staleness classification
        // is independent of the bootstrap-refresh outcome below. The catch branch reuses
        // this same snapshot when the refresh throws and a fresh context is unavailable;
        // rollback-card selection still requires fresh data and is suppressed in that case.
        let preRefreshValidationContext = self.makeReviewSubmissionRollbackValidationContext(now: now)
        guard self.reviewSubmissionRequestMatchesCurrentContext(
            request: request,
            validationContext: preRefreshValidationContext
        ) else {
            self.applyStaleReviewSubmissionCompletion(request: request)
            return
        }

        do {
            _ = try self.refreshBootstrapSnapshotWithoutReset(now: now)
            let rollbackValidationContext = self.makeReviewSubmissionRollbackValidationContext(now: now)
            guard self.reviewSubmissionRequestMatchesCurrentContext(
                request: request,
                validationContext: rollbackValidationContext
            ) else {
                self.applyStaleReviewSubmissionCompletion(request: request)
                return
            }

            self.applyReviewPublishedState(
                reviewState: self.reviewRuntime.failReviewSubmission(
                    publishedState: self.currentReviewPublishedState(),
                    request: request,
                    message: submissionErrorMessage,
                    validationContext: rollbackValidationContext
                )
            )
        } catch {
            let reloadErrorMessage = Flashcards.errorMessage(error: error)
            // Re-run the staleness gate against the pre-refresh snapshot so the
            // classification stays consistent with the early check above, regardless of
            // refresh outcome. Rollback-card selection requires fresh data we no longer
            // have, so we pass nil to suppress it.
            guard self.reviewSubmissionRequestMatchesCurrentContext(
                request: request,
                validationContext: preRefreshValidationContext
            ) else {
                self.applyStaleReviewSubmissionCompletion(request: request)
                return
            }
            self.applyReviewPublishedState(
                reviewState: self.reviewRuntime.failReviewSubmission(
                    publishedState: self.currentReviewPublishedState(),
                    request: request,
                    message: "\(submissionErrorMessage)\n\nReload failed: \(reloadErrorMessage)",
                    validationContext: nil
                )
            )
        }
    }

    private func makeReviewSubmissionRollbackValidationContext(
        now: Date
    ) -> ReviewSubmissionRollbackValidationContext? {
        guard let workspaceId = self.workspace?.workspaceId else {
            return nil
        }

        return ReviewSubmissionRollbackValidationContext(
            currentWorkspaceId: workspaceId,
            cards: self.cards,
            decks: self.decks,
            schedulerSettings: self.schedulerSettings,
            now: now
        )
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
            reviewQueue: currentEffectiveQueue,
            schedulerSettings: self.schedulerSettings,
            seedQueueSize: reviewSeedQueueSize
        )
        let databaseURL = database.databaseURL
        let reviewCountsLoader = self.dependencies.reviewCountsLoader
        let reviewQueueWindowLoader = self.dependencies.reviewQueueWindowLoader
        let reviewQueueWindowLimit = max(currentReviewState.reviewQueue.count, reviewSeedQueueSize)

        async let reviewCountsTask = reviewCountsLoader(
            databaseURL,
            workspaceId,
            resolvedReviewQuery.queryDefinition,
            now
        )
        async let reviewQueueWindowTask = reviewQueueWindowLoader(
            databaseURL,
            workspaceId,
            resolvedReviewQuery.queryDefinition,
            now,
            reviewQueueWindowLimit
        )

        let reviewCounts = try await reviewCountsTask
        let reviewQueueWindowState = try await reviewQueueWindowTask

        guard workspaceId == self.workspace?.workspaceId else {
            return false
        }
        guard resolvedReviewQuery.reviewFilter == self.selectedReviewFilter else {
            return false
        }
        let refreshedReviewQueue = reviewQueueWindowState.reviewQueue
        let preservedPresentedReviewCard = presentedReviewCardForBackgroundRefresh(
            reviewQueue: reviewQueueWindowState.reviewQueue,
            presentedCardId: currentCardId,
            pendingReviewCardIds: currentReviewState.pendingReviewCardIds,
            resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
            decks: self.decks,
            cards: self.cards,
            now: now
        )
        let nextPresentedReviewCard = preservedPresentedReviewCard ?? refreshedReviewQueue.first { card in
            currentReviewState.pendingReviewCardIds.contains(card.cardId) == false
        }
        let nextReviewStateForComparison = ReviewQueuePublishedState(
            selectedReviewFilter: resolvedReviewQuery.reviewFilter,
            reviewQueue: refreshedReviewQueue,
            presentedReviewCard: nextPresentedReviewCard,
            reviewCounts: reviewCounts,
            isReviewHeadLoading: false,
            isReviewCountsLoading: false,
            isReviewQueueChunkLoading: false,
            pendingReviewCardIds: currentReviewState.pendingReviewCardIds,
            reviewSubmissionFailure: currentReviewState.reviewSubmissionFailure
        )
        let nextEffectiveQueueForComparison = self.reviewRuntime.effectiveReviewQueue(
            publishedState: nextReviewStateForComparison
        )

        let nextSignature = makeReviewSessionSignature(
            selectedReviewFilter: resolvedReviewQuery.reviewFilter,
            reviewQueue: nextEffectiveQueueForComparison,
            schedulerSettings: self.schedulerSettings,
            seedQueueSize: reviewSeedQueueSize
        )
        let pendingReviewCardIds = currentReviewState.pendingReviewCardIds
        let currentNonPendingReviewQueue = currentReviewState.reviewQueue.filter { card in
            pendingReviewCardIds.contains(card.cardId) == false
        }
        let didChangeReviewSession = currentSignature != nextSignature
        let didChangeReviewCounts = currentReviewState.reviewCounts != reviewCounts
        let didChangeLoadedReviewQueue = currentNonPendingReviewQueue != refreshedReviewQueue
        let didChangePresentedReviewCard = currentReviewState.presentedReviewCard != nextPresentedReviewCard

        guard didChangeReviewSession || didChangeReviewCounts || didChangeLoadedReviewQueue || didChangePresentedReviewCard else {
            return false
        }

        let nextReviewState = self.reviewRuntime.applyBackgroundReviewRefresh(
            publishedState: currentReviewState,
            selectedReviewFilter: resolvedReviewQuery.reviewFilter,
            reviewCounts: reviewCounts,
            reviewQueue: refreshedReviewQueue,
            presentedReviewCard: nextPresentedReviewCard,
            hasMoreCards: reviewQueueWindowState.hasMoreCards
        )
        self.applyReviewPublishedState(reviewState: nextReviewState)
        self.persistSelectedReviewFilter(reviewFilter: nextReviewState.selectedReviewFilter)
        self.startReviewQueueChunkLoadIfNeeded(now: now)

        let nextEffectiveQueue = self.reviewRuntime.effectiveReviewQueue(publishedState: nextReviewState)
        let nextCardId = currentReviewCard(reviewQueue: nextEffectiveQueue)?.cardId
        if case .cloudSyncWithVisibleChangeBanner = trigger, let currentCardId, currentCardId != nextCardId {
            self.enqueueTransientBanner(banner: makeReviewUpdatedOnAnotherDeviceBanner())
        }

        return true
    }
}
