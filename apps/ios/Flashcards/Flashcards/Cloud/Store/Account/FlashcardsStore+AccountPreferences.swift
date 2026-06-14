import Foundation

private let accountPreferencesCacheUserDefaultsKey: String = "account-preferences-cache"

private struct PersistedAccountPreferencesCache: Codable, Hashable {
    var preferencesByIdentityKey: [String: AccountPreferences]
}

private func makeAccountPreferencesIdentityKey(
    userId: String,
    configurationMode: CloudServiceConfigurationMode,
    apiBaseUrl: String
) -> String {
    "\(configurationMode.rawValue)|\(apiBaseUrl)|\(userId)"
}

@MainActor
extension FlashcardsStore {
    var canPersistAccountPreferences: Bool {
        switch self.cloudSettings?.cloudState {
        case .guest, .linked:
            return true
        case .disconnected, .linkingReady, nil:
            return false
        }
    }

    func refreshCloudAccountContextIfActive() async throws {
        guard self.isAccountPreferencesUpdateInFlight == false else {
            return
        }
        guard let session = try await self.cloudSessionForAccountContextRefresh() else {
            return
        }
        let refreshGeneration = self.accountPreferencesRefreshGeneration
        let refreshIdentityKey = makeAccountPreferencesIdentityKey(
            userId: session.userId,
            configurationMode: session.configurationMode,
            apiBaseUrl: session.apiBaseUrl
        )

        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let accountContext = try await cloudSyncService.fetchCloudAccountContext(
            apiBaseUrl: session.apiBaseUrl,
            authorizationHeader: session.authorizationHeaderValue
        )
        try self.applyRefreshedCloudAccountContext(
            accountContext: accountContext,
            session: session,
            refreshGeneration: refreshGeneration,
            refreshIdentityKey: refreshIdentityKey
        )
    }

    func triggerCloudAccountContextRefreshIfActive(surfacesGlobalErrorMessage: Bool) {
        Task { @MainActor in
            do {
                try await self.refreshCloudAccountContextIfActive()
            } catch {
                if surfacesGlobalErrorMessage {
                    self.globalErrorMessage = Flashcards.errorMessage(error: error)
                }
            }
        }
    }

    func updateReviewReactionAnimationsEnabled(isEnabled: Bool) async throws {
        let previousPreferences = self.accountPreferences
        let rollbackIdentityKey = self.accountPreferencesIdentityKey
        let nextPreferences = AccountPreferences(reviewReactionAnimationsEnabled: isEnabled)
        self.accountPreferencesRefreshGeneration += 1
        let updateGeneration = self.accountPreferencesRefreshGeneration
        self.accountPreferences = nextPreferences
        self.isAccountPreferencesUpdateInFlight = true

        do {
            let updateResult = try await self.updateCloudAccountPreferences(
                preferences: nextPreferences
            )
            if self.isCurrentAccountPreferencesUpdate(
                identityKey: rollbackIdentityKey,
                updateGeneration: updateGeneration
            ) {
                self.applyCloudAccountPreferences(preferences: updateResult.preferences, session: updateResult.session)
                self.isAccountPreferencesUpdateInFlight = false
                self.triggerCloudAccountContextRefreshIfActive(surfacesGlobalErrorMessage: false)
            }
        } catch {
            if self.isCurrentAccountPreferencesUpdate(
                identityKey: rollbackIdentityKey,
                updateGeneration: updateGeneration
            ) {
                self.accountPreferences = previousPreferences
                self.isAccountPreferencesUpdateInFlight = false
            }
            throw error
        }
    }

    func applyCloudAccountPreferences(account: CloudAccountSnapshot) {
        guard let configuration = try? self.currentCloudServiceConfiguration() else {
            return
        }

        let identityKey = makeAccountPreferencesIdentityKey(
            userId: account.userId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        guard self.currentAccountPreferencesIdentityKey() == identityKey else {
            return
        }

        self.applyCloudAccountPreferences(preferences: account.preferences, identityKey: identityKey)
    }

    func applyCloudAccountPreferences(
        preferences: AccountPreferences,
        linkContext: CloudWorkspaceLinkContext
    ) {
        guard let configuration = try? self.currentCloudServiceConfiguration(),
            configuration.apiBaseUrl == linkContext.apiBaseUrl else {
            return
        }

        self.applyCloudAccountPreferences(
            preferences: preferences,
            userId: linkContext.userId,
            configurationMode: configuration.mode,
            apiBaseUrl: linkContext.apiBaseUrl
        )
    }

    func applyCloudAccountPreferences(
        preferences: AccountPreferences,
        userId: String,
        configurationMode: CloudServiceConfigurationMode,
        apiBaseUrl: String
    ) {
        let identityKey = makeAccountPreferencesIdentityKey(
            userId: userId,
            configurationMode: configurationMode,
            apiBaseUrl: apiBaseUrl
        )
        guard self.currentAccountPreferencesIdentityKey() == identityKey else {
            return
        }
        self.applyCloudAccountPreferences(preferences: preferences, identityKey: identityKey)
    }

    func reloadCachedAccountPreferencesForCurrentIdentity() {
        let previousIdentityKey = self.accountPreferencesIdentityKey
        guard let identityKey = self.currentAccountPreferencesIdentityKey() else {
            self.accountPreferencesIdentityKey = nil
            self.accountPreferences = makeDefaultAccountPreferences()
            return
        }

        self.accountPreferencesIdentityKey = identityKey
        let cache = self.loadPersistedAccountPreferencesCache()
        if let preferences = cache.preferencesByIdentityKey[identityKey] {
            self.accountPreferences = preferences
        } else if previousIdentityKey != identityKey {
            self.accountPreferences = makeDefaultAccountPreferences()
        }
    }

    func resetAccountPreferencesForCloudIdentityReset() {
        self.accountPreferencesIdentityKey = nil
        self.accountPreferencesRefreshGeneration += 1
        self.isAccountPreferencesUpdateInFlight = false
        self.accountPreferences = makeDefaultAccountPreferences()
        self.userDefaults.removeObject(forKey: accountPreferencesCacheUserDefaultsKey)
        self.communityProfileRefreshGeneration += 1
        self.isCommunityProfileUpdateInFlight = false
        self.communityPublicProfile = nil
    }

    private func updateCloudAccountPreferences(
        preferences: AccountPreferences
    ) async throws -> (preferences: AccountPreferences, session: CloudLinkedSession) {
        switch self.cloudSettings?.cloudState {
        case .linked:
            _ = try await self.linkedCloudSessionForAccountContextRefresh()
            return try await self.withAuthenticatedCloudSession { session in
                try await self.updateCloudAccountPreferences(preferences: preferences, session: session)
            }
        case .guest:
            let session = try self.guestCloudSessionForAccountContextRefresh()
            return try await self.updateCloudAccountPreferences(preferences: preferences, session: session)
        case .disconnected, .linkingReady, nil:
            throw LocalStoreError.uninitialized("Cloud account is unavailable")
        }
    }

    private func isCurrentAccountPreferencesUpdate(
        identityKey: String?,
        updateGeneration: Int
    ) -> Bool {
        self.accountPreferencesRefreshGeneration == updateGeneration
            && self.accountPreferencesIdentityKey == identityKey
    }

    private func updateCloudAccountPreferences(
        preferences: AccountPreferences,
        session: CloudLinkedSession
    ) async throws -> (preferences: AccountPreferences, session: CloudLinkedSession) {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let updatedPreferences = try await cloudSyncService.updateAccountPreferences(
            apiBaseUrl: session.apiBaseUrl,
            authorizationHeader: session.authorizationHeaderValue,
            preferences: preferences
        )
        return (updatedPreferences, session)
    }

    func cloudSessionForAccountContextRefresh() async throws -> CloudLinkedSession? {
        try self.throwIfCloudCredentialRecoveryRequired()
        switch self.cloudSettings?.cloudState {
        case .linked:
            return try await self.linkedCloudSessionForAccountContextRefresh()
        case .guest:
            return try self.guestCloudSessionForAccountContextRefresh()
        case .disconnected, .linkingReady, nil:
            return nil
        }
    }

    private func linkedCloudSessionForAccountContextRefresh() async throws -> CloudLinkedSession {
        if try self.markLinkedCredentialRecoveryForMissingCredentialsIfNeeded(detectedAt: Date()) {
            try self.throwIfCloudCredentialRecoveryRequired()
        }

        return try await self.withStoredAuthenticatedCredentials { credentials, configuration in
            let cloudSettings = try requireCloudSettings(cloudSettings: self.cloudSettings)
            guard cloudSettings.cloudState == .linked else {
                throw LocalStoreError.uninitialized("Cloud account is not linked")
            }
            guard let linkedUserId = cloudSettings.linkedUserId, linkedUserId.isEmpty == false else {
                throw LocalStoreError.uninitialized("Linked user is unavailable")
            }
            let workspaceId = cloudSettings.activeWorkspaceId ?? cloudSettings.linkedWorkspaceId
            guard let workspaceId, workspaceId.isEmpty == false else {
                throw LocalStoreError.uninitialized("Linked workspace is unavailable")
            }

            let session = CloudLinkedSession(
                userId: linkedUserId,
                workspaceId: workspaceId,
                email: cloudSettings.linkedEmail,
                configurationMode: configuration.mode,
                apiBaseUrl: configuration.apiBaseUrl,
                authorization: .bearer(credentials.idToken)
            )
            self.cloudRuntime.setActiveCloudSession(linkedSession: session)
            return session
        }
    }

    private func guestCloudSessionForAccountContextRefresh() throws -> CloudLinkedSession {
        if try self.markCloudCredentialRecoveryForMissingPersistedCredentialsIfNeeded(detectedAt: Date()) {
            try self.throwIfCloudCredentialRecoveryRequired()
        }
        guard let storedGuestSession = try self.loadUsableGuestSessionForCurrentConfiguration() else {
            throw LocalStoreError.uninitialized("Guest cloud session is unavailable")
        }

        let session = CloudLinkedSession(
            userId: storedGuestSession.userId,
            workspaceId: storedGuestSession.workspaceId,
            email: nil,
            configurationMode: storedGuestSession.configurationMode,
            apiBaseUrl: storedGuestSession.apiBaseUrl,
            authorization: .guest(storedGuestSession.guestToken)
        )
        self.cloudRuntime.setActiveCloudSession(linkedSession: session)
        return session
    }

    private func applyRefreshedCloudAccountContext(
        accountContext: CloudAccountContext,
        session: CloudLinkedSession,
        refreshGeneration: Int,
        refreshIdentityKey: String
    ) throws {
        guard refreshGeneration == self.accountPreferencesRefreshGeneration,
            self.accountPreferencesIdentityKey == refreshIdentityKey else {
            return
        }

        guard accountContext.userId == session.userId else {
            switch session.authorization {
            case .bearer:
                try self.resetLocalStateForCloudIdentityChange()
                return
            case .guest:
                throw LocalStoreError.validation("Guest cloud session resolved to a different account")
            }
        }

        guard self.isAccountPreferencesUpdateInFlight == false else {
            return
        }

        self.applyCloudAccountPreferences(preferences: accountContext.preferences, session: session)
    }

    private func currentAccountPreferencesIdentityKey() -> String? {
        guard let cloudSettings = self.cloudSettings else {
            return nil
        }
        guard cloudSettings.cloudState == .guest || cloudSettings.cloudState == .linked else {
            return nil
        }
        guard let userId = cloudSettings.linkedUserId, userId.isEmpty == false else {
            return nil
        }
        guard let configuration = try? self.currentCloudServiceConfiguration() else {
            return nil
        }

        return makeAccountPreferencesIdentityKey(
            userId: userId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
    }

    private func applyCloudAccountPreferences(
        preferences: AccountPreferences,
        session: CloudLinkedSession
    ) {
        let identityKey = makeAccountPreferencesIdentityKey(
            userId: session.userId,
            configurationMode: session.configurationMode,
            apiBaseUrl: session.apiBaseUrl
        )
        self.applyCloudAccountPreferences(preferences: preferences, identityKey: identityKey)
    }

    private func applyCloudAccountPreferences(
        preferences: AccountPreferences,
        identityKey: String
    ) {
        self.accountPreferences = preferences
        self.accountPreferencesIdentityKey = identityKey
        self.cacheAccountPreferences(preferences: preferences, identityKey: identityKey)
    }

    private func loadPersistedAccountPreferencesCache() -> PersistedAccountPreferencesCache {
        guard let data = self.userDefaults.data(forKey: accountPreferencesCacheUserDefaultsKey) else {
            return PersistedAccountPreferencesCache(preferencesByIdentityKey: [:])
        }

        do {
            return try self.decoder.decode(PersistedAccountPreferencesCache.self, from: data)
        } catch {
            self.captureAccountPreferencesSilentFailure(
                error: error,
                action: "account_preferences_cache_load",
                stage: "decode"
            )
            self.userDefaults.removeObject(forKey: accountPreferencesCacheUserDefaultsKey)
            return PersistedAccountPreferencesCache(preferencesByIdentityKey: [:])
        }
    }

    private func savePersistedAccountPreferencesCache(_ cache: PersistedAccountPreferencesCache) {
        do {
            let data = try self.encoder.encode(cache)
            self.userDefaults.set(data, forKey: accountPreferencesCacheUserDefaultsKey)
        } catch {
            self.captureAccountPreferencesSilentFailure(
                error: error,
                action: "account_preferences_cache_save",
                stage: "encode"
            )
            self.userDefaults.removeObject(forKey: accountPreferencesCacheUserDefaultsKey)
        }
    }

    private func cacheAccountPreferences(
        preferences: AccountPreferences,
        identityKey: String
    ) {
        var cache = self.loadPersistedAccountPreferencesCache()
        cache.preferencesByIdentityKey[identityKey] = preferences
        self.savePersistedAccountPreferencesCache(cache)
    }

    private func captureAccountPreferencesSilentFailure(
        error: Error,
        action: String,
        stage: String
    ) {
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: IOSObservationScope(
                feature: .cloudAuth,
                userId: self.cloudSettings?.linkedUserId,
                workspaceId: self.workspace?.workspaceId,
                requestId: nil,
                clientRequestId: nil,
                sessionId: nil,
                runId: nil,
                cloudState: self.cloudSettings?.cloudState,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            ),
            action: action,
            stage: stage,
            statusCode: nil,
            backendCode: nil,
            requestId: nil
        )
    }
}
