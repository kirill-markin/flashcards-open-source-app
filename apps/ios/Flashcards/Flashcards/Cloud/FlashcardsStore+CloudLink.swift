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
        _ = try await self.cloudRuntime.runWorkspaceCompletion { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            guard let workspace = self.workspace else {
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
                    authorizationHeader: "Bearer \(linkContext.credentials.idToken)",
                    workspaceId: linkedWorkspace.workspaceId,
                    installationId: cloudSettings.installationId
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
                ),
                trigger: self.manualCloudSyncTrigger(now: Date())
            )
            try self.clearGuestSessionIfNeeded()
            self.globalErrorMessage = ""
            return linkedWorkspace
        }
    }

    func completeGuestCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) async throws {
        _ = try await self.cloudRuntime.runWorkspaceCompletion { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

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
                ),
                trigger: self.manualCloudSyncTrigger(now: Date())
            )
            try self.clearGuestSessionIfNeeded()
            self.globalErrorMessage = ""
            return linkedWorkspace
        }
    }

    func finishCloudLink(linkedSession: CloudLinkedSession, trigger: CloudSyncTrigger) async throws {
        try await self.cloudRuntime.runCloudLinkTransition { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            try await self.performCloudLink(linkedSession: linkedSession, trigger: trigger)
        }
    }

    private func performCloudLink(linkedSession: CloudLinkedSession, trigger: CloudSyncTrigger) async throws {
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
                try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
            } else {
                try await self.performActiveWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
            }
            return
        }

        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)

        self.syncStatus = .syncing
        var didCompleteLocalLink = false
        do {
            let remoteWorkspaceIsEmpty = try await self.isLinkedWorkspaceEmptyForBootstrap(
                linkedSession: linkedSession
            )
            let migrationKind = remoteWorkspaceIsEmpty ? "preserve_local_data" : "replace_local_shell"
            logCloudFlowPhase(
                phase: .linkLocalWorkspace,
                outcome: "start",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                sourceWorkspaceId: context.workspaceId,
                targetWorkspaceId: linkedSession.workspaceId,
                migrationKind: migrationKind,
                remoteWorkspaceIsEmpty: remoteWorkspaceIsEmpty
            )
            try context.database.migrateLocalWorkspaceToLinkedWorkspace(
                localWorkspaceId: context.workspaceId,
                linkedSession: linkedSession,
                remoteWorkspaceIsEmpty: remoteWorkspaceIsEmpty
            )
            if linkedSession.authorization.isGuest {
                try self.applyGuestCloudStateBeforeReload(
                    database: context.database,
                    session: linkedSession
                )
            }

            self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            try self.reload()
            didCompleteLocalLink = true
            logCloudFlowPhase(
                phase: .linkLocalWorkspace,
                outcome: "success",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                sourceWorkspaceId: context.workspaceId,
                targetWorkspaceId: linkedSession.workspaceId,
                migrationKind: migrationKind,
                remoteWorkspaceIsEmpty: remoteWorkspaceIsEmpty
            )
            let syncResult = try await self.runLinkedSync(linkedSession: linkedSession)
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
            self.userDefaults.removeObject(forKey: pendingCloudServerBootstrapUserDefaultsKey)
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "success",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId
            )
            try self.reload()
        } catch {
            if didCompleteLocalLink == false {
                logCloudFlowPhase(
                    phase: .linkLocalWorkspace,
                    outcome: "failure",
                    workspaceId: linkedSession.workspaceId,
                    installationId: self.cloudSettings?.installationId,
                    sourceWorkspaceId: context.workspaceId,
                    targetWorkspaceId: linkedSession.workspaceId,
                    errorMessage: Flashcards.errorMessage(error: error)
                )
            }
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "failure",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            throw error
        }
    }

    private func applyGuestCloudStateBeforeReload(
        database: LocalDatabase,
        session: CloudLinkedSession
    ) throws {
        try database.updateCloudSettings(
            cloudState: .guest,
            linkedUserId: session.userId,
            linkedWorkspaceId: session.workspaceId,
            activeWorkspaceId: session.workspaceId,
            linkedEmail: nil
        )
    }

    /**
     Restores a cloud session for the already-linked local workspace without
     resetting review UI state. This keeps the locally rendered card visible
     unless the sync result produces an actual review data change.
     */
    func performSameWorkspaceCloudRestore(
        linkedSession: CloudLinkedSession,
        trigger: CloudSyncTrigger
    ) async throws {
        self.syncStatus = .syncing

        do {
            self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
            let syncResult = try await self.runLinkedSync(linkedSession: linkedSession)
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
            self.userDefaults.removeObject(forKey: pendingCloudServerBootstrapUserDefaultsKey)
        } catch {
            logCloudFlowPhase(
                phase: .linkedSync,
                outcome: "failure",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            throw error
        }
    }

    func performActiveWorkspaceCloudRestore(
        linkedSession: CloudLinkedSession,
        trigger: CloudSyncTrigger
    ) async throws {
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
        try await self.performSameWorkspaceCloudRestore(linkedSession: linkedSession, trigger: trigger)
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

    private func isLinkedWorkspaceEmptyForBootstrap(linkedSession: CloudLinkedSession) async throws -> Bool {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let cloudSettings = try requireCloudSettings(cloudSettings: self.cloudSettings)
        return try await cloudSyncService.isWorkspaceEmptyForBootstrap(
            apiBaseUrl: linkedSession.apiBaseUrl,
            authorizationHeader: linkedSession.authorizationHeaderValue,
            workspaceId: linkedSession.workspaceId,
            installationId: cloudSettings.installationId
        )
    }
}
