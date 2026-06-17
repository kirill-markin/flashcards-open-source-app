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
    func sendCloudSignInCode(email: String) async throws -> CloudSendCodeResult {
        let configuration = try self.currentCloudServiceConfiguration()
        do {
            let result = try await self.cloudRuntime.sendCode(email: email, configuration: configuration)
            self.globalErrorMessage = ""
            return result
        } catch {
            if isRequestCancellationError(error: error) {
                throw error
            }
            self.captureCloudAuthFailure(
                error: error,
                configuration: configuration,
                action: .sendCode
            )
            throw error
        }
    }

    func verifyCloudOtp(challenge: CloudOtpChallenge, code: String) async throws -> CloudVerifiedAuthContext {
        let configuration = try self.currentCloudServiceConfiguration()
        do {
            let context = try await self.cloudRuntime.verifyCode(
                challenge: challenge,
                code: code,
                configuration: configuration
            )
            self.globalErrorMessage = ""
            return context
        } catch {
            if isRequestCancellationError(error: error) {
                throw error
            }
            self.captureCloudAuthFailure(
                error: error,
                configuration: configuration,
                action: .verifyCode
            )
            throw error
        }
    }

    func prepareCloudLink(verifiedContext: CloudVerifiedAuthContext) async throws -> CloudWorkspaceLinkContext {
        let detectedAt = Date()
        let postAuthRecoveryRoute = try self.resolvePostAuthRecoveryRouteBeforeIdentitySideEffects(
            apiBaseUrl: verifiedContext.apiBaseUrl,
            detectedAt: detectedAt
        )

        switch postAuthRecoveryRoute {
        case .linkedCredentialRestore:
            return try await self.prepareLinkedCredentialRecoveryLink(verifiedContext: verifiedContext)
        case .guestLocalRecovery:
            return try await self.prepareGuestLocalRecoveryLink(
                verifiedContext: verifiedContext,
                postAuthRecoveryRoute: .guestLocalRecovery
            )
        case .pendingGuestUpgradeMissingGuestSessionRecovery:
            return try await self.prepareGuestLocalRecoveryLink(
                verifiedContext: verifiedContext,
                postAuthRecoveryRoute: .pendingGuestUpgradeMissingGuestSessionRecovery
            )
        case .pendingGuestUpgradeRecovery:
            return try await self.prepareStandardCloudLink(
                verifiedContext: verifiedContext,
                detectedAt: detectedAt,
                postAuthRecoveryRoute: .pendingGuestUpgradeRecovery
            )
        case .none:
            return try await self.prepareStandardCloudLink(
                verifiedContext: verifiedContext,
                detectedAt: detectedAt,
                postAuthRecoveryRoute: .none
            )
        }
    }

    private func resolvePostAuthRecoveryRouteBeforeIdentitySideEffects(
        apiBaseUrl: String,
        detectedAt: Date
    ) throws -> CloudPostAuthRecoveryRoute {
        if self.cloudCredentialRecoveryState?.reason == .invalidStoredState {
            try self.throwIfCloudCredentialRecoveryRequired()
        }
        if let pendingGuestUpgradeRecoveryRoute = try self.pendingGuestUpgradePostAuthRecoveryRoute(
            apiBaseUrl: apiBaseUrl,
            detectedAt: detectedAt
        ) {
            return pendingGuestUpgradeRecoveryRoute
        }
        guard let recoveryState = self.cloudCredentialRecoveryState else {
            return .none
        }

        switch recoveryState.reason {
        case .linkedCredentialsMissing:
            guard recoveryState.previousCloudState == .linked else {
                try self.throwIfCloudCredentialRecoveryRequired()
                return .none
            }
            return .linkedCredentialRestore
        case .guestSessionMissing:
            return .guestLocalRecovery
        case .invalidStoredState:
            try self.throwIfCloudCredentialRecoveryRequired()
            return .none
        }
    }

    private func prepareStandardCloudLink(
        verifiedContext: CloudVerifiedAuthContext,
        detectedAt: Date,
        postAuthRecoveryRoute: CloudPostAuthRecoveryRoute
    ) async throws -> CloudWorkspaceLinkContext {
        if try self.hasCompletedPendingGuestUpgradeRecoveryCheckpoint(apiBaseUrl: verifiedContext.apiBaseUrl) {
            return try await self.prepareCompletedPendingGuestUpgradeRecoveryLink(
                verifiedContext: verifiedContext
            )
        }

        let prevalidatedAccount: CloudAccountSnapshot?
        if try self.shouldValidatePendingGuestUpgradeAccountBeforePrepare(apiBaseUrl: verifiedContext.apiBaseUrl) {
            let account = try await self.cloudRuntime.fetchCloudAccount(verifiedContext: verifiedContext)
            try self.validatePendingGuestUpgradeAccountIfNeeded(
                userId: account.userId,
                apiBaseUrl: verifiedContext.apiBaseUrl
            )
            prevalidatedAccount = account
        } else {
            prevalidatedAccount = nil
        }

        let guestUpgradeMode = try await self.prepareGuestUpgradeModeIfNeeded(
            verifiedContext: verifiedContext,
            detectedAt: detectedAt
        )
        let account: CloudAccountSnapshot
        if let prevalidatedAccount {
            account = prevalidatedAccount
        } else {
            account = try await self.cloudRuntime.fetchCloudAccount(verifiedContext: verifiedContext)
            try self.validatePendingGuestUpgradeAccountIfNeeded(
                userId: account.userId,
                apiBaseUrl: verifiedContext.apiBaseUrl
            )
        }
        try self.validateCloudCredentialRecoveryAccountBeforeIdentityReset(
            account: account,
            apiBaseUrl: verifiedContext.apiBaseUrl
        )
        try self.resetLocalStateIfLinkedUserDiffers(nextUserId: account.userId)

        self.globalErrorMessage = ""
        return CloudWorkspaceLinkContext(
            userId: account.userId,
            email: account.email,
            apiBaseUrl: verifiedContext.apiBaseUrl,
            credentials: verifiedContext.credentials,
            workspaces: account.workspaces,
            preferences: account.preferences,
            guestUpgradeMode: guestUpgradeMode,
            postAuthRecoveryRoute: postAuthRecoveryRoute
        )
    }

    private func prepareLinkedCredentialRecoveryLink(
        verifiedContext: CloudVerifiedAuthContext
    ) async throws -> CloudWorkspaceLinkContext {
        let account = try await self.cloudRuntime.fetchCloudAccount(verifiedContext: verifiedContext)
        let expectedWorkspace = try self.linkedCredentialRecoveryWorkspaceBeforeIdentitySideEffects(
            account: account,
            apiBaseUrl: verifiedContext.apiBaseUrl
        )
        try self.resetLocalStateIfLinkedUserDiffers(nextUserId: account.userId)

        self.globalErrorMessage = ""
        return CloudWorkspaceLinkContext(
            userId: account.userId,
            email: account.email,
            apiBaseUrl: verifiedContext.apiBaseUrl,
            credentials: verifiedContext.credentials,
            workspaces: [expectedWorkspace],
            preferences: account.preferences,
            guestUpgradeMode: nil,
            postAuthRecoveryRoute: .linkedCredentialRestore
        )
    }

    private func prepareGuestLocalRecoveryLink(
        verifiedContext: CloudVerifiedAuthContext,
        postAuthRecoveryRoute: CloudPostAuthRecoveryRoute
    ) async throws -> CloudWorkspaceLinkContext {
        let account = try await self.cloudRuntime.fetchCloudAccount(verifiedContext: verifiedContext)

        self.globalErrorMessage = ""
        return CloudWorkspaceLinkContext(
            userId: account.userId,
            email: account.email,
            apiBaseUrl: verifiedContext.apiBaseUrl,
            credentials: verifiedContext.credentials,
            workspaces: account.workspaces,
            preferences: account.preferences,
            guestUpgradeMode: nil,
            postAuthRecoveryRoute: postAuthRecoveryRoute
        )
    }

    func completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) async throws {
        if linkContext.postAuthRecoveryRoute == .guestLocalRecovery {
            try await self.completeGuestLocalRecoveryCloudLink(
                linkContext: linkContext,
                selection: selection
            )
            return
        }

        _ = try await self.cloudRuntime.runWorkspaceCompletion { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            guard let workspace = self.workspace else {
                throw LocalStoreError.uninitialized("Workspace is unavailable")
            }

            let trigger = self.manualCloudSyncTrigger(now: Date())
            try self.validatePostAuthRecoveryRouteBeforeCloudLinkCompletion(
                linkContext: linkContext,
                selection: selection
            )
            try self.validateCloudCredentialRecoveryUserBeforeIdentitySideEffects(
                userId: linkContext.userId,
                email: linkContext.email,
                apiBaseUrl: linkContext.apiBaseUrl
            )
            if linkContext.guestUpgradeMode == nil {
                let completedGuestUpgradeWorkspace: CloudWorkspaceSummary? = try self.completedPendingGuestUpgradeWorkspaceForRecoveredLink(
                    linkContext: linkContext
                )
                if let completedGuestUpgradeWorkspace {
                    try self.validateCompletedPendingGuestUpgradeRecoverySelection(
                        selection: selection,
                        workspace: completedGuestUpgradeWorkspace
                    )
                    let finalizedCompletedGuestUpgradeWorkspace: CloudWorkspaceSummary?
                    do {
                        defer {
                            self.applyCloudAccountPreferences(
                                preferences: linkContext.preferences,
                                linkContext: linkContext
                            )
                        }

                        finalizedCompletedGuestUpgradeWorkspace = try await self.finalizeCompletedPendingGuestUpgradeForRecoveredLinkIfNeeded(
                            linkContext: linkContext,
                            trigger: trigger
                        )
                    }
                    if let completedGuestUpgradeWorkspace = finalizedCompletedGuestUpgradeWorkspace {
                        self.globalErrorMessage = ""
                        return completedGuestUpgradeWorkspace
                    }
                }
            }
            try self.validateCloudCredentialRecoveryWorkspaceSelectionBeforeIdentitySideEffects(
                selection: selection,
                apiBaseUrl: linkContext.apiBaseUrl
            )

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
            let linkedSession = CloudLinkedSession(
                userId: linkContext.userId,
                workspaceId: linkedWorkspace.workspaceId,
                email: linkContext.email,
                configurationMode: configuration.mode,
                apiBaseUrl: linkContext.apiBaseUrl,
                authorization: .bearer(linkContext.credentials.idToken)
            )
            do {
                defer {
                    self.applyCloudAccountPreferences(
                        preferences: linkContext.preferences,
                        linkContext: linkContext
                    )
                }

                try await self.finishCloudLink(
                    linkedSession: linkedSession,
                    trigger: trigger
                )
            }
            if linkContext.guestUpgradeMode == nil {
                self.clearPendingGuestUpgradeStateAndUnblockMutations()
            }
            try self.clearGuestSessionIfNeeded()
            self.clearCloudCredentialRecoveryState()
            self.globalErrorMessage = ""
            return linkedWorkspace
        }
    }

    private func completeGuestLocalRecoveryCloudLink(
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

            let trigger = self.manualCloudSyncTrigger(now: Date())
            let recoveryState = try self.validateGuestLocalRecoveryBeforeCloudLinkCompletion(
                linkContext: linkContext,
                selection: selection
            )
            let configuration = try self.currentCloudServiceConfiguration()

            let linkedWorkspace: CloudWorkspaceSummary
            var credentials: StoredCloudCredentials
            if let retryWorkspace = try self.guestLocalRecoveryRetryWorkspace(linkContext: linkContext) {
                linkedWorkspace = retryWorkspace
                credentials = try await self.guestLocalRecoveryCredentials(
                    linkContextCredentials: linkContext.credentials,
                    configuration: configuration,
                    forceRefresh: false
                )
            } else if let checkpointWorkspace = try self.guestLocalRecoveryCheckpointWorkspace(
                linkContext: linkContext,
                recoveryState: recoveryState
            ) {
                linkedWorkspace = checkpointWorkspace
                credentials = try await self.guestLocalRecoveryCredentials(
                    linkContextCredentials: linkContext.credentials,
                    configuration: configuration,
                    forceRefresh: false
                )
            } else {
                credentials = try await self.guestLocalRecoveryCredentials(
                    linkContextCredentials: linkContext.credentials,
                    configuration: configuration,
                    forceRefresh: false
                )
                let workspaceCreation = try await self.createGuestLocalRecoveryWorkspace(
                    linkContext: linkContext,
                    configuration: configuration,
                    localWorkspaceName: workspace.name,
                    credentials: credentials
                )
                linkedWorkspace = workspaceCreation.workspace
                credentials = workspaceCreation.credentials
                try self.saveGuestLocalRecoveryWorkspaceCheckpoint(
                    linkContext: linkContext,
                    recoveryState: recoveryState,
                    workspace: linkedWorkspace
                )
            }

            do {
                defer {
                    self.applyCloudAccountPreferences(
                        preferences: linkContext.preferences,
                        linkContext: linkContext
                    )
                }

                _ = try await self.finishGuestLocalRecoveryCloudLink(
                    linkContext: linkContext,
                    linkedWorkspace: linkedWorkspace,
                    configuration: configuration,
                    credentials: credentials,
                    trigger: trigger
                )
            }
            self.clearPendingGuestUpgradeStateAndUnblockMutations()
            try self.clearGuestSessionIfNeeded()
            self.clearCloudCredentialRecoveryState()
            self.globalErrorMessage = ""
            return linkedWorkspace
        }
    }

    private func guestLocalRecoveryCredentials(
        linkContextCredentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration,
        forceRefresh: Bool
    ) async throws -> StoredCloudCredentials {
        let storedCredentials = try self.cloudRuntime.loadCredentials()
        if let storedCredentials {
            if storedCredentials.refreshToken != linkContextCredentials.refreshToken {
                try self.cloudRuntime.saveCredentials(credentials: linkContextCredentials)
            }
        } else {
            try self.cloudRuntime.saveCredentials(credentials: linkContextCredentials)
        }

        return try await self.cloudRuntime.refreshCloudCredentials(
            forceRefresh: forceRefresh,
            configuration: configuration,
            now: Date()
        )
    }

    private func createGuestLocalRecoveryWorkspace(
        linkContext: CloudWorkspaceLinkContext,
        configuration: CloudServiceConfiguration,
        localWorkspaceName: String,
        credentials: StoredCloudCredentials
    ) async throws -> (workspace: CloudWorkspaceSummary, credentials: StoredCloudCredentials) {
        do {
            let workspace = try await self.cloudRuntime.selectOrCreateWorkspace(
                linkContext: self.guestLocalRecoveryLinkContext(
                    linkContext: linkContext,
                    credentials: credentials
                ),
                selection: .createNew,
                localWorkspaceName: localWorkspaceName
            )
            return (workspace, credentials)
        } catch {
            guard self.isCloudAuthorizationError(error) else {
                throw error
            }
        }

        let refreshedCredentials = try await self.guestLocalRecoveryCredentials(
            linkContextCredentials: linkContext.credentials,
            configuration: configuration,
            forceRefresh: true
        )
        let workspace = try await self.cloudRuntime.selectOrCreateWorkspace(
            linkContext: self.guestLocalRecoveryLinkContext(
                linkContext: linkContext,
                credentials: refreshedCredentials
            ),
            selection: .createNew,
            localWorkspaceName: localWorkspaceName
        )
        return (workspace, refreshedCredentials)
    }

    private func finishGuestLocalRecoveryCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        linkedWorkspace: CloudWorkspaceSummary,
        configuration: CloudServiceConfiguration,
        credentials: StoredCloudCredentials,
        trigger: CloudSyncTrigger
    ) async throws -> CloudLinkedSession {
        let linkedSession = self.guestLocalRecoveryLinkedSession(
            linkContext: linkContext,
            linkedWorkspace: linkedWorkspace,
            configuration: configuration,
            credentials: credentials
        )

        do {
            try await self.finishCloudLink(linkedSession: linkedSession, trigger: trigger)
            return linkedSession
        } catch {
            guard self.isCloudAuthorizationError(error) else {
                throw error
            }
        }

        let refreshedCredentials = try await self.guestLocalRecoveryCredentials(
            linkContextCredentials: linkContext.credentials,
            configuration: configuration,
            forceRefresh: true
        )
        let refreshedSession = self.guestLocalRecoveryLinkedSession(
            linkContext: linkContext,
            linkedWorkspace: linkedWorkspace,
            configuration: configuration,
            credentials: refreshedCredentials
        )
        try await self.finishCloudLink(linkedSession: refreshedSession, trigger: trigger)
        return refreshedSession
    }

    private func guestLocalRecoveryLinkContext(
        linkContext: CloudWorkspaceLinkContext,
        credentials: StoredCloudCredentials
    ) -> CloudWorkspaceLinkContext {
        CloudWorkspaceLinkContext(
            userId: linkContext.userId,
            email: linkContext.email,
            apiBaseUrl: linkContext.apiBaseUrl,
            credentials: credentials,
            workspaces: linkContext.workspaces,
            preferences: linkContext.preferences,
            guestUpgradeMode: linkContext.guestUpgradeMode,
            postAuthRecoveryRoute: linkContext.postAuthRecoveryRoute
        )
    }

    private func guestLocalRecoveryLinkedSession(
        linkContext: CloudWorkspaceLinkContext,
        linkedWorkspace: CloudWorkspaceSummary,
        configuration: CloudServiceConfiguration,
        credentials: StoredCloudCredentials
    ) -> CloudLinkedSession {
        CloudLinkedSession(
            userId: linkContext.userId,
            workspaceId: linkedWorkspace.workspaceId,
            email: linkContext.email,
            configurationMode: configuration.mode,
            apiBaseUrl: linkContext.apiBaseUrl,
            authorization: .bearer(credentials.idToken)
        )
    }

    private func guestLocalRecoveryRetryWorkspace(
        linkContext: CloudWorkspaceLinkContext
    ) throws -> CloudWorkspaceSummary? {
        guard let cloudSettings = self.cloudSettings,
            cloudSettings.cloudState == .linked,
            cloudSettings.linkedUserId == linkContext.userId else {
            return nil
        }

        let targetWorkspaceId = cloudSettings.activeWorkspaceId ?? cloudSettings.linkedWorkspaceId
        guard let workspace = self.workspace,
            targetWorkspaceId == workspace.workspaceId else {
            return nil
        }

        let configuration = try self.currentCloudServiceConfiguration()
        guard configuration.apiBaseUrl == linkContext.apiBaseUrl else {
            return nil
        }

        return CloudWorkspaceSummary(
            workspaceId: workspace.workspaceId,
            name: workspace.name,
            createdAt: workspace.createdAt,
            isSelected: true
        )
    }

    private func guestLocalRecoveryCheckpointWorkspace(
        linkContext: CloudWorkspaceLinkContext,
        recoveryState: CloudCredentialRecoveryState
    ) throws -> CloudWorkspaceSummary? {
        guard let checkpoint = try loadGuestLocalRecoveryWorkspaceCheckpoint(
            userDefaults: self.userDefaults,
            decoder: self.decoder
        ) else {
            return nil
        }

        let configuration = try self.currentCloudServiceConfiguration()
        guard checkpoint.userId == linkContext.userId,
            checkpoint.apiBaseUrl == linkContext.apiBaseUrl,
            checkpoint.configurationMode == configuration.mode,
            checkpoint.recoveryDetectedAt == recoveryState.detectedAt else {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(
                localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing)
            )
        }

        return checkpoint.workspace
    }

    private func saveGuestLocalRecoveryWorkspaceCheckpoint(
        linkContext: CloudWorkspaceLinkContext,
        recoveryState: CloudCredentialRecoveryState,
        workspace: CloudWorkspaceSummary
    ) throws {
        let configuration = try self.currentCloudServiceConfiguration()
        try Flashcards.saveGuestLocalRecoveryWorkspaceCheckpoint(
            checkpoint: GuestLocalRecoveryWorkspaceCheckpoint(
                userId: linkContext.userId,
                apiBaseUrl: linkContext.apiBaseUrl,
                configurationMode: configuration.mode,
                recoveryDetectedAt: recoveryState.detectedAt,
                workspace: workspace
            ),
            userDefaults: self.userDefaults,
            encoder: self.encoder
        )
    }

    private func prepareCompletedPendingGuestUpgradeRecoveryLink(
        verifiedContext: CloudVerifiedAuthContext
    ) async throws -> CloudWorkspaceLinkContext {
        let account = try await self.cloudRuntime.fetchCloudAccount(verifiedContext: verifiedContext)
        let baseLinkContext = CloudWorkspaceLinkContext(
            userId: account.userId,
            email: account.email,
            apiBaseUrl: verifiedContext.apiBaseUrl,
            credentials: verifiedContext.credentials,
            workspaces: account.workspaces,
            preferences: account.preferences,
            guestUpgradeMode: nil,
            postAuthRecoveryRoute: .pendingGuestUpgradeRecovery
        )
        try self.validateCloudCredentialRecoveryAccountBeforeIdentityReset(
            account: account,
            apiBaseUrl: verifiedContext.apiBaseUrl
        )
        guard let completedGuestUpgradeWorkspace = try self.completedPendingGuestUpgradeWorkspaceForRecoveredLink(
            linkContext: baseLinkContext
        ) else {
            throw LocalStoreError.validation(
                localizedCloudCredentialRecoveryInterruptedUpgradeAccountMessage()
            )
        }
        try self.resetLocalStateIfLinkedUserDiffers(nextUserId: account.userId)

        self.globalErrorMessage = ""
        return CloudWorkspaceLinkContext(
            userId: account.userId,
            email: account.email,
            apiBaseUrl: verifiedContext.apiBaseUrl,
            credentials: verifiedContext.credentials,
            workspaces: [completedGuestUpgradeWorkspace],
            preferences: account.preferences,
            guestUpgradeMode: nil,
            postAuthRecoveryRoute: .pendingGuestUpgradeRecovery
        )
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
            let remoteWorkspaceIsEmpty = try await self.isLinkedWorkspaceEmptyForCredentialRecoveryOrBootstrap(
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
            if isRequestCancellationError(error: error) {
                self.syncStatus = .idle
                throw error
            }
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
            if isRetryableNetworkTransportFailure(error: error) == false {
                self.captureCloudSyncFailure(
                    error: error,
                    linkedSession: linkedSession,
                    fallbackCloudState: self.cloudSettings?.cloudState,
                    action: "cloud_link_sync"
                )
            }
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

    private func isLinkedWorkspaceEmptyForCredentialRecoveryOrBootstrap(
        linkedSession: CloudLinkedSession
    ) async throws -> Bool {
        if try self.shouldPreserveLocalDataForCloudCredentialRecovery(linkedSession: linkedSession) {
            return true
        }

        return try await self.isLinkedWorkspaceEmptyForBootstrap(linkedSession: linkedSession)
    }
}
