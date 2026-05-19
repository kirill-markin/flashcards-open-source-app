import Foundation

extension AIChatStore {
    var canSendMessage: Bool {
        self.isChatInteractive
            && self.composerPhase == .idle
            && self.dictationState == .idle
            && self.hasExternalProviderConsent
            && (self.trimmedInputText().isEmpty == false || self.pendingAttachments.isEmpty == false)
    }

    var canEditDraft: Bool {
        self.canEditDraftText
            && self.dictationState == .idle
    }

    /// Text editing intentionally stays available during dictation so the keyboard and cursor remain active.
    var canEditDraftText: Bool {
        guard self.isChatInteractive else {
            return false
        }
        if aiChatDictationStateKeepsDraftTextEditable(self.dictationState) {
            return true
        }
        return aiChatComposerPhaseAllowsDraftPreparation(self.composerPhase)
    }

    var canModifyDraftAttachments: Bool {
        self.canEditDraft
    }

    var canAttachToDraft: Bool {
        self.canModifyDraftAttachments
            && self.serverChatConfig.features.attachmentsEnabled
    }

    var canAttachCardToDraft: Bool {
        self.canModifyDraftAttachments
    }

    var canStartDictation: Bool {
        self.isChatInteractive
            && self.serverChatConfig.features.dictationEnabled
            && self.dictationState == .idle
            && aiChatComposerPhaseAllowsDraftPreparation(self.composerPhase)
    }

    var canUseDictation: Bool {
        switch self.dictationState {
        case .idle:
            return self.canStartDictation
        case .recording:
            return self.isChatInteractive
        case .requestingPermission, .transcribing:
            return false
        }
    }

    var canStopResponse: Bool {
        self.isChatInteractive
            && (self.composerPhase == .startingRun || self.composerPhase == .running)
    }

    var canStartNewChat: Bool {
        guard self.isChatInteractive else {
            return false
        }
        guard self.dictationState == .idle else {
            return false
        }
        return self.messages.isEmpty == false
            || self.pendingAttachments.isEmpty == false
            || self.trimmedInputText().isEmpty == false
            || self.isStreaming
    }

    var isComposerBusy: Bool {
        self.bootstrapPhase == .loading || self.composerPhase != .idle
    }

    var visibleComposerSuggestions: [AIChatComposerSuggestion] {
        guard self.isChatInteractive else {
            return []
        }
        guard self.composerPhase == .idle else {
            return []
        }
        guard self.dictationState == .idle else {
            return []
        }
        guard self.pendingAttachments.isEmpty else {
            return []
        }
        guard self.trimmedInputText().isEmpty else {
            return []
        }
        return self.composerSuggestions
    }

    var isStreaming: Bool {
        self.composerPhase == .startingRun || self.composerPhase == .running || self.composerPhase == .stopping
    }

    var usesGuestAIRestrictions: Bool {
        self.flashcardsStore.cloudSettings?.cloudState != .linked
    }

    var isChatInteractive: Bool {
        self.bootstrapPhase == .ready
    }

    var bootstrapFailurePresentation: AIChatBootstrapErrorPresentation? {
        guard case .failed(let presentation) = self.bootstrapPhase else {
            return nil
        }

        return presentation
    }

    func appendAttachment(_ attachment: AIChatAttachment) {
        guard self.canAttachToDraft else {
            return
        }
        guard self.hasExternalProviderConsent else {
            self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return
        }

        self.pendingAttachments.append(attachment)
    }

    func applyComposerSuggestions(_ suggestions: [AIChatComposerSuggestion]) {
        self.composerSuggestions = suggestions
    }

    func applyComposerSuggestion(_ suggestion: AIChatComposerSuggestion) {
        guard self.canEditDraft else {
            return
        }

        let trimmedInputText = self.inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedInputText.isEmpty {
            self.inputText = suggestion.text
            return
        }

        let separator = self.inputText.hasSuffix(" ") ? "" : " "
        self.inputText += separator + suggestion.text
    }

    func removeAttachment(id: String) {
        guard self.canModifyDraftAttachments else {
            return
        }
        self.pendingAttachments.removeAll { attachment in
            attachment.id == id
        }
    }

    func showAlert(_ alert: AIChatAlert) {
        self.activeAlert = alert
    }

    func showGeneralError(message: String) {
        self.activeResumeErrorAttemptSequence = nil
        self.activeAlert = .generalError(
            title: aiSettingsLocalized("ai.error.title", "Error"),
            message: message
        )
    }

    func showGeneralError(error: Error) {
        self.activeResumeErrorAttemptSequence = nil
        self.captureUserVisibleAIChatFailure(error: error)
        self.activeAlert = aiChatGeneralErrorAlert(
            error: error,
            resumeAttemptSequence: self.activeLiveResumeAttemptSequence
        )
    }

    func showLiveTerminalError(
        message: String,
        metadata: AIChatLiveEventMetadata,
        isError: Bool?,
        isStopped: Bool?
    ) {
        self.activeResumeErrorAttemptSequence = nil
        self.captureUserVisibleAILiveTerminalFailure(
            metadata: metadata,
            isError: isError,
            isStopped: isStopped
        )
        self.activeAlert = .generalError(
            title: aiSettingsLocalized("ai.error.title", "Error"),
            message: message
        )
    }

    func showLiveReconciledError(
        message: String,
        sessionId: String,
        runId: String?,
        afterCursor: String?,
        requestId: String?,
        clientRequestId: String?,
        eventType: String
    ) {
        self.activeResumeErrorAttemptSequence = nil
        self.captureUserVisibleAILiveReconciledFailure(
            sessionId: sessionId,
            runId: runId,
            afterCursor: afterCursor,
            requestId: requestId,
            clientRequestId: clientRequestId,
            eventType: eventType
        )
        self.activeAlert = .generalError(
            title: aiSettingsLocalized("ai.error.title", "Error"),
            message: message
        )
    }

    func captureLiveOptimisticFallbackFailure(
        sessionId: String,
        runId: String?,
        afterCursor: String?,
        requestId: String?,
        clientRequestId: String?
    ) {
        self.activeResumeErrorAttemptSequence = nil
        self.captureUserVisibleAILiveOptimisticFallbackFailure(
            sessionId: sessionId,
            runId: runId,
            afterCursor: afterCursor,
            requestId: requestId,
            clientRequestId: clientRequestId
        )
    }

    func showResumeGeneralError(message: String, resumeAttemptSequence: Int) {
        self.activeResumeErrorAttemptSequence = resumeAttemptSequence
        self.activeAlert = .generalError(
            title: aiSettingsLocalized("ai.error.title", "Error"),
            message: message
        )
    }

    func showMicrophoneSettingsAlert() {
        self.activeAlert = .microphoneSettings
    }

    func showAttachmentSettingsAlert(source: AIChatAttachmentSettingsSource) {
        self.activeAlert = .attachmentSettings(source: source)
    }

    func dismissAlert() {
        self.activeAlert = nil
    }

    func consumeCompletedDictationTranscript(id: String) {
        guard self.completedDictationTranscript?.id == id else {
            return
        }

        self.completedDictationTranscript = nil
    }

    func applyPresentationRequest(request: AIChatPresentationRequest) -> Bool {
        switch request {
        case .createCard:
            guard self.canEditDraft else {
                return false
            }
            self.inputText = aiChatCreateCardDraftPrompt
            return true
        case .attachCard(let card):
            return self.prepareCardHandoff(card: card)
        }
    }

    func trimmedInputText() -> String {
        self.inputText.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

func aiChatComposerPhaseAllowsDraftPreparation(_ phase: AIChatComposerPhase) -> Bool {
    switch phase {
    case .idle, .running:
        return true
    case .preparingSend, .startingRun, .stopping:
        return false
    }
}

func aiChatDictationStateKeepsDraftTextEditable(_ state: AIChatDictationState) -> Bool {
    switch state {
    case .idle:
        return false
    case .requestingPermission, .recording, .transcribing:
        return true
    }
}

func logAIChatStoreEvent(action: String, metadata: [String: String]) {
    if action.hasPrefix("ai_live") {
        logAIChatStoreLiveEvent(action: action, metadata: metadata)
        return
    }

    logAIChatStoreLifecycleEvent(action: action, metadata: metadata)
}

private func logAIChatStoreLifecycleEvent(action: String, metadata: [String: String]) {
    let actionValue: AIChatLifecycleAction = AIChatLifecycleAction(rawValue: action) ?? .storeLifecycle
    let requestId: String? = metadata["backendRequestId"].flatMap(aiChatStoreNonPlaceholderString)
        ?? metadata["requestId"].flatMap(aiChatStoreNonPlaceholderString)
    let sessionId: String? = aiChatStoreSessionId(metadata: metadata)
    let runId: String? = aiChatStoreRunId(metadata: metadata)
    let scope = IOSObservationScope(
        feature: .aiChat,
        userId: nil,
        workspaceId: metadata["workspaceId"].flatMap(aiChatStoreNonPlaceholderString),
        requestId: requestId,
        clientRequestId: metadata["clientRequestId"].flatMap(aiChatStoreNonPlaceholderString),
        sessionId: sessionId,
        runId: runId,
        cloudState: nil,
        configurationMode: nil
    )
    let observation = AIChatLifecycleObservation(
        action: actionValue,
        scope: scope,
        sessionId: sessionId,
        runId: runId,
        conversationScopeId: metadata["conversationScopeId"].flatMap(aiChatStoreNonPlaceholderString),
        eventType: metadata["eventType"].flatMap(aiChatStoreNonPlaceholderString),
        statusCode: metadata["statusCode"].flatMap(Int.init),
        backendCode: metadata["backendCode"].flatMap(aiChatStoreNonPlaceholderString),
        backendRequestId: metadata["backendRequestId"].flatMap(aiChatStoreNonPlaceholderString),
        clientRequestId: metadata["clientRequestId"].flatMap(aiChatStoreNonPlaceholderString),
        stage: metadata["stage"].flatMap(AIChatFailureStage.init(rawValue:)),
        errorKind: metadata["errorKind"].flatMap(AIChatFailureKind.init(rawValue:)),
        failureKind: metadata["failureKind"].flatMap(aiChatStoreNonPlaceholderString)
            ?? metadata["errorType"].flatMap(aiChatStoreNonPlaceholderString)
            ?? (actionValue == .storeLifecycle ? action : nil),
        attempt: metadata["attempt"].flatMap(Int.init)
            ?? metadata["nextAttempt"].flatMap(Int.init)
            ?? metadata["resumeAttempt"].flatMap(Int.init),
        maxAttempts: metadata["maxAttempts"].flatMap(Int.init),
        delayNanoseconds: metadata["delayNanoseconds"].flatMap(UInt64.init),
        outgoingContentCount: metadata["outgoingContentCount"].flatMap(Int.init),
        contentCount: metadata["contentCount"].flatMap(Int.init)
            ?? metadata["count"].flatMap(Int.init),
        textLength: metadata["textLength"].flatMap(Int.init),
        summaryLength: metadata["summaryLength"].flatMap(Int.init),
        suggestionCount: metadata["suggestionCount"].flatMap(Int.init)
            ?? metadata["count"].flatMap(Int.init),
        isError: metadata["isError"].flatMap(aiChatStoreBool),
        isStopped: metadata["isStopped"].flatMap(aiChatStoreBool),
        outcome: metadata["outcome"].flatMap(aiChatStoreNonPlaceholderString),
        reason: metadata["reason"].flatMap(aiChatStoreNonPlaceholderString),
        errorSummary: nil
    )

    if aiChatStoreLifecycleEventIsWarning(actionValue) {
        FlashcardsObservability.captureWarning(.aiChatLifecycle(observation))
        return
    }

    FlashcardsObservability.addBreadcrumb(.aiChatLifecycle(observation))
}

private func logAIChatStoreLiveEvent(action: String, metadata: [String: String]) {
    let actionValue: AILiveLifecycleAction = AILiveLifecycleAction(rawValue: action) ?? .eventReceived
    let requestId: String? = metadata["requestId"].flatMap(aiChatStoreNonPlaceholderString)
    let backendRequestId: String? = metadata["backendRequestId"].flatMap(aiChatStoreNonPlaceholderString)
    let sessionId: String = aiChatStoreSessionId(metadata: metadata) ?? "unknown"
    let runId: String? = aiChatStoreRunId(metadata: metadata)
    let scope = IOSObservationScope(
        feature: .aiLive,
        userId: nil,
        workspaceId: metadata["workspaceId"].flatMap(aiChatStoreNonPlaceholderString),
        requestId: backendRequestId ?? requestId,
        clientRequestId: metadata["clientRequestId"].flatMap(aiChatStoreNonPlaceholderString),
        sessionId: sessionId,
        runId: runId,
        cloudState: nil,
        configurationMode: nil
    )
    let observation = AILiveLifecycleObservation(
        action: actionValue,
        scope: scope,
        sessionId: sessionId,
        runId: runId,
        afterCursor: metadata["afterCursor"].flatMap(aiChatStoreNonPlaceholderString),
        requestId: requestId,
        backendRequestId: backendRequestId,
        backendCode: metadata["backendCode"].flatMap(aiChatStoreNonPlaceholderString),
        statusCode: metadata["statusCode"].flatMap(Int.init),
        eventType: metadata["eventType"].flatMap(aiChatStoreNonPlaceholderString),
        sequenceNumber: metadata["sequenceNumber"].flatMap(Int.init),
        cursor: metadata["cursor"].flatMap(aiChatStoreNonPlaceholderString),
        streamEpoch: metadata["streamEpoch"].flatMap(aiChatStoreNonPlaceholderString),
        itemId: metadata["itemId"].flatMap(aiChatStoreNonPlaceholderString),
        toolName: metadata["toolName"].flatMap(aiChatStoreNonPlaceholderString),
        toolStatus: metadata["toolStatus"].flatMap(aiChatStoreNonPlaceholderString),
        contentCount: metadata["contentCount"].flatMap(Int.init)
            ?? metadata["count"].flatMap(Int.init),
        textLength: metadata["textLength"].flatMap(Int.init),
        summaryLength: metadata["summaryLength"].flatMap(Int.init),
        suggestionCount: metadata["suggestionCount"].flatMap(Int.init)
            ?? metadata["count"].flatMap(Int.init),
        isError: metadata["isError"].flatMap(aiChatStoreBool),
        isStopped: metadata["isStopped"].flatMap(aiChatStoreBool),
        outcome: metadata["outcome"].flatMap(aiChatStoreNonPlaceholderString),
        failureKind: metadata["failureKind"].flatMap(aiChatStoreNonPlaceholderString)
            ?? metadata["reason"].flatMap(aiChatStoreNonPlaceholderString),
        stage: metadata["stage"].flatMap(AIChatFailureStage.init(rawValue:)),
        errorKind: metadata["errorKind"].flatMap(AIChatFailureKind.init(rawValue:)),
        resumeAttempt: metadata["resumeAttempt"].flatMap(Int.init)
    )

    if aiChatStoreLiveEventIsWarning(actionValue) {
        FlashcardsObservability.captureWarning(.aiLiveLifecycle(observation))
        return
    }

    FlashcardsObservability.addBreadcrumb(.aiLiveLifecycle(observation))
}

private func aiChatStoreSessionId(metadata: [String: String]) -> String? {
    metadata["chatSessionId"].flatMap(aiChatStoreNonPlaceholderString)
        ?? metadata["sessionId"].flatMap(aiChatStoreNonPlaceholderString)
        ?? metadata["eventSessionId"].flatMap(aiChatStoreNonPlaceholderString)
}

private func aiChatStoreRunId(metadata: [String: String]) -> String? {
    metadata["runId"].flatMap(aiChatStoreNonPlaceholderString)
        ?? metadata["activeRunId"].flatMap(aiChatStoreNonPlaceholderString)
        ?? metadata["eventRunId"].flatMap(aiChatStoreNonPlaceholderString)
}

private func aiChatStoreLifecycleEventIsWarning(_ action: AIChatLifecycleAction) -> Bool {
    switch action {
    case .runFail,
            .runFailed,
            .stopFailed,
            .bootstrapSessionContractMismatch,
            .chatUnknownContentReceived:
        return true
    case .runStart,
            .runStarted,
            .bootstrapRetryScheduled,
            .newSessionRetryScheduled,
            .contentUnknown,
            .storeLifecycle:
        return false
    }
}

private func aiChatStoreLiveEventIsWarning(_ action: AILiveLifecycleAction) -> Bool {
    switch action {
    case .terminalEventReconcileRequired:
        return true
    case .connectStart,
            .httpResponse,
            .eventReceived,
            .eventSkippedUnknownType,
            .cancelled,
            .finish,
            .finishError,
            .attach,
            .detach,
            .error,
            .eventParseFailed,
            .eventHandleStart,
            .eventIgnoredStale,
            .eventApplied,
            .eventHandleApplied,
            .terminalEventApplied,
            .composerSuggestionsApplied,
            .repairStatusApplied,
            .terminalApplied:
        return false
    }
}

private func aiChatStoreBool(_ value: String) -> Bool? {
    switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "true":
        return true
    case "false":
        return false
    default:
        return nil
    }
}

private func aiChatStoreNonPlaceholderString(_ value: String) -> String? {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false, trimmedValue != "-" else {
        return nil
    }

    return trimmedValue
}

extension AIChatStore {
    private func captureUserVisibleAIChatFailure(error: Error) {
        if let liveStreamError = error as? AIChatLiveStreamError {
            self.captureUserVisibleAILiveStreamFailure(error: liveStreamError)
            return
        }

        if let liveSetupError = error as? AIChatLiveStreamSetupError {
            self.captureUserVisibleAILiveDiagnosticFailure(
                error: liveSetupError,
                diagnostics: liveSetupError.diagnostics
            )
            return
        }

        if let liveContractError = error as? AIChatLiveStreamContractError {
            self.captureUserVisibleAILiveDiagnosticFailure(
                error: liveContractError,
                diagnostics: liveContractError.diagnostics
            )
            return
        }

        guard let diagnosticError = error as? any AIChatFailureDiagnosticProviding else {
            return
        }

        let diagnostics: AIChatFailureDiagnostics = diagnosticError.diagnostics
        let sessionId: String? = self.chatSessionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? nil
            : self.chatSessionId
        let scope = IOSObservationScope(
            feature: .aiChat,
            userId: nil,
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            requestId: diagnostics.backendRequestId,
            clientRequestId: diagnostics.clientRequestId,
            sessionId: sessionId,
            runId: self.activeRunId,
            cloudState: self.flashcardsStore.cloudSettings?.cloudState,
            configurationMode: nil
        )
        FlashcardsObservability.captureException(
            .aiChatFailed(
                error: error,
                scope: scope,
                details: diagnostics
            )
        )
    }

    private func captureUserVisibleAILiveStreamFailure(error: AIChatLiveStreamError) {
        let metadata: [String: String] = aiChatErrorLogMetadata(error: error)
        let liveContext: AIChatLiveStreamErrorObservationContext = aiChatLiveStreamErrorObservationContext(
            error: error,
            metadata: metadata
        )
        let sessionId: String = self.chatSessionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "unknown"
            : self.chatSessionId
        let scope = IOSObservationScope(
            feature: .aiLive,
            userId: nil,
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            requestId: liveContext.backendRequestId ?? liveContext.requestId,
            clientRequestId: liveContext.clientRequestId,
            sessionId: sessionId,
            runId: self.activeRunId,
            cloudState: self.flashcardsStore.cloudSettings?.cloudState,
            configurationMode: nil
        )
        FlashcardsObservability.captureException(
            .aiLiveStreamFailed(
                error: error,
                scope: scope,
                details: AILiveStreamFailureDetails(
                    sessionId: sessionId,
                    runId: self.activeRunId,
                    afterCursor: self.liveCursor,
                    requestId: liveContext.requestId,
                    backendRequestId: liveContext.backendRequestId,
                    statusCode: liveContext.statusCode,
                    backendCode: liveContext.backendCode,
                    clientRequestId: liveContext.clientRequestId,
                    failureKind: metadata["failureKind"] ?? "transport_failure",
                    stage: metadata["stage"].flatMap(AIChatFailureStage.init(rawValue:)),
                    errorKind: metadata["errorKind"].flatMap(AIChatFailureKind.init(rawValue:)),
                    eventType: nil,
                    outcome: nil,
                    decoderSummary: nil,
                    rawSnippetLength: nil,
                    idleTimeoutSeconds: metadata["idleTimeoutSeconds"].flatMap(TimeInterval.init),
                    isError: nil,
                    isStopped: nil,
                    resumeAttempt: self.activeLiveResumeAttemptSequence
                )
            )
        )
    }

    private func captureUserVisibleAILiveDiagnosticFailure(
        error: Error,
        diagnostics: AIChatFailureDiagnostics
    ) {
        let sessionId: String = aiChatStoreNonPlaceholderString(self.chatSessionId) ?? diagnostics.clientRequestId
        let scope = IOSObservationScope(
            feature: .aiLive,
            userId: nil,
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            requestId: diagnostics.backendRequestId,
            clientRequestId: diagnostics.clientRequestId,
            sessionId: sessionId,
            runId: self.activeRunId,
            cloudState: self.flashcardsStore.cloudSettings?.cloudState,
            configurationMode: nil
        )
        FlashcardsObservability.captureException(
            .aiLiveStreamFailed(
                error: error,
                scope: scope,
                details: AILiveStreamFailureDetails(
                    sessionId: sessionId,
                    runId: self.activeRunId,
                    afterCursor: self.liveCursor,
                    requestId: nil,
                    backendRequestId: diagnostics.backendRequestId,
                    statusCode: diagnostics.statusCode,
                    backendCode: nil,
                    clientRequestId: diagnostics.clientRequestId,
                    failureKind: diagnostics.errorKind.rawValue,
                    stage: diagnostics.stage,
                    errorKind: diagnostics.errorKind,
                    eventType: diagnostics.eventType,
                    outcome: nil,
                    decoderSummary: diagnostics.decoderSummary,
                    rawSnippetLength: diagnostics.rawSnippet.map(\.count),
                    idleTimeoutSeconds: nil,
                    isError: nil,
                    isStopped: nil,
                    resumeAttempt: diagnostics.continuationAttempt ?? self.activeLiveResumeAttemptSequence
                )
            )
        )
    }

    private func captureUserVisibleAILiveTerminalFailure(
        metadata: AIChatLiveEventMetadata,
        isError: Bool?,
        isStopped: Bool?
    ) {
        let sessionId: String = aiChatStoreNonPlaceholderString(metadata.sessionId)
            ?? aiChatStoreNonPlaceholderString(self.chatSessionId)
            ?? "unknown"
        let runId: String? = aiChatStoreNonPlaceholderString(metadata.runId) ?? self.activeRunId
        let requestId: String? = metadata.requestId.flatMap(aiChatStoreNonPlaceholderString)
        let clientRequestId: String? = metadata.clientRequestId.flatMap(aiChatStoreNonPlaceholderString)
        let scope = IOSObservationScope(
            feature: .aiLive,
            userId: nil,
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            requestId: requestId,
            clientRequestId: clientRequestId,
            sessionId: sessionId,
            runId: runId,
            cloudState: self.flashcardsStore.cloudSettings?.cloudState,
            configurationMode: nil
        )
        FlashcardsObservability.captureException(
            .aiLiveStreamFailed(
                error: AIChatLiveTerminalFailureError.failedRun,
                scope: scope,
                details: AILiveStreamFailureDetails(
                    sessionId: sessionId,
                    runId: runId,
                    afterCursor: metadata.cursor ?? self.liveCursor,
                    requestId: requestId,
                    backendRequestId: nil,
                    statusCode: nil,
                    backendCode: nil,
                    clientRequestId: clientRequestId,
                    failureKind: AIChatFailureKind.runTerminalError.rawValue,
                    stage: .runTerminal,
                    errorKind: .runTerminalError,
                    eventType: "run_terminal",
                    outcome: AIChatRunTerminalOutcome.error.rawValue,
                    decoderSummary: nil,
                    rawSnippetLength: nil,
                    idleTimeoutSeconds: nil,
                    isError: isError,
                    isStopped: isStopped,
                    resumeAttempt: self.activeLiveResumeAttemptSequence
                )
            )
        )
    }

    private func captureUserVisibleAILiveReconciledFailure(
        sessionId: String,
        runId: String?,
        afterCursor: String?,
        requestId: String?,
        clientRequestId: String?,
        eventType: String
    ) {
        let resolvedSessionId: String = aiChatStoreNonPlaceholderString(sessionId)
            ?? aiChatStoreNonPlaceholderString(self.chatSessionId)
            ?? "unknown"
        let resolvedRunId: String? = runId.flatMap(aiChatStoreNonPlaceholderString) ?? self.activeRunId
        let resolvedRequestId: String? = requestId.flatMap(aiChatStoreNonPlaceholderString)
        let resolvedClientRequestId: String? = clientRequestId.flatMap(aiChatStoreNonPlaceholderString)
        let scope = IOSObservationScope(
            feature: .aiLive,
            userId: nil,
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            requestId: resolvedRequestId,
            clientRequestId: resolvedClientRequestId,
            sessionId: resolvedSessionId,
            runId: resolvedRunId,
            cloudState: self.flashcardsStore.cloudSettings?.cloudState,
            configurationMode: nil
        )
        FlashcardsObservability.captureException(
            .aiLiveStreamFailed(
                error: AIChatLiveTerminalFailureError.failedRun,
                scope: scope,
                details: AILiveStreamFailureDetails(
                    sessionId: resolvedSessionId,
                    runId: resolvedRunId,
                    afterCursor: afterCursor.flatMap(aiChatStoreNonPlaceholderString),
                    requestId: resolvedRequestId,
                    backendRequestId: nil,
                    statusCode: nil,
                    backendCode: nil,
                    clientRequestId: resolvedClientRequestId,
                    failureKind: AIChatFailureKind.runTerminalError.rawValue,
                    stage: .runTerminal,
                    errorKind: .runTerminalError,
                    eventType: eventType,
                    outcome: AIChatRunTerminalOutcome.error.rawValue,
                    decoderSummary: nil,
                    rawSnippetLength: nil,
                    idleTimeoutSeconds: nil,
                    isError: true,
                    isStopped: nil,
                    resumeAttempt: self.activeLiveResumeAttemptSequence
                )
            )
        )
    }

    private func captureUserVisibleAILiveOptimisticFallbackFailure(
        sessionId: String,
        runId: String?,
        afterCursor: String?,
        requestId: String?,
        clientRequestId: String?
    ) {
        let resolvedSessionId: String = aiChatStoreNonPlaceholderString(sessionId)
            ?? aiChatStoreNonPlaceholderString(self.chatSessionId)
            ?? "unknown"
        let resolvedRunId: String? = runId.flatMap(aiChatStoreNonPlaceholderString) ?? self.activeRunId
        let resolvedRequestId: String? = requestId.flatMap(aiChatStoreNonPlaceholderString)
        let resolvedClientRequestId: String? = clientRequestId.flatMap(aiChatStoreNonPlaceholderString)
        let scope = IOSObservationScope(
            feature: .aiLive,
            userId: nil,
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            requestId: resolvedRequestId,
            clientRequestId: resolvedClientRequestId,
            sessionId: resolvedSessionId,
            runId: resolvedRunId,
            cloudState: self.flashcardsStore.cloudSettings?.cloudState,
            configurationMode: nil
        )
        FlashcardsObservability.captureException(
            .aiLiveStreamFailed(
                error: AIChatLiveOptimisticFallbackFailureError.streamFailed,
                scope: scope,
                details: AILiveStreamFailureDetails(
                    sessionId: resolvedSessionId,
                    runId: resolvedRunId,
                    afterCursor: afterCursor.flatMap(aiChatStoreNonPlaceholderString),
                    requestId: resolvedRequestId,
                    backendRequestId: nil,
                    statusCode: nil,
                    backendCode: nil,
                    clientRequestId: resolvedClientRequestId,
                    failureKind: "optimistic_fallback_after_stream_failure",
                    stage: nil,
                    errorKind: nil,
                    eventType: "failed_stream_optimistic_fallback",
                    outcome: nil,
                    decoderSummary: nil,
                    rawSnippetLength: nil,
                    idleTimeoutSeconds: nil,
                    isError: true,
                    isStopped: nil,
                    resumeAttempt: self.activeLiveResumeAttemptSequence
                )
            )
        )
    }
}

private struct AIChatLiveStreamErrorObservationContext {
    let requestId: String?
    let backendRequestId: String?
    let clientRequestId: String?
    let statusCode: Int?
    let backendCode: String?
}

private func aiChatLiveStreamErrorObservationContext(
    error: AIChatLiveStreamError,
    metadata: [String: String]
) -> AIChatLiveStreamErrorObservationContext {
    switch error {
    case .invalidStatusCode(let httpStatusCode, let errorDetails, _, _):
        return AIChatLiveStreamErrorObservationContext(
            requestId: errorDetails.requestId,
            backendRequestId: metadata["backendRequestId"],
            clientRequestId: metadata["clientRequestId"],
            statusCode: httpStatusCode,
            backendCode: errorDetails.code ?? metadata["backendCode"]
        )
    case .invalidUrl, .invalidResponse:
        return AIChatLiveStreamErrorObservationContext(
            requestId: nil,
            backendRequestId: metadata["backendRequestId"],
            clientRequestId: metadata["clientRequestId"],
            statusCode: metadata["statusCode"].flatMap(Int.init),
            backendCode: metadata["backendCode"]
        )
    case .transportFailure(_, let requestId, _):
        return AIChatLiveStreamErrorObservationContext(
            requestId: requestId,
            backendRequestId: metadata["backendRequestId"],
            clientRequestId: metadata["clientRequestId"],
            statusCode: metadata["statusCode"].flatMap(Int.init),
            backendCode: metadata["backendCode"]
        )
    case .staleStream(_, let requestId, _):
        return AIChatLiveStreamErrorObservationContext(
            requestId: requestId,
            backendRequestId: metadata["backendRequestId"],
            clientRequestId: metadata["clientRequestId"],
            statusCode: metadata["statusCode"].flatMap(Int.init),
            backendCode: metadata["backendCode"]
        )
    }
}

private enum AIChatLiveTerminalFailureError: LocalizedError {
    case failedRun

    var errorDescription: String? {
        "AI live terminal run failed."
    }
}

private enum AIChatLiveOptimisticFallbackFailureError: LocalizedError {
    case streamFailed

    var errorDescription: String? {
        "AI live stream failed and the optimistic fallback was applied."
    }
}

private struct AIChatAlertPresentation {
    let title: String
    let message: String
}

func aiChatGeneralErrorAlert(
    error: Error,
    resumeAttemptSequence: Int?
) -> AIChatAlert {
    let presentation = aiChatAlertPresentation(
        error: error,
        resumeAttemptSequence: resumeAttemptSequence
    )
    return .generalError(title: presentation.title, message: presentation.message)
}

private func aiChatAlertPresentation(
    error: Error,
    resumeAttemptSequence: Int?
) -> AIChatAlertPresentation {
    if let liveError = error as? AIChatLiveStreamError {
        return aiChatAlertPresentation(
            liveError: liveError,
            resumeAttemptSequence: resumeAttemptSequence
        )
    }

    if let diagnosticError = error as? AIChatFailureDiagnosticProviding {
        return aiChatAlertPresentation(
            diagnostics: diagnosticError.diagnostics,
            summary: aiChatFailureSummary(error: error),
            rawDetails: nil,
            code: nil,
            statusCode: nil,
            requestId: nil,
            resumeAttemptSequence: resumeAttemptSequence
        )
    }

    return AIChatAlertPresentation(
        title: aiSettingsLocalized("ai.error.title", "Error"),
        message: Flashcards.errorMessage(error: error)
    )
}

private func aiChatAlertPresentation(
    liveError: AIChatLiveStreamError,
    resumeAttemptSequence: Int?
) -> AIChatAlertPresentation {
    switch liveError {
    case .invalidStatusCode(let httpStatusCode, let errorDetails, _, _):
        let summary = aiSettingsLocalized(
            "ai.error.summary.couldNotContinue",
            "Couldn't Continue the AI Response"
        )
        let rawDetails = errorDetails.message
        return aiChatAlertPresentation(
            diagnostics: nil,
            summary: summary,
            rawDetails: rawDetails,
            code: errorDetails.code,
            statusCode: httpStatusCode,
            requestId: errorDetails.requestId,
            resumeAttemptSequence: resumeAttemptSequence
        )
    case .invalidResponse:
        return aiChatAlertPresentation(
            diagnostics: nil,
            summary: aiSettingsLocalized(
                "ai.error.summary.couldNotContinue",
                "Couldn't Continue the AI Response"
            ),
            rawDetails: aiSettingsLocalized(
                "ai.error.live.invalidHttpResponse",
                "The AI live stream did not receive an HTTP response."
            ),
            code: nil,
            statusCode: nil,
            requestId: nil,
            resumeAttemptSequence: resumeAttemptSequence
        )
    case .transportFailure(let underlyingError, let requestId, _):
        return aiChatAlertPresentation(
            diagnostics: nil,
            summary: aiSettingsLocalized(
                "ai.error.summary.couldNotContinue",
                "Couldn't Continue the AI Response"
            ),
            rawDetails: Flashcards.errorMessage(error: underlyingError),
            code: nil,
            statusCode: nil,
            requestId: requestId,
            resumeAttemptSequence: resumeAttemptSequence
        )
    case .staleStream(_, let requestId, _):
        return aiChatAlertPresentation(
            diagnostics: nil,
            summary: aiSettingsLocalized(
                "ai.error.summary.couldNotContinue",
                "Couldn't Continue the AI Response"
            ),
            rawDetails: aiSettingsLocalized(
                "ai.error.live.staleStream",
                "The AI response stopped updating before the run finished."
            ),
            code: nil,
            statusCode: nil,
            requestId: requestId,
            resumeAttemptSequence: resumeAttemptSequence
        )
    case .invalidUrl:
        return aiChatAlertPresentation(
            diagnostics: nil,
            summary: aiSettingsLocalized(
                "ai.error.summary.configuration",
                "AI Configuration Error"
            ),
            rawDetails: aiSettingsLocalized(
                "ai.error.live.invalidUrl",
                "The AI live stream URL is invalid."
            ),
            code: nil,
            statusCode: nil,
            requestId: nil,
            resumeAttemptSequence: resumeAttemptSequence
        )
    }
}

private func aiChatAlertPresentation(
    diagnostics: AIChatFailureDiagnostics?,
    summary: String,
    rawDetails: String?,
    code: String?,
    statusCode: Int?,
    requestId: String?,
    resumeAttemptSequence: Int?
) -> AIChatAlertPresentation {
    var detailLines: [String] = []

    if let rawDetails, rawDetails.isEmpty == false {
        detailLines.append(rawDetails)
    }

    let effectiveRequestId = requestId ?? diagnostics?.backendRequestId
    if let effectiveRequestId, effectiveRequestId.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.reference",
                "Reference: %@",
                effectiveRequestId
            )
        )
    } else if let clientRequestId = diagnostics?.clientRequestId, clientRequestId.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.debug",
                "Debug: %@",
                clientRequestId
            )
        )
    }

    let effectiveStatusCode = statusCode ?? diagnostics?.statusCode
    if let effectiveStatusCode {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.status",
                "Status: %d",
                effectiveStatusCode
            )
        )
    }

    let effectiveCode = code
    if let effectiveCode, effectiveCode.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.code",
                "Code: %@",
                effectiveCode
            )
        )
    }

    if let stage = diagnostics?.stage {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.stage",
                "Stage: %@",
                stage.rawValue
            )
        )
    }

    if let resumeAttemptSequence {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.resumeAttempt",
                "Resume Attempt: %d",
                resumeAttemptSequence
            )
        )
    }

    if let decoderSummary = diagnostics?.decoderSummary, decoderSummary.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.details",
                "Details: %@",
                decoderSummary
            )
        )
    }

    if let rawSnippet = diagnostics?.rawSnippet, rawSnippet.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.payload",
                "Payload: %@",
                rawSnippet
            )
        )
    }

    return AIChatAlertPresentation(
        title: summary,
        message: detailLines.joined(separator: "\n")
    )
}

private func aiChatFailureSummary(error: Error) -> String {
    if error is AIChatLiveStreamSetupError {
        return aiSettingsLocalized(
            "ai.error.summary.couldNotContinue",
            "Couldn't Continue the AI Response"
        )
    }

    if error is AIChatLiveStreamContractError {
        return aiSettingsLocalized(
            "ai.error.summary.invalidResponse",
            "Received an Invalid AI Response"
        )
    }

    if let serviceError = error as? AIChatServiceError {
        switch serviceError {
        case .invalidBaseUrl:
            return aiSettingsLocalized(
                "ai.error.summary.configuration",
                "AI Configuration Error"
            )
        case .invalidHttpResponse, .invalidResponse:
            return aiSettingsLocalized(
                "ai.error.summary.couldNotContinue",
                "Couldn't Continue the AI Response"
            )
        case .invalidPayload:
            return aiSettingsLocalized(
                "ai.error.summary.invalidResponse",
                "Received an Invalid AI Response"
            )
        }
    }

    return aiSettingsLocalized("ai.error.title", "Error")
}
