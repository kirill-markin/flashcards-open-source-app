import Foundation

/**
 * Admits a repeated technical sync failure from a trigger that captures nothing today.
 *
 * Kept here rather than by flipping `capturesTechnicalFailures` at the trigger sites: that flag says
 * what a trigger is for, while the exception is not a property of any one trigger but a property of
 * the failure repeating. So it belongs at the single gate that already decides what a capture is
 * worth, and it applies by one rule — every trigger that captures nothing reaches it, whether the
 * sync it runs is automatic or user-initiated.
 *
 * Process state with no clearing path, so the bound it enforces is a bound per app launch. Identity
 * is carried in the counting key instead, so no boundary has to remember to clear it.
 */
@MainActor
private var cloudSyncFailureRepetitionGate: CloudSyncFailureRepetitionGate = CloudSyncFailureRepetitionGate()

private enum CloudSyncFailureCaptureDecision {
    case skip
    /// The trigger asked for technical captures, so the caller presents the error as observed too.
    case triggerOwnedCapture
    /// The repetition gate admitted it. Reported to Sentry and otherwise invisible: the caller runs
    /// exactly the error flow it would have run had nothing been captured.
    case repetitionCapture
}

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

    /// Reports whether the caller must present the thrown error as an observed technical error, which
    /// a repetition-gate capture deliberately is not: it reaches Sentry and still returns `false`.
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
        switch self.cloudSyncFailureCaptureDecision(
            error: error,
            trigger: trigger,
            action: action,
            linkedSession: linkedSession
        ) {
        case .skip:
            return false
        case .triggerOwnedCapture:
            self.captureCloudSyncFailure(
                error: error,
                linkedSession: linkedSession,
                fallbackCloudState: fallbackCloudState,
                action: action,
                captureContext: trigger.technicalErrorCaptureContext
            )
            return true
        case .repetitionCapture:
            // Reporting `false`, and passing no capture context, is the whole contract of this branch.
            // Every caller spends the returned flag as
            // `throw didCapture ? markTechnicalErrorObserved(error:) : error`, so reporting `true`
            // would replace the thrown error with an `ObservedTechnicalError` box that downstream
            // `error as?` classification no longer matches — turning silent retries into new Sentry
            // noise, which is the opposite of what this gate is for. The nil context is passed
            // explicitly rather than taken from `trigger.technicalErrorCaptureContext`, because the
            // designated `CloudSyncTrigger` initializer can pair a non-nil context with
            // `capturesTechnicalFailures: false`.
            self.captureCloudSyncFailure(
                error: error,
                linkedSession: linkedSession,
                fallbackCloudState: fallbackCloudState,
                action: action,
                captureContext: nil
            )
            return false
        }
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

    private func cloudSyncFailureCaptureDecision(
        error: Error,
        trigger: CloudSyncTrigger,
        action: String,
        linkedSession: CloudLinkedSession
    ) -> CloudSyncFailureCaptureDecision {
        if isRequestCancellationError(error: error) {
            return .skip
        }
        if self.blockedCloudIdentityConflictMessage(error: error) != nil {
            return .skip
        }
        if isRetryableNetworkTransportFailure(error: error) {
            return .skip
        }
        if trigger.capturesTechnicalFailures {
            return .triggerOwnedCapture
        }
        if self.isCloudAccountDeletedError(error) {
            return .triggerOwnedCapture
        }

        // Everything a cancellation, an identity conflict or a retryable transport failure explains has
        // already returned above, so what reaches the repetition gate is an unexplained failure from a
        // trigger that reports nothing. Repeated, that is the one thing here worth waking Sentry for.
        guard cloudSyncFailureRepetitionGate.admitsCapture(
            signature: cloudSyncFailureRepetitionSignature(
                error: error,
                action: action,
                linkedSession: linkedSession
            )
        ) else {
            return .skip
        }
        return .repetitionCapture
    }
}
