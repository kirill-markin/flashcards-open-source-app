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

            guard let activeSession = self.activeProgressCloudSession(scopeKey: scopeKey) else {
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

    func refreshProgressIfNeeded(now: Date) async {
        do {
            let scopeKey = try self.prepareProgressSnapshot(now: now)
            let summaryScopeKey = progressSummaryScopeKey(seriesScopeKey: scopeKey)
            let scheduleScopeKey = reviewScheduleScopeKey(seriesScopeKey: scopeKey)
            let shouldRefreshSummary = self.shouldRefreshProgressSummary(scopeKey: summaryScopeKey)
            let shouldRefreshSeries = self.shouldRefreshProgressSeries(scopeKey: scopeKey)
            let shouldRefreshReviewSchedule = self.shouldRefreshProgressReviewSchedule(scopeKey: scheduleScopeKey)

            guard shouldRefreshSummary || shouldRefreshSeries || shouldRefreshReviewSchedule else {
                return
            }

            guard let activeSession = self.activeProgressCloudSession(scopeKey: scopeKey) else {
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

            if shouldRefreshReviewSchedule {
                await self.refreshProgressReviewScheduleServerBase(
                    scopeKey: scheduleScopeKey,
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

            self.invalidateProgress(scopeKey: scopeKey, summaryScopeKey: summaryScopeKey)
            guard let activeSession = self.activeProgressCloudSession(scopeKey: scopeKey) else {
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
            _ = await (refreshSummary, refreshSeries, refreshReviewSchedule)
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }

            self.replaceProgressErrorMessage(message: Flashcards.errorMessage(error: error))
        }
    }

    func handleProgressContextDidChange(now: Date) {
        self.prepareProgressForCurrentVisibleTabAndRefreshIfNeeded(now: now)
    }

    func handleProgressLocalMutation(
        now: Date,
        reviewedAtClient: String
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
            self.markProgressReviewSchedulePendingLocalOverlay(scopeKey: scheduleScopeKey)
            try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
            self.publishReviewScheduleSnapshotIsolatingErrors(
                scopeKey: scheduleScopeKey
            )

            guard let progressSnapshot = self.progressSnapshot else {
                self.clearProgressErrorMessage()
                return
            }

            let patchedSnapshot = try patchProgressSnapshot(
                snapshot: progressSnapshot,
                scopeKey: scopeKey,
                reviewedAtClient: reviewedAtClient
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
            self.markProgressReviewSchedulePendingLocalOverlay(scopeKey: scheduleScopeKey)
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

            let reviewScheduleDataChanged = syncResult.reviewScheduleDataChanged
            guard syncResult.reviewProgressDataChanged || reviewScheduleDataChanged else {
                return
            }
            if syncResult.reviewProgressDataChanged {
                self.progressReviewedAtClientRevision += 1
            }
            if reviewScheduleDataChanged {
                self.progressReviewScheduleLocalRevision += 1
            }

            if syncResult.reviewProgressDataChanged {
                self.invalidateProgressSummaryAndSeries(scopeKey: scopeKey, summaryScopeKey: summaryScopeKey)
                if reviewScheduleDataChanged {
                    self.invalidateProgressReviewSchedule(scopeKey: scheduleScopeKey)
                }
                if isReviewVisible {
                    try self.publishReviewProgressBadgeState(scopeKey: scopeKey)
                } else if self.progressSummaryServerBaseCache == nil || self.progressSeriesServerBaseCache == nil {
                    try self.publishProgressSnapshot(scopeKey: scopeKey)
                }
            } else {
                self.invalidateProgressReviewSchedule(scopeKey: scheduleScopeKey)
            }

            if reviewScheduleDataChanged && isReviewVisible == false {
                self.publishReviewScheduleSnapshotIsolatingErrors(scopeKey: scheduleScopeKey)
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
            await self.refreshReviewProgressBadgeIfNeeded(now: now)
        case .progress:
            await self.refreshProgressIfNeeded(now: now)
        case .cards, .ai, .settings:
            return
        }
    }
}
