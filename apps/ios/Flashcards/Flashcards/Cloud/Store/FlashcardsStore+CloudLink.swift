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
        if try self.hasCompletedPendingGuestUpgradeRecoveryCheckpoint(apiBaseUrl: verifiedContext.apiBaseUrl) {
            return try await self.prepareCompletedPendingGuestUpgradeRecoveryLink(
                verifiedContext: verifiedContext
            )
        }
        if self.cloudCredentialRecoveryState?.reason == .invalidStoredState {
            try self.throwIfCloudCredentialRecoveryRequired()
        }
        try self.blockPendingGuestUpgradeRecoveryIfMissingGuestSession(
            apiBaseUrl: verifiedContext.apiBaseUrl,
            detectedAt: detectedAt
        )

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

            let trigger = self.manualCloudSyncTrigger(now: Date())
            try self.validateCloudCredentialRecoveryUserBeforeIdentitySideEffects(
                userId: linkContext.userId,
                email: linkContext.email,
                apiBaseUrl: linkContext.apiBaseUrl
            )
            if linkContext.guestUpgradeMode == nil
                && (try self.shouldFinalizeCompletedPendingGuestUpgradeForRecoveredLink(linkContext: linkContext)),
                let completedGuestUpgradeWorkspace = try self.completedPendingGuestUpgradeWorkspaceForRecoveredLink(
                    linkContext: linkContext
                ) {
                try self.validateCompletedPendingGuestUpgradeRecoverySelection(
                    selection: selection,
                    workspace: completedGuestUpgradeWorkspace
                )
                if let completedGuestUpgradeWorkspace = try await self.finalizeCompletedPendingGuestUpgradeForRecoveredLinkIfNeeded(
                    linkContext: linkContext,
                    trigger: trigger
                ) {
                    self.globalErrorMessage = ""
                    return completedGuestUpgradeWorkspace
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
            try await self.finishCloudLink(
                linkedSession: CloudLinkedSession(
                    userId: linkContext.userId,
                    workspaceId: linkedWorkspace.workspaceId,
                    email: linkContext.email,
                    configurationMode: configuration.mode,
                    apiBaseUrl: linkContext.apiBaseUrl,
                    authorization: .bearer(linkContext.credentials.idToken)
                ),
                trigger: trigger
            )
            if linkContext.guestUpgradeMode == nil {
                self.clearPendingGuestUpgradeStateAndUnblockMutations()
            }
            try self.clearGuestSessionIfNeeded()
            self.clearCloudCredentialRecoveryState()
            self.globalErrorMessage = ""
            return linkedWorkspace
        }
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
            guestUpgradeMode: nil
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
            guestUpgradeMode: nil
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
            self.captureCloudSyncFailure(
                error: error,
                linkedSession: linkedSession,
                fallbackCloudState: self.cloudSettings?.cloudState,
                action: "cloud_link_sync"
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

    private func isLinkedWorkspaceEmptyForCredentialRecoveryOrBootstrap(
        linkedSession: CloudLinkedSession
    ) async throws -> Bool {
        if try self.shouldPreserveLocalDataForCloudCredentialRecovery(linkedSession: linkedSession) {
            return true
        }

        return try await self.isLinkedWorkspaceEmptyForBootstrap(linkedSession: linkedSession)
    }
}
