import Foundation

extension AIChatStore {
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

    private func captureUserVisibleAIChatFailure(error: Error) {
        if isAIChatRequestTooLargeError(error: error) {
            return
        }

        if isAIChatAttachmentUnsupportedTypeError(error: error) {
            return
        }

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

    private func captureUserVisibleAILiveTerminalFailure(
        metadata: AIChatLiveEventMetadata,
        isError: Bool?,
        isStopped: Bool?
    ) {
        let sessionId: String = aiChatObservabilityNonPlaceholderString(metadata.sessionId)
            ?? aiChatObservabilityNonPlaceholderString(self.chatSessionId)
            ?? "unknown"
        let runId: String? = aiChatObservabilityNonPlaceholderString(metadata.runId) ?? self.activeRunId
        let requestId: String? = metadata.requestId.flatMap(aiChatObservabilityNonPlaceholderString)
        let clientRequestId: String? = metadata.clientRequestId.flatMap(aiChatObservabilityNonPlaceholderString)
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
        let resolvedSessionId: String = aiChatObservabilityNonPlaceholderString(sessionId)
            ?? aiChatObservabilityNonPlaceholderString(self.chatSessionId)
            ?? "unknown"
        let resolvedRunId: String? = runId.flatMap(aiChatObservabilityNonPlaceholderString) ?? self.activeRunId
        let resolvedRequestId: String? = requestId.flatMap(aiChatObservabilityNonPlaceholderString)
        let resolvedClientRequestId: String? = clientRequestId.flatMap(aiChatObservabilityNonPlaceholderString)
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
                    afterCursor: afterCursor.flatMap(aiChatObservabilityNonPlaceholderString),
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
        let resolvedSessionId: String = aiChatObservabilityNonPlaceholderString(sessionId)
            ?? aiChatObservabilityNonPlaceholderString(self.chatSessionId)
            ?? "unknown"
        let resolvedRunId: String? = runId.flatMap(aiChatObservabilityNonPlaceholderString) ?? self.activeRunId
        let resolvedRequestId: String? = requestId.flatMap(aiChatObservabilityNonPlaceholderString)
        let resolvedClientRequestId: String? = clientRequestId.flatMap(aiChatObservabilityNonPlaceholderString)
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
                    afterCursor: afterCursor.flatMap(aiChatObservabilityNonPlaceholderString),
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
        let sessionId: String = aiChatObservabilityNonPlaceholderString(self.chatSessionId) ?? diagnostics.clientRequestId
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

private func aiChatObservabilityNonPlaceholderString(_ value: String) -> String? {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false, trimmedValue != "-" else {
        return nil
    }

    return trimmedValue
}
