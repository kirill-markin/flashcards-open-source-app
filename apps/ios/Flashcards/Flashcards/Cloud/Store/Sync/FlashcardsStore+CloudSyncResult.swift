import Foundation

/**
 Whether the sync wrote anything Review reads: pulled or bootstrapped entities, pulled or imported review
 history, or a local id repair each record their entity type. Pushes and outbox cleanup record none, so a
 sync after a rating or an idle polling tick rebuilds nothing. See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
func syncAppliedRemoteChanges(result: CloudSyncResult) -> Bool {
    result.changedEntityTypes.isEmpty == false
}

@MainActor
extension FlashcardsStore {
    /// Called right after the sync returns, before anything that can throw, so a caller that fails or never
    /// applies the result still leaves the next applied sync to rebuild.
    func markUnrebuiltSyncWritesIfNeeded(syncResult: CloudSyncResult) {
        if syncAppliedRemoteChanges(result: syncResult) {
            self.hasUnrebuiltSyncWrites = true
        }
    }

    /// Pushed reviews still reach Progress through `handleProgressSyncCompletion` when nothing was rebuilt.
    func applySyncResultWithoutBlockingReset(
        syncResult: CloudSyncResult,
        now: Date,
        trigger: CloudSyncTrigger
    ) async throws {
        if self.hasUnrebuiltSyncWrites || syncAppliedRemoteChanges(result: syncResult) {
            try await self.rebuildReviewDataAfterSyncAppliedRemoteChanges(
                syncResult: syncResult,
                now: now,
                allowsVisibleChangeBanner: trigger.allowsVisibleChangeBanner
            )
        }
        await self.handleProgressSyncCompletion(
            now: now,
            syncResult: syncResult
        )
        self.lastSuccessfulCloudSyncAt = nowIsoTimestamp()
        self.syncStatus = .idle
        self.globalErrorMessage = ""
    }

    /**
     The `.syncAppliedRemoteChanges` rebuild. Unlike `rebuildReviewData(reason:now:)`'s background rebuilds it is
     awaited, so the sync fails with it and can report a shown card that left review on another device.
     It also shows what earlier syncs wrote without a rebuild, so the flag is cleared before reading and
     restored on failure.
     */
    private func rebuildReviewDataAfterSyncAppliedRemoteChanges(
        syncResult: CloudSyncResult,
        now: Date,
        allowsVisibleChangeBanner: Bool
    ) async throws {
        self.hasUnrebuiltSyncWrites = false
        do {
            try await self.rebuildReviewDataForSyncResult(
                syncResult: syncResult,
                now: now,
                allowsVisibleChangeBanner: allowsVisibleChangeBanner
            )
        } catch {
            self.hasUnrebuiltSyncWrites = true
            throw error
        }
    }

    private func rebuildReviewDataForSyncResult(
        syncResult: CloudSyncResult,
        now: Date,
        allowsVisibleChangeBanner: Bool
    ) async throws {
        self.addReviewDataRebuildBreadcrumb(reason: .syncAppliedRemoteChanges)
        let bootstrapRefreshOutcome = try await self.refreshBootstrapSnapshotWithoutReset(now: now)
        let didResetVolatileReviewSelection = self.resetVolatileReviewSelectionAfterLocalIdRepairIfNeeded(
            syncResult: syncResult,
            now: now
        )
        if didResetVolatileReviewSelection == false {
            let reviewRefreshMode: ReviewRefreshMode
            if allowsVisibleChangeBanner || syncResult.appliedPullChanges {
                reviewRefreshMode = .backgroundReconcileWithVisibleChangeBanner
            } else {
                reviewRefreshMode = .backgroundReconcileSilently
            }
            _ = try await self.refreshReviewState(
                now: now,
                mode: reviewRefreshMode
            )
        }
        self.reconcileStrictReminders(trigger: .reviewHistoryImported, now: now)
        if allowsVisibleChangeBanner {
            self.enqueueBackgroundSyncVisibleChangeBannerIfNeeded(
                bootstrapRefreshOutcome: bootstrapRefreshOutcome
            )
        }
        // Reached only when the database holds sync writes, so every local reader rereads.
        self.localReadVersion += 1
    }

    func failureErrorAfterApplyingLocalIdRepairSideEffectsIfNeeded(
        error: Error,
        now: Date
    ) async throws -> Error {
        guard let localIdRepairFailure = error as? CloudSyncLocalIdRepairFailure else {
            return error
        }

        try await self.applyLocalIdRepairSideEffectsAfterSyncFailure(
            syncResult: localIdRepairFailure.syncResult,
            now: now
        )
        return localIdRepairFailure.underlyingError
    }

    private func applyLocalIdRepairSideEffectsAfterSyncFailure(
        syncResult: CloudSyncResult,
        now: Date
    ) async throws {
        let bootstrapRefreshOutcome = try await self.refreshBootstrapSnapshotWithoutReset(now: now)
        let didResetVolatileReviewSelection = self.resetVolatileReviewSelectionAfterLocalIdRepairIfNeeded(
            syncResult: syncResult,
            now: now
        )
        if didResetVolatileReviewSelection {
            self.reconcileStrictReminders(trigger: .reviewHistoryImported, now: now)
        }
        if bootstrapRefreshOutcome.didChange || didResetVolatileReviewSelection {
            self.localReadVersion += 1
        }
    }

    /**
     Local re-id recovery can invalidate volatile review filters and selections
     that store entity ids. Reset broadly to All Cards instead of preserving
     individual filters with fragile per-entity repair logic.
     */
    private func resetVolatileReviewSelectionAfterLocalIdRepairIfNeeded(
        syncResult: CloudSyncResult,
        now: Date
    ) -> Bool {
        guard syncResult.localIdRepairEntityTypes.isEmpty == false else {
            return false
        }

        self.selectedReviewFilter = .allCards
        self.persistSelectedReviewFilter(reviewFilter: .allCards)
        self.startReviewLoad(reviewFilter: .allCards, now: now)
        self.reconcileReviewNotifications(trigger: .filterChanged, now: now)
        return true
    }

    private func enqueueBackgroundSyncVisibleChangeBannerIfNeeded(
        bootstrapRefreshOutcome: BootstrapSnapshotRefreshOutcome
    ) {
        guard self.currentVisibleTab == .library
            && self.currentLibraryAnalyticsSurface == .cards else {
            return
        }
        guard bootstrapRefreshOutcome.workspaceChanged
            || bootstrapRefreshOutcome.cardsChanged else {
            return
        }

        self.enqueueTransientBanner(banner: makeCardsUpdatedFromCloudBanner())
    }
}
