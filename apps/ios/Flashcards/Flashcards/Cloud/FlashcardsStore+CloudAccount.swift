import Foundation

@MainActor
extension FlashcardsStore {
    func logoutCloudAccount() throws {
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

    func cloudSessionForAI() async throws -> CloudLinkedSession {
        if case .blocked(let message) = self.syncStatus {
            throw LocalStoreError.validation(message)
        }
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
            // After logout/account deletion the stored guest session is gone and
            // the local installation id has already been regenerated. Creating
            // a session here intentionally starts a brand new guest identity.
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

    private func prepareGuestCloudSessionForAI() async throws -> CloudLinkedSession {
        let restoredGuestSession = try await self.restoreGuestCloudSessionIfNeeded(
            trigger: CloudSyncTrigger(
                source: .manualSyncNow,
                now: Date(),
                extendsFastPolling: false,
                allowsVisibleChangeBanner: false,
                surfacesGlobalErrorMessage: true
            )
        )
        return restoredGuestSession.session
    }

    func restoreGuestCloudSessionIfNeeded(
        trigger: CloudSyncTrigger
    ) async throws -> (session: CloudLinkedSession, didRunSync: Bool) {
        let guestSession = try await self.loadOrCreateGuestCloudSession()
        let isAlreadyGuestLinked = self.cloudSettings?.cloudState == .guest
            && self.workspace?.workspaceId == guestSession.workspaceId
            && self.cloudSettings?.linkedUserId == guestSession.userId

        if isAlreadyGuestLinked {
            self.cloudRuntime.setActiveCloudSession(linkedSession: guestSession)
            return (guestSession, false)
        }

        try await self.finishCloudLink(linkedSession: guestSession, trigger: trigger)
        return (guestSession, true)
    }

    func prepareAuthenticatedCloudSessionForAI() async throws -> CloudLinkedSession {
        return try await self.cloudRuntime.prepareAuthenticatedCloudSessionForAI(
            restoreCloudLink: { [weak self] in
                guard let self else {
                    throw LocalStoreError.uninitialized("Flashcards store is unavailable")
                }

                try await self.restoreCloudLinkFromStoredCredentials(trigger: self.manualCloudSyncTrigger(now: Date()))
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

    func restoreCloudLinkFromStoredCredentials(trigger: CloudSyncTrigger) async throws {
        try await self.cloudRuntime.runCloudLinkTransition { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            try await self.performRestoreCloudLinkFromStoredCredentials(trigger: trigger)
        }
    }

    /**
     Restores the linked cloud session from persisted credentials. When the
     stored workspace already matches the local workspace, it reuses the
     non-blocking restore path; otherwise it falls back to the full relink flow.
     */
    private func performRestoreCloudLinkFromStoredCredentials(trigger: CloudSyncTrigger) async throws {
        do {
            try await self.withStoredAuthenticatedCredentials { credentials, configuration in
                try await self.restoreLinkedSessionFromCredentials(
                    credentials: credentials,
                    configuration: configuration,
                    trigger: trigger
                )
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
            return try await self.withStoredAuthenticatedCredentials { credentials, _ in
                let linkedSession = try self.cloudRuntime.sessionWithUpdatedBearerToken(credentials: credentials)
                return try await operation(linkedSession)
            }
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
}
