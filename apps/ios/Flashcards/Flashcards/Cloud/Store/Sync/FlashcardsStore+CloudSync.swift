import Foundation

private enum PersistedCloudStateReconciliationOutcome {
    case continueSync(hasStoredCredentials: Bool, hasStoredGuestSession: Bool)
    case stopSync
}

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
            // Re-arms the failure gate: this attempt is the same unit of work the catch below reports,
            // so a sync that got through is what ends the episode it opened.
            Analytics.recordSyncSucceeded()
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
            // Emitted here rather than in captureCloudSyncFailureIfNeeded: that path deliberately
            // drops offline, conflicts and every non-user-visible trigger, which are exactly the
            // sync failures the product needs counted.
            //
            // Through the shared reporter rather than a direct track, because this catch is what the
            // 15 s fast-polling loop reaches on every attempt: the reporter emits on the transition
            // into failure and stays silent while the same reason persists.
            Analytics.reportSyncFailure(reason: analyticsSyncFailureReason(error: error))
            try self.throwIfCloudCredentialRecoveryRequired()
            let failureError: Error
            do {
                failureError = try await self.failureErrorAfterApplyingLocalIdRepairSideEffectsIfNeeded(
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
        // Only a guest session this install adopted as its cloud session counts. A credential minted
        // to authenticate analytics sits in the same Keychain item while `cloudState` is
        // `disconnected`, and reading it as a cloud session here would restore guest cloud state and
        // turn on sync for an install that never asked for either.
        let hasStoredGuestSession = try self.loadUsableCloudGuestSessionForCurrentConfiguration() != nil
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

                // No analytics identity boundary here on purpose. `analyticsCredentials()` reads the
                // active cloud session, which this state never has, and otherwise a stored guest
                // session, which this branch leaves in place — so nothing analytics could ever have
                // posted under is being cleared, and rotating `anonymous_id` would only split one
                // install's history in two.
                try self.cloudRuntime.clearCredentials()
                self.globalErrorMessage = ""
                return .stopSync
            }

            if hasStoredCredentials && hasStoredGuestSession {
                try self.cloudRuntime.clearCredentials()
                try self.dependencies.guestCredentialStore.clearGuestSession()
                // The guest session just cleared is the credential `analyticsCredentials()` falls back
                // to, so anything still queued was created while it was the identity those events would
                // have gone out under, and the next credential this device obtains belongs to a
                // different server-side user. That is the boundary of contract §6. This state is only
                // reached when the persisted local state disagrees with the Keychain — leftovers of an
                // install that is not this one — so carrying the same `anonymous_id` into the next
                // identity is exactly the first-wins mislink the rule exists to prevent.
                //
                // After the clears rather than before, unlike `resetLocalStateForCloudIdentityChange`:
                // this reconciliation runs before every sync, and firing the boundary first would
                // rotate `anonymous_id` again on every attempt if a clear kept failing. Neither
                // statement above suspends, so no new credential can appear in between.
                Analytics.reset()
                self.globalErrorMessage = ""
                return .stopSync
            }

            return .continueSync(
                hasStoredCredentials: hasStoredCredentials,
                hasStoredGuestSession: hasStoredGuestSession
            )
        }
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

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        try self.enforceCloudCredentialRecoveryGateOutsideIdentityResolution(detectedAt: Date())
        do {
            if try self.shouldRunGuestLocalRecoveryLinkedSync(linkedSession: linkedSession) {
                return try await self.cloudRuntime.runGuestLocalRecoveryLinkedSync(linkedSession: linkedSession)
            }

            return try await self.cloudRuntime.runLinkedSync(linkedSession: linkedSession)
        } catch {
            let failureError = try await self.failureErrorAfterApplyingLocalIdRepairSideEffectsIfNeeded(
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
            let failureError = try await self.failureErrorAfterApplyingLocalIdRepairSideEffectsIfNeeded(
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

}
