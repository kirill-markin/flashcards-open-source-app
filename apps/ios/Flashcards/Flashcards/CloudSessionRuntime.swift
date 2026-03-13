import Foundation

@MainActor
struct CloudSessionRuntimeState {
    var activeCloudSession: CloudLinkedSession?
    var activeCloudSyncTask: Task<Void, Error>?
    var pendingCloudResync: Bool
    var activeAIChatSessionPreparation: AIChatSessionPreparationState?
}

@MainActor
struct CloudSessionRuntime {
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
            activeAIChatSessionPreparation: nil
        )
    }

    func sendCode(email: String, configuration: CloudServiceConfiguration) async throws -> CloudOtpChallenge {
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

    mutating func saveCredentials(credentials: StoredCloudCredentials) throws {
        try self.credentialStore.saveCredentials(credentials: credentials)
    }

    mutating func clearCredentials() throws {
        try self.credentialStore.clearCredentials()
    }

    func loadCredentials() throws -> StoredCloudCredentials? {
        try self.credentialStore.loadCredentials()
    }

    mutating func refreshCloudCredentials(
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
                apiBaseUrl: activeCloudSession.apiBaseUrl,
                bearerToken: updatedCredentials.idToken
            )
        }

        return updatedCredentials
    }

    mutating func prepareAuthenticatedCloudSessionForAI(
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

    mutating func storedLinkedSession(
        cloudSettings: CloudSettings?,
        apiBaseUrl: String,
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
        guard let linkedWorkspaceId = cloudSettings.linkedWorkspaceId, linkedWorkspaceId.isEmpty == false else {
            throw LocalStoreError.uninitialized("Linked workspace is unavailable")
        }

        let linkedSession = CloudLinkedSession(
            userId: linkedUserId,
            workspaceId: linkedWorkspaceId,
            email: cloudSettings.linkedEmail,
            apiBaseUrl: apiBaseUrl,
            bearerToken: bearerToken
        )
        self.state.activeCloudSession = linkedSession
        return linkedSession
    }

    mutating func sessionWithUpdatedBearerToken(
        credentials: StoredCloudCredentials
    ) throws -> CloudLinkedSession {
        guard let activeCloudSession = self.state.activeCloudSession else {
            throw LocalStoreError.uninitialized("Cloud session is unavailable")
        }

        let nextSession = CloudLinkedSession(
            userId: activeCloudSession.userId,
            workspaceId: activeCloudSession.workspaceId,
            email: activeCloudSession.email,
            apiBaseUrl: activeCloudSession.apiBaseUrl,
            bearerToken: credentials.idToken
        )
        self.state.activeCloudSession = nextSession
        return nextSession
    }

    mutating func setActiveCloudSession(linkedSession: CloudLinkedSession) {
        self.state.activeCloudSession = linkedSession
    }

    mutating func runLinkedSync(linkedSession: CloudLinkedSession) async throws {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.cloudSyncService)

        if let activeCloudSyncTask = self.state.activeCloudSyncTask {
            self.state.pendingCloudResync = true
            try await activeCloudSyncTask.value
            return
        }

        while true {
            self.state.pendingCloudResync = false
            let syncTask = Task { @MainActor in
                try await cloudSyncService.runLinkedSync(linkedSession: linkedSession)
            }
            self.state.activeCloudSyncTask = syncTask

            do {
                try await syncTask.value
                self.state.activeCloudSyncTask = nil
            } catch {
                self.state.activeCloudSyncTask = nil
                throw error
            }

            if self.state.pendingCloudResync == false {
                break
            }
        }
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

    mutating func disconnectSession() {
        self.state.activeCloudSession = nil
    }

    mutating func cancelForAccountDeletion() {
        self.state.activeCloudSyncTask?.cancel()
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
