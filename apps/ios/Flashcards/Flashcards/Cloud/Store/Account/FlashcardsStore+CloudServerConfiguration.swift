import Foundation

@MainActor
extension FlashcardsStore {
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

    func shouldValidateEmptyRemoteWorkspaceBeforeBootstrap() async throws -> Bool {
        let configuration = try self.currentCloudServiceConfiguration()
        return configuration.mode == .custom
            && self.userDefaults.bool(forKey: pendingCloudServerBootstrapUserDefaultsKey)
            && self.cloudCredentialRecoveryState == nil
    }

    func isLinkedWorkspaceEmptyForBootstrap(linkedSession: CloudLinkedSession) async throws -> Bool {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let cloudSettings = try requireCloudSettings(cloudSettings: self.cloudSettings)
        return try await cloudSyncService.isWorkspaceEmptyForBootstrap(
            apiBaseUrl: linkedSession.apiBaseUrl,
            authorizationHeader: linkedSession.authorizationHeaderValue,
            workspaceId: linkedSession.workspaceId,
            installationId: cloudSettings.installationId
        )
    }

    private func switchCloudServer(override: CloudServerOverride?) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)

        // The second identity boundary: this disconnects the account and clears the guest session,
        // and the next credential belongs to a different backend entirely. Queued analytics events
        // were created against the server being left, so they are discarded here for the same reason
        // they are on logout rather than posted to the new one under a new identity.
        Analytics.reset()
        self.cloudRuntime.cancelForAccountDeletion()
        self.clearCloudCredentialRecoveryState()
        try self.cloudRuntime.clearCredentials()
        try self.dependencies.guestCredentialStore.clearGuestSession()
        // The analytics answer survives the switch, because it is this person's privacy choice on
        // this device, but its binding to the identity being left does not: the next identity lives
        // on another backend entirely, and an answer is only ever handed to one that has none.
        //
        // Below the clears, like the other caller of this reset, so the debt is re-armed only once
        // the credential it was made under is gone — a clear that throws must not leave it owed to
        // a credential that already accepted the answer. The republish is what the other branch
        // needs: a merely mirrored answer is dropped outright, and nothing else here restores the
        // published switch, so without it the screen keeps showing a value stored nowhere and flips
        // itself back at the next unrelated republish.
        ProductAnalyticsPreference.clearIdentityBindingForCloudIdentityReset(userDefaults: self.userDefaults)
        self.applyStoredProductAnalyticsPreference()
        self.clearProductAnalyticsPushFailureReportsForCloudIdentityReset()
        self.clearPendingGuestUpgradeStateAndUnblockMutations()
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
        self.clearCustomGuestWorkspacePause()
        self.syncStatus = .idle
        self.lastSuccessfulCloudSyncAt = nil
        self.globalErrorMessage = ""
        try self.reload()
    }
}
