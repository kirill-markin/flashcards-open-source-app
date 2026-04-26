import Foundation

@MainActor
struct CloudSyncOperationState {
    let id: String
    let task: Task<CloudSyncResult, Error>
}

@MainActor
struct CloudSessionRuntimeState {
    var activeCloudSession: CloudLinkedSession?
    var activeCloudSyncTask: CloudSyncOperationState?
    var pendingCloudResync: Bool
    var activeCloudLinkTask: CloudLinkTransitionState?
    var activeWorkspaceCompletionTask: CloudWorkspaceCompletionState?
    var activeAIChatSessionPreparation: AIChatSessionPreparationState?
}

@MainActor
final class CloudSessionRuntime {
    private let cloudAuthService: any CloudAuthServing
    private let cloudSyncService: (any CloudSyncServing)?
    private let credentialStore: any CredentialStoring
    private(set) var state: CloudSessionRuntimeState

    init(
        cloudAuthService: any CloudAuthServing,
        cloudSyncService: (any CloudSyncServing)?,
        credentialStore: any CredentialStoring
    ) {
        self.cloudAuthService = cloudAuthService
        self.cloudSyncService = cloudSyncService
        self.credentialStore = credentialStore
        self.state = CloudSessionRuntimeState(
            activeCloudSession: nil,
            activeCloudSyncTask: nil,
            pendingCloudResync: false,
            activeCloudLinkTask: nil,
            activeWorkspaceCompletionTask: nil,
            activeAIChatSessionPreparation: nil
        )
    }

    func sendCode(email: String, configuration: CloudServiceConfiguration) async throws -> CloudSendCodeResult {
        try await self.cloudAuthService.sendCode(
            email: email,
            authBaseUrl: configuration.authBaseUrl
        )
    }

    func verifyCode(
        challenge: CloudOtpChallenge,
        code: String,
        configuration: CloudServiceConfiguration
    ) async throws -> CloudVerifiedAuthContext {
        let credentials = try await self.cloudAuthService.verifyCode(
            challenge: challenge,
            code: code,
            authBaseUrl: configuration.authBaseUrl
        )

        return CloudVerifiedAuthContext(
            apiBaseUrl: configuration.apiBaseUrl,
            credentials: credentials
        )
    }

    func fetchCloudAccount(
        verifiedContext: CloudVerifiedAuthContext
    ) async throws -> CloudAccountSnapshot {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.cloudSyncService)
        return try await cloudSyncService.fetchCloudAccount(
            apiBaseUrl: verifiedContext.apiBaseUrl,
            bearerToken: verifiedContext.credentials.idToken
        )
    }

    func selectOrCreateWorkspace(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection,
        localWorkspaceName: String
    ) async throws -> CloudWorkspaceSummary {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.cloudSyncService)

        switch selection {
        case .existing(let workspaceId):
            return try await cloudSyncService.selectWorkspace(
                apiBaseUrl: linkContext.apiBaseUrl,
                bearerToken: linkContext.credentials.idToken,
                workspaceId: workspaceId
            )
        case .createNew:
            return try await cloudSyncService.createWorkspace(
                apiBaseUrl: linkContext.apiBaseUrl,
                bearerToken: linkContext.credentials.idToken,
                name: localWorkspaceName
            )
        }
    }

    func saveCredentials(credentials: StoredCloudCredentials) throws {
        try self.credentialStore.saveCredentials(credentials: credentials)
    }

    func clearCredentials() throws {
        try self.credentialStore.clearCredentials()
    }

    func loadCredentials() throws -> StoredCloudCredentials? {
        try self.credentialStore.loadCredentials()
    }

    func refreshCloudCredentials(
        forceRefresh: Bool,
        configuration: CloudServiceConfiguration,
        now: Date
    ) async throws -> StoredCloudCredentials {
        guard let storedCredentials = try self.credentialStore.loadCredentials() else {
            throw LocalStoreError.uninitialized("Cloud credentials are unavailable")
        }

        if forceRefresh == false
            && shouldRefreshCloudIdToken(
                idTokenExpiresAt: storedCredentials.idTokenExpiresAt,
                now: now
            ) == false {
            return storedCredentials
        }

        let refreshedToken = try await self.cloudAuthService.refreshIdToken(
            refreshToken: storedCredentials.refreshToken,
            authBaseUrl: configuration.authBaseUrl
        )
        let updatedCredentials = StoredCloudCredentials(
            refreshToken: storedCredentials.refreshToken,
            idToken: refreshedToken.idToken,
            idTokenExpiresAt: refreshedToken.idTokenExpiresAt
        )
        try self.credentialStore.saveCredentials(credentials: updatedCredentials)

        if let activeCloudSession = self.state.activeCloudSession {
            self.state.activeCloudSession = CloudLinkedSession(
                userId: activeCloudSession.userId,
                workspaceId: activeCloudSession.workspaceId,
                email: activeCloudSession.email,
                configurationMode: activeCloudSession.configurationMode,
                apiBaseUrl: activeCloudSession.apiBaseUrl,
                authorization: .bearer(updatedCredentials.idToken)
            )
        }

        return updatedCredentials
    }

    func prepareAuthenticatedCloudSessionForAI(
        restoreCloudLink: @escaping @MainActor () async throws -> Void,
        resolveSession: @escaping @MainActor () async throws -> CloudLinkedSession
    ) async throws -> CloudLinkedSession {
        if let activePreparation = self.state.activeAIChatSessionPreparation {
            return try await activePreparation.task.value
        }

        let needsRestore = self.state.activeCloudSession == nil

        let preparation = AIChatSessionPreparationState(
            id: UUID().uuidString.lowercased(),
            task: Task { @MainActor in
                if needsRestore {
                    try await restoreCloudLink()
                }

                return try await resolveSession()
            }
        )
        self.state.activeAIChatSessionPreparation = preparation

        do {
            let session = try await preparation.task.value
            if self.state.activeAIChatSessionPreparation?.id == preparation.id {
                self.state.activeAIChatSessionPreparation = nil
            }
            return session
        } catch {
            if self.state.activeAIChatSessionPreparation?.id == preparation.id {
                self.state.activeAIChatSessionPreparation = nil
            }
            throw error
        }
    }

    func runCloudLinkTransition(
        operation: @escaping @MainActor () async throws -> Void
    ) async throws {
        if let activeCloudLinkTask = self.state.activeCloudLinkTask {
            try await activeCloudLinkTask.task.value
            return
        }

        let linkTransition = CloudLinkTransitionState(
            id: UUID().uuidString.lowercased(),
            task: Task { @MainActor in
                try await operation()
            }
        )
        self.state.activeCloudLinkTask = linkTransition

        do {
            try await linkTransition.task.value
            if self.state.activeCloudLinkTask?.id == linkTransition.id {
                self.state.activeCloudLinkTask = nil
            }
        } catch {
            if self.state.activeCloudLinkTask?.id == linkTransition.id {
                self.state.activeCloudLinkTask = nil
            }
            throw error
        }
    }

    func runWorkspaceCompletion(
        operation: @escaping @MainActor () async throws -> CloudWorkspaceSummary
    ) async throws -> CloudWorkspaceSummary {
        if let activeWorkspaceCompletionTask = self.state.activeWorkspaceCompletionTask {
            return try await activeWorkspaceCompletionTask.task.value
        }

        let workspaceCompletion = CloudWorkspaceCompletionState(
            id: UUID().uuidString.lowercased(),
            task: Task { @MainActor in
                try await operation()
            }
        )
        self.state.activeWorkspaceCompletionTask = workspaceCompletion

        do {
            let workspace = try await workspaceCompletion.task.value
            if self.state.activeWorkspaceCompletionTask?.id == workspaceCompletion.id {
                self.state.activeWorkspaceCompletionTask = nil
            }
            return workspace
        } catch {
            if self.state.activeWorkspaceCompletionTask?.id == workspaceCompletion.id {
                self.state.activeWorkspaceCompletionTask = nil
            }
            throw error
        }
    }

    func waitForActiveCloudLinkTransitionIfNeeded() async throws -> Bool {
        guard let activeCloudLinkTask = self.state.activeCloudLinkTask else {
            return false
        }

        try await activeCloudLinkTask.task.value
        return true
    }

    func waitForActiveCloudCompletionIfNeeded() async throws -> Bool {
        if let activeWorkspaceCompletionTask = self.state.activeWorkspaceCompletionTask {
            _ = try await activeWorkspaceCompletionTask.task.value
            return true
        }

        if let activeCloudLinkTask = self.state.activeCloudLinkTask {
            try await activeCloudLinkTask.task.value
            return true
        }

        return false
    }

    func storedLinkedSession(
        cloudSettings: CloudSettings?,
        configuration: CloudServiceConfiguration,
        bearerToken: String
    ) throws -> CloudLinkedSession {
        guard let cloudSettings else {
            throw LocalStoreError.uninitialized("Cloud settings are unavailable")
        }
        guard cloudSettings.cloudState == .linked else {
            throw LocalStoreError.uninitialized("Cloud account is not linked")
        }
        guard let linkedUserId = cloudSettings.linkedUserId, linkedUserId.isEmpty == false else {
            throw LocalStoreError.uninitialized("Linked user is unavailable")
        }
        let activeWorkspaceId = cloudSettings.activeWorkspaceId ?? cloudSettings.linkedWorkspaceId
        guard let activeWorkspaceId, activeWorkspaceId.isEmpty == false else {
            throw LocalStoreError.uninitialized("Linked workspace is unavailable")
        }

        let linkedSession = CloudLinkedSession(
            userId: linkedUserId,
            workspaceId: activeWorkspaceId,
            email: cloudSettings.linkedEmail,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl,
            authorization: .bearer(bearerToken)
        )
        self.state.activeCloudSession = linkedSession
        return linkedSession
    }

    func sessionWithUpdatedBearerToken(
        credentials: StoredCloudCredentials
    ) throws -> CloudLinkedSession {
        guard let activeCloudSession = self.state.activeCloudSession else {
            throw LocalStoreError.uninitialized("Cloud session is unavailable")
        }

        let nextSession = CloudLinkedSession(
            userId: activeCloudSession.userId,
            workspaceId: activeCloudSession.workspaceId,
            email: activeCloudSession.email,
            configurationMode: activeCloudSession.configurationMode,
            apiBaseUrl: activeCloudSession.apiBaseUrl,
            authorization: .bearer(credentials.idToken)
        )
        self.state.activeCloudSession = nextSession
        return nextSession
    }

    func setActiveCloudSession(linkedSession: CloudLinkedSession) {
        self.state.activeCloudSession = linkedSession
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.cloudSyncService)
        return try await self.runCloudSyncTask {
            try await cloudSyncService.runLinkedSync(linkedSession: linkedSession)
        }
    }

    func runFreshLinkedSyncAfterActiveSyncSettles(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.cloudSyncService)
        await self.waitForActiveCloudSyncToSettle()
        return try await self.startCloudSyncTask {
            try await cloudSyncService.runLinkedSync(linkedSession: linkedSession)
        }
    }

    private func runCloudSyncTask(
        operation: @escaping @MainActor () async throws -> CloudSyncResult
    ) async throws -> CloudSyncResult {
        if let activeCloudSyncTask = self.state.activeCloudSyncTask {
            self.state.pendingCloudResync = true
            return try await activeCloudSyncTask.task.value
        }

        return try await self.startCloudSyncTask(operation: operation)
    }

    private func startCloudSyncTask(
        operation: @escaping @MainActor () async throws -> CloudSyncResult
    ) async throws -> CloudSyncResult {
        let syncOperation = CloudSyncOperationState(
            id: UUID().uuidString.lowercased(),
            task: Task { @MainActor in
                try await self.runCloudSyncLoop(operation: operation)
            }
        )
        self.state.activeCloudSyncTask = syncOperation

        do {
            let syncResult = try await syncOperation.task.value
            self.clearActiveCloudSyncTaskIfCurrent(id: syncOperation.id)
            return syncResult
        } catch {
            self.clearActiveCloudSyncTaskIfCurrent(id: syncOperation.id)
            throw error
        }
    }

    private func runCloudSyncLoop(
        operation: @escaping @MainActor () async throws -> CloudSyncResult
    ) async throws -> CloudSyncResult {
        var accumulatedResult = CloudSyncResult.noChanges
        while true {
            self.state.pendingCloudResync = false
            let syncResult = try await operation()
            accumulatedResult = accumulatedResult.merging(syncResult)

            if self.state.pendingCloudResync == false {
                break
            }
        }

        return accumulatedResult
    }

    private func waitForActiveCloudSyncToSettle() async {
        while let activeCloudSyncTask = self.state.activeCloudSyncTask {
            do {
                _ = try await activeCloudSyncTask.task.value
            } catch {
                logFlashcardsError(
                    domain: "cloud",
                    action: "active_sync_settled_before_fresh_sync",
                    metadata: [
                        "message": Flashcards.errorMessage(error: error),
                    ]
                )
            }
            self.clearActiveCloudSyncTaskIfCurrent(id: activeCloudSyncTask.id)
        }
    }

    private func clearActiveCloudSyncTaskIfCurrent(id: String) {
        guard self.state.activeCloudSyncTask?.id == id else {
            return
        }

        self.state.activeCloudSyncTask = nil
        self.state.pendingCloudResync = false
    }

    func isCloudAuthorizationError(_ error: Error) -> Bool {
        if let syncError = error as? CloudSyncError, syncError.statusCode == 401 {
            return true
        }

        if let authError = error as? CloudAuthError, authError.statusCode == 401 {
            return true
        }

        return false
    }

    func isCloudAccountDeletedError(_ error: Error) -> Bool {
        if let syncError = error as? CloudSyncError {
            switch syncError {
            case .invalidResponse(let details, let statusCode):
                return statusCode == 410 && details.code == "ACCOUNT_DELETED"
            case .invalidBaseUrl:
                return false
            }
        }

        return false
    }

    func disconnectSession() {
        self.state.activeCloudSession = nil
    }

    func cancelForWorkspaceSwitch() {
        self.state.activeCloudSyncTask?.task.cancel()
        self.state.activeCloudSyncTask = nil
        self.state.pendingCloudResync = false
        self.state.activeAIChatSessionPreparation?.task.cancel()
        self.state.activeAIChatSessionPreparation = nil
    }

    func cancelForAccountDeletion() {
        self.state.activeCloudLinkTask?.task.cancel()
        self.state.activeCloudLinkTask = nil
        self.state.activeCloudSyncTask?.task.cancel()
        self.state.activeCloudSyncTask = nil
        self.state.pendingCloudResync = false
        self.state.activeAIChatSessionPreparation?.task.cancel()
        self.state.activeAIChatSessionPreparation = nil
        self.state.activeCloudSession = nil
        self.cloudAuthService.resetChallengeSession()
    }

    func activeCloudSession() -> CloudLinkedSession? {
        self.state.activeCloudSession
    }
}
