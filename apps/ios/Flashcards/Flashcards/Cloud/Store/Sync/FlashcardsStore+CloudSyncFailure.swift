import Foundation

@MainActor
extension FlashcardsStore {
    func syncStatusForCloudFailure(
        error: Error,
        fallbackCloudState: CloudAccountState?,
        trigger: CloudSyncTrigger
    ) -> SyncStatus {
        if self.isCustomGuestWorkspacePaused {
            return .blocked(message: localizedCustomGuestWorkspacePauseMessage())
        }
        return self.syncStatus(
            decision: CloudSyncFailurePolicy.statusDecision(
                recoveryReason: self.cloudCredentialRecoveryState?.reason,
                postAuthenticationFailureIsIdle: trigger.source == .postAuth,
                identityConflictMessage: self.blockedCloudIdentityConflictMessage(error: error),
                failureMessage: Flashcards.errorMessage(error: error),
                fallback: .cloudState(fallbackCloudState)
            )
        )
    }

    func transitionSyncStatusForCloudFailure(error: Error) -> SyncStatus {
        if self.isCustomGuestWorkspacePaused {
            return .blocked(message: localizedCustomGuestWorkspacePauseMessage())
        }
        return self.syncStatus(
            decision: CloudSyncFailurePolicy.statusDecision(
                recoveryReason: self.cloudCredentialRecoveryState?.reason,
                postAuthenticationFailureIsIdle: false,
                identityConflictMessage: self.blockedCloudIdentityConflictMessage(error: error),
                failureMessage: Flashcards.errorMessage(error: error),
                fallback: .failed
            )
        )
    }

    func transitionSyncStatusForCloudFailure(error: Error, trigger: CloudSyncTrigger) -> SyncStatus {
        if self.isCustomGuestWorkspacePaused {
            return .blocked(message: localizedCustomGuestWorkspacePauseMessage())
        }
        return self.syncStatus(
            decision: CloudSyncFailurePolicy.statusDecision(
                recoveryReason: self.cloudCredentialRecoveryState?.reason,
                postAuthenticationFailureIsIdle: trigger.source == .postAuth,
                identityConflictMessage: self.blockedCloudIdentityConflictMessage(error: error),
                failureMessage: Flashcards.errorMessage(error: error),
                fallback: .failed
            )
        )
    }

    func blockedCloudIdentityConflictMessage(error: Error) -> String? {
        guard CloudSyncFailurePolicy.isBlockedIdentityConflict(error: error) else {
            return nil
        }
        return Flashcards.errorMessage(error: error)
    }

    func captureCloudSyncFailure(
        error: Error,
        linkedSession: CloudLinkedSession,
        fallbackCloudState: CloudAccountState?,
        action: String,
        captureContext: TechnicalErrorCaptureContext?
    ) {
        let diagnostics = CloudSyncFailurePolicy.diagnostics(error: error)
        let scope = IOSObservationScope(
            feature: .cloudSync,
            userId: linkedSession.userId,
            workspaceId: linkedSession.workspaceId,
            requestId: diagnostics.requestId,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: fallbackCloudState ?? self.cloudSettings?.cloudState,
            configurationMode: linkedSession.configurationMode
        )
        self.markTechnicalErrorCaptured(captureContext: captureContext)
        FlashcardsObservability.captureException(
            .cloudSyncFailed(
                error: error,
                scope: scope,
                details: CloudSyncFailureDetails(
                    action: action,
                    statusCode: diagnostics.statusCode,
                    backendCode: diagnostics.backendCode,
                    requestId: diagnostics.requestId,
                    messageSummary: Flashcards.errorMessage(error: error)
                )
            )
        )
    }

    @discardableResult
    func captureCloudSyncFailureIfNeeded(
        error: Error,
        linkedSession: CloudLinkedSession,
        fallbackCloudState: CloudAccountState?,
        trigger: CloudSyncTrigger,
        action: String
    ) -> Bool {
        if let pauseState = self.customGuestWorkspacePauseState,
            let installationId = self.cloudSettings?.installationId,
            customGuestWorkspacePauseMatchesSession(
                pauseState: pauseState,
                linkedSession: linkedSession,
                installationId: installationId
            ),
            let localStoreError = error as? LocalStoreError,
            case .validation(let message) = localStoreError,
            message == localizedCustomGuestWorkspacePauseMessage() {
            return false
        }
        if let pauseState = self.customGuestWorkspacePauseState,
            let installationId = self.cloudSettings?.installationId,
            let syncError = error as? CloudSyncError,
            case .invalidResponse(let details, let statusCode) = syncError,
            statusCode == pauseState.statusCode,
            details.code == pauseState.backendCode,
            customGuestWorkspacePauseMatchesSession(
                pauseState: pauseState,
                linkedSession: linkedSession,
                installationId: installationId
            ) {
            return false
        }
        if self.cloudCredentialRecoveryState?.reason == .linkedWorkspaceUnavailable,
            let localStoreError = error as? LocalStoreError,
            case .validation(let message) = localStoreError,
            message == localizedCloudCredentialRecoveryBlockedMessage(reason: .linkedWorkspaceUnavailable) {
            return false
        }
        if isLinkedWorkspaceUnavailableCloudSyncResponse(
            error: error,
            linkedSession: linkedSession,
            cloudSettings: self.cloudSettings
        ) {
            return false
        }
        guard self.shouldCaptureCloudSyncFailure(error: error, trigger: trigger) else {
            return false
        }

        self.captureCloudSyncFailure(
            error: error,
            linkedSession: linkedSession,
            fallbackCloudState: fallbackCloudState,
            action: action,
            captureContext: trigger.technicalErrorCaptureContext
        )
        return true
    }

    func captureMediaUploadTransferProcessingFailure(error: Error, linkedSession: CloudLinkedSession) {
        if isSilentlyIgnorableNetworkTransportFailure(error: error) {
            return
        }

        let diagnostics = CloudSyncFailurePolicy.diagnostics(error: error)
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: IOSObservationScope(
                feature: .cloudSync,
                userId: linkedSession.userId,
                workspaceId: linkedSession.workspaceId,
                requestId: diagnostics.requestId,
                clientRequestId: nil,
                sessionId: nil,
                runId: nil,
                cloudState: self.cloudSettings?.cloudState,
                configurationMode: linkedSession.configurationMode
            ),
            action: "media_upload_transfer_process",
            stage: "after_cloud_sync",
            statusCode: diagnostics.statusCode,
            backendCode: diagnostics.backendCode,
            requestId: diagnostics.requestId
        )
    }

    private func syncStatus(decision: CloudSyncFailureStatusDecision) -> SyncStatus {
        switch decision {
        case .blockedForRecovery(let reason):
            return .blocked(message: localizedCloudCredentialRecoveryBlockedMessage(reason: reason))
        case .idle:
            return .idle
        case .blockedForIdentityConflict(let message):
            return .blocked(message: message)
        case .failed(let message):
            return .failed(message: message)
        }
    }

    private func shouldCaptureCloudSyncFailure(error: Error, trigger: CloudSyncTrigger) -> Bool {
        if isRequestCancellationError(error: error) {
            return false
        }
        if self.blockedCloudIdentityConflictMessage(error: error) != nil {
            return false
        }
        if isRetryableNetworkTransportFailure(error: error) {
            return false
        }
        if trigger.capturesTechnicalFailures {
            return true
        }

        return self.isCloudAccountDeletedError(error)
    }
}
