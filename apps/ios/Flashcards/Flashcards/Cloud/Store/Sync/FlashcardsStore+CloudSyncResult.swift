import Foundation

@MainActor
extension FlashcardsStore {
    /**
     Applies sync side effects through diff-aware bootstrap and review
     reconciliation so no-op syncs do not trigger a blocking review reload.
     */
    func applySyncResultWithoutBlockingReset(
        syncResult: CloudSyncResult,
        now: Date,
        trigger: CloudSyncTrigger
    ) async throws {
        let bootstrapRefreshOutcome = try await self.refreshBootstrapSnapshotWithoutReset(now: now)
        let didResetVolatileReviewSelection = self.resetVolatileReviewSelectionAfterLocalIdRepairIfNeeded(
            syncResult: syncResult,
            now: now
        )
        let shouldRefreshReviewState = didResetVolatileReviewSelection == false
            && (syncResult.reviewDataChanged || bootstrapRefreshOutcome.cardsChanged)
        let didRefreshReviewState: Bool
        if shouldRefreshReviewState {
            let reviewRefreshMode: ReviewRefreshMode
            if trigger.allowsVisibleChangeBanner || syncResult.appliedPullChanges {
                reviewRefreshMode = .backgroundReconcileWithVisibleChangeBanner
            } else {
                reviewRefreshMode = .backgroundReconcileSilently
            }
            didRefreshReviewState = try await self.refreshReviewState(
                now: now,
                mode: reviewRefreshMode
            )
            self.reconcileStrictReminders(trigger: .reviewHistoryImported, now: now)
        } else {
            didRefreshReviewState = didResetVolatileReviewSelection
            if didResetVolatileReviewSelection {
                self.reconcileStrictReminders(trigger: .reviewHistoryImported, now: now)
            }
        }
        if trigger.allowsVisibleChangeBanner {
            self.enqueueBackgroundSyncVisibleChangeBannerIfNeeded(
                bootstrapRefreshOutcome: bootstrapRefreshOutcome
            )
        }
        if bootstrapRefreshOutcome.didChange
            || didRefreshReviewState
            || syncResult.changedEntityTypes.contains(.mediaAsset) {
            self.localReadVersion += 1
        }
        if bootstrapRefreshOutcome.homeSnapshotChanged {
            self.requestGuestSignInAfterReviewPromptReconciliation()
        }
        await self.handleProgressSyncCompletion(
            now: now,
            syncResult: syncResult
        )
        self.lastSuccessfulCloudSyncAt = nowIsoTimestamp()
        self.syncStatus = .idle
        self.globalErrorMessage = ""
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
        if bootstrapRefreshOutcome.homeSnapshotChanged {
            self.requestGuestSignInAfterReviewPromptReconciliation()
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
        guard self.currentVisibleTab == .cards else {
            return
        }
        guard bootstrapRefreshOutcome.workspaceChanged
            || bootstrapRefreshOutcome.cardsChanged else {
            return
        }

        self.enqueueTransientBanner(banner: makeCardsUpdatedFromCloudBanner())
    }
}
