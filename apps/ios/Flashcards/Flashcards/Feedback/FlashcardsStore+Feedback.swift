import Foundation

@MainActor
extension FlashcardsStore {
    var isAutomaticFeedbackPromptBlockedByModal: Bool {
        self.feedbackPresentation != nil
            || self.isGuestSignInAfterReviewPromptPresented
            || self.activeCloudSignInSheetCount > 0
            || self.accountDeletionState != .hidden
            || self.accountDeletionSuccessMessage != nil
            || self.reviewSubmissionFailure != nil
            || self.isReviewNotificationPrePromptPresented
            || self.isReviewHardReminderPresented
    }

    func presentFeedbackSheet(trigger: FeedbackTrigger) {
        self.feedbackPresentation = makeFeedbackPresentation(trigger: trigger)
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
        let feedbackState = try await self.withFeedbackCloudSession { cloudSyncService, session in
            try await cloudSyncService.submitFeedback(
                apiBaseUrl: session.apiBaseUrl,
                authorizationHeader: session.authorizationHeaderValue,
                request: request
            )
        }

        self.updateFeedbackPromptState(
            state: makeFeedbackPromptStateAfterSubmission(
                promptState: self.feedbackPromptState,
                feedbackState: feedbackState,
                submittedAt: Date()
            )
        )
        clearFeedbackDraft(
            identityKey: self.feedbackPromptIdentityKey,
            userDefaults: self.userDefaults
        )
        self.dismissFeedbackSheet()
        self.enqueueTransientBanner(banner: makeFeedbackSentBanner())
    }

    func startAutomaticFeedbackPromptCheckAfterSuccessfulReview(now: Date) {
        guard self.activeAutomaticFeedbackPromptTask == nil else {
            return
        }
        if let nextRetryAt = self.nextAutomaticFeedbackPromptRetryAt {
            guard now >= nextRetryAt else {
                return
            }
            self.nextAutomaticFeedbackPromptRetryAt = nil
        }
        guard self.isAutomaticFeedbackPromptBlockedByModal == false else {
            return
        }
        guard isFeedbackAutomaticCooldownExpired(promptState: self.feedbackPromptState, now: now) else {
            return
        }

        let task = Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            defer {
                self.activeAutomaticFeedbackPromptTask = nil
            }
            await self.runAutomaticFeedbackPromptCheck(now: now)
        }
        self.activeAutomaticFeedbackPromptTask = task
    }

    func clearFeedbackPromptState() {
        self.feedbackPresentation = nil
        self.feedbackPromptState = makeDefaultFeedbackPromptState()
        self.activeAutomaticFeedbackPromptTask?.cancel()
        self.activeAutomaticFeedbackPromptTask = nil
        self.nextAutomaticFeedbackPromptRetryAt = nil
        clearFeedbackPromptPersistence(
            identityKey: self.feedbackPromptIdentityKey,
            userDefaults: self.userDefaults
        )
    }

    func reloadFeedbackPromptStateForCurrentIdentity() {
        self.nextAutomaticFeedbackPromptRetryAt = nil
        self.feedbackPromptState = loadFeedbackPromptState(
            identityKey: self.feedbackPromptIdentityKey,
            userDefaults: self.userDefaults,
            decoder: self.decoder
        )
    }

    private func runAutomaticFeedbackPromptCheck(now: Date) async {
        var failureStage: String = "start"
        do {
            failureStage = "resolve_workspace"
            guard let workspaceId = self.workspace?.workspaceId else {
                return
            }
            failureStage = "modal_gate"
            guard self.isAutomaticFeedbackPromptBlockedByModal == false else {
                return
            }
            failureStage = "local_cooldown_gate"
            guard isFeedbackAutomaticCooldownExpired(promptState: self.feedbackPromptState, now: now) else {
                return
            }

            failureStage = "load_review_activity"
            let database = try requireLocalDatabase(database: self.database)
            let reviewActivity = try database.loadFeedbackReviewActivitySummary(
                workspaceId: workspaceId,
                now: now,
                timeZone: TimeZone.current
            )
            failureStage = "previous_review_day_gate"
            guard reviewActivity.hasPreviousLocalReviewDay else {
                return
            }
            failureStage = "current_day_review_count_gate"
            guard reviewActivity.currentLocalDayReviewCount >= feedbackAutomaticReviewThreshold else {
                return
            }

            if shouldFetchFeedbackServerState(promptState: self.feedbackPromptState, now: now) {
                failureStage = "load_feedback_state"
                let feedbackState = try await self.loadFeedbackStateFromServer()
                self.updateFeedbackPromptState(
                    state: applyFeedbackServerState(
                        promptState: self.feedbackPromptState,
                        feedbackState: feedbackState,
                        fetchedAt: Date()
                    )
                )
            }
            failureStage = "post_server_cooldown_gate"
            guard isFeedbackAutomaticCooldownExpired(promptState: self.feedbackPromptState, now: Date()) else {
                return
            }
            failureStage = "post_server_modal_gate"
            guard self.isAutomaticFeedbackPromptBlockedByModal == false else {
                return
            }

            failureStage = "record_prompt_shown"
            let shownAt = Date()
            let feedbackState = try await self.recordAutomaticFeedbackPromptShown(now: shownAt)
            self.updateFeedbackPromptState(
                state: makeFeedbackPromptStateAfterAutomaticPromptShown(
                    promptState: self.feedbackPromptState,
                    feedbackState: feedbackState,
                    shownAt: shownAt
                )
            )
            failureStage = "present_sheet"
            self.nextAutomaticFeedbackPromptRetryAt = nil
            self.presentFeedbackSheet(trigger: .automatic)
        } catch is CancellationError {
            return
        } catch {
            if self.shouldRetryAutomaticFeedbackPromptSilently(error: error, stage: failureStage) {
                self.nextAutomaticFeedbackPromptRetryAt = Date().addingTimeInterval(
                    feedbackAutomaticPromptFailureBackoffSeconds
                )
                return
            }
            self.captureFeedbackSilentFailure(
                error: error,
                action: "automatic_feedback_prompt_check",
                stage: failureStage
            )
            return
        }
    }

    private func loadFeedbackStateFromServer() async throws -> FeedbackState {
        try await self.withFeedbackCloudSession { cloudSyncService, session in
            try await cloudSyncService.loadFeedbackState(
                apiBaseUrl: session.apiBaseUrl,
                authorizationHeader: session.authorizationHeaderValue
            )
        }
    }

    private func recordAutomaticFeedbackPromptShown(now: Date) async throws -> FeedbackState {
        let request = makeFeedbackPromptEventRequest(
            workspaceId: self.workspace?.workspaceId,
            installationId: self.cloudSettings?.installationId,
            eventType: .automaticPromptShown,
            now: now
        )
        return try await self.withFeedbackCloudSession { cloudSyncService, session in
            try await cloudSyncService.recordFeedbackPromptEvent(
                apiBaseUrl: session.apiBaseUrl,
                authorizationHeader: session.authorizationHeaderValue,
                request: request
            )
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

    private func shouldRetryAutomaticFeedbackPromptSilently(
        error: Error,
        stage: String
    ) -> Bool {
        guard isFeedbackAutomaticPromptServerStage(stage: stage) else {
            return false
        }
        if isRequestCancellationError(error: error) {
            return true
        }
        if isRetryableNetworkTransportFailure(error: error) {
            return true
        }
        if let statusCode = feedbackFailureDiagnostics(error: error).statusCode,
           isRetryableFeedbackAutomaticPromptStatusCode(statusCode) {
            return true
        }
        return self.isAutomaticFeedbackPromptBlockedGateFailure(error: error)
    }

    private func isAutomaticFeedbackPromptBlockedGateFailure(error: Error) -> Bool {
        guard case .blocked(let blockedMessage) = self.syncStatus else {
            return false
        }
        guard let localStoreError = error as? LocalStoreError else {
            return false
        }
        guard case .validation(let message) = localStoreError else {
            return false
        }
        return message == blockedMessage
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

private func isFeedbackAutomaticPromptServerStage(stage: String) -> Bool {
    stage == "load_feedback_state" || stage == "record_prompt_shown"
}

private func isRetryableFeedbackAutomaticPromptStatusCode(_ statusCode: Int) -> Bool {
    statusCode == 408 || statusCode == 429 || (statusCode >= 500 && statusCode <= 599)
}
