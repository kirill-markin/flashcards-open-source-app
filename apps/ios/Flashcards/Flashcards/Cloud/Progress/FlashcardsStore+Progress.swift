import Foundation

/// Store-owned progress lifecycle:
/// prepare a scope snapshot from local state, render immediately from cached/local data,
/// then refresh summary and series independently and re-render whenever the latest response still matches the latest token.
@MainActor
extension FlashcardsStore {
    func prepareVisibleTabForPresentation(
        tab: AppTab,
        now: Date
    ) {
        self.updateCurrentVisibleTab(tab: tab)

        guard isProgressConsumerTab(tab: tab) else {
            return
        }

        self.prepareProgressForCurrentVisibleTab(now: now)
    }

    func refreshReviewProgressBadgeIfNeeded() async {
        await self.refreshReviewProgressBadgeIfNeeded(now: Date())
    }

    func refreshReviewLeaderboardBadgeIfNeeded() async {
        await self.refreshReviewLeaderboardBadgeIfNeeded(now: Date())
    }

    func refreshProgressIfNeeded() async {
        await self.refreshProgressIfNeeded(now: Date())
    }

    func refreshProgressManually() async {
        await self.refreshProgressManually(now: Date())
    }

    func refreshReviewProgressBadgeIfNeeded(now: Date) async {
        do {
            let scopeKey = try self.prepareProgressScope(now: now)
            try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
            guard self.shouldRefreshProgressSummary(scopeKey: summaryScopeKey) else {
                return
            }

            guard let activeSession = try await self.progressCloudSession(scopeKey: scopeKey) else {
                return
            }

            await self.refreshProgressSummaryServerBase(
                scopeKey: summaryScopeKey,
                linkedSession: activeSession
            )
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.replaceProgressErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    func refreshReviewLeaderboardBadgeIfNeeded(now: Date) async {
        do {
            let scopeKey = try self.prepareProgressScope(now: now)
            let leaderboardScopeKey = self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
            self.publishProgressLeaderboardSnapshotIsolatingErrors(
                scopeKey: leaderboardScopeKey,
                now: now
            )

            guard leaderboardScopeKey.cloudState == .linked else {
                return
            }

            guard self.shouldRefreshProgressLeaderboard(scopeKey: leaderboardScopeKey, now: now) else {
                return
            }

            guard let activeSession = try await self.progressCloudSession(scopeKey: scopeKey) else {
                return
            }

            await self.refreshProgressLeaderboardServerBase(
                scopeKey: leaderboardScopeKey,
                linkedSession: activeSession
            )
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.replaceProgressLeaderboardRefreshErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    func refreshProgressIfNeeded(now: Date) async {
        do {
            let scopeKey = try self.prepareProgressSnapshot(now: now)
            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
            let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
            let leaderboardScopeKey = self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)
            let shouldRefreshSummary = self.shouldRefreshProgressSummary(scopeKey: summaryScopeKey)
            let shouldRefreshSeries = self.shouldRefreshProgressSeries(scopeKey: scopeKey)
            let shouldRefreshReviewSchedule = self.shouldRefreshProgressReviewSchedule(scopeKey: scheduleScopeKey)
            let shouldRefreshLeaderboard = self.shouldRefreshProgressLeaderboard(
                scopeKey: leaderboardScopeKey,
                now: now
            )

            guard shouldRefreshSummary
                || shouldRefreshSeries
                || shouldRefreshReviewSchedule
                || shouldRefreshLeaderboard else {
                return
            }

            guard let activeSession = try await self.progressCloudSession(scopeKey: scopeKey) else {
                return
            }

            if shouldRefreshSummary || shouldRefreshSeries {
                if shouldRefreshSummary && shouldRefreshSeries {
                    async let refreshSummary: Void = self.refreshProgressSummaryServerBase(
                        scopeKey: summaryScopeKey,
                        linkedSession: activeSession
                    )
                    async let refreshSeries: Void = self.refreshProgressSeriesServerBase(
                        scopeKey: scopeKey,
                        linkedSession: activeSession
                    )
                    _ = await (refreshSummary, refreshSeries)
                } else if shouldRefreshSummary {
                    await self.refreshProgressSummaryServerBase(
                        scopeKey: summaryScopeKey,
                        linkedSession: activeSession
                    )
                } else if shouldRefreshSeries {
                    await self.refreshProgressSeriesServerBase(
                        scopeKey: scopeKey,
                        linkedSession: activeSession
                    )
                }
            }

            if shouldRefreshReviewSchedule && shouldRefreshLeaderboard {
                async let refreshReviewSchedule: Void = self.refreshProgressReviewScheduleServerBase(
                    scopeKey: scheduleScopeKey,
                    linkedSession: activeSession
                )
                async let refreshLeaderboard: Void = self.refreshProgressLeaderboardServerBase(
                    scopeKey: leaderboardScopeKey,
                    linkedSession: activeSession
                )
                _ = await (refreshReviewSchedule, refreshLeaderboard)
            } else if shouldRefreshReviewSchedule {
                await self.refreshProgressReviewScheduleServerBase(
                    scopeKey: scheduleScopeKey,
                    linkedSession: activeSession
                )
            } else if shouldRefreshLeaderboard {
                await self.refreshProgressLeaderboardServerBase(
                    scopeKey: leaderboardScopeKey,
                    linkedSession: activeSession
                )
            }

            if self.progressObservedScopeKey == scopeKey {
                try self.publishProgressSnapshot(scopeKey: scopeKey)
                self.publishReviewScheduleSnapshotIsolatingErrors(scopeKey: scheduleScopeKey)
            }
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.replaceProgressErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    func refreshProgressManually(now: Date) async {
        do {
            let scopeKey = try self.prepareProgressSnapshot(now: now)
            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
            let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
            let leaderboardScopeKey = self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey)

            self.invalidateProgress(scopeKey: scopeKey, summaryScopeKey: summaryScopeKey)
            guard let activeSession = try await self.progressCloudSession(scopeKey: scopeKey) else {
                return
            }

            async let refreshSummary: Void = self.refreshProgressSummaryServerBase(
                scopeKey: summaryScopeKey,
                linkedSession: activeSession
            )
            async let refreshSeries: Void = self.refreshProgressSeriesServerBase(
                scopeKey: scopeKey,
                linkedSession: activeSession
            )
            async let refreshReviewSchedule: Void = self.refreshProgressReviewScheduleServerBase(
                scopeKey: scheduleScopeKey,
                linkedSession: activeSession
            )
            async let refreshLeaderboard: Void = self.refreshProgressLeaderboardServerBaseIfLinked(
                scopeKey: leaderboardScopeKey,
                linkedSession: activeSession
            )
            _ = await (refreshSummary, refreshSeries, refreshReviewSchedule, refreshLeaderboard)
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.replaceProgressErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    /// Guests render the sign-in placeholder locally, so only linked accounts
    /// refetch the leaderboard on a manual refresh.
    private func refreshProgressLeaderboardServerBaseIfLinked(
        scopeKey: ProgressLeaderboardScopeKey,
        linkedSession: CloudLinkedSession
    ) async {
        guard scopeKey.cloudState == .linked else {
            return
        }

        await self.refreshProgressLeaderboardServerBase(
            scopeKey: scopeKey,
            linkedSession: linkedSession
        )
    }

    func handleProgressContextDidChange(now: Date) {
        self.prepareProgressForCurrentVisibleTabAndRefreshIfNeeded(now: now)
    }

    func handleProgressLocalMutation(
        now: Date,
        reviewedAtClient: String,
        rating: ReviewRating
    ) {
        do {
            let scopeKey = try self.prepareProgressScope(now: now)
            let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
            self.progressReviewedAtClientRevision += 1
            self.progressReviewScheduleLocalRevision += 1
            self.invalidateProgressSummaryAndSeries(
                scopeKey: scopeKey,
                summaryScopeKey: progressSummaryScopeKey(seriesScopeKey: scopeKey)
            )
            try self.markProgressReviewSchedulePendingLocalOverlay(scopeKey: scheduleScopeKey)
            try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
            self.publishReviewScheduleSnapshotIsolatingErrors(
                scopeKey: scheduleScopeKey
            )
            // Re-render the cached leaderboard so the viewer's live qualified
            // count reflects the just-submitted review immediately.
            self.publishProgressLeaderboardSnapshotIsolatingErrors(
                scopeKey: self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey),
                now: now
            )

            guard let progressSnapshot = self.progressSnapshot else {
                self.clearProgressErrorMessage()
                return
            }

            guard progressSnapshot.scopeKey == scopeKey else {
                try self.publishProgressSnapshot(scopeKey: scopeKey)
                self.clearProgressErrorMessage()
                return
            }

            let patchedSnapshot = try patchProgressSnapshot(
                snapshot: progressSnapshot,
                scopeKey: scopeKey,
                reviewedAtClient: reviewedAtClient,
                rating: rating
            )
            self.applyProgressSnapshot(snapshot: patchedSnapshot)
            self.clearProgressErrorMessage()
        } catch {
            self.replaceProgressErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    func handleReviewScheduleLocalCardStateDidChange(now: Date) {
        do {
            let scopeKey = try self.prepareProgressScope(now: now)
            let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
            self.progressReviewScheduleLocalRevision += 1
            try self.markProgressReviewSchedulePendingLocalOverlay(scopeKey: scheduleScopeKey)
            guard self.currentVisibleTab == .progress else {
                return
            }

            self.publishReviewScheduleSnapshotIsolatingErrors(scopeKey: scheduleScopeKey)
        } catch {
            self.replaceProgressErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    func handleProgressSyncCompletion(
        now: Date,
        syncResult: CloudSyncResult
    ) async {
        do {
            let isReviewVisible = self.currentVisibleTab == .review
            let scopeKey: ProgressScopeKey
            if isReviewVisible {
                scopeKey = try self.prepareProgressScope(now: now)
            } else {
                scopeKey = try self.prepareProgressSnapshot(now: now)
            }
            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
            let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)

            let reviewProgressDataChanged = syncResult.reviewProgressDataChanged
            let reviewScheduleDataChanged = syncResult.reviewScheduleDataChanged
            guard reviewProgressDataChanged || reviewScheduleDataChanged else {
                return
            }
            if reviewProgressDataChanged {
                self.progressReviewedAtClientRevision += 1
            }
            if reviewScheduleDataChanged {
                self.progressReviewScheduleLocalRevision += 1
            }

            if reviewProgressDataChanged {
                self.invalidateProgressSummaryAndSeries(scopeKey: scopeKey, summaryScopeKey: summaryScopeKey)
                if reviewScheduleDataChanged {
                    try self.markProgressReviewScheduleChangedAfterSync(
                        scopeKey: scheduleScopeKey,
                        syncResult: syncResult
                    )
                }
                if isReviewVisible {
                    try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
                } else if self.progressSummaryServerBaseCache == nil || self.progressSeriesServerBaseCache == nil {
                    try self.publishProgressSnapshot(scopeKey: scopeKey)
                }
            } else {
                try self.markProgressReviewScheduleChangedAfterSync(
                    scopeKey: scheduleScopeKey,
                    syncResult: syncResult
                )
            }

            if reviewScheduleDataChanged && isReviewVisible == false {
                self.publishReviewScheduleSnapshotIsolatingErrors(scopeKey: scheduleScopeKey)
            }
            if reviewProgressDataChanged && isReviewVisible == false {
                self.publishProgressLeaderboardSnapshotIsolatingErrors(
                    scopeKey: self.currentProgressLeaderboardScopeKey(seriesScopeKey: scopeKey),
                    now: now
                )
            }

            guard isProgressConsumerTab(tab: self.currentVisibleTab) else {
                return
            }

            guard self.activeProgressCloudSession(scopeKey: scopeKey) != nil else {
                return
            }

            await self.refreshVisibleProgressIfNeeded(now: now)
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.replaceProgressErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    private func markProgressReviewScheduleChangedAfterSync(
        scopeKey: ReviewScheduleScopeKey,
        syncResult: CloudSyncResult
    ) throws {
        let didAcknowledgeLocalScheduleChange = syncResult.acknowledgedReviewScheduleImpactingOperationCount > 0
            || syncResult.cleanedUpReviewScheduleImpactingOperationCount > 0
        let didPullScheduleChange = syncResult.reviewScheduleImpactingPullChangeCount > 0
        guard didAcknowledgeLocalScheduleChange || didPullScheduleChange else {
            return
        }

        try self.markProgressReviewSchedulePendingLocalOverlay(scopeKey: scopeKey)
    }

    func prepareProgressForCurrentVisibleTab(now: Date) {
        do {
            try self.prepareProgressForCurrentVisibleTabState(now: now)
        } catch {
            self.replaceProgressErrorMessage(message: Flashcards.errorMessage(error: error))
            self.applyProgressSnapshot(snapshot: nil)
        }
    }

    func prepareProgressForCurrentVisibleTabAndRefreshIfNeeded(now: Date) {
        do {
            try self.prepareProgressForCurrentVisibleTabState(now: now)
            guard isProgressConsumerTab(tab: self.currentVisibleTab) else {
                return
            }

            Task { @MainActor in
                await self.refreshVisibleProgressIfNeeded(now: now)
            }
        } catch {
            self.replaceProgressErrorMessage(message: Flashcards.errorMessage(error: error))
            self.applyProgressSnapshot(snapshot: nil)
        }
    }

    private func prepareProgressForCurrentVisibleTabState(now: Date) throws {
        if self.currentVisibleTab == .review {
            let scopeKey = try self.prepareProgressScope(now: now)
            try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
        } else {
            _ = try self.prepareProgressSnapshot(now: now)
        }
    }

    private func refreshVisibleProgressIfNeeded(now: Date) async {
        switch self.currentVisibleTab {
        case .review:
            async let refreshProgressBadge: Void = self.refreshReviewProgressBadgeIfNeeded(now: now)
            async let refreshLeaderboardBadge: Void = self.refreshReviewLeaderboardBadgeIfNeeded(now: now)
            _ = await (refreshProgressBadge, refreshLeaderboardBadge)
        case .progress:
            await self.refreshProgressIfNeeded(now: now)
        case .cards, .ai, .settings:
            return
        }
    }
}
