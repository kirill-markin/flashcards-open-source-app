import Foundation

@MainActor
extension FlashcardsStore {
    var isAutomaticFeedbackPromptBlockedByModal: Bool {
        self.isSavedReviewPromptSurfaceAvailable == false
            || self.isPremiumPresentationActive
            || self.pendingStoreReviewRequestAttempt != nil
            || self.feedbackPresentation != nil
            || self.isGuestSignInAfterReviewPromptPresented
            || self.activeCloudSignInSheetCount > 0
            || self.accountDeletionState != .hidden
            || self.accountDeletionSuccessMessage != nil
            || self.reviewSubmissionFailure != nil
            || self.isReviewNotificationPrePromptPresented
            || self.isReviewHardReminderPresented
    }

    func presentFeedbackSheet(trigger: FeedbackTrigger) {
        self.feedbackPresentation = makeFeedbackPresentation(trigger: trigger, isTestPreview: false)
    }

    func presentAutomaticFeedbackPromptTestPreview() {
        self.feedbackPresentation = makeFeedbackPresentation(trigger: .automatic, isTestPreview: true)
    }

    func dismissFeedbackSheet() {
        self.feedbackPresentation = nil
    }

    func loadFeedbackDraftMessage() -> String {
        loadFeedbackDraft(
            identityKey: self.feedbackPromptIdentityKey,
            userDefaults: self.userDefaults
        )
    }

    func saveFeedbackDraftMessage(message: String) {
        saveFeedbackDraft(
            identityKey: self.feedbackPromptIdentityKey,
            message: message,
            userDefaults: self.userDefaults
        )
    }

    func submitFeedback(
        trigger: FeedbackTrigger,
        message: String
    ) async throws {
        let trimmedMessage = trimmedFeedbackMessage(message)
        guard trimmedMessage.isEmpty == false else {
            throw LocalStoreError.validation(
                aiSettingsLocalized("feedback.sheet.emptyMessageError", "Write feedback before sending.")
            )
        }
        guard trimmedMessage.count <= feedbackMessageMaximumCharacters else {
            throw LocalStoreError.validation(
                aiSettingsLocalizedFormat(
                    "feedback.sheet.messageTooLong",
                    "Keep feedback under %d characters.",
                    feedbackMessageMaximumCharacters
                )
            )
        }

        let now = Date()
        let request = makeFeedbackSubmissionRequest(
            workspaceId: self.workspace?.workspaceId,
            installationId: self.cloudSettings?.installationId,
            trigger: trigger,
            message: trimmedMessage,
            now: now
        )
        _ = try await self.withFeedbackCloudSession { cloudSyncService, session in
            try await cloudSyncService.submitFeedback(
                apiBaseUrl: session.apiBaseUrl,
                authorizationHeader: session.authorizationHeaderValue,
                request: request
            )
        }

        clearFeedbackDraft(
            identityKey: self.feedbackPromptIdentityKey,
            userDefaults: self.userDefaults
        )
        self.dismissFeedbackSheet()
        self.enqueueTransientBanner(banner: makeFeedbackSentBanner())
    }

    /// The cooldown counts only from the last automatic showing.
    func presentAutomaticFeedbackPromptIfDue(
        settings: ReviewPromptSettings,
        counters: ReviewPromptCounters,
        now: Date
    ) -> Bool {
        guard self.isAutomaticFeedbackPromptBlockedByModal == false,
              reviewPromptConfigAllows(
                settings: settings,
                counters: counters,
                lastShownAt: self.feedbackPromptState.lastAutomaticPromptShownAt,
                now: now
              ) else {
            return false
        }

        self.presentFeedbackSheet(trigger: .automatic)
        return true
    }

    func clearFeedbackPromptState() {
        self.feedbackPresentation = nil
        self.feedbackPromptState = makeDefaultFeedbackPromptState()
        clearFeedbackPromptPersistence(
            identityKey: self.feedbackPromptIdentityKey,
            userDefaults: self.userDefaults
        )
    }

    func clearAutomaticFeedbackPromptStateForTests() {
        self.updateFeedbackPromptState(state: makeDefaultFeedbackPromptState())
    }

    func reloadFeedbackPromptStateForCurrentIdentity() {
        self.feedbackPromptState = loadFeedbackPromptState(
            identityKey: self.feedbackPromptIdentityKey,
            userDefaults: self.userDefaults,
            decoder: self.decoder
        )
    }

    func recordAutomaticFeedbackPromptShownAfterPresentation(presentation: FeedbackPresentation) {
        guard presentation.trigger == .automatic, presentation.isTestPreview == false,
              self.feedbackPresentation?.id == presentation.id else { return }
        let shownAt = Date()
        let identityKey = self.feedbackPromptIdentityKey
        self.updateFeedbackPromptState(state: PersistedFeedbackPromptState(lastAutomaticPromptShownAt: shownAt))
        let request = makeFeedbackPromptEventRequest(
            workspaceId: self.workspace?.workspaceId,
            installationId: self.cloudSettings?.installationId,
            eventType: .automaticPromptShown,
            now: shownAt
        )
        Task { @MainActor [weak self] in
            guard let self, self.feedbackPromptIdentityKey == identityKey else { return }
            do {
                _ = try await self.withFeedbackCloudSession { cloudSyncService, session in
                    guard self.feedbackPromptIdentityKey == identityKey else { throw CancellationError() }
                    return try await cloudSyncService.recordFeedbackPromptEvent(
                        apiBaseUrl: session.apiBaseUrl,
                        authorizationHeader: session.authorizationHeaderValue,
                        request: request
                    )
                }
            } catch is CancellationError {
                return
            } catch {
                self.captureFeedbackSilentFailure(
                    error: error,
                    action: "automatic_feedback_prompt_check",
                    stage: "record_prompt_shown"
                )
            }
        }
    }

    private func withFeedbackCloudSession<Result>(
        operation: @MainActor (any CloudSyncServing, CloudLinkedSession) async throws -> Result
    ) async throws -> Result {
        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let session = try await self.cloudSessionForFeedback()
        return try await self.withCloudSessionPreservingStableContext(linkedSession: session) { refreshedSession in
            try await operation(cloudSyncService, refreshedSession)
        }
    }

    private func cloudSessionForFeedback() async throws -> CloudLinkedSession {
        try self.throwIfCloudCredentialRecoveryRequired()
        if case .blocked(let message) = self.syncStatus {
            throw LocalStoreError.validation(message)
        }
        if self.cloudSettings?.cloudState == .linked {
            if self.cloudRuntime.activeCloudSession() == nil {
                try await self.restoreCloudLinkFromStoredCredentials(trigger: self.manualCloudSyncTrigger(now: Date()))
            }

            return try await self.withAuthenticatedCloudSession { session in
                session
            }
        }

        let restoredGuestSession = try await self.restoreGuestCloudSessionIfNeeded(
            trigger: self.manualCloudSyncTrigger(now: Date())
        )
        return restoredGuestSession.session
    }

    private func updateFeedbackPromptState(state: PersistedFeedbackPromptState) {
        self.feedbackPromptState = state
        saveFeedbackPromptState(
            identityKey: self.feedbackPromptIdentityKey,
            state: state,
            userDefaults: self.userDefaults,
            encoder: self.encoder
        )
    }

    private var feedbackPromptIdentityKey: FeedbackPromptIdentityKey {
        makeFeedbackPromptIdentityKey(cloudSettings: self.cloudSettings)
    }

    private func captureFeedbackSilentFailure(
        error: Error,
        action: String,
        stage: String
    ) {
        let diagnostics = feedbackFailureDiagnostics(error: error)
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: IOSObservationScope(
                feature: .feedback,
                userId: self.cloudSettings?.linkedUserId,
                workspaceId: self.workspace?.workspaceId,
                requestId: diagnostics.requestId,
                clientRequestId: nil,
                sessionId: nil,
                runId: nil,
                cloudState: self.cloudSettings?.cloudState,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            ),
            action: action,
            stage: stage,
            statusCode: diagnostics.statusCode,
            backendCode: diagnostics.backendCode,
            requestId: diagnostics.requestId
        )
    }
}

private struct FeedbackFailureDiagnostics {
    let statusCode: Int?
    let backendCode: String?
    let requestId: String?
}

private func feedbackFailureDiagnostics(error: Error) -> FeedbackFailureDiagnostics {
    if let syncError = error as? CloudSyncError {
        switch syncError {
        case .invalidResponse(let details, let statusCode):
            return FeedbackFailureDiagnostics(
                statusCode: statusCode,
                backendCode: details.code,
                requestId: details.requestId
            )
        case .invalidBaseUrl:
            return FeedbackFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
        }
    }

    if let authError = error as? CloudAuthError {
        switch authError {
        case .invalidResponse(let details, let statusCode):
            return FeedbackFailureDiagnostics(
                statusCode: statusCode,
                backendCode: details.code,
                requestId: details.requestId
            )
        case .invalidBaseUrl, .invalidResponseBody:
            return FeedbackFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
        }
    }

    if let guestAuthError = error as? GuestCloudAuthError {
        switch guestAuthError {
        case .invalidResponse(let details, let statusCode):
            return FeedbackFailureDiagnostics(
                statusCode: statusCode,
                backendCode: details.code,
                requestId: details.requestId
            )
        case .invalidBaseUrl, .invalidResponseBody:
            return FeedbackFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
        }
    }

    return FeedbackFailureDiagnostics(statusCode: nil, backendCode: nil, requestId: nil)
}
