import Foundation

@MainActor
extension FlashcardsStore {
    func sendCloudSignInCode(email: String) async throws -> CloudOtpChallenge {
        let configuration = try loadCloudServiceConfiguration()
        let challenge = try await self.cloudRuntime.sendCode(email: email, configuration: configuration)
        self.globalErrorMessage = ""
        return challenge
    }

    func verifyCloudOtp(challenge: CloudOtpChallenge, code: String) async throws -> CloudVerifiedAuthContext {
        let configuration = try loadCloudServiceConfiguration()
        self.globalErrorMessage = ""
        return try await self.cloudRuntime.verifyCode(
            challenge: challenge,
            code: code,
            configuration: configuration
        )
    }

    func prepareCloudLink(verifiedContext: CloudVerifiedAuthContext) async throws -> CloudWorkspaceLinkContext {
        let account = try await self.cloudRuntime.fetchCloudAccount(verifiedContext: verifiedContext)

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

        try self.cloudRuntime.saveCredentials(credentials: linkContext.credentials)
        try await self.finishCloudLink(
            linkedSession: CloudLinkedSession(
                userId: linkContext.userId,
                workspaceId: linkedWorkspace.workspaceId,
                email: linkContext.email,
                apiBaseUrl: linkContext.apiBaseUrl,
                bearerToken: linkContext.credentials.idToken
            )
        )
        self.globalErrorMessage = ""
    }

    func disconnectCloudAccount() throws {
        let database = try requireLocalDatabase(database: self.database)
        self.cloudRuntime.cancelForAccountDeletion()
        try self.cloudRuntime.clearCredentials()
        try database.updateCloudSettings(
            cloudState: .disconnected,
            linkedUserId: nil,
            linkedWorkspaceId: nil,
            linkedEmail: nil
        )
        self.syncStatus = .idle
        self.lastSuccessfulCloudSyncAt = nil
        self.globalErrorMessage = ""
        try self.reload()
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
            _ = try await self.withAuthenticatedCloudSession { session in
                try await self.runLinkedSync(linkedSession: session)
                return session
            }
            self.lastSuccessfulCloudSyncAt = currentIsoTimestamp()
            self.syncStatus = .idle
            self.globalErrorMessage = ""
            try self.reload()
        } catch {
            self.syncStatus = self.cloudSettings?.cloudState == .linked
                ? .failed(message: localizedMessage(error: error))
                : .idle
            self.globalErrorMessage = localizedMessage(error: error)
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

            self.globalErrorMessage = localizedMessage(error: error)
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
                    "message": localizedMessage(error: error),
                    "selectedTab": String(describing: self.selectedTab),
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
            let needsBootstrap = self.cloudSettings?.cloudState != .linked
                || self.cloudSettings?.linkedWorkspaceId != linkedSession.workspaceId

            logCloudPhase(
                phase: .linkLocalWorkspace,
                outcome: "start",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId
            )
            try context.database.relinkWorkspace(
                localWorkspaceId: context.workspaceId,
                linkedSession: linkedSession
            )
            if needsBootstrap {
                try context.database.bootstrapOutbox(workspaceId: linkedSession.workspaceId)
            }

            self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            try self.reload()
            didCompleteLocalLink = true
            logCloudPhase(
                phase: .linkLocalWorkspace,
                outcome: "success",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId
            )
            try await self.runLinkedSync(linkedSession: linkedSession)
            self.lastSuccessfulCloudSyncAt = currentIsoTimestamp()
            self.syncStatus = .idle
            self.globalErrorMessage = ""
            logCloudPhase(
                phase: .linkedSync,
                outcome: "success",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId
            )
            try self.reload()
        } catch {
            if didCompleteLocalLink == false {
                logCloudPhase(
                    phase: .linkLocalWorkspace,
                    outcome: "failure",
                    workspaceId: linkedSession.workspaceId,
                    deviceId: self.cloudSettings?.deviceId,
                    errorMessage: localizedMessage(error: error)
                )
            }
            logCloudPhase(
                phase: .linkedSync,
                outcome: "failure",
                workspaceId: linkedSession.workspaceId,
                deviceId: self.cloudSettings?.deviceId,
                errorMessage: localizedMessage(error: error)
            )
            self.syncStatus = .failed(message: localizedMessage(error: error))
            self.globalErrorMessage = localizedMessage(error: error)
            throw error
        }
    }

    func refreshCloudCredentials(forceRefresh: Bool) async throws -> StoredCloudCredentials {
        let configuration = try loadCloudServiceConfiguration()
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

    private func performRestoreCloudLinkFromStoredCredentials() async throws {
        let configuration = try loadCloudServiceConfiguration()

        do {
            let credentials = try await self.refreshCloudCredentials(forceRefresh: false)
            try await self.performCloudLink(
                linkedSession: try self.cloudRuntime.storedLinkedSession(
                    cloudSettings: self.cloudSettings,
                    apiBaseUrl: configuration.apiBaseUrl,
                    bearerToken: credentials.idToken
                )
            )
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
            try await self.performCloudLink(
                linkedSession: try self.cloudRuntime.storedLinkedSession(
                    cloudSettings: self.cloudSettings,
                    apiBaseUrl: configuration.apiBaseUrl,
                    bearerToken: refreshedCredentials.idToken
                )
            )
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

            self.accountDeletionState = .failed(message: localizedMessage(error: error))
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
        let database = try requireLocalDatabase(database: self.database)

        self.reviewRuntime.cancelForAccountDeletion()
        self.cloudRuntime.cancelForAccountDeletion()
        try self.cloudRuntime.clearCredentials()
        self.userDefaults.removeObject(forKey: selectedReviewFilterUserDefaultsKey)
        self.userDefaults.removeObject(forKey: accountDeletionPendingUserDefaultsKey)
        self.aiChatStore.clearHistory()
        try database.resetForAccountDeletion()
        self.syncStatus = .idle
        self.lastSuccessfulCloudSyncAt = nil
        self.globalErrorMessage = ""
        try self.reload()
    }

    func handleRemoteAccountDeletedCleanup() {
        do {
            self.userDefaults.set(true, forKey: accountDeletionPendingUserDefaultsKey)
            try self.completeLocalAccountDeletion()
            self.accountDeletionState = .hidden
            self.accountDeletionSuccessMessage = "Your account has been deleted."
        } catch {
            self.accountDeletionState = .failed(message: localizedMessage(error: error))
        }
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws {
        try await self.cloudRuntime.runLinkedSync(linkedSession: linkedSession)
    }

    func triggerCloudSyncIfLinked() {
        self.extendCloudSyncFastPolling(now: Date())
        Task { @MainActor in
            await self.syncCloudIfLinked()
        }
    }
}
