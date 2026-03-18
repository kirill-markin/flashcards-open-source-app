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
        self.userDefaults.removeObject(forKey: selectedReviewFilterUserDefaultsKey)
        self.userDefaults.removeObject(forKey: aiChatExternalProviderConsentUserDefaultsKey)
        self.aiChatStore.clearHistory()
        self.reviewRuntime = ReviewQueueRuntime(
            initialSelectedReviewFilter: .allCards,
            reviewSeedQueueSize: reviewSeedQueueSize,
            reviewQueueReplenishmentThreshold: reviewQueueReplenishmentThreshold
        )
        self.applyReviewPublishedState(
            reviewState: ReviewQueueRuntime.makeInitialPublishedState(selectedReviewFilter: .allCards)
        )
        self.reviewOverlayBanner = nil
        self.lastSuccessfulCloudSyncAt = nil
        self.syncStatus = .idle
        self.globalErrorMessage = ""
        try database.resetForAccountDeletion()
        try self.reload()
    }

    private func resetLocalStateIfLinkedUserDiffers(nextUserId: String) throws {
        guard let linkedUserId = self.cloudSettings?.linkedUserId, linkedUserId.isEmpty == false else {
            return
        }

        if linkedUserId != nextUserId {
            try self.resetLocalStateForCloudIdentityChange()
        }
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

    /**
     Prevents stored credentials from silently restoring a different cloud
     account into local state that still belongs to the previous user.
     */
    @discardableResult
    private func resetLocalStateIfStoredCredentialsBelongToDifferentUser(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ) async throws -> Bool {
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

    func sendCloudSignInCode(email: String) async throws -> CloudOtpChallenge {
        let configuration = try self.currentCloudServiceConfiguration()
        let challenge = try await self.cloudRuntime.sendCode(email: email, configuration: configuration)
        self.globalErrorMessage = ""
        return challenge
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
        let account = try await self.cloudRuntime.fetchCloudAccount(verifiedContext: verifiedContext)
        try self.resetLocalStateIfLinkedUserDiffers(nextUserId: account.userId)

        self.globalErrorMessage = ""
        return CloudWorkspaceLinkContext(
            userId: account.userId,
            email: account.email,
            apiBaseUrl: verifiedContext.apiBaseUrl,
            credentials: verifiedContext.credentials,
            workspaces: account.workspaces
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
                bearerToken: linkContext.credentials.idToken
            )
        )
        self.globalErrorMessage = ""
    }

    func disconnectCloudAccount() throws {
        try self.resetLocalStateForCloudIdentityChange()
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
            try await self.restoreCloudLinkFromStoredCredentials()
            return
        }

        self.syncStatus = .syncing
        do {
            let syncResult = try await self.withAuthenticatedCloudSession { session in
                try await self.runLinkedSync(linkedSession: session)
            }
            let now = Date()
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: now
            )
        } catch {
            self.syncStatus = self.cloudSettings?.cloudState == .linked
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
            let hasStoredCredentials = try self.cloudRuntime.loadCredentials() != nil
            if self.cloudRuntime.activeCloudSession() == nil && hasStoredCredentials == false {
                if self.cloudSettings?.cloudState == .linked {
                    try self.disconnectCloudAccount()
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

    func authenticatedCloudSessionForAI() async throws -> CloudLinkedSession {
        try await self.prepareAuthenticatedCloudSessionForAI()
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
                bearerToken: deleteResult.0.bearerToken
            )
            let database = try requireLocalDatabase(database: self.database)
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
                try await self.performCloudLink(linkedSession: linkedSession)
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
                try await self.performCloudLink(linkedSession: linkedSession)
            }
        } catch {
            if self.isCloudAccountDeletedError(error) {
                self.handleRemoteAccountDeletedCleanup()
                return
            }

            if self.isCloudAuthorizationError(error) {
                try self.disconnectCloudAccount()
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
                try self.disconnectCloudAccount()
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
        try context.database.clearCloudSyncState(workspaceId: context.workspaceId)
        try context.database.updateCloudSettings(
            cloudState: .disconnected,
            linkedUserId: nil,
            linkedWorkspaceId: nil,
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
