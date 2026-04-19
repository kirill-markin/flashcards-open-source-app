import Foundation

private enum PersistedCloudStateReconciliationOutcome {
    case continueSync(hasStoredCredentials: Bool, hasStoredGuestSession: Bool)
    case stopSync
}

private let blockedCloudIdentityConflictCodes: Set<String> = [
    "SYNC_INSTALLATION_PLATFORM_MISMATCH",
    "SYNC_REPLICA_CONFLICT"
]

@MainActor
extension FlashcardsStore {
    func manualCloudSyncTrigger(now: Date) -> CloudSyncTrigger {
        CloudSyncTrigger(
            source: .manualSyncNow,
            now: now,
            extendsFastPolling: false,
            allowsVisibleChangeBanner: false,
            surfacesGlobalErrorMessage: true
        )
    }

    func updateCurrentVisibleTab(tab: AppTab) {
        self.currentVisibleTab = tab
    }

    func syncCloudNow(trigger: CloudSyncTrigger) async throws {
        if case .blocked(let message) = self.syncStatus {
            throw LocalStoreError.validation(message)
        }
        if self.cloudRuntime.activeCloudSession() == nil {
            if self.cloudSettings?.cloudState == .guest {
                let restoredGuestSession = try await self.restoreGuestCloudSessionIfNeeded(trigger: trigger)
                if restoredGuestSession.didRunSync {
                    return
                }
            } else {
                try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
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
            let now = Date()
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: now,
                trigger: trigger
            )
        } catch {
            self.syncStatus = self.syncStatusForCloudFailure(
                error: error,
                fallbackCloudState: failureStateCloudState
            )
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            throw error
        }
    }

    func syncCloudIfLinked(trigger: CloudSyncTrigger) async {
        if self.isCloudSyncBlocked {
            return
        }
        if self.userDefaults.bool(forKey: accountDeletionPendingUserDefaultsKey) {
            await self.resumePendingAccountDeletionIfNeeded()
            return
        }

        do {
            let reconciliationOutcome = try await self.reconcilePersistedCloudStateBeforeSync(trigger: trigger)
            let hasStoredCredentials: Bool
            let hasStoredGuestSession: Bool
            switch reconciliationOutcome {
            case .continueSync(let resolvedHasStoredCredentials, let resolvedHasStoredGuestSession):
                hasStoredCredentials = resolvedHasStoredCredentials
                hasStoredGuestSession = resolvedHasStoredGuestSession
            case .stopSync:
                return
            }

            if try await self.cloudRuntime.waitForActiveCloudLinkTransitionIfNeeded() {
                return
            }

            if self.cloudRuntime.activeCloudSession() == nil
                && hasStoredCredentials == false
                && hasStoredGuestSession == false {
                if self.cloudSettings?.cloudState == .linked {
                    try self.logoutCloudAccount()
                }

                return
            }

            try await self.syncCloudNow(trigger: trigger)
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                return
            }

            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }

    private func reconcilePersistedCloudStateBeforeSync(
        trigger: CloudSyncTrigger
    ) async throws -> PersistedCloudStateReconciliationOutcome {
        let hasStoredCredentials = try self.cloudRuntime.loadCredentials() != nil
        let hasStoredGuestSession = try self.loadGuestSessionForCurrentConfiguration() != nil
        guard let cloudState = self.cloudSettings?.cloudState else {
            return .continueSync(
                hasStoredCredentials: hasStoredCredentials,
                hasStoredGuestSession: hasStoredGuestSession
            )
        }

        switch cloudState {
        case .linked:
            if hasStoredCredentials {
                return .continueSync(
                    hasStoredCredentials: hasStoredCredentials,
                    hasStoredGuestSession: hasStoredGuestSession
                )
            }

            try self.resetLocalStateForCloudIdentityChange()
            self.globalErrorMessage = ""
            return .stopSync
        case .guest:
            let hasActiveGuestSession = self.cloudRuntime.activeCloudSession()?.authorization.isGuest == true
            if hasStoredGuestSession || hasActiveGuestSession {
                return .continueSync(
                    hasStoredCredentials: hasStoredCredentials,
                    hasStoredGuestSession: hasStoredGuestSession
                )
            }

            try self.resetLocalStateForCloudIdentityChange()
            self.globalErrorMessage = ""
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
        let didRefreshReviewState: Bool
        if syncResult.reviewDataChanged {
            let reviewRefreshMode: ReviewRefreshMode
            if trigger.allowsVisibleChangeBanner {
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
            didRefreshReviewState = false
        }
        if trigger.allowsVisibleChangeBanner {
            self.enqueueBackgroundSyncVisibleChangeBannerIfNeeded(
                bootstrapRefreshOutcome: bootstrapRefreshOutcome
            )
        }
        if bootstrapRefreshOutcome.didChange || didRefreshReviewState {
            self.localReadVersion += 1
        }
        await self.handleProgressSyncCompletion(
            now: now,
            syncResult: syncResult
        )
        self.lastSuccessfulCloudSyncAt = nowIsoTimestamp()
        self.syncStatus = .idle
        self.globalErrorMessage = ""
    }

    func isCloudAuthorizationError(_ error: Error) -> Bool {
        self.cloudRuntime.isCloudAuthorizationError(error)
    }

    var isCloudSyncBlocked: Bool {
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
        fallbackCloudState: CloudAccountState?
    ) -> SyncStatus {
        if let blockedMessage = self.blockedCloudIdentityConflictMessage(error: error) {
            return .blocked(message: blockedMessage)
        }

        if fallbackCloudState == .linked || fallbackCloudState == .guest {
            return .failed(message: Flashcards.errorMessage(error: error))
        }

        return .idle
    }

    func transitionSyncStatusForCloudFailure(error: Error) -> SyncStatus {
        if let blockedMessage = self.blockedCloudIdentityConflictMessage(error: error) {
            return .blocked(message: blockedMessage)
        }

        return .failed(message: Flashcards.errorMessage(error: error))
    }

    private func blockedCloudIdentityConflictMessage(error: Error) -> String? {
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

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        try await self.cloudRuntime.runLinkedSync(linkedSession: linkedSession)
    }

    func triggerCloudSyncIfLinked(trigger: CloudSyncTrigger) {
        if trigger.extendsFastPolling {
            self.extendCloudSyncFastPolling(now: trigger.now)
        }
        if self.shouldSkipImmediateCloudSyncStart(trigger: trigger) {
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
}
