import Foundation

private enum ReviewStateReconcileTrigger: Equatable {
    case cloudSyncSilently
    case cloudSyncWithVisibleChangeBanner
    case localReview
    /// A saved rating from a session the user has since left; the current session did not advance.
    case staleLocalReview
}

private enum ReviewOperationLoadKind: String {
    case head
    case chunk
}

private func reviewOperationFilterKind(reviewFilter: ReviewFilter) -> String {
    switch reviewFilter {
    case .allCards:
        return "all_cards"
    case .deck:
        return "deck"
    case .tags:
        return "tags"
    }
}

private func reviewOperationRefreshModeName(mode: ReviewRefreshMode) -> String {
    switch mode {
    case .blockingReset:
        return "blocking_reset"
    case .backgroundReconcileSilently:
        return "background_reconcile_silently"
    case .backgroundReconcileWithVisibleChangeBanner:
        return "background_reconcile_with_visible_change_banner"
    }
}

@MainActor
private func addReviewForegroundOperationBreadcrumb(
    store: FlashcardsStore,
    action: ForegroundOperationAction,
    phase: ForegroundOperationPhase,
    startedAt: Date?,
    requestId: String?,
    reviewFilter: ReviewFilter,
    reviewRefreshMode: ReviewRefreshMode?,
    reviewLoadKind: ReviewOperationLoadKind?,
    publishedState: ReviewQueuePublishedState,
    errorSummary: String?
) {
    let durationMilliseconds = startedAt.map { startDate in
        iosObservationDurationMilliseconds(startedAt: startDate, finishedAt: Date())
    }
    let reviewQueueCount = store.reviewRuntime.effectiveReviewQueue(publishedState: publishedState).count
    let reviewPendingCount = store.reviewRuntime.pendingReviewCount(
        publishedState: publishedState,
        cards: store.cards,
        decks: store.decks
    )
    let scope = IOSObservationScope(
        feature: .storeReview,
        userId: store.cloudSettings?.linkedUserId,
        workspaceId: store.workspace?.workspaceId,
        requestId: requestId,
        clientRequestId: nil,
        sessionId: nil,
        runId: nil,
        cloudState: store.cloudSettings?.cloudState,
        configurationMode: try? store.currentCloudServiceConfiguration().mode
    )

    FlashcardsObservability.addBreadcrumb(
        .foregroundOperation(
            ForegroundOperationObservation(
                scope: scope,
                action: action,
                phase: phase,
                durationMilliseconds: durationMilliseconds,
                selectedTab: nil,
                scenePhase: nil,
                isStartupReady: nil,
                isRecoveryGateActive: nil,
                cardCount: store.cards.count,
                deckCount: store.decks.count,
                pendingOutboxOperationCount: nil,
                reviewQueueCount: reviewQueueCount,
                reviewDueCount: publishedState.reviewCounts.dueCount,
                reviewNewCount: nil,
                reviewPendingCount: reviewPendingCount,
                reviewTotalCount: publishedState.reviewCounts.totalCount,
                reviewFilterKind: reviewOperationFilterKind(reviewFilter: reviewFilter),
                reviewRefreshMode: reviewRefreshMode.map(reviewOperationRefreshModeName),
                reviewLoadKind: reviewLoadKind?.rawValue,
                progressSummaryRefreshNeeded: nil,
                progressSeriesRefreshNeeded: nil,
                progressReviewScheduleRefreshNeeded: nil,
                progressLeaderboardRefreshNeeded: nil,
                progressStreakLeaderboardRefreshNeeded: nil,
                cloudSyncBlocked: store.isCloudSyncBlocked,
                errorSummary: errorSummary
            )
        )
    )
}

@MainActor
extension FlashcardsStore {
    func selectReviewFilter(reviewFilter: ReviewFilter) {
        self.extendCloudSyncFastPolling(now: Date())
        self.rebuildReviewDataReportingFailure(reason: .filterChanged(reviewFilter), now: Date())
        self.reconcileReviewNotifications(trigger: .filterChanged, now: Date())
    }

    /// Starts a new Review session for `reviewFilter`. Full rebuilds go through `rebuildReviewData(reason:now:)`.
    @discardableResult
    func startReviewLoad(reviewFilter: ReviewFilter, now: Date) -> Bool {
        self.startReviewLoad(reviewFilter: reviewFilter, shownCardIntent: .startNewSession, now: now)
    }

    /// Reloads the selected scope after its in-flight load or source was invalidated; the shown card stays.
    @discardableResult
    func restartReviewLoadKeepingShownCard(now: Date) -> Bool {
        self.startReviewLoad(reviewFilter: self.selectedReviewFilter, shownCardIntent: .keepShownCard, now: now)
    }

    /// Opens Review from a widget tap. A tapped card that is still in review in the current workspace starts a new
    /// session shown first; otherwise the current session stays as it is.
    func openReviewFromWidget(deepLink: WidgetDeepLink, navigation: AppNavigationModel, now: Date) {
        defer {
            navigation.selectTab(.review)
        }
        guard let cardId = deepLink.cardId, deepLink.workspaceId == self.workspace?.workspaceId else {
            return
        }
        let reviewState = self.currentReviewPublishedState()
        let shownCardId = currentReviewCard(
            reviewQueue: self.reviewRuntime.effectiveReviewQueue(publishedState: reviewState)
        )?.cardId
        guard cardId != shownCardId else {
            return
        }
        let tappedReviewCard = presentedReviewCardForBackgroundRefresh(
            reviewQueue: [],
            presentedCardId: cardId,
            pendingReviewCardIds: reviewState.pendingReviewCardIds,
            resolvedReviewFilter: reviewState.selectedReviewFilter,
            decks: self.decks,
            cards: self.cards,
            now: now
        )
        guard tappedReviewCard != nil else {
            return
        }
        self.startReviewLoad(
            reviewFilter: reviewState.selectedReviewFilter,
            shownCardIntent: .startNewSessionShowingCard(cardId: cardId),
            now: now
        )
    }

    @discardableResult
    private func startReviewLoad(reviewFilter: ReviewFilter, shownCardIntent: ReviewShownCardIntent, now: Date) -> Bool {
        do {
            try self.startReviewLoadOrThrow(reviewFilter: reviewFilter, shownCardIntent: shownCardIntent, now: now)
            return true
        } catch {
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            return false
        }
    }

    func startReviewLoadOrThrow(reviewFilter: ReviewFilter, shownCardIntent: ReviewShownCardIntent, now: Date) throws {
        let database = try requireLocalDatabase(database: self.database)
        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        let resolvedReviewQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspaceId,
            reviewFilter: reviewFilter
        )
        self.startResolvedReviewLoad(
            resolvedReviewQuery: resolvedReviewQuery,
            requestedReviewFilter: reviewFilter,
            shownCardIntent: shownCardIntent,
            workspaceId: workspaceId,
            databaseURL: database.databaseURL,
            now: now
        )
    }

    func startResolvedReviewLoad(
        resolvedReviewQuery: ResolvedReviewQuery,
        requestedReviewFilter: ReviewFilter,
        shownCardIntent: ReviewShownCardIntent,
        workspaceId: String,
        databaseURL: URL,
        now: Date
    ) {
        let currentReviewState = self.currentReviewPublishedState()
        // The shown card and the prepared next card must never change before the shown card is rated: replacing
        // either during a reload reads as a blink. Only a new scope starts empty, including the fallback when the
        // requested deck no longer exists; a widget tap starts a new session showing its card first. The cards are
        // validated against the fresh `cards`, not the queue being replaced.
        // See docs/fsrs-scheduling-logic.md#non-blocking-review.
        let startsNewSession = shownCardIntent != .keepShownCard
            || isMissingDeckReviewFilterFallback(
                requestedReviewFilter: requestedReviewFilter,
                resolvedReviewFilter: resolvedReviewQuery.reviewFilter
            )
        let requestedFirstCardId: String?
        if case .startNewSessionShowingCard(let cardId) = shownCardIntent {
            requestedFirstCardId = cardId
        } else {
            requestedFirstCardId = nil
        }
        let currentEffectiveQueue = self.reviewRuntime.effectiveReviewQueue(publishedState: currentReviewState)
        let validatedShownReviewCard = startsNewSession ? nil : presentedReviewCardForBackgroundRefresh(
            reviewQueue: [],
            presentedCardId: currentReviewCard(reviewQueue: currentEffectiveQueue)?.cardId,
            pendingReviewCardIds: currentReviewState.pendingReviewCardIds,
            resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
            decks: self.decks,
            cards: self.cards,
            now: now
        )
        // The same still-in-review check as the shown card.
        let validatedNextReviewCard = startsNewSession ? nil : presentedReviewCardForBackgroundRefresh(
            reviewQueue: [],
            presentedCardId: nextReviewCard(reviewQueue: currentEffectiveQueue)?.cardId,
            pendingReviewCardIds: currentReviewState.pendingReviewCardIds,
            resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
            decks: self.decks,
            cards: self.cards,
            now: now
        )
        let validatedRequestedFirstReviewCard = presentedReviewCardForBackgroundRefresh(
            reviewQueue: [],
            presentedCardId: requestedFirstCardId,
            pendingReviewCardIds: currentReviewState.pendingReviewCardIds,
            resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
            decks: self.decks,
            cards: self.cards,
            now: now
        )
        // A shown card that left review advances to the prepared next card; the head load prepares a new next card.
        // See docs/fsrs-scheduling-logic.md#non-blocking-review.
        let preservedPresentedReviewCard = validatedRequestedFirstReviewCard
            ?? validatedShownReviewCard
            ?? validatedNextReviewCard
        let preservedNextReviewCard = validatedShownReviewCard == nil ? nil : validatedNextReviewCard
        let plan = self.reviewRuntime.startReviewLoad(
            publishedState: currentReviewState,
            resolvedReviewQuery: resolvedReviewQuery,
            workspaceId: workspaceId,
            databaseURL: databaseURL,
            now: now,
            preservedPresentedReviewCard: preservedPresentedReviewCard,
            preservedNextReviewCard: preservedNextReviewCard
        )
        self.applyReviewPublishedState(reviewState: plan.publishedState)
        self.persistSelectedReviewFilter(reviewFilter: plan.publishedState.selectedReviewFilter)
        self.globalErrorMessage = ""

        self.startReviewCountsLoad(request: plan.countsRequest)

        let headLoadStartedAt = Date()
        addReviewForegroundOperationBreadcrumb(
            store: self,
            action: .reviewQueueLoad,
            phase: .start,
            startedAt: nil,
            requestId: plan.headRequest.requestId,
            reviewFilter: plan.headRequest.resolvedReviewFilter,
            reviewRefreshMode: nil,
            reviewLoadKind: .head,
            publishedState: plan.publishedState,
            errorSummary: nil
        )
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
                // A card rated or changed during the load may have left review since the load started.
                let preparedNextReviewCard = presentedReviewCardForBackgroundRefresh(
                    reviewQueue: reviewHeadState.seedReviewQueue,
                    presentedCardId: plan.headRequest.preservedNextReviewCard?.cardId,
                    pendingReviewCardIds: self.pendingReviewCardIds,
                    resolvedReviewFilter: reviewHeadState.resolvedReviewFilter,
                    decks: self.decks,
                    cards: self.cards,
                    now: plan.headRequest.now
                )
                guard let nextReviewState = self.reviewRuntime.applyReviewHeadLoadSuccess(
                    publishedState: self.currentReviewPublishedState(),
                    reviewHeadState: reviewHeadState,
                    preparedNextReviewCard: preparedNextReviewCard,
                    requestId: plan.headRequest.requestId,
                    sourceVersion: plan.headRequest.sourceVersion
                ) else {
                    return
                }

                addReviewForegroundOperationBreadcrumb(
                    store: self,
                    action: .reviewQueueLoad,
                    phase: .success,
                    startedAt: headLoadStartedAt,
                    requestId: plan.headRequest.requestId,
                    reviewFilter: nextReviewState.selectedReviewFilter,
                    reviewRefreshMode: nil,
                    reviewLoadKind: .head,
                    publishedState: nextReviewState,
                    errorSummary: nil
                )
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

                addReviewForegroundOperationBreadcrumb(
                    store: self,
                    action: .reviewQueueLoad,
                    phase: .failure,
                    startedAt: headLoadStartedAt,
                    requestId: plan.headRequest.requestId,
                    reviewFilter: nextReviewState.selectedReviewFilter,
                    reviewRefreshMode: nil,
                    reviewLoadKind: .head,
                    publishedState: nextReviewState,
                    errorSummary: Flashcards.errorMessage(error: error)
                )
                self.applyReviewPublishedState(reviewState: nextReviewState)
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
        self.reviewRuntime.setActiveReviewLoadTask(
            task: headTask,
            requestId: plan.headRequest.requestId
        )
    }

    func refreshReviewState(now: Date, mode: ReviewRefreshMode) async throws -> Bool {
        let startedAt = Date()
        let startState = self.currentReviewPublishedState()
        addReviewForegroundOperationBreadcrumb(
            store: self,
            action: .reviewStateRefresh,
            phase: .start,
            startedAt: nil,
            requestId: nil,
            reviewFilter: startState.selectedReviewFilter,
            reviewRefreshMode: mode,
            reviewLoadKind: nil,
            publishedState: startState,
            errorSummary: nil
        )
        do {
            let didRefresh: Bool
            switch mode {
            case .blockingReset:
                try self.startReviewLoadOrThrow(
                    reviewFilter: self.selectedReviewFilter,
                    shownCardIntent: .keepShownCard,
                    now: now
                )
                addReviewForegroundOperationBreadcrumb(
                    store: self,
                    action: .reviewStateRefresh,
                    phase: .success,
                    startedAt: startedAt,
                    requestId: nil,
                    reviewFilter: self.selectedReviewFilter,
                    reviewRefreshMode: mode,
                    reviewLoadKind: nil,
                    publishedState: self.currentReviewPublishedState(),
                    errorSummary: nil
                )
                return true
            case .backgroundReconcileSilently:
                didRefresh = try await self.reconcileReviewState(
                    now: now,
                    trigger: .cloudSyncSilently
                )
            case .backgroundReconcileWithVisibleChangeBanner:
                didRefresh = try await self.reconcileReviewState(
                    now: now,
                    trigger: .cloudSyncWithVisibleChangeBanner
                )
            }
            addReviewForegroundOperationBreadcrumb(
                store: self,
                action: .reviewStateRefresh,
                phase: .success,
                startedAt: startedAt,
                requestId: nil,
                reviewFilter: self.selectedReviewFilter,
                reviewRefreshMode: mode,
                reviewLoadKind: nil,
                publishedState: self.currentReviewPublishedState(),
                errorSummary: nil
            )
            return didRefresh
        } catch {
            addReviewForegroundOperationBreadcrumb(
                store: self,
                action: .reviewStateRefresh,
                phase: .failure,
                startedAt: startedAt,
                requestId: nil,
                reviewFilter: self.selectedReviewFilter,
                reviewRefreshMode: mode,
                reviewLoadKind: nil,
                publishedState: self.currentReviewPublishedState(),
                errorSummary: Flashcards.errorMessage(error: error)
            )
            throw error
        }
    }

    func startReviewCountsLoad(request: ReviewCountsLoadRequest) {
        self.reviewRuntime.startReviewCountsLoad(request: request)
        let countsLoadStartedAt = Date()
        let startState = self.currentReviewPublishedState()
        addReviewForegroundOperationBreadcrumb(
            store: self,
            action: .reviewCountsLoad,
            phase: .start,
            startedAt: nil,
            requestId: request.requestId,
            reviewFilter: startState.selectedReviewFilter,
            reviewRefreshMode: nil,
            reviewLoadKind: nil,
            publishedState: startState,
            errorSummary: nil
        )
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

                addReviewForegroundOperationBreadcrumb(
                    store: self,
                    action: .reviewCountsLoad,
                    phase: .success,
                    startedAt: countsLoadStartedAt,
                    requestId: request.requestId,
                    reviewFilter: nextReviewState.selectedReviewFilter,
                    reviewRefreshMode: nil,
                    reviewLoadKind: nil,
                    publishedState: nextReviewState,
                    errorSummary: nil
                )
                self.applyReviewPublishedState(reviewState: nextReviewState)
                // The request belongs to the active load of the selected filter, so its due count is the badge's.
                self.reviewDueBadgeCount = reviewCounts.dueCount
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

                addReviewForegroundOperationBreadcrumb(
                    store: self,
                    action: .reviewCountsLoad,
                    phase: .failure,
                    startedAt: countsLoadStartedAt,
                    requestId: request.requestId,
                    reviewFilter: nextReviewState.selectedReviewFilter,
                    reviewRefreshMode: nil,
                    reviewLoadKind: nil,
                    publishedState: nextReviewState,
                    errorSummary: Flashcards.errorMessage(error: error)
                )
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

        let requestedReviewFilter = self.selectedReviewFilter
        let resolvedReviewQuery: ResolvedReviewQuery
        do {
            resolvedReviewQuery = try requireLocalDatabase(database: self.database).loadResolvedReviewQuery(
                workspaceId: workspaceId,
                reviewFilter: requestedReviewFilter
            )
        } catch {
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            return
        }
        guard resolvedReviewQuery.reviewFilter == requestedReviewFilter else {
            self.rebuildReviewDataReportingFailure(reason: .filterChanged(requestedReviewFilter), now: now)
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
        let queueChunkLoadStartedAt = Date()
        addReviewForegroundOperationBreadcrumb(
            store: self,
            action: .reviewQueueLoad,
            phase: .start,
            startedAt: nil,
            requestId: request.requestId,
            reviewFilter: loadingReviewState.selectedReviewFilter,
            reviewRefreshMode: nil,
            reviewLoadKind: .chunk,
            publishedState: loadingReviewState,
            errorSummary: nil
        )
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

                addReviewForegroundOperationBreadcrumb(
                    store: self,
                    action: .reviewQueueLoad,
                    phase: .success,
                    startedAt: queueChunkLoadStartedAt,
                    requestId: request.requestId,
                    reviewFilter: nextReviewState.selectedReviewFilter,
                    reviewRefreshMode: nil,
                    reviewLoadKind: .chunk,
                    publishedState: nextReviewState,
                    errorSummary: nil
                )
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

                addReviewForegroundOperationBreadcrumb(
                    store: self,
                    action: .reviewQueueLoad,
                    phase: .failure,
                    startedAt: queueChunkLoadStartedAt,
                    requestId: request.requestId,
                    reviewFilter: nextReviewState.selectedReviewFilter,
                    reviewRefreshMode: nil,
                    reviewLoadKind: .chunk,
                    publishedState: nextReviewState,
                    errorSummary: Flashcards.errorMessage(error: error)
                )
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
            captureReviewFilterPersistenceSilentFailure(
                error: error,
                action: "review_filter_save",
                stage: "encode",
                cloudSettings: self.cloudSettings,
                workspaceId: workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
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
        // Rating until this submission's follow-up work settles; non-blocking review plans read it
        // as their before/after number.
        let afterRatingWorkSpan = FlashcardsObservability.startReviewAfterRatingWorkSpan(
            ratedAt: parseIsoTimestamp(value: request.reviewedAtClient) ?? Date()
        )
        defer {
            FlashcardsObservability.finishReviewAfterRatingWorkSpan(afterRatingWorkSpan)
        }

        guard let reviewSubmissionExecutor = self.dependencies.reviewSubmissionExecutor else {
            await self.handleReviewSubmissionFailure(
                request: request,
                submissionError: self.reviewRuntime.reviewSubmissionExecutorUnavailableError()
            )
            return
        }

        let onboardingOwnerUserId = self.cloudSettings?.linkedUserId
        let onboardingInstallationId = self.cloudSettings?.installationId
        do {
            try self.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade()
            _ = try await reviewSubmissionExecutor.submitReview(
                workspaceId: request.workspaceId,
                submission: ReviewSubmission(
                    cardId: request.cardId,
                    rating: request.rating,
                    reviewedAtClient: request.reviewedAtClient,
                    reviewedTimeZone: request.reviewedTimeZone
                )
            )
        } catch {
            await self.handleReviewSubmissionFailure(request: request, submissionError: error)
            return
        }

        let retainsOnboardingOwner = self.cloudSettings?.linkedUserId == onboardingOwnerUserId
            || (onboardingOwnerUserId == nil && self.cloudSettings?.cloudState == .guest)
        if self.cloudSettings?.installationId == onboardingInstallationId, retainsOnboardingOwner {
            self.applySavedFirstReviewOnboarding(reviewToken: "\(request.cardId)|\(request.reviewedAtClient)")
        }

        let now = Date()
        self.reviewRuntime.invalidateReviewSource()
        let reviewedAt = parseIsoTimestamp(value: request.reviewedAtClient) ?? now
        self.recordSuccessfulReviewNotificationEffects(
            reviewedAt: reviewedAt,
            workspaceId: request.workspaceId,
            now: now
        )
        guard self.reviewSubmissionRequestMatchesCurrentContext(request: request, now: now) else {
            await self.applyStaleSuccessfulReviewSubmissionCompletion(request: request, now: now)
            return
        }

        // A rating never reads the whole workspace. See docs/fsrs-scheduling-logic.md#non-blocking-review.
        do {
            try await self.applyRatedCardLocally(workspaceId: request.workspaceId, cardId: request.cardId, now: now)
            _ = try await self.reconcileReviewState(
                now: now,
                trigger: .localReview
            )
        } catch {
            self.applyStaleReviewSubmissionCompletion(request: request)
            self.settleReviewSourceRefreshFailure(error: error)
            return
        }
        let completionValidationContext = self.makeReviewSubmissionRollbackValidationContext(now: now)
        // The shown card must never change before it is rated, so a queue that only reordered or gained
        // cards (an `Again` card becoming due) completes normally; a reload would replace the card (a blink).
        // See docs/fsrs-scheduling-logic.md#non-blocking-review.
        guard self.reviewSubmissionRequestMatchesCurrentContext(
            request: request,
            validationContext: completionValidationContext
        ) else {
            // The rated card and the queue window are already current; only the pending state settles.
            self.applyStaleReviewSubmissionCompletion(request: request)
            return
        }

        self.reviewHardReminderRecentRatings = appendReviewHardReminderRating(
            recentRatings: self.reviewHardReminderRecentRatings,
            nextRating: request.rating
        )
        self.applyReviewPublishedState(
            reviewState: self.reviewRuntime.completeReviewSubmission(
                publishedState: self.currentReviewPublishedState(),
                request: request,
                validationContext: completionValidationContext
            )
        )
        self.handleProgressLocalMutation(
            now: now,
            reviewedAtClient: request.reviewedAtClient,
            reviewedTimeZone: request.reviewedTimeZone,
            rating: request.rating
        )
        func triggerSuccessfulReviewCloudSync() {
            self.triggerCloudSyncIfLinked(
                trigger: CloudSyncTrigger(
                    source: .localMutation,
                    now: now,
                    extendsFastPolling: true,
                    allowsVisibleChangeBanner: false,
                    surfacesGlobalErrorMessage: false,
                    capturesTechnicalFailures: false
                )
            )
        }

        self.pendingStoreReviewRequestAttempt = nil
        self.savedReviewPromptOpportunity = SavedReviewPromptOpportunity(
            id: UUID(), workspaceId: request.workspaceId,
            rating: request.rating,
            reviewFilter: request.reviewContext.selectedReviewFilter
        )
        triggerSuccessfulReviewCloudSync()
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

    private func reviewSubmissionRequestMatchesCurrentSession(
        request: ReviewSubmissionRequest,
        validationContext: ReviewSubmissionRollbackValidationContext?
    ) -> Bool {
        guard let validationContext else {
            return false
        }
        return self.reviewRuntime.reviewSubmissionRequestMatchesCurrentSession(
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

    private func applyStaleSuccessfulReviewSubmissionCompletion(
        request: ReviewSubmissionRequest,
        now: Date
    ) async {
        self.applyStaleReviewSubmissionCompletion(request: request)
        do {
            try await self.applyRatedCardLocally(workspaceId: request.workspaceId, cardId: request.cardId, now: now)
            // This rating did not advance the current session, so its prepared next card stays.
            // See docs/fsrs-scheduling-logic.md#non-blocking-review.
            _ = try await self.reconcileReviewState(now: now, trigger: .staleLocalReview)
        } catch {
            self.settleReviewSourceRefreshFailure(error: error)
        }
    }

    func handleReviewSubmissionFailure(request: ReviewSubmissionRequest, submissionError: Error) async {
        let submissionErrorMessage = Flashcards.errorMessage(error: submissionError)
        Analytics.track(
            .reviewAnswerFailed(reason: analyticsReviewAnswerFailureReason(error: submissionError)),
            screen: .review
        )
        let now = Date()
        // Capture the pre-refresh validation context once so the staleness classification
        // is independent of the bootstrap-refresh outcome below. The catch branch reuses
        // this same snapshot when the refresh throws and a fresh context is unavailable;
        // rollback-card selection still requires fresh data and is suppressed in that case.
        let preRefreshValidationContext = self.makeReviewSubmissionRollbackValidationContext(now: now)
        guard self.reviewSubmissionRequestMatchesCurrentSession(
            request: request,
            validationContext: preRefreshValidationContext
        ) else {
            self.applyStaleReviewSubmissionCompletion(request: request)
            return
        }

        do {
            let bootstrapRefreshOutcome = try await self.refreshBootstrapSnapshotWithoutReset(now: now)
            if bootstrapRefreshOutcome.didChange {
                self.localReadVersion += 1
            }
            let rollbackValidationContext = self.makeReviewSubmissionRollbackValidationContext(now: now)
            guard self.reviewSubmissionRequestMatchesCurrentSession(
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
            guard self.reviewSubmissionRequestMatchesCurrentSession(
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

        let requestedReviewFilter = self.selectedReviewFilter
        let resolvedReviewQuery = try database.loadResolvedReviewQuery(
            workspaceId: workspaceId,
            reviewFilter: requestedReviewFilter
        )
        // A missing deck is a new scope, so it starts a new session instead of keeping the shown card.
        if isMissingDeckReviewFilterFallback(
            requestedReviewFilter: requestedReviewFilter,
            resolvedReviewFilter: resolvedReviewQuery.reviewFilter
        ) {
            try self.rebuildReviewData(reason: .filterChanged(requestedReviewFilter), now: now)
            return true
        }
        let currentReviewState = self.currentReviewPublishedState()
        let reviewSourceVersion = self.reviewRuntime.currentReviewSourceVersion()
        let reconciliationGeneration = self.reviewRuntime.beginReviewReconciliation()
        let currentEffectiveQueue = self.reviewRuntime.effectiveReviewQueue(publishedState: currentReviewState)
        let currentCardId = currentReviewCard(reviewQueue: currentEffectiveQueue)?.cardId
        // Only a rating moves the shown card off position 0, so only its reconcile may choose a new prepared next
        // card; every other refresh keeps it. See docs/fsrs-scheduling-logic.md#non-blocking-review.
        let currentPreparedNextCardId = trigger == .localReview
            ? nil
            : nextReviewCard(reviewQueue: currentEffectiveQueue)?.cardId
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
        // The Review badge counts the same due cards for the same filter, so it needs no query of its own. Fresh
        // counts publish it even when the queue below is unchanged, because a rating rereads nothing else; a
        // superseded reconcile publishes nothing, so it cannot overwrite a newer count.
        // See docs/fsrs-scheduling-logic.md#non-blocking-review.
        if requestedReviewFilter == self.selectedReviewFilter,
           self.reviewRuntime.reviewSourceVersionMatches(sourceVersion: reviewSourceVersion),
           self.reviewRuntime.shouldApplyReviewReconciliation(generation: reconciliationGeneration) {
            self.reviewDueBadgeCount = reviewCounts.dueCount
        }
        guard currentReviewState == self.currentReviewPublishedState() else {
            return false
        }
        guard self.reviewRuntime.reviewSourceVersionMatches(sourceVersion: reviewSourceVersion) else {
            self.restartReviewLoadKeepingShownCard(now: now)
            return false
        }
        guard self.reviewRuntime.shouldApplyReviewReconciliation(generation: reconciliationGeneration) else {
            return false
        }
        // The same still-in-review check as the shown card.
        let preparedNextReviewCard = presentedReviewCardForBackgroundRefresh(
            reviewQueue: reviewQueueWindowState.reviewQueue,
            presentedCardId: currentPreparedNextCardId,
            pendingReviewCardIds: currentReviewState.pendingReviewCardIds,
            resolvedReviewFilter: resolvedReviewQuery.reviewFilter,
            decks: self.decks,
            cards: self.cards,
            now: now
        )
        // If the shown card left review, the prepared next card is first here and becomes the shown card.
        let refreshedReviewQueue = reviewQueueKeepingPreparedNextCard(
            reviewQueue: reviewQueueWindowState.reviewQueue,
            preparedNextCard: preparedNextReviewCard
        )
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
