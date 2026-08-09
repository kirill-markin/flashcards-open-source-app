import Foundation

private enum PersistedCloudStateReconciliationOutcome {
    case continueSync(hasStoredCredentials: Bool, hasStoredGuestSession: Bool)
    case stopSync
}

private let blockedCloudIdentityConflictCodes: Set<String> = [
    "GUEST_SESSION_PLATFORM_MISMATCH",
    "SYNC_INSTALLATION_PLATFORM_MISMATCH",
    "SYNC_REPLICA_CONFLICT",
    "SYNC_WORKSPACE_FORK_REQUIRED"
]

@MainActor
extension FlashcardsStore {
    func manualCloudSyncTrigger(now: Date) -> CloudSyncTrigger {
        CloudSyncTrigger(
            source: .manualSyncNow,
            now: now,
            extendsFastPolling: false,
            allowsVisibleChangeBanner: false,
            surfacesGlobalErrorMessage: true,
            technicalErrorCaptureContext: nil
        )
    }

    func technicalErrorModalCloudSyncTrigger(now: Date) -> CloudSyncTrigger {
        CloudSyncTrigger(
            source: .manualSyncNow,
            now: now,
            extendsFastPolling: false,
            allowsVisibleChangeBanner: false,
            surfacesGlobalErrorMessage: false,
            capturesTechnicalFailures: true,
            technicalErrorCaptureContext: self.beginTechnicalErrorCaptureContext()
        )
    }

    func postAuthCloudSyncTrigger(now: Date) -> CloudSyncTrigger {
        self.postAuthCloudSyncTrigger(
            now: now,
            technicalErrorCaptureContext: nil
        )
    }

    func postAuthCloudSyncTrigger(
        now: Date,
        technicalErrorCaptureContext: TechnicalErrorCaptureContext?
    ) -> CloudSyncTrigger {
        CloudSyncTrigger(
            source: .postAuth,
            now: now,
            extendsFastPolling: false,
            allowsVisibleChangeBanner: false,
            surfacesGlobalErrorMessage: false,
            technicalErrorCaptureContext: technicalErrorCaptureContext
        )
    }

    func updateCurrentVisibleTab(tab: AppTab) {
        self.currentVisibleTab = tab
    }

    private func addCloudSyncForegroundOperationBreadcrumb(
        stage: String,
        phase: ForegroundOperationPhase,
        trigger: CloudSyncTrigger,
        startedAt: Date?,
        immediateStartSkipped: Bool?,
        skipReason: String?,
        syncResult: CloudSyncResult?,
        error: Error?
    ) {
        let durationMilliseconds = startedAt.map { startDate in
            iosObservationDurationMilliseconds(startedAt: startDate, finishedAt: Date())
        }
        let scope = IOSObservationScope(
            feature: .cloudSync,
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
                    action: .cloudSync,
                    phase: phase,
                    durationMilliseconds: durationMilliseconds,
                    operationStage: stage,
                    operationTrigger: trigger.source.diagnosticValue,
                    selectedTab: nil,
                    scenePhase: nil,
                    isStartupReady: nil,
                    isRecoveryGateActive: nil,
                    cardCount: self.cards.count,
                    deckCount: self.decks.count,
                    pendingOutboxOperationCount: nil,
                    reviewQueueCount: nil,
                    reviewDueCount: nil,
                    reviewNewCount: nil,
                    reviewPendingCount: nil,
                    reviewTotalCount: nil,
                    reviewFilterKind: nil,
                    reviewRefreshMode: nil,
                    reviewLoadKind: nil,
                    progressSummaryRefreshNeeded: nil,
                    progressSeriesRefreshNeeded: nil,
                    progressReviewScheduleRefreshNeeded: nil,
                    progressLeaderboardRefreshNeeded: nil,
                    progressStreakLeaderboardRefreshNeeded: nil,
                    cloudSyncBlocked: self.isCloudSyncBlocked,
                    cloudSyncExtendsFastPolling: trigger.extendsFastPolling,
                    cloudSyncUsesImmediateStartDebounce: trigger.source.usesImmediateStartDebounce,
                    cloudSyncImmediateStartSkipped: immediateStartSkipped,
                    cloudSyncSkipReason: skipReason,
                    cloudSyncHadActiveTask: nil,
                    cloudSyncPendingResync: nil,
                    cloudSyncWaitOutcome: nil,
                    cloudSyncAcknowledgedOperationCount: syncResult?.acknowledgedOperationCount,
                    cloudSyncAppliedPullChangeCount: syncResult?.appliedPullChangeCount,
                    cloudSyncChangedEntityTypeCount: syncResult?.changedEntityTypes.count,
                    cloudSyncLocalIdRepairEntityTypeCount: syncResult?.localIdRepairEntityTypes.count,
                    cloudSyncReviewScheduleImpactingPullChangeCount: syncResult?.reviewScheduleImpactingPullChangeCount,
                    cloudSyncAcknowledgedReviewEventOperationCount: syncResult?.acknowledgedReviewEventOperationCount,
                    cloudSyncAcknowledgedReviewScheduleImpactingOperationCount: syncResult?.acknowledgedReviewScheduleImpactingOperationCount,
                    cloudSyncCleanedUpOperationCount: syncResult?.cleanedUpOperationCount,
                    cloudSyncCleanedUpReviewScheduleImpactingOperationCount: syncResult?.cleanedUpReviewScheduleImpactingOperationCount,
                    cloudSyncCleanedUpReviewEventOperationCount: syncResult?.cleanedUpReviewEventOperationCount,
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
                    errorSummary: error.map { operationError in Flashcards.errorMessage(error: operationError) }
                )
            )
        )
    }

    func syncCloudNow(trigger: CloudSyncTrigger) async throws {
        let startedAt = Date()
        self.addCloudSyncForegroundOperationBreadcrumb(
            stage: "sync_now",
            phase: .start,
            trigger: trigger,
            startedAt: nil,
            immediateStartSkipped: nil,
            skipReason: nil,
            syncResult: nil,
            error: nil
        )
        do {
        try self.throwIfCredentialRecoveryBlocksPendingGuestUpgrade()
        if try await self.resumePendingGuestUpgradeIfNeeded(trigger: trigger) {
            self.addCloudSyncForegroundOperationBreadcrumb(
                stage: "sync_now",
                phase: .success,
                trigger: trigger,
                startedAt: startedAt,
                immediateStartSkipped: nil,
                skipReason: "guest_upgrade_resumed",
                syncResult: nil,
                error: nil
            )
            return
        }
        try self.throwIfCloudCredentialRecoveryRequired()
        if try self.markCloudCredentialRecoveryForMissingPersistedCredentialsIfNeeded(detectedAt: trigger.now) {
            try self.throwIfCloudCredentialRecoveryRequired()
        }
        if try await self.cloudRuntime.waitForActiveCloudCompletionIfNeeded() {
            self.addCloudSyncForegroundOperationBreadcrumb(
                stage: "sync_now",
                phase: .success,
                trigger: trigger,
                startedAt: startedAt,
                immediateStartSkipped: nil,
                skipReason: "active_cloud_completion_waited",
                syncResult: nil,
                error: nil
            )
            return
        }
        if case .blocked(let message) = self.syncStatus {
            throw LocalStoreError.validation(message)
        }
        if self.cloudRuntime.activeCloudSession() == nil {
            if self.cloudSettings?.cloudState == .guest {
                let restoredGuestSession = try await self.restoreGuestCloudSessionIfNeeded(trigger: trigger)
                if restoredGuestSession.didRunSync {
                    self.addCloudSyncForegroundOperationBreadcrumb(
                        stage: "sync_now",
                        phase: .success,
                        trigger: trigger,
                        startedAt: startedAt,
                        immediateStartSkipped: nil,
                        skipReason: "guest_session_restore_ran_sync",
                        syncResult: nil,
                        error: nil
                    )
                    return
                }
            } else {
                try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
                self.addCloudSyncForegroundOperationBreadcrumb(
                    stage: "sync_now",
                    phase: .success,
                    trigger: trigger,
                    startedAt: startedAt,
                    immediateStartSkipped: nil,
                    skipReason: "cloud_link_restored",
                    syncResult: nil,
                    error: nil
                )
                return
            }
        }

        guard let activeSession = self.cloudRuntime.activeCloudSession() else {
            throw LocalStoreError.uninitialized("Cloud session is unavailable")
        }

        let isGuestSession = activeSession.authorization.isGuest
        let failureStateCloudState = self.cloudSettings?.cloudState

        self.syncStatus = .syncing
        do {
            let syncResult: CloudSyncResult
            if isGuestSession {
                syncResult = try await self.runLinkedSync(linkedSession: activeSession)
            } else {
                syncResult = try await self.withAuthenticatedCloudSession { session in
                    try await self.runLinkedSync(linkedSession: session)
                }
            }
            try self.throwIfCloudCredentialRecoveryRequired()
            let now = Date()
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: now,
                trigger: trigger
            )
            await self.processMediaUploadTransfersAfterCloudSync(linkedSession: activeSession)
            self.addCloudSyncForegroundOperationBreadcrumb(
                stage: "sync_now",
                phase: .success,
                trigger: trigger,
                startedAt: startedAt,
                immediateStartSkipped: nil,
                skipReason: nil,
                syncResult: syncResult,
                error: nil
            )
        } catch {
            if isRequestCancellationError(error: error) {
                self.syncStatus = .idle
                throw error
            }
            try self.throwIfCloudCredentialRecoveryRequired()
            let failureError: Error
            do {
                failureError = try self.failureErrorAfterApplyingLocalIdRepairSideEffectsIfNeeded(
                    error: error,
                    now: Date()
                )
            } catch {
                self.syncStatus = self.syncStatusForCloudFailure(
                    error: error,
                    fallbackCloudState: failureStateCloudState,
                    trigger: trigger
                )
                let didCapture = self.captureCloudSyncFailureIfNeeded(
                    error: error,
                    linkedSession: activeSession,
                    fallbackCloudState: failureStateCloudState,
                    trigger: trigger,
                    action: "sync_cloud_now"
                )
                if trigger.surfacesGlobalErrorMessage {
                    self.globalErrorMessage = Flashcards.errorMessage(error: error)
                }
                throw didCapture ? markTechnicalErrorObserved(error: error) : error
            }
            self.syncStatus = self.syncStatusForCloudFailure(
                error: failureError,
                fallbackCloudState: failureStateCloudState,
                trigger: trigger
            )
            let didCapture = self.captureCloudSyncFailureIfNeeded(
                error: failureError,
                linkedSession: activeSession,
                fallbackCloudState: failureStateCloudState,
                trigger: trigger,
                action: "sync_cloud_now"
            )
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: failureError)
            }
            throw didCapture ? markTechnicalErrorObserved(error: failureError) : failureError
        }
        } catch {
            self.addCloudSyncForegroundOperationBreadcrumb(
                stage: "sync_now",
                phase: .failure,
                trigger: trigger,
                startedAt: startedAt,
                immediateStartSkipped: nil,
                skipReason: nil,
                syncResult: nil,
                error: error
            )
            throw error
        }
    }

    func syncCloudIfLinked(trigger: CloudSyncTrigger) async {
        let startedAt = Date()
        self.addCloudSyncForegroundOperationBreadcrumb(
            stage: "sync_if_linked",
            phase: .start,
            trigger: trigger,
            startedAt: nil,
            immediateStartSkipped: nil,
            skipReason: nil,
            syncResult: nil,
            error: nil
        )
        if self.userDefaults.bool(forKey: accountDeletionPendingUserDefaultsKey) {
            await self.resumePendingAccountDeletionIfNeeded()
            self.addCloudSyncForegroundOperationBreadcrumb(
                stage: "sync_if_linked",
                phase: .success,
                trigger: trigger,
                startedAt: startedAt,
                immediateStartSkipped: nil,
                skipReason: "account_deletion_pending",
                syncResult: nil,
                error: nil
            )
            return
        }

        do {
            try self.throwIfCredentialRecoveryBlocksPendingGuestUpgrade()
            if try await self.resumePendingGuestUpgradeIfNeeded(trigger: trigger) {
                self.addCloudSyncForegroundOperationBreadcrumb(
                    stage: "sync_if_linked",
                    phase: .success,
                    trigger: trigger,
                    startedAt: startedAt,
                    immediateStartSkipped: nil,
                    skipReason: "guest_upgrade_resumed",
                    syncResult: nil,
                    error: nil
                )
                return
            }
            if self.blockCloudSyncForCredentialRecoveryIfNeeded() {
                self.addCloudSyncForegroundOperationBreadcrumb(
                    stage: "sync_if_linked",
                    phase: .success,
                    trigger: trigger,
                    startedAt: startedAt,
                    immediateStartSkipped: nil,
                    skipReason: "credential_recovery_block",
                    syncResult: nil,
                    error: nil
                )
                return
            }
            if self.isCloudSyncBlocked {
                self.addCloudSyncForegroundOperationBreadcrumb(
                    stage: "sync_if_linked",
                    phase: .success,
                    trigger: trigger,
                    startedAt: startedAt,
                    immediateStartSkipped: nil,
                    skipReason: "sync_blocked",
                    syncResult: nil,
                    error: nil
                )
                return
            }

            let reconciliationOutcome = try await self.reconcilePersistedCloudStateBeforeSync(trigger: trigger)
            let hasStoredCredentials: Bool
            let hasStoredGuestSession: Bool
            switch reconciliationOutcome {
            case .continueSync(let resolvedHasStoredCredentials, let resolvedHasStoredGuestSession):
                hasStoredCredentials = resolvedHasStoredCredentials
                hasStoredGuestSession = resolvedHasStoredGuestSession
            case .stopSync:
                self.addCloudSyncForegroundOperationBreadcrumb(
                    stage: "sync_if_linked",
                    phase: .success,
                    trigger: trigger,
                    startedAt: startedAt,
                    immediateStartSkipped: nil,
                    skipReason: "persisted_cloud_state_reconciled",
                    syncResult: nil,
                    error: nil
                )
                return
            }

            if try await self.cloudRuntime.waitForActiveCloudCompletionIfNeeded() {
                self.addCloudSyncForegroundOperationBreadcrumb(
                    stage: "sync_if_linked",
                    phase: .success,
                    trigger: trigger,
                    startedAt: startedAt,
                    immediateStartSkipped: nil,
                    skipReason: "active_cloud_completion_waited",
                    syncResult: nil,
                    error: nil
                )
                return
            }

            if self.cloudRuntime.activeCloudSession() == nil
                && hasStoredCredentials == false
                && hasStoredGuestSession == false {
                if self.cloudSettings?.cloudState == .linked {
                    try self.logoutCloudAccount()
                }

                self.addCloudSyncForegroundOperationBreadcrumb(
                    stage: "sync_if_linked",
                    phase: .success,
                    trigger: trigger,
                    startedAt: startedAt,
                    immediateStartSkipped: nil,
                    skipReason: "no_stored_cloud_session",
                    syncResult: nil,
                    error: nil
                )
                return
            }

            try await self.syncCloudNow(trigger: trigger)
            self.addCloudSyncForegroundOperationBreadcrumb(
                stage: "sync_if_linked",
                phase: .success,
                trigger: trigger,
                startedAt: startedAt,
                immediateStartSkipped: nil,
                skipReason: nil,
                syncResult: nil,
                error: nil
            )
        } catch {
            if isRequestCancellationError(error: error) {
                self.addCloudSyncForegroundOperationBreadcrumb(
                    stage: "sync_if_linked",
                    phase: .success,
                    trigger: trigger,
                    startedAt: startedAt,
                    immediateStartSkipped: nil,
                    skipReason: "cancelled",
                    syncResult: nil,
                    error: nil
                )
                return
            }
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                self.addCloudSyncForegroundOperationBreadcrumb(
                    stage: "sync_if_linked",
                    phase: .success,
                    trigger: trigger,
                    startedAt: startedAt,
                    immediateStartSkipped: nil,
                    skipReason: "remote_account_deleted",
                    syncResult: nil,
                    error: nil
                )
                return
            }

            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            self.addCloudSyncForegroundOperationBreadcrumb(
                stage: "sync_if_linked",
                phase: .failure,
                trigger: trigger,
                startedAt: startedAt,
                immediateStartSkipped: nil,
                skipReason: nil,
                syncResult: nil,
                error: error
            )
        }
    }

    private func reconcilePersistedCloudStateBeforeSync(
        trigger: CloudSyncTrigger
    ) async throws -> PersistedCloudStateReconciliationOutcome {
        let hasStoredCredentials = try self.cloudRuntime.loadCredentials() != nil
        let hasStoredGuestSession = try self.loadUsableGuestSessionForCurrentConfiguration() != nil
        guard let cloudSettings = self.cloudSettings else {
            return .continueSync(
                hasStoredCredentials: hasStoredCredentials,
                hasStoredGuestSession: hasStoredGuestSession
            )
        }

        switch cloudSettings.cloudState {
        case .linked:
            if hasStoredCredentials {
                return .continueSync(
                    hasStoredCredentials: hasStoredCredentials,
                    hasStoredGuestSession: hasStoredGuestSession
                )
            }

            let configuration = try self.currentCloudServiceConfiguration()
            try self.markCloudCredentialRecoveryRequired(
                reason: .linkedCredentialsMissing,
                cloudSettings: cloudSettings,
                configuration: configuration,
                detectedAt: trigger.now
            )
            return .stopSync
        case .guest:
            if hasStoredGuestSession {
                return .continueSync(
                    hasStoredCredentials: hasStoredCredentials,
                    hasStoredGuestSession: hasStoredGuestSession
                )
            }

            let configuration = try self.currentCloudServiceConfiguration()
            try self.markCloudCredentialRecoveryRequired(
                reason: .guestSessionMissing,
                cloudSettings: cloudSettings,
                configuration: configuration,
                detectedAt: trigger.now
            )
            return .stopSync
        case .disconnected, .linkingReady:
            if hasStoredGuestSession && hasStoredCredentials == false {
                _ = try await self.restoreGuestCloudSessionIfNeeded(trigger: trigger)
                self.globalErrorMessage = ""
                return .stopSync
            }

            if hasStoredCredentials && hasStoredGuestSession == false {
                let configuration = try self.currentCloudServiceConfiguration()
                if try self.isAuthenticatedSilentRestoreEligible(
                    configuration: configuration,
                    hasStoredCredentials: hasStoredCredentials,
                    hasStoredGuestSession: hasStoredGuestSession
                ) {
                    do {
                        try await self.restoreAuthenticatedCloudSessionAfterReinstall(trigger: trigger)
                        self.globalErrorMessage = ""
                        return .stopSync
                    } catch {
                        if self.shouldResetLocalStateAfterAuthenticatedSilentRestoreFailure(error: error) {
                            try self.resetLocalStateForCloudIdentityChange()
                            self.globalErrorMessage = ""
                            return .stopSync
                        }

                        throw error
                    }
                }

                try self.cloudRuntime.clearCredentials()
                self.globalErrorMessage = ""
                return .stopSync
            }

            if hasStoredCredentials && hasStoredGuestSession {
                try self.cloudRuntime.clearCredentials()
                try self.dependencies.guestCredentialStore.clearGuestSession()
                self.globalErrorMessage = ""
                return .stopSync
            }

            return .continueSync(
                hasStoredCredentials: hasStoredCredentials,
                hasStoredGuestSession: hasStoredGuestSession
            )
        }
    }

    /**
     Applies sync side effects through diff-aware bootstrap and review
     reconciliation so no-op syncs do not trigger a blocking review reload.
     */
    func applySyncResultWithoutBlockingReset(
        syncResult: CloudSyncResult,
        now: Date,
        trigger: CloudSyncTrigger
    ) async throws {
        let bootstrapRefreshOutcome = try self.refreshBootstrapSnapshotWithoutReset(now: now)
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

    private func failureErrorAfterApplyingLocalIdRepairSideEffectsIfNeeded(
        error: Error,
        now: Date
    ) throws -> Error {
        guard let localIdRepairFailure = error as? CloudSyncLocalIdRepairFailure else {
            return error
        }

        try self.applyLocalIdRepairSideEffectsAfterSyncFailure(
            syncResult: localIdRepairFailure.syncResult,
            now: now
        )
        return localIdRepairFailure.underlyingError
    }

    private func applyLocalIdRepairSideEffectsAfterSyncFailure(
        syncResult: CloudSyncResult,
        now: Date
    ) throws {
        let bootstrapRefreshOutcome = try self.refreshBootstrapSnapshotWithoutReset(now: now)
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

    func isCloudAuthorizationError(_ error: Error) -> Bool {
        self.cloudRuntime.isCloudAuthorizationError(error)
    }

    var isCloudSyncBlocked: Bool {
        if self.isCloudCredentialRecoveryRequired {
            return true
        }
        if case .blocked = self.syncStatus {
            return true
        }
        return false
    }

    func isCloudAccountDeletedError(_ error: Error) -> Bool {
        self.cloudRuntime.isCloudAccountDeletedError(error)
    }

    private func syncStatusForCloudFailure(
        error: Error,
        fallbackCloudState: CloudAccountState?,
        trigger: CloudSyncTrigger
    ) -> SyncStatus {
        if let recoveryState = self.cloudCredentialRecoveryState {
            return .blocked(message: localizedCloudCredentialRecoveryBlockedMessage(reason: recoveryState.reason))
        }
        if trigger.source == .postAuth {
            return .idle
        }

        if let blockedMessage = self.blockedCloudIdentityConflictMessage(error: error) {
            return .blocked(message: blockedMessage)
        }

        if fallbackCloudState == .linked || fallbackCloudState == .guest {
            return .failed(message: Flashcards.errorMessage(error: error))
        }

        return .idle
    }

    func transitionSyncStatusForCloudFailure(error: Error) -> SyncStatus {
        if let recoveryState = self.cloudCredentialRecoveryState {
            return .blocked(message: localizedCloudCredentialRecoveryBlockedMessage(reason: recoveryState.reason))
        }
        if let blockedMessage = self.blockedCloudIdentityConflictMessage(error: error) {
            return .blocked(message: blockedMessage)
        }

        return .failed(message: Flashcards.errorMessage(error: error))
    }

    func transitionSyncStatusForCloudFailure(error: Error, trigger: CloudSyncTrigger) -> SyncStatus {
        if let recoveryState = self.cloudCredentialRecoveryState {
            return .blocked(message: localizedCloudCredentialRecoveryBlockedMessage(reason: recoveryState.reason))
        }
        if trigger.source == .postAuth {
            return .idle
        }

        if let blockedMessage = self.blockedCloudIdentityConflictMessage(error: error) {
            return .blocked(message: blockedMessage)
        }

        return .failed(message: Flashcards.errorMessage(error: error))
    }

    func blockedCloudIdentityConflictMessage(error: Error) -> String? {
        guard let syncError = error as? CloudSyncError else {
            return nil
        }
        guard case .invalidResponse(let details, _) = syncError else {
            return nil
        }
        guard blockedCloudIdentityConflictCodes.contains(details.code ?? "") else {
            return nil
        }
        return Flashcards.errorMessage(error: error)
    }

    func captureCloudSyncFailure(
        error: Error,
        linkedSession: CloudLinkedSession,
        fallbackCloudState: CloudAccountState?,
        action: String,
        captureContext: TechnicalErrorCaptureContext?
    ) {
        let diagnostics = cloudSyncFailureDiagnostics(error: error)
        let scope = IOSObservationScope(
            feature: .cloudSync,
            userId: linkedSession.userId,
            workspaceId: linkedSession.workspaceId,
            requestId: diagnostics.requestId,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: fallbackCloudState ?? self.cloudSettings?.cloudState,
            configurationMode: linkedSession.configurationMode
        )
        self.markTechnicalErrorCaptured(captureContext: captureContext)
        FlashcardsObservability.captureException(
            .cloudSyncFailed(
                error: error,
                scope: scope,
                details: CloudSyncFailureDetails(
                    action: action,
                    statusCode: diagnostics.statusCode,
                    backendCode: diagnostics.backendCode,
                    requestId: diagnostics.requestId,
                    messageSummary: Flashcards.errorMessage(error: error)
                )
            )
        )
    }

    @discardableResult
    func captureCloudSyncFailureIfNeeded(
        error: Error,
        linkedSession: CloudLinkedSession,
        fallbackCloudState: CloudAccountState?,
        trigger: CloudSyncTrigger,
        action: String
    ) -> Bool {
        if self.cloudCredentialRecoveryState?.reason == .linkedWorkspaceUnavailable,
            let localStoreError = error as? LocalStoreError,
            case .validation(let message) = localStoreError,
            message == localizedCloudCredentialRecoveryBlockedMessage(reason: .linkedWorkspaceUnavailable) {
            return false
        }
        if isLinkedWorkspaceUnavailableCloudSyncResponse(
            error: error,
            linkedSession: linkedSession,
            cloudSettings: self.cloudSettings
        ) {
            return false
        }
        guard self.shouldCaptureCloudSyncFailure(error: error, trigger: trigger) else {
            return false
        }

        self.captureCloudSyncFailure(
            error: error,
            linkedSession: linkedSession,
            fallbackCloudState: fallbackCloudState,
            action: action,
            captureContext: trigger.technicalErrorCaptureContext
        )
        return true
    }

    private func shouldCaptureCloudSyncFailure(error: Error, trigger: CloudSyncTrigger) -> Bool {
        if isRequestCancellationError(error: error) {
            return false
        }
        if self.blockedCloudIdentityConflictMessage(error: error) != nil {
            return false
        }
        if isRetryableNetworkTransportFailure(error: error) {
            return false
        }
        if trigger.capturesTechnicalFailures {
            return true
        }

        return self.isCloudAccountDeletedError(error)
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        try self.enforceCloudCredentialRecoveryGateOutsideIdentityResolution(detectedAt: Date())
        do {
            if try self.shouldRunGuestLocalRecoveryLinkedSync(linkedSession: linkedSession) {
                return try await self.cloudRuntime.runGuestLocalRecoveryLinkedSync(linkedSession: linkedSession)
            }

            return try await self.cloudRuntime.runLinkedSync(linkedSession: linkedSession)
        } catch {
            let failureError = try self.failureErrorAfterApplyingLocalIdRepairSideEffectsIfNeeded(
                error: error,
                now: Date()
            )
            if try await self.enterLinkedWorkspaceUnavailableRecoveryIfNeeded(
                error: failureError,
                linkedSession: linkedSession,
                detectedAt: Date()
            ) {
                try self.throwIfCloudCredentialRecoveryRequired()
            }
            throw failureError
        }
    }

    private func shouldRunGuestLocalRecoveryLinkedSync(linkedSession: CloudLinkedSession) throws -> Bool {
        guard let recoveryState = self.cloudCredentialRecoveryState,
            recoveryState.reason == .guestSessionMissing else {
            return false
        }

        try self.validateGuestLocalRecoveryState(
            recoveryState: recoveryState,
            apiBaseUrl: linkedSession.apiBaseUrl
        )
        return linkedSession.authorization.isGuest == false
    }

    func runFreshLinkedSyncAfterActiveSyncSettles(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        try self.enforceCloudCredentialRecoveryGateOutsideIdentityResolution(detectedAt: Date())
        do {
            if try self.shouldRunGuestLocalRecoveryLinkedSync(linkedSession: linkedSession) {
                return try await self.cloudRuntime.runFreshGuestLocalRecoveryLinkedSyncAfterActiveSyncSettles(
                    linkedSession: linkedSession
                )
            }

            return try await self.cloudRuntime.runFreshLinkedSyncAfterActiveSyncSettles(linkedSession: linkedSession)
        } catch {
            let failureError = try self.failureErrorAfterApplyingLocalIdRepairSideEffectsIfNeeded(
                error: error,
                now: Date()
            )
            if try await self.enterLinkedWorkspaceUnavailableRecoveryIfNeeded(
                error: failureError,
                linkedSession: linkedSession,
                detectedAt: Date()
            ) {
                try self.throwIfCloudCredentialRecoveryRequired()
            }
            throw failureError
        }
    }

    func triggerCloudSyncIfLinked(trigger: CloudSyncTrigger) {
        if trigger.extendsFastPolling {
            self.extendCloudSyncFastPolling(now: trigger.now)
        }
        let immediateStartSkipped = self.shouldSkipImmediateCloudSyncStart(trigger: trigger)
        self.addCloudSyncForegroundOperationBreadcrumb(
            stage: "trigger_received",
            phase: .start,
            trigger: trigger,
            startedAt: nil,
            immediateStartSkipped: immediateStartSkipped,
            skipReason: immediateStartSkipped ? "immediate_start_debounce" : nil,
            syncResult: nil,
            error: nil
        )
        if immediateStartSkipped {
            return
        }
        Task { @MainActor in
            await self.syncCloudIfLinked(trigger: trigger)
        }
    }

    private func shouldSkipImmediateCloudSyncStart(trigger: CloudSyncTrigger) -> Bool {
        guard trigger.source.usesImmediateStartDebounce else {
            return false
        }
        if let lastImmediateCloudSyncTriggerAt,
           trigger.now.timeIntervalSince(lastImmediateCloudSyncTriggerAt) < cloudImmediateSyncDebounceIntervalSeconds {
            return true
        }

        self.lastImmediateCloudSyncTriggerAt = trigger.now
        return false
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

    private func processMediaUploadTransfersAfterCloudSync(linkedSession: CloudLinkedSession) async {
        guard let database = self.database,
              let cloudSyncService = self.dependencies.cloudSyncService,
              self.workspace?.workspaceId == linkedSession.workspaceId else {
            return
        }

        do {
            try await self.withCloudSessionPreservingStableContext(linkedSession: linkedSession) { refreshedSession in
                try await MediaUploadTransferRunner(
                    database: database,
                    cloudSyncService: cloudSyncService
                ).processDueUploads(linkedSession: refreshedSession, now: Date())
            }
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }
            self.captureMediaUploadTransferProcessingFailure(error: error, linkedSession: linkedSession)
        }
    }

    private func captureMediaUploadTransferProcessingFailure(error: Error, linkedSession: CloudLinkedSession) {
        if isRetryableNetworkTransportFailure(error: error) {
            return
        }

        let diagnostics = cloudSyncFailureDiagnostics(error: error)
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: IOSObservationScope(
                feature: .cloudSync,
                userId: linkedSession.userId,
                workspaceId: linkedSession.workspaceId,
                requestId: diagnostics.requestId,
                clientRequestId: nil,
                sessionId: nil,
                runId: nil,
                cloudState: self.cloudSettings?.cloudState,
                configurationMode: linkedSession.configurationMode
            ),
            action: "media_upload_transfer_process",
            stage: "after_cloud_sync",
            statusCode: diagnostics.statusCode,
            backendCode: diagnostics.backendCode,
            requestId: diagnostics.requestId
        )
    }
}

private struct CloudFailureDiagnostics {
    let statusCode: Int?
    let backendCode: String?
    let requestId: String?
}

private func cloudSyncFailureDiagnostics(error: Error) -> CloudFailureDiagnostics {
    if let syncError = error as? CloudSyncError {
        switch syncError {
        case .invalidResponse(let details, let statusCode):
            return CloudFailureDiagnostics(
                statusCode: statusCode,
                backendCode: details.code,
                requestId: details.requestId
            )
        case .invalidBaseUrl:
            return CloudFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
        }
    }

    if let authError = error as? CloudAuthError {
        switch authError {
        case .invalidResponse(let details, let statusCode):
            return CloudFailureDiagnostics(
                statusCode: statusCode,
                backendCode: details.code,
                requestId: details.requestId
            )
        case .invalidBaseUrl, .invalidResponseBody:
            return CloudFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
        }
    }

    if let guestAuthError = error as? GuestCloudAuthError {
        switch guestAuthError {
        case .invalidResponse(let details, let statusCode):
            return CloudFailureDiagnostics(
                statusCode: statusCode,
                backendCode: details.code,
                requestId: details.requestId
            )
        case .invalidBaseUrl, .invalidResponseBody:
            return CloudFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
        }
    }

    return CloudFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
}
