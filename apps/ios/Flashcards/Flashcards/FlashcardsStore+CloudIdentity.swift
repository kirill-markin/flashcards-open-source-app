import Foundation

@MainActor
extension FlashcardsStore {
    /**
     Clears all account-scoped local state so the next cloud link starts from a
     fresh local database and a freshly generated sync device id.
     
     This reset is the boundary that intentionally breaks identity continuity
     across logout and account deletion. The next guest cloud restore creates a
     brand new server-side guest session with a new guest user/workspace, so we
     never try to merge a future guest account into another linked account as if
     it were the same pre-reset guest identity.
     */
    func resetLocalStateForCloudIdentityChange() throws {
        let database = try requireLocalDatabase(database: self.database)

        self.reviewRuntime.cancelForAccountDeletion()
        self.cloudRuntime.cancelForAccountDeletion()
        try self.cloudRuntime.clearCredentials()
        try self.dependencies.guestCredentialStore.clearGuestSession()
        clearStoredReviewFilters(userDefaults: self.userDefaults)
        self.userDefaults.removeObject(forKey: reviewNotificationPromptStateUserDefaultsKey)
        self.userDefaults.removeObject(forKey: reviewNotificationSuccessfulReviewCountUserDefaultsKey)
        self.userDefaults.removeObject(forKey: reviewNotificationLastActiveAtUserDefaultsKey)
        self.userDefaults.removeObject(forKey: accountDeletionPendingUserDefaultsKey)
        self.userDefaults.removeObject(forKey: aiChatExternalProviderConsentUserDefaultsKey)
        self.cachedAIChatStore?.clearLocalHistory()
        clearStoredAIChatHistories(userDefaults: self.userDefaults)
        self.reviewRuntime = ReviewQueueRuntime(
            initialSelectedReviewFilter: .allCards,
            reviewSeedQueueSize: reviewSeedQueueSize,
            reviewQueueReplenishmentThreshold: reviewQueueReplenishmentThreshold
        )
        self.applyReviewPublishedState(
            reviewState: ReviewQueueRuntime.makeInitialPublishedState(selectedReviewFilter: .allCards)
        )
        self.notificationPermissionPromptState = makeDefaultNotificationPermissionPromptState()
        self.isReviewNotificationPrePromptPresented = false
        self.accountDeletionState = .hidden
        self.accountDeletionSuccessMessage = nil
        self.cloudSyncFastPollingUntil = nil
        self.pendingReviewCardIds = []
        self.reviewSubmissionFailure = nil
        self.isAccountDeletionRunning = false
        self.clearTransientBanners()
        self.lastSuccessfulCloudSyncAt = nil
        self.syncStatus = .idle
        self.globalErrorMessage = ""
        try database.resetForAccountDeletion()
        try self.reload()
    }

    func resetLocalStateIfLinkedUserDiffers(nextUserId: String) throws {
        guard self.cloudSettings?.cloudState == .linked else {
            return
        }

        guard let linkedUserId = self.cloudSettings?.linkedUserId, linkedUserId.isEmpty == false else {
            return
        }

        if linkedUserId != nextUserId {
            try self.resetLocalStateForCloudIdentityChange()
        }
    }

    func loadGuestSessionForCurrentConfiguration() throws -> StoredGuestCloudSession? {
        guard let storedGuestSession = try self.dependencies.guestCredentialStore.loadGuestSession() else {
            return nil
        }

        let configuration = try self.currentCloudServiceConfiguration()
        if storedGuestSession.apiBaseUrl != configuration.apiBaseUrl
            || storedGuestSession.configurationMode != configuration.mode {
            try self.dependencies.guestCredentialStore.clearGuestSession()
            return nil
        }

        return storedGuestSession
    }

    private func loadAuthenticatedCloudAccountSnapshot(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ) async throws -> CloudAccountSnapshot {
        try await self.cloudRuntime.fetchCloudAccount(
            verifiedContext: CloudVerifiedAuthContext(
                apiBaseUrl: configuration.apiBaseUrl,
                credentials: credentials
            )
        )
    }

    func isAuthenticatedSilentRestoreEligible(
        configuration: CloudServiceConfiguration,
        hasStoredCredentials: Bool,
        hasStoredGuestSession: Bool
    ) throws -> Bool {
        guard configuration.mode == .official else {
            return false
        }
        guard hasStoredCredentials else {
            return false
        }
        guard hasStoredGuestSession == false else {
            return false
        }
        guard self.cloudSettings?.cloudState == .disconnected || self.cloudSettings?.cloudState == .linkingReady else {
            return false
        }

        let database = try requireLocalDatabase(database: self.database)
        return try database.isSafeForAuthenticatedSilentRestore()
    }

    private func selectedWorkspaceForAuthenticatedSilentRestore(
        account: CloudAccountSnapshot
    ) throws -> CloudWorkspaceSummary {
        guard let selectedWorkspace = account.workspaces.first(where: { workspace in
            workspace.isSelected
        }) else {
            throw LocalStoreError.validation("Authenticated cloud account is missing a selected workspace")
        }

        return selectedWorkspace
    }

    private func performAuthenticatedSilentRestore(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration,
        trigger: CloudSyncTrigger
    ) async throws {
        let account = try await self.loadAuthenticatedCloudAccountSnapshot(
            credentials: credentials,
            configuration: configuration
        )
        let selectedWorkspace = try self.selectedWorkspaceForAuthenticatedSilentRestore(account: account)

        try await self.finishCloudLink(
            linkedSession: CloudLinkedSession(
                userId: account.userId,
                workspaceId: selectedWorkspace.workspaceId,
                email: account.email,
                configurationMode: configuration.mode,
                apiBaseUrl: configuration.apiBaseUrl,
                authorization: .bearer(credentials.idToken)
            ),
            trigger: trigger
        )
    }

    func restoreAuthenticatedCloudSessionAfterReinstall(
        trigger: CloudSyncTrigger
    ) async throws {
        try await self.withStoredAuthenticatedCredentials { credentials, configuration in
            try await self.performAuthenticatedSilentRestore(
                credentials: credentials,
                configuration: configuration,
                trigger: trigger
            )
        }
    }

    func shouldResetLocalStateAfterAuthenticatedSilentRestoreFailure(error: Error) -> Bool {
        if error is URLError {
            return true
        }
        if error is CloudAuthError {
            return true
        }
        if error is CloudSyncError {
            return true
        }

        return false
    }

    /**
     Prevents stored credentials from silently restoring a different cloud
     account into local state that still belongs to the previous user.
     */
    @discardableResult
    private func resetLocalStateIfStoredCredentialsBelongToDifferentUser(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ) async throws -> Bool {
        guard self.cloudSettings?.cloudState == .linked else {
            return false
        }

        let authenticatedAccount = try await self.loadAuthenticatedCloudAccountSnapshot(
            credentials: credentials,
            configuration: configuration
        )
        guard let linkedUserId = self.cloudSettings?.linkedUserId, linkedUserId.isEmpty == false else {
            return false
        }

        if linkedUserId == authenticatedAccount.userId {
            return false
        }

        try self.resetLocalStateForCloudIdentityChange()
        return true
    }

    func currentCloudServiceConfiguration() throws -> CloudServiceConfiguration {
        try loadCloudServiceConfiguration(
            bundle: .main,
            userDefaults: self.userDefaults,
            decoder: self.decoder
        )
    }

    func refreshCloudCredentials(forceRefresh: Bool) async throws -> StoredCloudCredentials {
        let configuration = try self.currentCloudServiceConfiguration()
        return try await self.refreshCloudCredentials(
            forceRefresh: forceRefresh,
            configuration: configuration
        )
    }

    private func refreshCloudCredentials(
        forceRefresh: Bool,
        configuration: CloudServiceConfiguration
    ) async throws -> StoredCloudCredentials {
        try await self.cloudRuntime.refreshCloudCredentials(
            forceRefresh: forceRefresh,
            configuration: configuration,
            now: Date()
        )
    }

    func withStoredAuthenticatedCredentials<Result>(
        operation: (StoredCloudCredentials, CloudServiceConfiguration) async throws -> Result
    ) async throws -> Result {
        let configuration = try self.currentCloudServiceConfiguration()

        do {
            let credentials = try await self.refreshCloudCredentials(
                forceRefresh: false,
                configuration: configuration
            )
            return try await operation(credentials, configuration)
        } catch {
            if self.isCloudAuthorizationError(error) == false {
                throw error
            }
        }

        let refreshedCredentials = try await self.refreshCloudCredentials(
            forceRefresh: true,
            configuration: configuration
        )
        return try await operation(refreshedCredentials, configuration)
    }

    func restoreLinkedSessionFromCredentials(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration,
        trigger: CloudSyncTrigger
    ) async throws {
        if try await self.resetLocalStateIfStoredCredentialsBelongToDifferentUser(
            credentials: credentials,
            configuration: configuration
        ) {
            return
        }

        let linkedSession = try self.cloudRuntime.storedLinkedSession(
            cloudSettings: self.cloudSettings,
            configuration: configuration,
            bearerToken: credentials.idToken
        )
        if self.workspace?.workspaceId == linkedSession.workspaceId {
            try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
        } else {
            try await self.performActiveWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
        }
    }

    func clearGuestSessionIfNeeded() throws {
        if try self.dependencies.guestCredentialStore.loadGuestSession() != nil {
            try self.dependencies.guestCredentialStore.clearGuestSession()
        }
    }
}
