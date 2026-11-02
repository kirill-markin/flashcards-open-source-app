import Foundation

/*
 A rating updates only the rated card, the queue, counts and badge in memory (`applyRatedCardLocally`).
 A full rebuild rereads Review data for one `ReviewDataRebuildReason` and records it with
 `addReviewDataRebuildBreadcrumb`. Every reason but one starts in `rebuildReviewData(reason:now:)`; a sync that
 applied remote changes rebuilds awaited in `applySyncResultWithoutBlockingReset`. A rebuild never swaps the
 shown card or the prepared next card except for a new scope.
 See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */

let reviewSafetyRebuildInterval: TimeInterval = 10 * 60
let reviewLongAbsenceThreshold: TimeInterval = 30 * 60

enum ReviewDataRebuildReason: Hashable {
    case initialLoad
    /// A chosen filter, or the fallback when the selected deck no longer exists.
    case filterChanged(ReviewFilter)
    /// A workspace switch or another identity transition that reloads the whole workspace. Only a different
    /// workspace id starts a new session; a rename, relink, or server reset keeps the shown card.
    case workspaceChanged
    /// A local create, edit, delete, or import of cards or decks, or a scheduler settings change.
    case localCardsChanged
    case syncAppliedRemoteChanges
    case returnedAfterLongAbsence
    case dateChanged
    case safetyInterval

    var diagnosticValue: String {
        switch self {
        case .initialLoad:
            return "initial_load"
        case .filterChanged:
            return "filter_changed"
        case .workspaceChanged:
            return "workspace_changed"
        case .localCardsChanged:
            return "local_cards_changed"
        case .syncAppliedRemoteChanges:
            return "sync_applied_remote_changes"
        case .returnedAfterLongAbsence:
            return "returned_after_long_absence"
        case .dateChanged:
            return "date_changed"
        case .safetyInterval:
            return "safety_interval"
        }
    }
}

/// What a review load does with the card on screen.
enum ReviewShownCardIntent {
    /// A new scope starts a new session without the shown card.
    case startNewSession
    /// The shown card stays while it still belongs to the resolved scope.
    case keepShownCard
}

/// Returns the rebuild a return to the foreground needs, or nil when the app was away briefly on the same day.
func reviewDataRebuildReasonAfterReturning(
    leftForegroundAt: Date,
    now: Date,
    calendar: Calendar
) -> ReviewDataRebuildReason? {
    if now.timeIntervalSince(leftForegroundAt) >= reviewLongAbsenceThreshold {
        return .returnedAfterLongAbsence
    }
    if calendar.isDate(leftForegroundAt, inSameDayAs: now) == false {
        return .dateChanged
    }
    return nil
}

@MainActor
extension FlashcardsStore {
    /**
     Starts the full rebuild for every reason except `.syncAppliedRemoteChanges`. Initial load and workspace
     transitions read on the main actor and publish before returning because their callers read the new workspace
     at once; a filter change only resolves the filter there. The remaining reasons read off the main actor while
     Review stays usable.
     */
    func rebuildReviewData(reason: ReviewDataRebuildReason, now: Date) throws {
        self.addReviewDataRebuildBreadcrumb(reason: reason)
        switch reason {
        case .initialLoad:
            try self.reload(now: now, refreshVisibleProgress: false, shownCardIntent: .keepShownCard)
        case .filterChanged(let reviewFilter):
            // Picking the filter already shown (a deck's Review button, a tag, a filtered reminder) keeps the card;
            // a missing deck still starts a new session in `startResolvedReviewLoad`.
            let shownCardIntent: ReviewShownCardIntent = reviewFilter == self.selectedReviewFilter
                ? .keepShownCard
                : .startNewSession
            try self.startReviewLoadOrThrow(reviewFilter: reviewFilter, shownCardIntent: shownCardIntent, now: now)
        case .workspaceChanged:
            // A different workspace id resets the session in `applyLoadedBootstrapSnapshot`.
            try self.reload(now: now, refreshVisibleProgress: true, shownCardIntent: .keepShownCard)
        case .localCardsChanged, .returnedAfterLongAbsence, .dateChanged, .safetyInterval:
            self.startBackgroundReviewDataRebuild(reason: reason, now: now)
        case .syncAppliedRemoteChanges:
            // The sync awaits this rebuild so it fails with it; see `applySyncResultWithoutBlockingReset`.
            throw LocalStoreError.validation(
                "The sync_applied_remote_changes rebuild runs only in applySyncResultWithoutBlockingReset."
            )
        }
    }

    /// Loads the rated card by id and replaces it in `cards`; the queue window and counts reconcile after it.
    func applyRatedCardLocally(workspaceId: String, cardId: String, now: Date) async throws {
        guard workspaceId == self.workspace?.workspaceId else {
            return
        }
        guard let databaseURL = self.localDatabaseURL else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        let ratedCard: Card?
        do {
            ratedCard = try await loadActiveCardInBackground(
                databaseURL: databaseURL,
                workspaceId: workspaceId,
                cardId: cardId
            )
        } catch LocalStoreError.notFound {
            // A sync deleted the card after the rating; it leaves review like any deleted card.
            // See docs/fsrs-scheduling-logic.md#non-blocking-review.
            ratedCard = nil
        }
        guard workspaceId == self.workspace?.workspaceId else {
            return
        }
        if let ratedCard {
            self.cards = self.cards.map { card in
                card.cardId == ratedCard.cardId ? ratedCard : card
            }
        } else {
            self.cards = self.cards.filter { card in
                card.cardId != cardId
            }
            // Screens keyed on this version drop the deleted card. See docs/fsrs-scheduling-logic.md#non-blocking-review.
            self.localReadVersion += 1
        }
        self.resumeReviewLoadsInvalidatedBySourceChange(now: now)
        self.reviewScheduleVersion += 1
        // "Again in 1 minute" can come due before the armed timer; only the timer moves, nothing is reread.
        if let ratedDueAt = ratedCard?.dueAt.flatMap({ dueAt in parseIsoTimestamp(value: dueAt) }),
           ratedDueAt > now,
           self.armedNextDueRefreshAt().map({ nextDueRefreshAt in ratedDueAt < nextDueRefreshAt }) ?? true {
            self.scheduleNextDueRefresh(nextDueAt: ratedDueAt)
        }
    }

    /// A fired or cancelled timer leaves nothing armed. A timer past its time that has not woken yet stays armed:
    /// it re-arms at the earliest due time, the rated card included.
    private func armedNextDueRefreshAt() -> Date? {
        guard let nextDueRefreshTask = self.nextDueRefreshTask, nextDueRefreshTask.isCancelled == false else {
            return nil
        }
        return self.nextDueRefreshAt
    }

    /**
     One timer at the earliest future due time refreshes only the bounded queue window and counts, never a full
     rebuild, and keeps the shown card and the prepared next card. Re-arming replaces the previous timer.
     */
    func scheduleNextDueRefresh(nextDueAt: Date?) {
        self.nextDueRefreshTask?.cancel()
        self.nextDueRefreshTask = nil
        self.nextDueRefreshAt = nextDueAt
        guard let nextDueAt else {
            return
        }
        self.nextDueRefreshTask = Task { @MainActor in
            do {
                try await Task.sleep(for: .seconds(max(0, nextDueAt.timeIntervalSinceNow)))
                try Task.checkCancellation()
                // A fired timer is unarmed: a rating during this refresh arms its own timer without cancelling
                // this one, which then re-arms at the earliest due time.
                self.nextDueRefreshTask = nil
                self.nextDueRefreshAt = nil
                _ = try await self.refreshReviewState(now: Date(), mode: .backgroundReconcileSilently)
            } catch is CancellationError {
                return
            } catch {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            guard Task.isCancelled == false else {
                return
            }
            // Publishes the badge and arms the timer at the following due time.
            await self.runReviewDueBadgeUpdates()
        }
    }

    /// Runs while the app is active; the caller's task cancels it when the scene leaves the foreground.
    func runReviewDataSafetyRebuilds() async {
        while true {
            do {
                try await Task.sleep(for: .seconds(reviewSafetyRebuildInterval))
            } catch {
                return
            }
            self.rebuildReviewDataReportingFailure(reason: .safetyInterval, now: Date())
        }
    }

    func recordReviewDataLeftForeground(now: Date) {
        self.reviewDataLeftForegroundAt = now
    }

    func rebuildReviewDataAfterReturningIfNeeded(now: Date) {
        guard let leftForegroundAt = self.reviewDataLeftForegroundAt else {
            return
        }
        self.reviewDataLeftForegroundAt = nil
        guard let reason = reviewDataRebuildReasonAfterReturning(
            leftForegroundAt: leftForegroundAt,
            now: now,
            calendar: Calendar.current
        ) else {
            return
        }
        self.rebuildReviewDataReportingFailure(reason: reason, now: now)
    }

    /// For callers with no error surface of their own: the failure shows as the global error.
    func rebuildReviewDataReportingFailure(reason: ReviewDataRebuildReason, now: Date) {
        do {
            try self.rebuildReviewData(reason: reason, now: now)
        } catch {
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    /**
     A local write invalidates in-flight review loads, so each restarts or settles instead of staying loading.
     A head load keeps the shown card on an empty queue, so it restarts instead of settling.
     */
    func resumeReviewLoadsInvalidatedBySourceChange(now: Date) {
        guard self.isReviewHeadLoading || self.isReviewCountsLoading || self.isReviewQueueChunkLoading else {
            return
        }
        if self.isReviewHeadLoading || (self.reviewQueue.isEmpty && self.presentedReviewCard == nil) {
            self.restartReviewLoadKeepingShownCard(now: now)
            return
        }
        let settledReviewState = self.reviewRuntime.settleInvalidatedReviewLoads(
            publishedState: self.currentReviewPublishedState()
        )
        self.applyReviewPublishedState(reviewState: settledReviewState)
    }

    private func startBackgroundReviewDataRebuild(reason: ReviewDataRebuildReason, now: Date) {
        self.activeReviewDataRebuildTask?.cancel()
        self.activeReviewDataRebuildTask = Task { @MainActor in
            do {
                let bootstrapRefreshOutcome = try await self.refreshBootstrapSnapshotWithoutReset(now: now)
                _ = try await self.refreshReviewState(now: now, mode: .backgroundReconcileSilently)
                if bootstrapRefreshOutcome.didChange {
                    self.localReadVersion += 1
                }
                // Due data shown on other screens moves with time even when nothing was written.
                self.reviewScheduleVersion += 1
            } catch is CancellationError {
                return
            } catch {
                self.settleReviewSourceRefreshFailure(error: error)
                // The user's own save already succeeded, so its failed rebuild is shown like a failed save was.
                if reason == .localCardsChanged {
                    self.presentTechnicalError(error)
                }
            }
        }
    }

    func addReviewDataRebuildBreadcrumb(reason: ReviewDataRebuildReason) {
        let scope = IOSObservationScope(
            feature: .storeReview,
            userId: self.cloudSettings?.linkedUserId,
            workspaceId: self.workspace?.workspaceId,
            requestId: nil,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: self.cloudSettings?.cloudState,
            configurationMode: try? self.currentCloudServiceConfiguration().mode
        )
        FlashcardsObservability.addBreadcrumb(
            .foregroundOperation(
                ForegroundOperationObservation(
                    scope: scope,
                    action: .reviewDataRebuild,
                    phase: .start,
                    durationMilliseconds: nil,
                    operationStage: nil,
                    operationTrigger: reason.diagnosticValue,
                    selectedTab: nil,
                    scenePhase: nil,
                    isStartupReady: nil,
                    isRecoveryGateActive: nil,
                    cardCount: self.cards.count,
                    deckCount: self.decks.count,
                    pendingOutboxOperationCount: nil,
                    reviewQueueCount: self.reviewQueue.count,
                    reviewDueCount: self.reviewCounts.dueCount,
                    reviewNewCount: nil,
                    reviewPendingCount: self.pendingReviewCardIds.count,
                    reviewTotalCount: self.reviewCounts.totalCount,
                    reviewFilterKind: nil,
                    reviewRefreshMode: nil,
                    reviewLoadKind: nil,
                    progressSummaryRefreshNeeded: nil,
                    progressSeriesRefreshNeeded: nil,
                    progressReviewScheduleRefreshNeeded: nil,
                    progressLeaderboardRefreshNeeded: nil,
                    progressStreakLeaderboardRefreshNeeded: nil,
                    cloudSyncBlocked: self.isCloudSyncBlocked,
                    cloudSyncExtendsFastPolling: nil,
                    cloudSyncUsesImmediateStartDebounce: nil,
                    cloudSyncImmediateStartSkipped: nil,
                    cloudSyncSkipReason: nil,
                    cloudSyncHadActiveTask: nil,
                    cloudSyncPendingResync: nil,
                    cloudSyncWaitOutcome: nil,
                    cloudSyncAcknowledgedOperationCount: nil,
                    cloudSyncAppliedPullChangeCount: nil,
                    cloudSyncChangedEntityTypeCount: nil,
                    cloudSyncLocalIdRepairEntityTypeCount: nil,
                    cloudSyncReviewScheduleImpactingPullChangeCount: nil,
                    cloudSyncAcknowledgedReviewEventOperationCount: nil,
                    cloudSyncAcknowledgedReviewScheduleImpactingOperationCount: nil,
                    cloudSyncCleanedUpOperationCount: nil,
                    cloudSyncCleanedUpReviewScheduleImpactingOperationCount: nil,
                    cloudSyncCleanedUpReviewEventOperationCount: nil,
                    notificationKind: nil,
                    notificationAuthorizationStatus: nil,
                    notificationPendingBeforeTotalCount: nil,
                    notificationPendingBeforeReviewCount: nil,
                    notificationPendingBeforeStrictCount: nil,
                    notificationPendingBeforeOtherCount: nil,
                    notificationPendingAfterTotalCount: nil,
                    notificationPendingAfterReviewCount: nil,
                    notificationPendingAfterStrictCount: nil,
                    notificationPendingAfterOtherCount: nil,
                    notificationDeliveredBeforeCount: nil,
                    notificationDeliveredRemovedCount: nil,
                    notificationPlannedCount: nil,
                    notificationAttemptedCount: nil,
                    notificationAcceptedCount: nil,
                    notificationReadbackCompleted: nil,
                    notificationReadbackAttemptCount: nil,
                    errorSummary: nil
                )
            )
        )
    }
}
