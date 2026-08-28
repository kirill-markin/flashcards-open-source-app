import Foundation

@MainActor
extension FlashcardsStore {
    var isCloudCredentialRecoveryRequired: Bool {
        self.cloudCredentialRecoveryState != nil
    }

    func markCloudCredentialRecoveryRequired(
        reason: CloudCredentialRecoveryReason,
        cloudSettings: CloudSettings,
        configuration: CloudServiceConfiguration,
        detectedAt: Date
    ) throws {
        let recoveryState = CloudCredentialRecoveryState(
            reason: reason,
            previousCloudState: cloudSettings.cloudState,
            installationId: cloudSettings.installationId,
            linkedUserId: cloudSettings.linkedUserId,
            linkedWorkspaceId: cloudSettings.linkedWorkspaceId,
            activeWorkspaceId: cloudSettings.activeWorkspaceId,
            linkedEmail: cloudSettings.linkedEmail,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl,
            detectedAt: formatIsoTimestamp(date: detectedAt)
        )

        try saveCloudCredentialRecoveryState(
            state: recoveryState,
            userDefaults: self.userDefaults,
            encoder: self.encoder
        )
        self.cloudCredentialRecoveryState = recoveryState
        self.blockCloudSyncForCredentialRecovery()
    }

    func clearCloudCredentialRecoveryState() {
        self.cloudCredentialRecoveryState = nil
        Flashcards.clearCloudCredentialRecoveryState(userDefaults: self.userDefaults)
    }

    /**
     * The recovery gate's "erase local data and start fresh".
     *
     * A sign-in attempt can still be running here. The gate replaces the tab root rather than
     * dismissing whatever sheet the other branch was presenting, so no `onDismiss` reaches
     * `endCloudSignInAttempt` and the attempt's post-auth work keeps going with no surface. Ending
     * the attempt first is what stops it going further: every post-auth step compares its own state
     * `id` against the attempt after its awaited work, and a fresh `CloudSignInAttemptState` fails
     * all of them, so no result of a step in flight reaches the attempt and no further post-auth
     * step is started from one. The person asked to start fresh, and the attempt they lost the
     * surface of does not get to drive the sign-in on behind that.
     *
     * That is narrower than "nothing writes across the reset", and the difference matters if you are
     * working here. Those comparisons gate the write-back only; they sit after the awaited work and
     * do not gate its identity side effects. `FlashcardsStore.completeCloudLink` runs its body
     * through `CloudSessionRuntime.runWorkspaceCompletion`, which awaits an unstructured `Task`, so
     * cancelling `postAuthSyncTask` cancels the wait and not that task: a `completeCloudLink`
     * already in flight when this runs still finishes its credential and workspace writes, and this
     * call does not stop it. That overlap is a known gap left open on purpose — closing it is a
     * larger change than this one.
     */
    func eraseLocalDataForCredentialRecovery() throws {
        guard self.cloudCredentialRecoveryState != nil else {
            throw LocalStoreError.validation("Cloud credential recovery is not active.")
        }

        self.endCloudSignInAttempt()
        try self.resetLocalStateForCloudIdentityChange()
    }

    @discardableResult
    func blockCloudSyncForCredentialRecoveryIfNeeded() -> Bool {
        guard self.cloudCredentialRecoveryState != nil else {
            return false
        }

        self.blockCloudSyncForCredentialRecovery()
        return true
    }

    func throwIfCloudCredentialRecoveryRequired() throws {
        guard let recoveryState = self.cloudCredentialRecoveryState else {
            return
        }

        self.blockCloudSyncForCredentialRecovery()
        throw LocalStoreError.validation(
            localizedCloudCredentialRecoveryBlockedMessage(reason: recoveryState.reason)
        )
    }

    func throwIfCredentialRecoveryBlocksPendingGuestUpgrade() throws {
        guard let reason = self.cloudCredentialRecoveryState?.reason,
            reason == .invalidStoredState || reason == .linkedWorkspaceUnavailable else {
            return
        }

        try self.throwIfCloudCredentialRecoveryRequired()
    }

    func throwIfLinkedWorkspaceUnavailableRecoveryRequired() throws {
        guard self.cloudCredentialRecoveryState?.reason == .linkedWorkspaceUnavailable else {
            return
        }

        try self.throwIfCloudCredentialRecoveryRequired()
    }

    func validateCloudCredentialRecoveryAccountBeforeIdentityReset(
        account: CloudAccountSnapshot,
        apiBaseUrl: String
    ) throws {
        try self.validateCloudCredentialRecoveryUserBeforeIdentitySideEffects(
            userId: account.userId,
            email: account.email,
            apiBaseUrl: apiBaseUrl
        )
    }

    func validateCloudCredentialRecoveryUserBeforeIdentitySideEffects(
        userId: String,
        email: String?,
        apiBaseUrl: String
    ) throws {
        guard let recoveryState = self.cloudCredentialRecoveryState else {
            return
        }

        if let expectedUserId = try self.completedPendingGuestUpgradeRecoveryUserId(apiBaseUrl: apiBaseUrl) {
            guard userId == expectedUserId else {
                self.blockCloudSyncForCredentialRecovery()
                throw LocalStoreError.validation(
                    localizedCloudCredentialRecoveryInterruptedUpgradeAccountMessage()
                )
            }
            return
        }
        if let expectedUserId = try self.inFlightPendingGuestUpgradeRecoveryUserId(apiBaseUrl: apiBaseUrl) {
            guard userId == expectedUserId else {
                self.blockCloudSyncForCredentialRecovery()
                throw LocalStoreError.validation(
                    localizedCloudCredentialRecoveryInterruptedUpgradeAccountMessage()
                )
            }
            return
        }

        try self.validateLinkedCredentialRecoveryIdentityBeforeSideEffects(
            recoveryState: recoveryState,
            userId: userId,
            email: email,
            apiBaseUrl: apiBaseUrl
        )
    }

    func validateCloudCredentialRecoveryWorkspaceSelectionBeforeIdentitySideEffects(
        selection: CloudWorkspaceLinkSelection,
        apiBaseUrl: String
    ) throws {
        guard let recoveryState = self.cloudCredentialRecoveryState else {
            return
        }

        if recoveryState.reason == .invalidStoredState {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(
                localizedCloudCredentialRecoveryBlockedMessage(reason: recoveryState.reason)
            )
        }

        guard recoveryState.reason.requiresOriginalLinkedIdentity else {
            return
        }
        guard recoveryState.previousCloudState == .linked else {
            return
        }
        try self.validateLinkedCredentialRecoveryConfiguration(
            recoveryState: recoveryState,
            apiBaseUrl: apiBaseUrl
        )
        guard let expectedWorkspaceId = self.linkedCredentialRecoveryTargetWorkspaceId(
            recoveryState: recoveryState
        ) else {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(localizedCloudCredentialRecoveryWrongLinkedWorkspaceMessage())
        }

        switch selection {
        case .existing(let selectedWorkspaceId):
            guard selectedWorkspaceId == expectedWorkspaceId else {
                self.blockCloudSyncForCredentialRecovery()
                throw LocalStoreError.validation(localizedCloudCredentialRecoveryWrongLinkedWorkspaceMessage())
            }
        case .createNew:
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(localizedCloudCredentialRecoveryWrongLinkedWorkspaceMessage())
        }
    }

    func linkedCredentialRecoveryWorkspaceBeforeIdentitySideEffects(
        account: CloudAccountSnapshot,
        apiBaseUrl: String
    ) throws -> CloudWorkspaceSummary {
        guard let recoveryState = self.cloudCredentialRecoveryState else {
            throw LocalStoreError.uninitialized("Cloud credential recovery state is unavailable")
        }
        try self.validateLinkedCredentialRecoveryIdentityBeforeSideEffects(
            recoveryState: recoveryState,
            userId: account.userId,
            email: account.email,
            apiBaseUrl: apiBaseUrl
        )
        guard let expectedWorkspaceId = self.linkedCredentialRecoveryTargetWorkspaceId(
            recoveryState: recoveryState
        ) else {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(localizedCloudCredentialRecoveryWrongLinkedWorkspaceMessage())
        }
        guard let expectedWorkspace = account.workspaces.first(where: { workspace in
            workspace.workspaceId == expectedWorkspaceId
        }) else {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(localizedCloudCredentialRecoveryWrongLinkedWorkspaceMessage())
        }

        return expectedWorkspace
    }

    func validatePostAuthRecoveryRouteBeforeCloudLinkCompletion(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) throws {
        switch linkContext.postAuthRecoveryRoute {
        case .none:
            return
        case .linkedCredentialRestore:
            guard self.cloudCredentialRecoveryState != nil else {
                throw LocalStoreError.uninitialized("Linked credential recovery state is unavailable")
            }
            try self.validateCloudCredentialRecoveryUserBeforeIdentitySideEffects(
                userId: linkContext.userId,
                email: linkContext.email,
                apiBaseUrl: linkContext.apiBaseUrl
            )
            try self.validateCloudCredentialRecoveryWorkspaceSelectionBeforeIdentitySideEffects(
                selection: selection,
                apiBaseUrl: linkContext.apiBaseUrl
            )
        case .guestLocalRecovery:
            try self.validateGuestLocalRecoveryBeforeCloudLinkCompletion(
                linkContext: linkContext,
                selection: selection
            )
        case .pendingGuestUpgradeMissingGuestSessionRecovery:
            try self.throwIfGuestLocalRecoveryRequired()
        case .pendingGuestUpgradeRecovery:
            return
        }
    }

    @discardableResult
    func validateGuestLocalRecoveryBeforeCloudLinkCompletion(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) throws -> CloudCredentialRecoveryState {
        guard let recoveryState = self.cloudCredentialRecoveryState else {
            throw LocalStoreError.uninitialized("Guest local recovery state is unavailable")
        }

        try self.validateGuestLocalRecoveryState(
            recoveryState: recoveryState,
            apiBaseUrl: linkContext.apiBaseUrl
        )
        guard linkContext.guestUpgradeMode == nil else {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(
                localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing)
            )
        }
        switch selection {
        case .createNew:
            break
        case .existing:
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(
                localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing)
            )
        }

        try self.validateNoPendingGuestUpgradeStateForGuestLocalRecovery(apiBaseUrl: linkContext.apiBaseUrl)
        return recoveryState
    }

    func throwIfGuestLocalRecoveryRequired() throws {
        guard let recoveryState = self.cloudCredentialRecoveryState else {
            throw LocalStoreError.uninitialized("Guest local recovery state is unavailable")
        }
        guard recoveryState.reason == .guestSessionMissing else {
            try self.throwIfCloudCredentialRecoveryRequired()
            return
        }

        self.blockCloudSyncForCredentialRecovery()
        throw LocalStoreError.validation(
            localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing)
        )
    }

    func shouldPreserveLocalDataForCloudCredentialRecovery(
        linkedSession: CloudLinkedSession
    ) throws -> Bool {
        guard let recoveryState = self.cloudCredentialRecoveryState else {
            return false
        }

        switch recoveryState.reason {
        case .guestSessionMissing:
            try self.validateGuestLocalRecoveryState(
                recoveryState: recoveryState,
                apiBaseUrl: linkedSession.apiBaseUrl
            )
            return true
        case .linkedCredentialsMissing, .linkedWorkspaceUnavailable:
            try self.validateLinkedCredentialRecoveryConfiguration(
                recoveryState: recoveryState,
                apiBaseUrl: linkedSession.apiBaseUrl
            )
            guard let expectedWorkspaceId = self.linkedCredentialRecoveryTargetWorkspaceId(
                recoveryState: recoveryState
            ) else {
                return false
            }
            return linkedSession.workspaceId == expectedWorkspaceId
        case .invalidStoredState:
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(
                localizedCloudCredentialRecoveryBlockedMessage(reason: recoveryState.reason)
            )
        }
    }

    func enforceCloudCredentialRecoveryGateOutsideIdentityResolution(detectedAt: Date) throws {
        if self.isCloudIdentityResolutionInProgress {
            return
        }

        try self.throwIfCloudCredentialRecoveryRequired()
        if try self.markCloudCredentialRecoveryForMissingPersistedCredentialsIfNeeded(detectedAt: detectedAt) {
            try self.throwIfCloudCredentialRecoveryRequired()
        }
    }

    private var isCloudIdentityResolutionInProgress: Bool {
        self.cloudRuntime.state.activeCloudLinkTask != nil
            || self.cloudRuntime.state.activeWorkspaceCompletionTask != nil
    }

    @discardableResult
    func markLinkedCredentialRecoveryForMissingCredentialsIfNeeded(
        detectedAt: Date
    ) throws -> Bool {
        guard let cloudSettings = self.cloudSettings, cloudSettings.cloudState == .linked else {
            return false
        }

        return try self.markLinkedCredentialRecoveryForMissingCredentialsIfNeeded(
            cloudSettings: cloudSettings,
            detectedAt: detectedAt
        )
    }

    @discardableResult
    func markLinkedCredentialRecoveryForMissingCredentialsIfNeeded(
        cloudSettings: CloudSettings,
        detectedAt: Date
    ) throws -> Bool {
        guard try self.cloudRuntime.loadCredentials() == nil else {
            return false
        }

        let configuration = try self.currentCloudServiceConfiguration()
        try self.markCloudCredentialRecoveryRequired(
            reason: .linkedCredentialsMissing,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: detectedAt
        )
        return true
    }

    @discardableResult
    func markCloudCredentialRecoveryForMissingPersistedCredentialsIfNeeded(
        detectedAt: Date
    ) throws -> Bool {
        guard let cloudSettings = self.cloudSettings else {
            return false
        }

        switch cloudSettings.cloudState {
        case .linked:
            return try self.markLinkedCredentialRecoveryForMissingCredentialsIfNeeded(detectedAt: detectedAt)
        case .guest:
            guard try self.loadUsableGuestSessionForCurrentConfiguration() == nil else {
                return false
            }

            let configuration = try self.currentCloudServiceConfiguration()
            try self.markCloudCredentialRecoveryRequired(
                reason: .guestSessionMissing,
                cloudSettings: cloudSettings,
                configuration: configuration,
                detectedAt: detectedAt
            )
            return true
        case .disconnected, .linkingReady:
            return false
        }
    }

    func loadUsableGuestSessionForCurrentConfiguration() throws -> StoredGuestCloudSession? {
        if let storedGuestSession = try self.loadGuestSessionForCurrentConfiguration() {
            return storedGuestSession
        }

        guard let activeGuestSession = try self.activeGuestSessionForCurrentConfiguration() else {
            return nil
        }

        try self.dependencies.guestCredentialStore.saveGuestSession(session: activeGuestSession)
        // The record now names the session this install is already running its cloud state on, so an
        // analytics-only marker from the credential it replaced describes nothing: it names a token
        // the record no longer holds, and `isAnalyticsOnlyGuestSession` matches by value, so it
        // mismatches rather than hiding this session. Swept here only so the sidecar stops carrying a
        // dead token, and best-effort for that reason — this loader gates guest upgrade and cloud
        // session paths that must not fail on an analytics bookkeeping question, and the next read
        // recognises and sweeps it again.
        try? self.dependencies.guestCredentialStore.clearAnalyticsOnlyGuestToken()
        return activeGuestSession
    }

    private func activeGuestSessionForCurrentConfiguration() throws -> StoredGuestCloudSession? {
        let configuration = try self.currentCloudServiceConfiguration()
        guard let activeSession = self.cloudRuntime.activeCloudSession(),
            case .guest(let guestToken) = activeSession.authorization,
            activeSession.apiBaseUrl == configuration.apiBaseUrl,
            activeSession.configurationMode == configuration.mode else {
            return nil
        }

        if let cloudSettings = self.cloudSettings, cloudSettings.cloudState == .guest {
            if let linkedUserId = cloudSettings.linkedUserId, linkedUserId != activeSession.userId {
                return nil
            }
            if let linkedWorkspaceId = cloudSettings.linkedWorkspaceId,
                linkedWorkspaceId != activeSession.workspaceId {
                return nil
            }
            if let activeWorkspaceId = cloudSettings.activeWorkspaceId,
                activeWorkspaceId != activeSession.workspaceId {
                return nil
            }
        }

        return StoredGuestCloudSession(
            guestToken: guestToken,
            userId: activeSession.userId,
            workspaceId: activeSession.workspaceId,
            configurationMode: activeSession.configurationMode,
            apiBaseUrl: activeSession.apiBaseUrl
        )
    }

    func blockCloudSyncForCredentialRecovery() {
        guard let recoveryState = self.cloudCredentialRecoveryState else {
            return
        }

        self.cloudRuntime.cancelForWorkspaceSwitch()
        self.cloudRuntime.disconnectSession()
        self.syncStatus = .blocked(
            message: localizedCloudCredentialRecoveryBlockedMessage(reason: recoveryState.reason)
        )
        self.globalErrorMessage = ""
    }

    private func validateLinkedCredentialRecoveryIdentityBeforeSideEffects(
        recoveryState: CloudCredentialRecoveryState,
        userId: String,
        email: String?,
        apiBaseUrl: String
    ) throws {
        if recoveryState.reason == .invalidStoredState {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(
                localizedCloudCredentialRecoveryBlockedMessage(reason: recoveryState.reason)
            )
        }

        guard recoveryState.reason.requiresOriginalLinkedIdentity else {
            return
        }
        guard recoveryState.previousCloudState == .linked else {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(localizedCloudCredentialRecoveryWrongLinkedAccountMessage())
        }
        try self.validateLinkedCredentialRecoveryConfiguration(
            recoveryState: recoveryState,
            apiBaseUrl: apiBaseUrl
        )
        if let linkedUserId = recoveryState.linkedUserId, linkedUserId.isEmpty == false {
            guard userId == linkedUserId else {
                self.blockCloudSyncForCredentialRecovery()
                throw LocalStoreError.validation(localizedCloudCredentialRecoveryWrongLinkedAccountMessage())
            }
            return
        }
        if let linkedEmail = normalizedCloudCredentialRecoveryEmail(recoveryState.linkedEmail) {
            guard normalizedCloudCredentialRecoveryEmail(email) == linkedEmail else {
                self.blockCloudSyncForCredentialRecovery()
                throw LocalStoreError.validation(localizedCloudCredentialRecoveryWrongLinkedAccountMessage())
            }
            return
        }

        self.blockCloudSyncForCredentialRecovery()
        throw LocalStoreError.validation(localizedCloudCredentialRecoveryWrongLinkedAccountMessage())
    }

    private func validateLinkedCredentialRecoveryConfiguration(
        recoveryState: CloudCredentialRecoveryState,
        apiBaseUrl: String
    ) throws {
        guard recoveryState.previousCloudState == .linked,
            recoveryState.apiBaseUrl == apiBaseUrl else {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(localizedCloudCredentialRecoveryWrongLinkedAccountMessage())
        }

        let configuration = try self.currentCloudServiceConfiguration()
        guard recoveryState.configurationMode == configuration.mode else {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(localizedCloudCredentialRecoveryWrongLinkedAccountMessage())
        }
    }

    private func linkedCredentialRecoveryTargetWorkspaceId(
        recoveryState: CloudCredentialRecoveryState
    ) -> String? {
        if let activeWorkspaceId = recoveryState.activeWorkspaceId, activeWorkspaceId.isEmpty == false {
            return activeWorkspaceId
        }
        if let linkedWorkspaceId = recoveryState.linkedWorkspaceId, linkedWorkspaceId.isEmpty == false {
            return linkedWorkspaceId
        }

        return nil
    }

    func validateGuestLocalRecoveryState(
        recoveryState: CloudCredentialRecoveryState,
        apiBaseUrl: String
    ) throws {
        guard recoveryState.reason == .guestSessionMissing,
            recoveryState.previousCloudState == .guest,
            recoveryState.apiBaseUrl == apiBaseUrl else {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(
                localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing)
            )
        }

        let configuration = try self.currentCloudServiceConfiguration()
        guard recoveryState.configurationMode == configuration.mode,
            recoveryState.apiBaseUrl == configuration.apiBaseUrl else {
            self.blockCloudSyncForCredentialRecovery()
            throw LocalStoreError.validation(
                localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing)
            )
        }
    }
}

private func normalizedCloudCredentialRecoveryEmail(_ email: String?) -> String? {
    guard let email else {
        return nil
    }

    let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard normalizedEmail.isEmpty == false else {
        return nil
    }

    return normalizedEmail
}
