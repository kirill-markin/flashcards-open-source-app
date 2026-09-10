import Foundation

private let linkedWorkspaceUnavailableErrorCode: String = "WORKSPACE_NOT_FOUND"
private let customGuestWorkspaceUnavailableStatusCode: Int = 404

func isLinkedWorkspaceUnavailableCloudSyncResponse(
    error: Error,
    linkedSession: CloudLinkedSession,
    cloudSettings: CloudSettings?
) -> Bool {
    guard linkedSession.authorization.isGuest == false else {
        return false
    }
    guard let cloudSettings, cloudSettings.cloudState == .linked else {
        return false
    }
    guard cloudSettings.linkedUserId == linkedSession.userId else {
        return false
    }
    let expectedWorkspaceId = cloudSettings.activeWorkspaceId ?? cloudSettings.linkedWorkspaceId
    guard expectedWorkspaceId == linkedSession.workspaceId else {
        return false
    }
    guard let syncError = error as? CloudSyncError,
        case .invalidResponse(let details, let statusCode) = syncError else {
        return false
    }

    return statusCode == 404 && details.code == linkedWorkspaceUnavailableErrorCode
}

func customGuestWorkspacePauseMatchesSession(
    pauseState: CustomGuestWorkspacePauseState,
    linkedSession: CloudLinkedSession,
    installationId: String
) -> Bool {
    pauseState.installationId == installationId
        && linkedSession.authorization.isGuest
        && linkedSession.configurationMode == .custom
        && pauseState.userId == linkedSession.userId
        && pauseState.workspaceId == linkedSession.workspaceId
        && pauseState.apiBaseUrl == linkedSession.apiBaseUrl
}

func customGuestWorkspacePauseMatchesStoredIdentity(
    pauseState: CustomGuestWorkspacePauseState,
    configuration: CloudServiceConfiguration,
    storedGuestSession: StoredGuestCloudSession,
    installationId: String
) -> Bool {
    pauseState.installationId == installationId
        && configuration.mode == .custom
        && configuration.apiBaseUrl == pauseState.apiBaseUrl
        && configuration.customOrigin == pauseState.customOrigin
        && storedGuestSession.configurationMode == .custom
        && storedGuestSession.apiBaseUrl == pauseState.apiBaseUrl
        && storedGuestSession.userId == pauseState.userId
        && storedGuestSession.workspaceId == pauseState.workspaceId
}

@MainActor
extension FlashcardsStore {
    var isCustomGuestWorkspacePaused: Bool {
        guard let pauseState = self.customGuestWorkspacePauseState,
            let installationId = self.cloudSettings?.installationId,
            pauseState.installationId == installationId else {
            return false
        }
        guard let activeSession = self.cloudRuntime.activeCloudSession() else {
            return true
        }

        return customGuestWorkspacePauseMatchesSession(
            pauseState: pauseState,
            linkedSession: activeSession,
            installationId: installationId
        )
    }

    func throwIfCustomGuestWorkspacePaused() throws {
        guard self.isCustomGuestWorkspacePaused else {
            return
        }

        self.blockCloudSyncForCustomGuestWorkspacePause()
        throw LocalStoreError.validation(localizedCustomGuestWorkspacePauseMessage())
    }

    func throwIfCustomGuestWorkspacePausedDuringSync(linkedSession: CloudLinkedSession) throws {
        guard let pauseState = self.customGuestWorkspacePauseState,
            let installationId = self.cloudSettings?.installationId,
            customGuestWorkspacePauseMatchesSession(
                pauseState: pauseState,
                linkedSession: linkedSession,
                installationId: installationId
            ) else {
            return
        }
        if self.customGuestWorkspaceRetrySession == linkedSession {
            return
        }

        self.blockCloudSyncForCustomGuestWorkspacePause()
        throw LocalStoreError.validation(localizedCustomGuestWorkspacePauseMessage())
    }

    func reconcileCustomGuestWorkspacePauseWithCurrentIdentity() throws {
        guard let pauseState = self.customGuestWorkspacePauseState else {
            return
        }
        guard let cloudSettings = self.cloudSettings,
            pauseState.installationId == cloudSettings.installationId else {
            self.clearCustomGuestWorkspacePause()
            return
        }
        guard self.cloudCredentialRecoveryState == nil else {
            self.clearCustomGuestWorkspacePause()
            return
        }

        let configuration: CloudServiceConfiguration
        do {
            configuration = try self.currentCloudServiceConfiguration()
        } catch {
            self.clearCustomGuestWorkspacePause()
            throw error
        }
        guard configuration.mode == .custom,
            configuration.apiBaseUrl == pauseState.apiBaseUrl,
            configuration.customOrigin == pauseState.customOrigin else {
            self.clearCustomGuestWorkspacePause()
            return
        }
        switch cloudSettings.cloudState {
        case .linked:
            self.clearCustomGuestWorkspacePause()
            return
        case .guest:
            let currentWorkspaceId = cloudSettings.activeWorkspaceId ?? cloudSettings.linkedWorkspaceId
            guard cloudSettings.linkedUserId == pauseState.userId,
                currentWorkspaceId == pauseState.workspaceId else {
                self.clearCustomGuestWorkspacePause()
                return
            }
        case .disconnected, .linkingReady:
            break
        }

        let storedGuestSession: StoredGuestCloudSession?
        do {
            storedGuestSession = try self.dependencies.guestCredentialStore.loadGuestSession()
        } catch GuestCloudCredentialStoreError.decodingFailed {
            try self.replaceCustomGuestWorkspacePauseWithCredentialRecovery(
                pauseState: pauseState,
                configuration: configuration,
                reason: .invalidStoredState
            )
            return
        } catch {
            self.blockCloudSyncForCustomGuestWorkspacePause()
            throw error
        }

        guard let storedGuestSession else {
            try self.replaceCustomGuestWorkspacePauseWithCredentialRecovery(
                pauseState: pauseState,
                configuration: configuration,
                reason: .guestSessionMissing
            )
            return
        }
        guard customGuestWorkspacePauseMatchesStoredIdentity(
            pauseState: pauseState,
            configuration: configuration,
            storedGuestSession: storedGuestSession,
            installationId: cloudSettings.installationId
        ) else {
            self.clearCustomGuestWorkspacePause()
            return
        }

        self.blockCloudSyncForCustomGuestWorkspacePause()
    }

    @discardableResult
    func enterCustomGuestWorkspacePauseIfNeeded(
        error: Error,
        linkedSession: CloudLinkedSession,
        detectedAt: Date
    ) throws -> Bool {
        guard linkedSession.authorization.isGuest,
            linkedSession.configurationMode == .custom,
            let syncError = error as? CloudSyncError,
            case .invalidResponse(let details, let statusCode) = syncError,
            statusCode == customGuestWorkspaceUnavailableStatusCode,
            details.code == linkedWorkspaceUnavailableErrorCode else {
            return false
        }

        let configuration = try self.currentCloudServiceConfiguration()
        guard configuration.mode == .custom,
            configuration.apiBaseUrl == linkedSession.apiBaseUrl,
            let customOrigin = configuration.customOrigin,
            let cloudSettings = self.cloudSettings,
            let storedGuestSession = try self.dependencies.guestCredentialStore.loadGuestSession(),
            storedGuestSession.userId == linkedSession.userId,
            storedGuestSession.workspaceId == linkedSession.workspaceId,
            storedGuestSession.apiBaseUrl == linkedSession.apiBaseUrl,
            storedGuestSession.configurationMode == linkedSession.configurationMode,
            case .guest(let guestToken) = linkedSession.authorization,
            storedGuestSession.guestToken == guestToken else {
            return false
        }

        if let pauseState = self.customGuestWorkspacePauseState {
            if pauseState.installationId != cloudSettings.installationId {
                self.clearCustomGuestWorkspacePause()
            } else {
                guard customGuestWorkspacePauseMatchesSession(
                    pauseState: pauseState,
                    linkedSession: linkedSession,
                    installationId: cloudSettings.installationId
                ) else {
                    return false
                }
                self.blockCloudSyncForCustomGuestWorkspacePause()
                return true
            }
        }

        let pauseState = CustomGuestWorkspacePauseState(
            installationId: cloudSettings.installationId,
            userId: linkedSession.userId,
            workspaceId: linkedSession.workspaceId,
            apiBaseUrl: linkedSession.apiBaseUrl,
            customOrigin: customOrigin,
            statusCode: statusCode,
            backendCode: details.code ?? linkedWorkspaceUnavailableErrorCode,
            requestId: details.requestId,
            backendMessage: details.message,
            detectedAt: formatIsoTimestamp(date: detectedAt)
        )
        try saveCustomGuestWorkspacePauseState(
            state: pauseState,
            userDefaults: self.userDefaults,
            encoder: self.encoder
        )
        self.customGuestWorkspacePauseState = pauseState
        self.blockCloudSyncForCustomGuestWorkspacePause()
        self.captureCloudSyncFailure(
            error: error,
            linkedSession: linkedSession,
            fallbackCloudState: self.cloudSettings?.cloudState,
            action: "custom_guest_workspace_unavailable",
            captureContext: nil
        )
        return true
    }

    func retryCustomGuestWorkspace() async throws {
        try self.reconcileCustomGuestWorkspacePauseWithCurrentIdentity()
        if self.cloudCredentialRecoveryState != nil {
            try self.throwIfCloudCredentialRecoveryRequired()
        }
        guard let pauseState = self.customGuestWorkspacePauseState else {
            throw LocalStoreError.uninitialized("Custom guest workspace pause state is unavailable")
        }
        guard let installationId = self.cloudSettings?.installationId,
            pauseState.installationId == installationId else {
            self.clearCustomGuestWorkspacePause()
            throw LocalStoreError.uninitialized("Custom guest workspace pause state is unavailable")
        }
        let configuration = try self.currentCloudServiceConfiguration()
        guard configuration.mode == .custom,
            configuration.apiBaseUrl == pauseState.apiBaseUrl,
            let storedGuestSession = try self.dependencies.guestCredentialStore.loadGuestSession(),
            storedGuestSession.userId == pauseState.userId,
            storedGuestSession.workspaceId == pauseState.workspaceId,
            storedGuestSession.apiBaseUrl == pauseState.apiBaseUrl,
            storedGuestSession.configurationMode == .custom else {
            self.blockCloudSyncForCustomGuestWorkspacePause()
            throw LocalStoreError.validation(localizedCustomGuestWorkspacePauseMessage())
        }

        let retrySession = CloudLinkedSession(
            userId: storedGuestSession.userId,
            workspaceId: storedGuestSession.workspaceId,
            email: nil,
            configurationMode: storedGuestSession.configurationMode,
            apiBaseUrl: storedGuestSession.apiBaseUrl,
            authorization: .guest(storedGuestSession.guestToken)
        )
        self.customGuestWorkspaceRetrySession = retrySession
        self.syncStatus = .failed(message: localizedCustomGuestWorkspacePauseMessage())
        defer {
            self.customGuestWorkspaceRetrySession = nil
        }

        do {
            let trigger = self.manualCloudSyncTrigger(now: Date())
            let isAlreadyGuestLinked = self.cloudSettings?.cloudState == .guest
                && self.workspace?.workspaceId == retrySession.workspaceId
                && self.cloudSettings?.linkedUserId == retrySession.userId
            if isAlreadyGuestLinked {
                self.cloudRuntime.setActiveCloudSession(linkedSession: retrySession)
                try await self.performSameWorkspaceCloudRestore(
                    linkedSession: retrySession,
                    trigger: trigger
                )
            } else {
                try await self.finishCloudLink(linkedSession: retrySession, trigger: trigger)
            }
            guard self.customGuestWorkspacePauseState == pauseState else {
                throw CancellationError()
            }
            self.customGuestWorkspacePauseState = nil
            clearCustomGuestWorkspacePauseState(userDefaults: self.userDefaults)
            self.globalErrorMessage = ""
        } catch {
            if self.customGuestWorkspacePauseState == pauseState {
                self.blockCloudSyncForCustomGuestWorkspacePause()
            }
            throw error
        }
    }

    func clearCustomGuestWorkspacePause() {
        self.customGuestWorkspacePauseState = nil
        self.customGuestWorkspaceRetrySession = nil
        clearCustomGuestWorkspacePauseState(userDefaults: self.userDefaults)
        if case .blocked(let message) = self.syncStatus,
            message == localizedCustomGuestWorkspacePauseMessage() {
            self.syncStatus = .idle
        }
    }

    func blockCloudSyncForCustomGuestWorkspacePause() {
        guard self.isCustomGuestWorkspacePaused else {
            return
        }
        self.syncStatus = .blocked(message: localizedCustomGuestWorkspacePauseMessage())
        self.globalErrorMessage = ""
    }

    private func replaceCustomGuestWorkspacePauseWithCredentialRecovery(
        pauseState: CustomGuestWorkspacePauseState,
        configuration: CloudServiceConfiguration,
        reason: CloudCredentialRecoveryReason
    ) throws {
        guard let cloudSettings = self.cloudSettings,
            pauseState.installationId == cloudSettings.installationId else {
            self.clearCustomGuestWorkspacePause()
            return
        }

        let recoveryCloudSettings: CloudSettings
        switch cloudSettings.cloudState {
        case .linked:
            self.clearCustomGuestWorkspacePause()
            return
        case .guest:
            let currentWorkspaceId = cloudSettings.activeWorkspaceId ?? cloudSettings.linkedWorkspaceId
            guard cloudSettings.linkedUserId == pauseState.userId,
                currentWorkspaceId == pauseState.workspaceId else {
                self.clearCustomGuestWorkspacePause()
                return
            }
            recoveryCloudSettings = cloudSettings
        case .disconnected, .linkingReady:
            recoveryCloudSettings = CloudSettings(
                installationId: cloudSettings.installationId,
                cloudState: .guest,
                linkedUserId: pauseState.userId,
                linkedWorkspaceId: pauseState.workspaceId,
                activeWorkspaceId: pauseState.workspaceId,
                linkedEmail: nil,
                onboardingCompleted: cloudSettings.onboardingCompleted,
                updatedAt: cloudSettings.updatedAt
            )
        }

        try self.markCloudCredentialRecoveryRequired(
            reason: reason,
            cloudSettings: recoveryCloudSettings,
            configuration: configuration,
            detectedAt: Date()
        )
        self.clearCustomGuestWorkspacePause()
    }

    @discardableResult
    func enterLinkedWorkspaceUnavailableRecoveryIfNeeded(
        error: Error,
        linkedSession: CloudLinkedSession,
        detectedAt: Date
    ) async throws -> Bool {
        guard isLinkedWorkspaceUnavailableCloudSyncResponse(
            error: error,
            linkedSession: linkedSession,
            cloudSettings: self.cloudSettings
        ) else {
            return false
        }

        await self.cloudRuntime.waitForActiveCloudSyncToSettle()

        if let recoveryState = self.cloudCredentialRecoveryState {
            guard recoveryState.reason == .linkedWorkspaceUnavailable else {
                return false
            }
            self.blockCloudSyncForCredentialRecovery()
            return true
        }

        guard let cloudSettings = self.cloudSettings,
            isLinkedWorkspaceUnavailableCloudSyncResponse(
                error: error,
                linkedSession: linkedSession,
                cloudSettings: cloudSettings
            ) else {
            return false
        }
        let configuration = try self.currentCloudServiceConfiguration()
        try self.markCloudCredentialRecoveryRequired(
            reason: .linkedWorkspaceUnavailable,
            cloudSettings: cloudSettings,
            configuration: configuration,
            detectedAt: detectedAt
        )
        return true
    }
}
