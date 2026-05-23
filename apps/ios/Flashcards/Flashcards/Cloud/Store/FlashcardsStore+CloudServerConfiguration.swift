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

        self.cloudRuntime.cancelForAccountDeletion()
        self.clearCloudCredentialRecoveryState()
        try self.cloudRuntime.clearCredentials()
        try self.dependencies.guestCredentialStore.clearGuestSession()
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
        self.syncStatus = .idle
        self.lastSuccessfulCloudSyncAt = nil
        self.globalErrorMessage = ""
        try self.reload()
    }
}
