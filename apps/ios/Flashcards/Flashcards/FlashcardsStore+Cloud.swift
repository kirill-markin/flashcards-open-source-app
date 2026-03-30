import Foundation

enum CloudBootstrapEligibilityError: LocalizedError {
    case remoteWorkspaceIsNotEmpty

    var errorDescription: String? {
        switch self {
        case .remoteWorkspaceIsNotEmpty:
            return "Choose a new or empty workspace on this server before uploading the current local data."
        }
    }
}

private enum PersistedCloudStateReconciliationOutcome {
    case continueSync(hasStoredCredentials: Bool, hasStoredGuestSession: Bool)
    case stopSync
}

enum FlashcardsUITestResetState: String {
    case localGuest = "local_guest"
}

@MainActor
extension FlashcardsStore {
    /**
     Clears all account-scoped local state so the next cloud link starts from a
     fresh local database and a freshly generated sync device id.
     */
    private func resetLocalStateForCloudIdentityChange() throws {
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
        self.cachedAIChatStore?.clearHistory()
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

    private func resetLocalStateIfLinkedUserDiffers(nextUserId: String) throws {
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

    private func loadGuestSessionForCurrentConfiguration() throws -> StoredGuestCloudSession? {
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

    private func isAuthenticatedSilentRestoreEligible(
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
        configuration: CloudServiceConfiguration
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
            )
        )
    }

    private func restoreAuthenticatedCloudSessionAfterReinstall(
        configuration: CloudServiceConfiguration
    ) async throws {
        do {
            let credentials = try await self.refreshCloudCredentials(forceRefresh: false)
            try await self.performAuthenticatedSilentRestore(
                credentials: credentials,
                configuration: configuration
            )
            return
        } catch {
            if self.isCloudAuthorizationError(error) == false {
                throw error
            }
        }

        let refreshedCredentials = try await self.refreshCloudCredentials(forceRefresh: true)
        try await self.performAuthenticatedSilentRestore(
            credentials: refreshedCredentials,
            configuration: configuration
        )
    }

    private func shouldResetLocalStateAfterAuthenticatedSilentRestoreFailure(error: Error) -> Bool {
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

    func validateCustomCloudServer(customOrigin: String) async throws -> CloudServiceConfiguration {
        let configuration = try makeCustomCloudServiceConfiguration(customOrigin: customOrigin)
        try await self.cloudServiceConfigurationValidator.validate(configuration: configuration)
        return configuration
    }

    func applyCustomCloudServer(configuration: CloudServiceConfiguration) throws {
        if configuration.mode != .custom {
            throw LocalStoreError.validation("Custom server configuration is required")
        }

        try self.switchCloudServer(override: CloudServerOverride(customOrigin: try requireCustomOrigin(configuration: configuration)))
    }

    func resetToOfficialCloudServer() throws {
        try self.switchCloudServer(override: nil)
    }

    func sendCloudSignInCode(email: String) async throws -> CloudSendCodeResult {
        let configuration = try self.currentCloudServiceConfiguration()
        let result = try await self.cloudRuntime.sendCode(email: email, configuration: configuration)
        self.globalErrorMessage = ""
        return result
    }

    func verifyCloudOtp(challenge: CloudOtpChallenge, code: String) async throws -> CloudVerifiedAuthContext {
        let configuration = try self.currentCloudServiceConfiguration()
        self.globalErrorMessage = ""
        return try await self.cloudRuntime.verifyCode(
            challenge: challenge,
            code: code,
            configuration: configuration
        )
    }

    func prepareCloudLink(verifiedContext: CloudVerifiedAuthContext) async throws -> CloudWorkspaceLinkContext {
        let guestUpgradeMode = try await self.prepareGuestUpgradeModeIfNeeded(verifiedContext: verifiedContext)
        let account = try await self.cloudRuntime.fetchCloudAccount(verifiedContext: verifiedContext)
        try self.resetLocalStateIfLinkedUserDiffers(nextUserId: account.userId)

        self.globalErrorMessage = ""
        return CloudWorkspaceLinkContext(
            userId: account.userId,
            email: account.email,
            apiBaseUrl: verifiedContext.apiBaseUrl,
            credentials: verifiedContext.credentials,
            workspaces: account.workspaces,
            guestUpgradeMode: guestUpgradeMode
        )
    }

    func completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) async throws {
        guard let workspace else {
            throw LocalStoreError.uninitialized("Workspace is unavailable")
        }

        let linkedWorkspace = try await self.cloudRuntime.selectOrCreateWorkspace(
            linkContext: linkContext,
            selection: selection,
            localWorkspaceName: workspace.name
        )

        if try await self.shouldValidateEmptyRemoteWorkspaceBeforeBootstrap() {
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            let cloudSettings = try requireCloudSettings(cloudSettings: self.cloudSettings)
            let isWorkspaceEmpty = try await cloudSyncService.isWorkspaceEmptyForBootstrap(
                apiBaseUrl: linkContext.apiBaseUrl,
                bearerToken: linkContext.credentials.idToken,
                workspaceId: linkedWorkspace.workspaceId,
                deviceId: cloudSettings.deviceId
            )
            if isWorkspaceEmpty == false {
                throw CloudBootstrapEligibilityError.remoteWorkspaceIsNotEmpty
            }
        }

        try self.cloudRuntime.saveCredentials(credentials: linkContext.credentials)
        let configuration = try self.currentCloudServiceConfiguration()
        try await self.finishCloudLink(
            linkedSession: CloudLinkedSession(
                userId: linkContext.userId,
                workspaceId: linkedWorkspace.workspaceId,
                email: linkContext.email,
                configurationMode: configuration.mode,
                apiBaseUrl: linkContext.apiBaseUrl,
                authorization: .bearer(linkContext.credentials.idToken)
            )
        )
        try self.clearGuestSessionIfNeeded()
        self.globalErrorMessage = ""
    }

    func completeGuestCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) async throws {
        guard let guestSession = try self.loadGuestSessionForCurrentConfiguration() else {
            throw LocalStoreError.uninitialized("Guest AI session is unavailable")
        }

        let guestSelection: CloudGuestUpgradeSelection
        switch selection {
        case .existing(let workspaceId):
            guestSelection = .existing(workspaceId: workspaceId)
        case .createNew:
            guestSelection = .createNew
        }

        let linkedWorkspace = try await self.dependencies.guestCloudAuthService.completeGuestUpgrade(
            apiBaseUrl: linkContext.apiBaseUrl,
            bearerToken: linkContext.credentials.idToken,
            guestToken: guestSession.guestToken,
            selection: guestSelection
        )

        try self.cloudRuntime.saveCredentials(credentials: linkContext.credentials)
        let configuration = try self.currentCloudServiceConfiguration()
        try await self.finishCloudLink(
            linkedSession: CloudLinkedSession(
                userId: linkContext.userId,
                workspaceId: linkedWorkspace.workspaceId,
                email: linkContext.email,
                configurationMode: configuration.mode,
                apiBaseUrl: linkContext.apiBaseUrl,
                authorization: .bearer(linkContext.credentials.idToken)
            )
        )
        try self.clearGuestSessionIfNeeded()
        self.globalErrorMessage = ""
    }

    func logoutCloudAccount() throws {
        try self.resetLocalStateForCloudIdentityChange()
    }

    func applyUITestResetState(resetState: FlashcardsUITestResetState) throws {
        switch resetState {
        case .localGuest:
            try self.resetLocalStateForCloudIdentityChange()
        }
    }

    func beginAccountDeletion() {
        self.userDefaults.set(true, forKey: accountDeletionPendingUserDefaultsKey)
        self.accountDeletionState = .inProgress
        Task { @MainActor in
            await self.runPendingAccountDeletion()
        }
    }

    func retryPendingAccountDeletion() {
        self.accountDeletionState = .inProgress
        Task { @MainActor in
            await self.runPendingAccountDeletion()
        }
    }

    func resumePendingAccountDeletionIfNeeded() async {
        guard self.userDefaults.bool(forKey: accountDeletionPendingUserDefaultsKey) else {
            return
        }

        self.accountDeletionState = .inProgress
        await self.runPendingAccountDeletion()
    }

    func dismissAccountDeletionSuccessMessage() {
        self.accountDeletionSuccessMessage = nil
    }

    func syncCloudNow() async throws {
        if self.cloudRuntime.activeCloudSession() == nil {
            if self.cloudSettings?.cloudState == .guest {
                let restoredGuestSession = try await self.restoreGuestCloudSessionIfNeeded()
                if restoredGuestSession.didRunSync {
                    return
                }
            } else {
                try await self.restoreCloudLinkFromStoredCredentials()
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
                now: now
            )
        } catch {
            self.syncStatus = failureStateCloudState == .linked || failureStateCloudState == .guest
                ? .failed(message: Flashcards.errorMessage(error: error))
                : .idle
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw error
        }
    }

    func syncCloudIfLinked() async {
        if self.userDefaults.bool(forKey: accountDeletionPendingUserDefaultsKey) {
            await self.resumePendingAccountDeletionIfNeeded()
            return
        }

        do {
            let reconciliationOutcome = try await self.reconcilePersistedCloudStateBeforeSync()
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

            try await self.syncCloudNow()
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                return
            }

            self.globalErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func reconcilePersistedCloudStateBeforeSync() async throws -> PersistedCloudStateReconciliationOutcome {
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
                _ = try await self.restoreGuestCloudSessionIfNeeded()
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
                        try await self.restoreAuthenticatedCloudSessionAfterReinstall(
                            configuration: configuration
                        )
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

    func cloudSessionForAI() async throws -> CloudLinkedSession {
        if self.cloudSettings?.cloudState == .linked {
            return try await self.prepareAuthenticatedCloudSessionForAI()
        }

        return try await self.prepareGuestCloudSessionForAI()
    }

    func warmUpAuthenticatedCloudSessionForAI() async {
        guard self.cloudSettings?.cloudState == .linked else {
            return
        }

        do {
            _ = try await self.prepareAuthenticatedCloudSessionForAI()
        } catch {
            logFlashcardsError(
                domain: "chat",
                action: "ai_chat_session_warmup_failed",
                metadata: [
                    "message": Flashcards.errorMessage(error: error),
                ]
            )
        }
    }

    private func loadOrCreateGuestCloudSession() async throws -> CloudLinkedSession {
        let storedGuestSession: StoredGuestCloudSession
        if let existingGuestSession = try self.loadGuestSessionForCurrentConfiguration() {
            storedGuestSession = existingGuestSession
        } else {
            let configuration = try self.currentCloudServiceConfiguration()
            let createdGuestSession = try await self.dependencies.guestCloudAuthService.createGuestSession(
                apiBaseUrl: configuration.apiBaseUrl,
                configurationMode: configuration.mode
            )
            try self.dependencies.guestCredentialStore.saveGuestSession(session: createdGuestSession)
            storedGuestSession = createdGuestSession
        }

        return CloudLinkedSession(
            userId: storedGuestSession.userId,
            workspaceId: storedGuestSession.workspaceId,
            email: nil,
            configurationMode: storedGuestSession.configurationMode,
            apiBaseUrl: storedGuestSession.apiBaseUrl,
            authorization: .guest(storedGuestSession.guestToken)
        )
    }

    private func markLocalCloudStateAsGuest(session: CloudLinkedSession) throws {
        let database = try requireLocalDatabase(database: self.database)
        try database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: session.userId,
            linkedWorkspaceId: session.workspaceId,
            activeWorkspaceId: session.workspaceId,
            linkedEmail: nil
        )
        try self.reload()
    }

    private func prepareGuestCloudSessionForAI() async throws -> CloudLinkedSession {
        let restoredGuestSession = try await self.restoreGuestCloudSessionIfNeeded()
        return restoredGuestSession.session
    }

    private func restoreGuestCloudSessionIfNeeded() async throws -> (session: CloudLinkedSession, didRunSync: Bool) {
        let guestSession = try await self.loadOrCreateGuestCloudSession()
        let isAlreadyGuestLinked = self.cloudSettings?.cloudState == .guest
            && self.workspace?.workspaceId == guestSession.workspaceId
            && self.cloudSettings?.linkedUserId == guestSession.userId

        if isAlreadyGuestLinked {
            self.cloudRuntime.setActiveCloudSession(linkedSession: guestSession)
            return (guestSession, false)
        }

        try await self.finishCloudLink(linkedSession: guestSession)
        try self.markLocalCloudStateAsGuest(session: guestSession)
        return (guestSession, true)
    }

    private func prepareGuestUpgradeModeIfNeeded(
        verifiedContext: CloudVerifiedAuthContext
    ) async throws -> CloudGuestUpgradeMode? {
        guard self.cloudSettings?.cloudState == .guest else {
            return nil
        }
        guard let guestSession = try self.loadGuestSessionForCurrentConfiguration() else {
            return nil
        }

        return try await self.dependencies.guestCloudAuthService.prepareGuestUpgrade(
            apiBaseUrl: verifiedContext.apiBaseUrl,
            bearerToken: verifiedContext.credentials.idToken,
            guestToken: guestSession.guestToken
        )
    }

    private func clearGuestSessionIfNeeded() throws {
        if try self.dependencies.guestCredentialStore.loadGuestSession() != nil {
            try self.dependencies.guestCredentialStore.clearGuestSession()
        }
    }

    func listAgentApiKeys() async throws -> (connections: [AgentApiKeyConnection], instructions: String) {
        return try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            return try await cloudSyncService.listAgentApiKeys(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken
            )
        }
    }

    func revokeAgentApiKey(connectionId: String) async throws -> (connection: AgentApiKeyConnection, instructions: String) {
        return try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            return try await cloudSyncService.revokeAgentApiKey(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                connectionId: connectionId
            )
        }
    }

    func listLinkedWorkspaces() async throws -> [CloudWorkspaceSummary] {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace switching is available only for linked cloud workspaces")
        }

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials()
        }

        return try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            let account = try await cloudSyncService.fetchCloudAccount(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken
            )
            return account.workspaces
        }
    }

    func switchLinkedWorkspace(selection: CloudWorkspaceLinkSelection) async throws {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace switching is available only for linked cloud workspaces")
        }

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials()
        }

        let currentWorkspaceId = self.workspace?.workspaceId
        let selectedWorkspace = try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            switch selection {
            case .existing(let workspaceId):
                return try await cloudSyncService.selectWorkspace(
                    apiBaseUrl: session.apiBaseUrl,
                    bearerToken: session.bearerToken,
                    workspaceId: workspaceId
                )
            case .createNew:
                return try await cloudSyncService.createWorkspace(
                    apiBaseUrl: session.apiBaseUrl,
                    bearerToken: session.bearerToken,
                    name: "Personal"
                )
            }
        }

        if currentWorkspaceId == selectedWorkspace.workspaceId {
            return
        }

        let activeSession = try await self.withAuthenticatedCloudSession { session in
            CloudLinkedSession(
                userId: session.userId,
                workspaceId: selectedWorkspace.workspaceId,
                email: session.email,
                configurationMode: session.configurationMode,
                apiBaseUrl: session.apiBaseUrl,
                authorization: session.authorization
            )
        }

        self.cloudRuntime.cancelForWorkspaceSwitch()
        self.prepareWorkspaceScopedStateForSwitch(nextWorkspaceId: selectedWorkspace.workspaceId)
        let database = try requireLocalDatabase(database: self.database)
        try database.switchActiveWorkspace(
            workspace: selectedWorkspace,
            linkedSession: activeSession
        )
        self.cloudRuntime.setActiveCloudSession(linkedSession: activeSession)
        try self.reload()
        self.syncStatus = .syncing

        do {
            let syncResult = try await self.runLinkedSync(linkedSession: activeSession)
            try await self.applySyncResultWithoutBlockingReset(syncResult: syncResult, now: Date())
        } catch {
            self.syncStatus = .failed(message: Flashcards.errorMessage(error: error))
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw error
        }
    }

    func renameCurrentWorkspace(name: String) async throws {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace rename is available only for linked cloud workspaces")
        }

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials()
        }

        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty {
            throw LocalStoreError.validation("Workspace name is required")
        }

        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        let renamedWorkspace = try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            return try await cloudSyncService.renameWorkspace(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                workspaceId: workspaceId,
                name: trimmedName
            )
        }

        let database = try requireLocalDatabase(database: self.database)
        _ = try database.updateWorkspaceName(workspaceId: workspaceId, name: renamedWorkspace.name)
        try self.reload()
        self.globalErrorMessage = ""
    }

    func loadCurrentWorkspaceDeletePreview() async throws -> CloudWorkspaceDeletePreview {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace deletion is available only for linked cloud workspaces")
        }

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials()
        }

        let workspaceId = try requireWorkspaceId(workspace: self.workspace)
        return try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            return try await cloudSyncService.loadWorkspaceDeletePreview(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                workspaceId: workspaceId
            )
        }
    }

    func deleteCurrentWorkspace(confirmationText: String) async throws {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Workspace deletion is available only for linked cloud workspaces")
        }

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials()
        }

        let localWorkspaceId = try requireWorkspaceId(workspace: self.workspace)
        self.syncStatus = .syncing

        do {
            let deleteResult = try await self.withAuthenticatedCloudSession { session in
                let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
                let response = try await cloudSyncService.deleteWorkspace(
                    apiBaseUrl: session.apiBaseUrl,
                    bearerToken: session.bearerToken,
                    workspaceId: localWorkspaceId,
                    confirmationText: confirmationText
                )
                return (session, response)
            }

            let replacementSession = CloudLinkedSession(
                userId: deleteResult.0.userId,
                workspaceId: deleteResult.1.workspace.workspaceId,
                email: deleteResult.0.email,
                configurationMode: deleteResult.0.configurationMode,
                apiBaseUrl: deleteResult.0.apiBaseUrl,
                authorization: deleteResult.0.authorization
            )
            let database = try requireLocalDatabase(database: self.database)
            self.cloudRuntime.cancelForWorkspaceSwitch()
            self.prepareWorkspaceScopedStateForSwitch(nextWorkspaceId: replacementSession.workspaceId)
            try database.replaceLocalWorkspaceAfterRemoteDelete(
                localWorkspaceId: localWorkspaceId,
                replacementWorkspace: deleteResult.1.workspace,
                linkedSession: replacementSession
            )
            self.cloudRuntime.setActiveCloudSession(linkedSession: replacementSession)
            let syncResult = try await self.runLinkedSync(linkedSession: replacementSession)
            try await self.applySyncResultWithoutBlockingReset(syncResult: syncResult, now: Date())
        } catch {
            self.syncStatus = .failed(message: Flashcards.errorMessage(error: error))
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw error
        }
    }

    func finishCloudLink(linkedSession: CloudLinkedSession) async throws {
        try await self.cloudRuntime.runCloudLinkTransition { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            try await self.performCloudLink(linkedSession: linkedSession)
        }
    }

    private func performCloudLink(linkedSession: CloudLinkedSession) async throws {
        if self.cloudSettings?.cloudState == .linked
            && self.cloudSettings?.linkedUserId == linkedSession.userId {
            let database = try requireLocalDatabase(database: self.database)
            if self.workspace?.workspaceId == linkedSession.workspaceId {
                try database.updateCloudSettings(
                    cloudState: .linked,
                    linkedUserId: linkedSession.userId,
                    linkedWorkspaceId: linkedSession.workspaceId,
                    activeWorkspaceId: linkedSession.workspaceId,
                    linkedEmail: linkedSession.email
                )
                try self.reload()
                try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession)
            } else {
                try await self.performActiveWorkspaceCloudRestore(linkedSession: linkedSession)
            }
            return
        }

        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)

        self.syncStatus = .syncing
        var didCompleteLocalLink = false
        do {
            logCloudFlowPhase(
                phase: .linkLocalWorkspace,
                outcome: "start",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId
            )
            try context.database.relinkWorkspace(
                localWorkspaceId: context.workspaceId,
                linkedSession: linkedSession
            )

            self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            try self.reload()
            didCompleteLocalLink = true
            logCloudFlowPhase(
                phase: .linkLocalWorkspace,
                outcome: "success",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId
            )
            _ = try await self.runLinkedSync(linkedSession: linkedSession)
            self.lastSuccessfulCloudSyncAt = nowIsoTimestamp()
            self.syncStatus = .idle
            self.globalErrorMessage = ""
            self.userDefaults.removeObject(forKey: pendingCloudServerBootstrapUserDefaultsKey)
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "success",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId
            )
            try self.reload()
        } catch {
            if didCompleteLocalLink == false {
                logCloudFlowPhase(
                    phase: .linkLocalWorkspace,
                    outcome: "failure",
                    workspaceId: linkedSession.workspaceId,
                    deviceId: self.cloudSettings?.deviceId,
                    errorMessage: Flashcards.errorMessage(error: error)
                )
            }
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "failure",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            self.syncStatus = .failed(message: Flashcards.errorMessage(error: error))
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw error
        }
    }

    /**
     Restores a cloud session for the already-linked local workspace without
     resetting review UI state. This keeps the locally rendered card visible
     unless the sync result produces an actual review data change.
     */
    private func performSameWorkspaceCloudRestore(linkedSession: CloudLinkedSession) async throws {
        self.syncStatus = .syncing

        do {
            self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            let syncResult = try await self.runLinkedSync(linkedSession: linkedSession)
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date()
            )
            self.userDefaults.removeObject(forKey: pendingCloudServerBootstrapUserDefaultsKey)
        } catch {
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "failure",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            self.syncStatus = .failed(message: Flashcards.errorMessage(error: error))
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
            throw error
        }
    }

    private func performActiveWorkspaceCloudRestore(linkedSession: CloudLinkedSession) async throws {
        let database = try requireLocalDatabase(database: self.database)
        let cachedWorkspace = try database.loadCachedWorkspaces().first { workspace in
            workspace.workspaceId == linkedSession.workspaceId
        }
        let workspaceSummary = CloudWorkspaceSummary(
            workspaceId: linkedSession.workspaceId,
            name: cachedWorkspace?.name ?? "Personal",
            createdAt: cachedWorkspace?.createdAt ?? nowIsoTimestamp(),
            isSelected: true
        )

        self.cloudRuntime.cancelForWorkspaceSwitch()
        self.prepareWorkspaceScopedStateForSwitch(nextWorkspaceId: linkedSession.workspaceId)
        try database.switchActiveWorkspace(workspace: workspaceSummary, linkedSession: linkedSession)
        self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
        try self.reload()
        try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession)
    }

    /**
     Applies sync side effects through diff-aware bootstrap and review
     reconciliation so no-op syncs do not trigger a blocking review reload.
     */
    private func applySyncResultWithoutBlockingReset(
        syncResult: CloudSyncResult,
        now: Date
    ) async throws {
        let didRefreshBootstrapSnapshot = try self.refreshBootstrapSnapshotWithoutReset(now: now)
        let didRefreshReviewState: Bool
        if syncResult.reviewDataChanged {
            didRefreshReviewState = try await self.refreshReviewState(
                now: now,
                mode: .backgroundReconcile
            )
        } else {
            didRefreshReviewState = false
        }
        if didRefreshBootstrapSnapshot || didRefreshReviewState {
            self.localReadVersion += 1
        }
        self.lastSuccessfulCloudSyncAt = nowIsoTimestamp()
        self.syncStatus = .idle
        self.globalErrorMessage = ""
    }

    func refreshCloudCredentials(forceRefresh: Bool) async throws -> StoredCloudCredentials {
        let configuration = try self.currentCloudServiceConfiguration()
        return try await self.cloudRuntime.refreshCloudCredentials(
            forceRefresh: forceRefresh,
            configuration: configuration,
            now: Date()
        )
    }

    func prepareAuthenticatedCloudSessionForAI() async throws -> CloudLinkedSession {
        return try await self.cloudRuntime.prepareAuthenticatedCloudSessionForAI(
            restoreCloudLink: { [weak self] in
                guard let self else {
                    throw LocalStoreError.uninitialized("Flashcards store is unavailable")
                }

                try await self.restoreCloudLinkFromStoredCredentials()
            },
            resolveSession: { [weak self] in
                guard let self else {
                    throw LocalStoreError.uninitialized("Flashcards store is unavailable")
                }

                return try await self.withAuthenticatedCloudSession { session in
                    session
                }
            }
        )
    }

    func restoreCloudLinkFromStoredCredentials() async throws {
        try await self.cloudRuntime.runCloudLinkTransition { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            try await self.performRestoreCloudLinkFromStoredCredentials()
        }
    }

    /**
     Restores the linked cloud session from persisted credentials. When the
     stored workspace already matches the local workspace, it reuses the
     non-blocking restore path; otherwise it falls back to the full relink flow.
     */
    private func performRestoreCloudLinkFromStoredCredentials() async throws {
        let configuration = try self.currentCloudServiceConfiguration()

        do {
            let credentials = try await self.refreshCloudCredentials(forceRefresh: false)
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
                try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession)
            } else {
                try await self.performActiveWorkspaceCloudRestore(linkedSession: linkedSession)
            }
            return
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                return
            }

            if self.isCloudAuthorizationError(error) == false {
                throw error
            }
        }

        do {
            let refreshedCredentials = try await self.refreshCloudCredentials(forceRefresh: true)
            if try await self.resetLocalStateIfStoredCredentialsBelongToDifferentUser(
                credentials: refreshedCredentials,
                configuration: configuration
            ) {
                return
            }
            let linkedSession = try self.cloudRuntime.storedLinkedSession(
                cloudSettings: self.cloudSettings,
                configuration: configuration,
                bearerToken: refreshedCredentials.idToken
            )
            if self.workspace?.workspaceId == linkedSession.workspaceId {
                try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession)
            } else {
                try await self.performActiveWorkspaceCloudRestore(linkedSession: linkedSession)
            }
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                return
            }

            if self.isCloudAuthorizationError(error) {
                try self.logoutCloudAccount()
            }

            throw error
        }
    }

    func withAuthenticatedCloudSession<Result>(
        operation: (CloudLinkedSession) async throws -> Result
    ) async throws -> Result {
        do {
            let credentials = try await self.refreshCloudCredentials(forceRefresh: false)
            let linkedSession = try self.cloudRuntime.sessionWithUpdatedBearerToken(credentials: credentials)
            return try await operation(linkedSession)
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                throw error
            }

            if self.isCloudAuthorizationError(error) == false {
                throw error
            }
        }

        do {
            let refreshedCredentials = try await self.refreshCloudCredentials(forceRefresh: true)
            let linkedSession = try self.cloudRuntime.sessionWithUpdatedBearerToken(credentials: refreshedCredentials)
            return try await operation(linkedSession)
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                throw error
            }

            if self.isCloudAuthorizationError(error) {
                try self.logoutCloudAccount()
            }

            throw error
        }
    }

    func isCloudAuthorizationError(_ error: Error) -> Bool {
        self.cloudRuntime.isCloudAuthorizationError(error)
    }

    func isCloudAccountDeletedError(_ error: Error) -> Bool {
        self.cloudRuntime.isCloudAccountDeletedError(error)
    }

    func runPendingAccountDeletion() async {
        guard self.isAccountDeletionRunning == false else {
            return
        }

        self.isAccountDeletionRunning = true
        defer {
            self.isAccountDeletionRunning = false
        }

        do {
            try await self.performCloudAccountDeletion()
            try self.completeLocalAccountDeletion()
            self.accountDeletionState = .hidden
            self.accountDeletionSuccessMessage = "Your account has been deleted."
        } catch {
            if self.isCloudAccountDeletedError(error) {
                return
            }

            self.accountDeletionState = .failed(message: Flashcards.errorMessage(error: error))
        }
    }

    func performCloudAccountDeletion() async throws {
        try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            try await cloudSyncService.deleteAccount(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                confirmationText: accountDeletionConfirmationText
            )
        }
    }

    func completeLocalAccountDeletion() throws {
        self.userDefaults.removeObject(forKey: accountDeletionPendingUserDefaultsKey)
        try self.resetLocalStateForCloudIdentityChange()
    }

    func handleRemoteAccountDeletedCleanup() {
        do {
            self.userDefaults.set(true, forKey: accountDeletionPendingUserDefaultsKey)
            try self.completeLocalAccountDeletion()
            self.accountDeletionState = .hidden
            self.accountDeletionSuccessMessage = "Your account has been deleted."
        } catch {
            self.accountDeletionState = .failed(message: Flashcards.errorMessage(error: error))
        }
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        try await self.cloudRuntime.runLinkedSync(linkedSession: linkedSession)
    }

    func triggerCloudSyncIfLinked() {
        self.extendCloudSyncFastPolling(now: Date())
        Task { @MainActor in
            await self.syncCloudIfLinked()
        }
    }

    private func switchCloudServer(override: CloudServerOverride?) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)

        self.cloudRuntime.cancelForAccountDeletion()
        try self.cloudRuntime.clearCredentials()
        try self.dependencies.guestCredentialStore.clearGuestSession()
        try context.database.clearCloudSyncState(workspaceId: context.workspaceId)
        try context.database.updateCloudSettings(
            cloudState: .disconnected,
            linkedUserId: nil,
            linkedWorkspaceId: nil,
            activeWorkspaceId: context.workspaceId,
            linkedEmail: nil
        )

        if let override {
            try saveCloudServerOverride(
                override: override,
                userDefaults: self.userDefaults,
                encoder: self.encoder
            )
        } else {
            clearCloudServerOverride(userDefaults: self.userDefaults)
        }

        if override == nil {
            self.userDefaults.removeObject(forKey: pendingCloudServerBootstrapUserDefaultsKey)
        } else {
            self.userDefaults.set(true, forKey: pendingCloudServerBootstrapUserDefaultsKey)
        }
        self.syncStatus = .idle
        self.lastSuccessfulCloudSyncAt = nil
        self.globalErrorMessage = ""
        try self.reload()
    }

    private func shouldValidateEmptyRemoteWorkspaceBeforeBootstrap() async throws -> Bool {
        let configuration = try self.currentCloudServiceConfiguration()
        return configuration.mode == .custom
            && self.userDefaults.bool(forKey: pendingCloudServerBootstrapUserDefaultsKey)
    }
}
