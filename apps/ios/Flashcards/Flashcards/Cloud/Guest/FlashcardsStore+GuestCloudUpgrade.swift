import Foundation

@MainActor
extension FlashcardsStore {
    func assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade() throws {
        try Flashcards.assertLocalOutboxMutationAllowedDuringPendingGuestUpgrade(
            isGuestUpgradeLocalOutboxMutationBlocked: self.isGuestUpgradeLocalOutboxMutationBlocked,
            userDefaults: self.userDefaults
        )
    }

    func completeGuestCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) async throws {
        _ = try await self.cloudRuntime.runWorkspaceCompletion { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            if linkContext.postAuthRecoveryRoute == .guestLocalRecovery
                || linkContext.postAuthRecoveryRoute == .pendingGuestUpgradeMissingGuestSessionRecovery {
                try self.throwIfGuestLocalRecoveryRequired()
            }
            guard let guestUpgradeMode = linkContext.guestUpgradeMode else {
                throw LocalStoreError.uninitialized("Guest upgrade context is unavailable")
            }

            let configuration = try self.currentCloudServiceConfiguration()
            let trigger = self.manualCloudSyncTrigger(now: Date())
            try self.validatePendingGuestUpgradeAccountIfNeeded(
                userId: linkContext.userId,
                apiBaseUrl: linkContext.apiBaseUrl
            )
            guard let guestSession = try self.loadUsableGuestSessionForCurrentConfiguration() else {
                try self.markPendingGuestUpgradeGuestSessionMissing(detectedAt: trigger.now)
                try self.throwIfCloudCredentialRecoveryRequired()
                throw LocalStoreError.uninitialized("Guest AI session is unavailable")
            }
            await self.blockGuestUpgradeLocalOutboxMutationsBeforeDrain()
            do {
                // Guest upgrade completion only merges already-synced cloud state.
                // Drain normal guest sync first so no pending guest outbox is carried
                // into the linked workspace.
                try await self.drainGuestWorkspaceBeforeUpgrade(
                    guestSession: guestSession,
                    configuration: configuration,
                    trigger: trigger
                )
                try self.cloudRuntime.saveCredentials(credentials: linkContext.credentials)
                let inFlightState = pendingGuestUpgradeInFlightState(
                    linkContext: linkContext,
                    configuration: configuration,
                    guestSession: guestSession,
                    selection: selection,
                    supportsDroppedEntities: guestUpgradeMode == .mergeRequired
                )
                try self.savePendingGuestUpgradeState(state: inFlightState)

                let completionState = try await self.completePendingGuestUpgradeIfNeeded(
                    state: inFlightState,
                    detectedAt: trigger.now
                )
                try await self.finalizePendingGuestUpgradeCompletion(
                    state: completionState,
                    trigger: trigger
                )
                self.unblockGuestUpgradeLocalOutboxMutationsIfPossible()
                return completionState.workspace
            } catch {
                self.unblockGuestUpgradeLocalOutboxMutationsIfPossible()
                throw error
            }
        }
    }

    func resumePendingGuestUpgradeIfNeeded(trigger: CloudSyncTrigger) async throws -> Bool {
        guard try self.loadPendingGuestUpgradeState() != nil else {
            return false
        }

        _ = try await self.cloudRuntime.runWorkspaceCompletion { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            return try await self.performPendingGuestUpgradeResume(trigger: trigger)
        }
        return true
    }

    func clearPendingGuestUpgradeStateAndUnblockMutations() {
        clearPendingGuestUpgradeState(userDefaults: self.userDefaults)
        self.isGuestUpgradeLocalOutboxMutationBlocked = false
        self.reviewSubmissionOutboxMutationGate.unblockReviewSubmissions()
    }

    func prepareGuestUpgradeModeIfNeeded(
        verifiedContext: CloudVerifiedAuthContext,
        detectedAt: Date
    ) async throws -> CloudGuestUpgradeMode? {
        guard try self.shouldPrepareGuestUpgradeModeForCloudLink(apiBaseUrl: verifiedContext.apiBaseUrl) else {
            return nil
        }
        guard let guestSession = try self.loadUsableGuestSessionForCurrentConfiguration() else {
            try self.markPendingGuestUpgradeGuestSessionMissing(detectedAt: detectedAt)
            try self.throwIfCloudCredentialRecoveryRequired()
            throw LocalStoreError.uninitialized("Guest AI session is unavailable")
        }

        return try await self.dependencies.guestCloudAuthService.prepareGuestUpgrade(
            apiBaseUrl: verifiedContext.apiBaseUrl,
            bearerToken: verifiedContext.credentials.idToken,
            guestToken: guestSession.guestToken
        )
    }

    func blockPendingGuestUpgradeRecoveryIfMissingGuestSession(
        apiBaseUrl: String,
        detectedAt: Date
    ) throws {
        guard self.cloudCredentialRecoveryState != nil else {
            return
        }
        if self.cloudCredentialRecoveryState?.reason == .invalidStoredState {
            try self.throwIfCloudCredentialRecoveryRequired()
        }
        guard try self.matchingInFlightPendingGuestUpgradeState(apiBaseUrl: apiBaseUrl) != nil else {
            return
        }
        guard try self.loadUsableGuestSessionForCurrentConfiguration() == nil else {
            return
        }

        try self.markPendingGuestUpgradeGuestSessionMissing(detectedAt: detectedAt)
        try self.throwIfCloudCredentialRecoveryRequired()
    }

    func pendingGuestUpgradePostAuthRecoveryRoute(
        apiBaseUrl: String,
        detectedAt: Date
    ) throws -> CloudPostAuthRecoveryRoute? {
        if try self.hasCompletedPendingGuestUpgradeRecoveryCheckpoint(apiBaseUrl: apiBaseUrl) {
            return .pendingGuestUpgradeRecovery
        }
        guard self.cloudCredentialRecoveryState != nil else {
            return nil
        }
        if self.cloudCredentialRecoveryState?.reason == .invalidStoredState {
            try self.throwIfCloudCredentialRecoveryRequired()
        }
        guard try self.matchingInFlightPendingGuestUpgradeState(apiBaseUrl: apiBaseUrl) != nil else {
            return nil
        }
        guard try self.loadUsableGuestSessionForCurrentConfiguration() != nil else {
            try self.markPendingGuestUpgradeGuestSessionMissing(detectedAt: detectedAt)
            return .pendingGuestUpgradeMissingGuestSessionRecovery
        }

        return .pendingGuestUpgradeRecovery
    }

    func validateNoPendingGuestUpgradeStateForGuestLocalRecovery(apiBaseUrl: String) throws {
        guard let pendingGuestUpgradeState = try self.loadPendingGuestUpgradeState() else {
            return
        }

        let configuration = try self.currentCloudServiceConfiguration()
        guard pendingGuestUpgradeState.common.apiBaseUrl == apiBaseUrl
            && pendingGuestUpgradeState.common.configurationMode == configuration.mode else {
            return
        }

        self.blockCloudSyncForCredentialRecoveryIfNeeded()
        throw LocalStoreError.validation(
            localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing)
        )
    }

    func shouldPrepareGuestUpgradeModeForCloudLink(apiBaseUrl: String) throws -> Bool {
        guard self.cloudSettings?.cloudState == .guest else {
            return false
        }
        guard self.cloudCredentialRecoveryState != nil else {
            return true
        }

        return try self.matchingInFlightPendingGuestUpgradeState(apiBaseUrl: apiBaseUrl) != nil
    }

    func finalizeCompletedPendingGuestUpgradeForRecoveredLinkIfNeeded(
        linkContext: CloudWorkspaceLinkContext,
        trigger: CloudSyncTrigger
    ) async throws -> CloudWorkspaceSummary? {
        guard let completedState = try self.completedPendingGuestUpgradeStateForRecoveredLink(
            linkContext: linkContext
        ) else {
            return nil
        }

        try self.cloudRuntime.saveCredentials(credentials: linkContext.credentials)
        try await self.finalizePendingGuestUpgradeCompletion(
            state: completedState,
            trigger: trigger
        )
        return completedState.workspace
    }

    func completedPendingGuestUpgradeWorkspaceForRecoveredLink(
        linkContext: CloudWorkspaceLinkContext
    ) throws -> CloudWorkspaceSummary? {
        try self.completedPendingGuestUpgradeStateForRecoveredLink(linkContext: linkContext)?.workspace
    }

    func completedPendingGuestUpgradeRecoveryUserId(apiBaseUrl: String) throws -> String? {
        try self.completedPendingGuestUpgradeRecoveryCheckpoint(apiBaseUrl: apiBaseUrl)?.common.userId
    }

    func inFlightPendingGuestUpgradeRecoveryUserId(apiBaseUrl: String) throws -> String? {
        guard let recoveryState = self.cloudCredentialRecoveryState else {
            return nil
        }
        guard recoveryState.reason == .linkedCredentialsMissing,
            recoveryState.previousCloudState == .guest,
            recoveryState.apiBaseUrl == apiBaseUrl else {
            return nil
        }
        guard let pendingState = try self.matchingInFlightPendingGuestUpgradeState(apiBaseUrl: apiBaseUrl),
            recoveryState.configurationMode == pendingState.common.configurationMode else {
            return nil
        }

        return pendingState.common.userId
    }

    func shouldFinalizeCompletedPendingGuestUpgradeForRecoveredLink(
        linkContext: CloudWorkspaceLinkContext
    ) throws -> Bool {
        try self.completedPendingGuestUpgradeStateForRecoveredLink(linkContext: linkContext) != nil
    }

    func validateCompletedPendingGuestUpgradeRecoverySelection(
        selection: CloudWorkspaceLinkSelection,
        workspace: CloudWorkspaceSummary
    ) throws {
        guard case .existing(let selectedWorkspaceId) = selection, selectedWorkspaceId == workspace.workspaceId else {
            throw LocalStoreError.validation(
                localizedCloudCredentialRecoveryUpgradeWorkspaceMessage(workspaceName: workspace.name)
            )
        }
    }

    func shouldValidatePendingGuestUpgradeAccountBeforePrepare(apiBaseUrl: String) throws -> Bool {
        guard try self.matchingInFlightPendingGuestUpgradeState(apiBaseUrl: apiBaseUrl) != nil else {
            return false
        }

        return try self.loadUsableGuestSessionForCurrentConfiguration() != nil
    }

    private func matchingInFlightPendingGuestUpgradeState(
        apiBaseUrl: String
    ) throws -> PendingGuestUpgradeInFlightState? {
        guard let pendingGuestUpgradeState = try self.loadPendingGuestUpgradeState(),
            case .inFlight(let pendingState) = pendingGuestUpgradeState else {
            return nil
        }

        let configuration = try self.currentCloudServiceConfiguration()
        guard pendingState.common.apiBaseUrl == apiBaseUrl
            && pendingState.common.configurationMode == configuration.mode else {
            return nil
        }

        return pendingState
    }

    func validatePendingGuestUpgradeAccountIfNeeded(
        userId: String,
        apiBaseUrl: String
    ) throws {
        guard let pendingGuestUpgradeState = try self.loadPendingGuestUpgradeState(),
            case .inFlight(let pendingState) = pendingGuestUpgradeState else {
            return
        }

        let configuration = try self.currentCloudServiceConfiguration()
        guard pendingState.common.apiBaseUrl == apiBaseUrl
            && pendingState.common.configurationMode == configuration.mode else {
            return
        }
        guard pendingState.common.userId == userId else {
            throw LocalStoreError.validation(
                localizedCloudCredentialRecoveryInterruptedUpgradeAccountMessage()
            )
        }
    }

    func hasCompletedPendingGuestUpgradeRecoveryCheckpoint(apiBaseUrl: String) throws -> Bool {
        try self.completedPendingGuestUpgradeRecoveryCheckpoint(apiBaseUrl: apiBaseUrl) != nil
    }

    private func completedPendingGuestUpgradeStateForRecoveredLink(
        linkContext: CloudWorkspaceLinkContext
    ) throws -> PendingGuestUpgradeCompletedState? {
        guard let completedState = try self.completedPendingGuestUpgradeRecoveryCheckpoint(
            apiBaseUrl: linkContext.apiBaseUrl
        ) else {
            return nil
        }
        let configuration = try self.currentCloudServiceConfiguration()
        guard completedState.common.userId == linkContext.userId
            && completedState.common.apiBaseUrl == linkContext.apiBaseUrl
            && completedState.common.configurationMode == configuration.mode else {
            return nil
        }

        return completedState
    }

    private func completedPendingGuestUpgradeRecoveryCheckpoint(
        apiBaseUrl: String
    ) throws -> PendingGuestUpgradeCompletedState? {
        guard let recoveryState = self.cloudCredentialRecoveryState else {
            return nil
        }
        guard recoveryState.previousCloudState == .guest,
            recoveryState.apiBaseUrl == apiBaseUrl else {
            return nil
        }

        let configuration = try self.currentCloudServiceConfiguration()
        guard recoveryState.configurationMode == configuration.mode else {
            return nil
        }
        guard let pendingState = try self.loadPendingGuestUpgradeState() else {
            return nil
        }
        guard case .completed(let completedState) = pendingState else {
            return nil
        }
        guard completedState.common.apiBaseUrl == apiBaseUrl
            && completedState.common.configurationMode == configuration.mode else {
            return nil
        }

        return completedState
    }

    private func performPendingGuestUpgradeResume(trigger: CloudSyncTrigger) async throws -> CloudWorkspaceSummary {
        guard let pendingState = try self.loadPendingGuestUpgradeState() else {
            throw LocalStoreError.uninitialized("Pending guest upgrade state is unavailable")
        }

        let completionState = try await self.completePendingGuestUpgradeIfNeeded(
            state: pendingState,
            detectedAt: trigger.now
        )
        try await self.finalizePendingGuestUpgradeCompletion(state: completionState, trigger: trigger)
        return completionState.workspace
    }

    private func drainGuestWorkspaceBeforeUpgrade(
        guestSession: StoredGuestCloudSession,
        configuration: CloudServiceConfiguration,
        trigger: CloudSyncTrigger
    ) async throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        guard context.workspaceId == guestSession.workspaceId else {
            throw CloudGuestUpgradeDrainError.workspaceMismatch(
                localWorkspaceId: context.workspaceId,
                guestWorkspaceId: guestSession.workspaceId
            )
        }

        let linkedSession = CloudLinkedSession(
            userId: guestSession.userId,
            workspaceId: guestSession.workspaceId,
            email: nil,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl,
            authorization: .guest(guestSession.guestToken)
        )

        self.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
        self.syncStatus = .syncing
        do {
            let syncResult = try await self.runFreshLinkedSyncAfterActiveSyncSettles(
                linkedSession: linkedSession
            )
            try await self.applySyncResultWithoutBlockingReset(
                syncResult: syncResult,
                now: Date(),
                trigger: trigger
            )
            let database = try requireLocalDatabase(database: self.database)
            let remainingOutboxEntries = try database.loadOutboxEntries(
                workspaceId: guestSession.workspaceId,
                limit: 1
            )
            if remainingOutboxEntries.isEmpty == false {
                throw CloudGuestUpgradeDrainError.pendingGuestOutboxEntries(
                    workspaceId: guestSession.workspaceId
                )
            }
        } catch {
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            throw error
        }
    }

    private func finalizePendingGuestUpgradeCompletion(
        state: PendingGuestUpgradeCompletedState,
        trigger: CloudSyncTrigger
    ) async throws {
        let credentials = try await self.loadPendingGuestUpgradeCredentials(
            commonState: state.common,
            detectedAt: trigger.now
        )
        let linkedSession = cloudLinkedSession(state: state, credentials: credentials)

        try await self.finishCompletedGuestCloudLink(
            linkedSession: linkedSession,
            workspace: state.workspace,
            trigger: trigger
        )

        try self.clearGuestSessionIfNeeded()
        self.clearPendingGuestUpgradeStateAndUnblockMutations()
        self.clearCloudCredentialRecoveryState()
        self.globalErrorMessage = ""
    }

    private func blockGuestUpgradeLocalOutboxMutationsBeforeDrain() async {
        self.isGuestUpgradeLocalOutboxMutationBlocked = true
        await self.reviewSubmissionOutboxMutationGate.blockNewReviewSubmissionsAndWaitForActiveSubmissions()
    }

    private func unblockGuestUpgradeLocalOutboxMutationsIfPossible() {
        if self.userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey) == nil {
            self.reviewSubmissionOutboxMutationGate.unblockReviewSubmissions()
        }
        self.isGuestUpgradeLocalOutboxMutationBlocked = false
    }

    private func completePendingGuestUpgradeIfNeeded(
        state: PendingGuestUpgradeState,
        detectedAt: Date
    ) async throws -> PendingGuestUpgradeCompletedState {
        switch state {
        case .completed(let completedState):
            return completedState
        case .inFlight(let inFlightState):
            let guestSession = try self.loadPendingGuestUpgradeGuestSession(
                state: inFlightState,
                detectedAt: detectedAt
            )
            let credentials = try await self.loadPendingGuestUpgradeCredentials(
                commonState: inFlightState.common,
                detectedAt: detectedAt
            )
            let workspace = try await self.dependencies.guestCloudAuthService.completeGuestUpgrade(
                apiBaseUrl: inFlightState.common.apiBaseUrl,
                bearerToken: credentials.idToken,
                guestToken: guestSession.guestToken,
                selection: cloudGuestUpgradeSelection(selection: inFlightState.selection),
                supportsDroppedEntities: inFlightState.supportsDroppedEntities,
                guestWorkspaceSyncedAndOutboxDrained: true
            )
            let completionState = pendingGuestUpgradeCompletedState(
                state: inFlightState,
                workspace: workspace
            )
            try self.savePendingGuestUpgradeState(state: .completed(completionState))
            return completionState
        }
    }

    private func loadPendingGuestUpgradeCredentials(
        commonState: PendingGuestUpgradeCommonState,
        detectedAt: Date
    ) async throws -> StoredCloudCredentials {
        let configuration = try self.currentCloudServiceConfiguration()
        guard configuration.apiBaseUrl == commonState.apiBaseUrl && configuration.mode == commonState.configurationMode else {
            throw LocalStoreError.database(
                "Pending guest upgrade cloud configuration mismatch: pendingApiBaseUrl=\(commonState.apiBaseUrl) currentApiBaseUrl=\(configuration.apiBaseUrl) pendingMode=\(commonState.configurationMode.rawValue) currentMode=\(configuration.mode.rawValue)"
            )
        }
        if let cloudSettings = self.cloudSettings,
            try self.markLinkedCredentialRecoveryForMissingCredentialsIfNeeded(
                cloudSettings: cloudSettings,
                detectedAt: detectedAt
            ) {
            try self.throwIfCloudCredentialRecoveryRequired()
        }
        try self.enforceCloudCredentialRecoveryGateOutsideIdentityResolution(detectedAt: detectedAt)

        return try await self.refreshCloudCredentials(forceRefresh: false)
    }

    private func loadPendingGuestUpgradeGuestSession(
        state: PendingGuestUpgradeInFlightState,
        detectedAt: Date
    ) throws -> StoredGuestCloudSession {
        // Only in-flight replay needs the guest token. Completed checkpoints
        // already have the linked workspace and must not require guest storage.
        let guestSession: StoredGuestCloudSession
        if let storedGuestSession = try self.dependencies.guestCredentialStore.loadGuestSession() {
            guestSession = storedGuestSession
        } else if let activeGuestSession = self.activePendingGuestUpgradeGuestSession(state: state) {
            try self.dependencies.guestCredentialStore.saveGuestSession(session: activeGuestSession)
            guestSession = activeGuestSession
        } else {
            try self.markPendingGuestUpgradeGuestSessionMissing(detectedAt: detectedAt)
            try self.throwIfCloudCredentialRecoveryRequired()
            throw LocalStoreError.database(
                "In-flight pending guest upgrade cannot replay backend completion because the guest credential is missing from secure storage."
            )
        }
        guard guestSession.apiBaseUrl == state.common.apiBaseUrl
            && guestSession.configurationMode == state.common.configurationMode else {
            throw LocalStoreError.database(
                "In-flight pending guest upgrade credential mismatch: pendingApiBaseUrl=\(state.common.apiBaseUrl) credentialApiBaseUrl=\(guestSession.apiBaseUrl) pendingMode=\(state.common.configurationMode.rawValue) credentialMode=\(guestSession.configurationMode.rawValue)"
            )
        }
        guard guestSession.userId == state.guestIdentity.userId
            && guestSession.workspaceId == state.guestIdentity.workspaceId else {
            throw LocalStoreError.database(
                "In-flight pending guest upgrade guest identity mismatch: pendingGuestUserId=\(state.guestIdentity.userId) credentialGuestUserId=\(guestSession.userId) pendingGuestWorkspaceId=\(state.guestIdentity.workspaceId) credentialGuestWorkspaceId=\(guestSession.workspaceId). Restore the original guest session for this pending upgrade before retrying recovery."
            )
        }

        return guestSession
    }

    private func activePendingGuestUpgradeGuestSession(
        state: PendingGuestUpgradeInFlightState
    ) -> StoredGuestCloudSession? {
        guard let activeSession = self.cloudRuntime.activeCloudSession() else {
            return nil
        }
        guard activeSession.userId == state.guestIdentity.userId
            && activeSession.workspaceId == state.guestIdentity.workspaceId
            && activeSession.apiBaseUrl == state.common.apiBaseUrl
            && activeSession.configurationMode == state.common.configurationMode else {
            return nil
        }
        guard case .guest(let guestToken) = activeSession.authorization else {
            return nil
        }

        return StoredGuestCloudSession(
            guestToken: guestToken,
            userId: activeSession.userId,
            workspaceId: activeSession.workspaceId,
            configurationMode: activeSession.configurationMode,
            apiBaseUrl: activeSession.apiBaseUrl
        )
    }

    private func markPendingGuestUpgradeGuestSessionMissing(
        detectedAt: Date
    ) throws {
        guard let cloudSettings = self.cloudSettings, cloudSettings.cloudState == .guest else {
            return
        }

        let configuration = try self.currentCloudServiceConfiguration()
        try self.markCloudCredentialRecoveryRequired(
            reason: .guestSessionMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: detectedAt
        )
    }

    private func savePendingGuestUpgradeState(state: PendingGuestUpgradeState) throws {
        let data = try self.encoder.encode(state)
        self.userDefaults.set(data, forKey: pendingGuestUpgradeUserDefaultsKey)
    }

    private func loadPendingGuestUpgradeState() throws -> PendingGuestUpgradeState? {
        guard let data = self.userDefaults.data(forKey: pendingGuestUpgradeUserDefaultsKey) else {
            return nil
        }

        let state = try self.decoder.decode(PendingGuestUpgradeState.self, from: data)
        return state
    }

    private func finishCompletedGuestCloudLink(
        linkedSession: CloudLinkedSession,
        workspace: CloudWorkspaceSummary,
        trigger: CloudSyncTrigger
    ) async throws {
        try await self.cloudRuntime.runCloudLinkTransition { [weak self] in
            guard let self else {
                throw LocalStoreError.uninitialized("Flashcards store is unavailable")
            }

            try await self.performCompletedGuestCloudLink(
                linkedSession: linkedSession,
                workspace: workspace,
                trigger: trigger
            )
        }
    }

    private func performCompletedGuestCloudLink(
        linkedSession: CloudLinkedSession,
        workspace: CloudWorkspaceSummary,
        trigger: CloudSyncTrigger
    ) async throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)

        self.cloudRuntime.cancelForWorkspaceSwitch()
        self.syncStatus = .syncing
        var didCompleteLocalLink = false
        let migrationKind = "guest_upgrade_hydrate_remote"
        do {
            logCloudFlowPhase(
                phase: .linkLocalWorkspace,
                outcome: "start",
                workspaceId: linkedSession.workspaceId,
                installationId: self.cloudSettings?.installationId,
                sourceWorkspaceId: context.workspaceId,
                targetWorkspaceId: linkedSession.workspaceId,
                migrationKind: migrationKind,
                remoteWorkspaceIsEmpty: nil
            )
            // Backend completion already merged drained guest cloud state.
            // Do not migrate any local guest outbox; switch locally and hydrate
            // the linked workspace from remote instead.
            try context.database.switchGuestUpgradeToLinkedWorkspaceFromRemote(
                localWorkspaceId: context.workspaceId,
                linkedSession: linkedSession,
                workspace: workspace
            )

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
                remoteWorkspaceIsEmpty: nil
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
                action: "guest_cloud_link_sync"
            )
            self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error)
            if trigger.surfacesGlobalErrorMessage {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
            throw error
        }
    }
}
