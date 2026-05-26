import Foundation

enum AIChatLiveAttachTermination: Sendable {
    case sawTerminalEvent(requestId: String?, clientRequestId: String?)
    case endedWithoutTerminalEvent(requestId: String?, clientRequestId: String?)
    case failed(message: String, requestId: String?, clientRequestId: String?)
}

func validateAIChatStartRunRequestSize(
    sessionId: String,
    workspaceId: String?,
    outgoingContent: [AIChatContentPart]
) throws {
    let effectiveSessionId = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
    if effectiveSessionId.isEmpty {
        throw LocalStoreError.validation("AI chat session orchestration started without a provisioned session id.")
    }

    let encoder = JSONEncoder()
    _ = try encodeAIChatStartRunRequestBody(
        request: AIChatStartRunRequestBody(
            sessionId: effectiveSessionId,
            clientRequestId: makeAIChatClientRequestId(),
            content: outgoingContent,
            timezone: TimeZone.current.identifier,
            uiLocale: currentAIChatUILocaleIdentifier(),
            workspaceId: workspaceId
        ),
        encoder: encoder,
        maximumByteCount: aiChatMaximumStartRunRequestBytes
    )
}

actor AIChatSessionRuntime {
    private let chatService: any AIChatSessionServicing
    private let contextLoader: any AIChatContextLoading
    private let liveStreamClient: AIChatLiveStreamClient
    private var activeLiveTask: Task<Void, Never>?

    init(
        chatService: any AIChatSessionServicing,
        contextLoader: any AIChatContextLoading,
        urlSession: URLSession
    ) {
        self.chatService = chatService
        self.contextLoader = contextLoader
        self.liveStreamClient = AIChatLiveStreamClient(urlSession: urlSession)
    }

    func validateStartRunRequestSize(
        session: CloudLinkedSession,
        sessionId: String,
        outgoingContent: [AIChatContentPart]
    ) throws {
        try validateAIChatStartRunRequestSize(
            sessionId: sessionId,
            workspaceId: session.workspaceId,
            outgoingContent: outgoingContent
        )
    }

    /**
     * Starts a new run request and reports the accepted response back to the
     * store. Snapshot/bootstrap remains the source of truth for session state.
     * This method only kicks off the run; the store applies the accepted
     * canonical envelope and attaches live only when the surface is visible.
     */
    func run(
        session: CloudLinkedSession,
        sessionId: String,
        afterCursor: String?,
        outgoingContent: [AIChatContentPart],
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async throws {
        _ = self.contextLoader
        logAIChatRuntimeEvent(
            action: "ai_run_start",
            metadata: [
                "sessionId": sessionId.isEmpty ? "-" : sessionId,
                "outgoingContentCount": String(outgoingContent.count)
            ]
        )

        do {
            let effectiveSessionId = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
            if effectiveSessionId.isEmpty {
                throw LocalStoreError.validation("AI chat session orchestration started without a provisioned session id.")
            }

            let startResponse = try await self.chatService.startRun(
                session: session,
                request: AIChatStartRunRequestBody(
                    sessionId: effectiveSessionId,
                    clientRequestId: makeAIChatClientRequestId(),
                    content: outgoingContent,
                    timezone: TimeZone.current.identifier,
                    uiLocale: currentAIChatUILocaleIdentifier()
                )
            )
            await eventHandler(.accepted(startResponse))
            logAIChatRuntimeEvent(
                action: "ai_run_started",
                metadata: [
                    "sessionId": startResponse.sessionId,
                    "hasActiveRun": startResponse.activeRun == nil ? "false" : "true"
                ]
            )
        } catch is CancellationError {
            await eventHandler(.finish)
            throw CancellationError()
        } catch {
            logAIChatRuntimeEvent(
                action: "ai_run_fail",
                metadata: [
                    "sessionId": sessionId.isEmpty ? "-" : sessionId,
                    "error": error.localizedDescription
                ]
            )
            throw error
        }
    }

    /**
     * Attaches the thin live SSE overlay for one already-known chat session.
     * Callers must only use this while the surface is visible and after they
     * have a trusted snapshot/bootstrap cursor to resume from.
     */
    func attachLive(
        liveStream: AIChatLiveStreamEnvelope,
        sessionId: String,
        runId: String,
        afterCursor: String?,
        configurationMode: CloudServiceConfigurationMode,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?,
        eventHandler: @escaping @Sendable (AIChatLiveEvent) async -> Void,
        completionHandler: @escaping @Sendable (AIChatLiveAttachTermination) async -> Void
    ) {
        detach()
        activeLiveTask = Task {
            logAIChatRuntimeEvent(
                action: "ai_live_attach",
                metadata: [
                    "sessionId": sessionId,
                    "runId": runId,
                    "afterCursor": afterCursor ?? "-"
                ]
                .merging(
                    resumeAttemptDiagnostics.map { ["resumeAttempt": $0.headerValue] } ?? [:]
                ) { _, newValue in newValue }
            )
            do {
                let termination = try await self.consumeLiveStream(
                    liveStream: liveStream,
                    sessionId: sessionId,
                    runId: runId,
                    afterCursor: afterCursor,
                    configurationMode: configurationMode,
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics,
                    eventHandler: eventHandler
                )
                await completionHandler(termination)
            } catch is CancellationError {
            } catch {
                logAIChatRuntimeEvent(
                    action: "ai_live_error",
                    metadata: aiChatRuntimeErrorMetadata(
                        error: error,
                        sessionId: sessionId,
                        runId: runId,
                        afterCursor: afterCursor,
                        resumeAttemptDiagnostics: resumeAttemptDiagnostics
                    )
                )
                await completionHandler(.failed(
                    message: Flashcards.errorMessage(error: error),
                    requestId: aiChatLiveErrorRequestId(error),
                    clientRequestId: aiChatLiveErrorClientRequestId(error)
                ))
            }
            logAIChatRuntimeEvent(
                action: "ai_live_detach",
                metadata: ["sessionId": sessionId]
            )
        }
    }

    func detach() {
        activeLiveTask?.cancel()
        activeLiveTask = nil
    }

    var isLiveAttached: Bool {
        activeLiveTask != nil && activeLiveTask?.isCancelled == false
    }

    private func consumeLiveStream(
        liveStream: AIChatLiveStreamEnvelope,
        sessionId: String,
        runId: String,
        afterCursor: String?,
        configurationMode: CloudServiceConfigurationMode,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?,
        eventHandler: @escaping @Sendable (AIChatLiveEvent) async -> Void
    ) async throws -> AIChatLiveAttachTermination {
        if runId.isEmpty {
            throw AIChatLiveStreamSetupError.missingRunId(
                sessionId: sessionId,
                afterCursor: afterCursor,
                resumeAttemptSequence: resumeAttemptDiagnostics?.sequence,
                clientRequestId: makeAIChatClientRequestId()
            )
        }

        let stream = await self.liveStreamClient.connect(
            liveUrl: liveStream.url,
            authorization: liveStream.authorization,
            sessionId: sessionId,
            runId: runId,
            afterCursor: afterCursor,
            configurationMode: configurationMode,
            resumeAttemptDiagnostics: resumeAttemptDiagnostics
        )

        var liveRequestId: String?
        var liveClientRequestId: String?
        for try await element in stream {
            try Task.checkCancellation()
            let event: AIChatLiveEvent
            switch element {
            case .connected(let requestId, let clientRequestId):
                liveRequestId = requestId ?? liveRequestId
                liveClientRequestId = aiChatRuntimeNonPlaceholderString(clientRequestId) ?? liveClientRequestId
                continue
            case .event(let liveEvent):
                event = liveEvent
                liveRequestId = aiChatLiveEventMetadata(liveEvent).requestId ?? liveRequestId
            }

            await eventHandler(event)

            switch event {
            case .runTerminal:
                return .sawTerminalEvent(
                    requestId: liveRequestId,
                    clientRequestId: liveClientRequestId
                )
            case .assistantDelta,
                    .assistantToolCall,
                    .assistantReasoningStarted,
                    .assistantReasoningSummary,
                    .assistantReasoningDone,
                    .composerSuggestionsUpdated,
                    .repairStatus,
                    .assistantMessageDone:
                break
            }
        }

        return .endedWithoutTerminalEvent(
            requestId: liveRequestId,
            clientRequestId: liveClientRequestId
        )
    }
}

func isGuestAiLimitError(error: Error) -> Bool {
    guard let serviceError = error as? AIChatServiceError else {
        return false
    }

    switch serviceError {
    case .invalidResponse(let errorDetails, _, _):
        return isGuestAiLimitCode(errorDetails.code)
    case .invalidBaseUrl, .invalidHttpResponse, .invalidPayload:
        return false
    }
}

private func logAIChatRuntimeEvent(action: String, metadata: [String: String]) {
    if action.hasPrefix("ai_live") {
        logAIChatRuntimeLiveEvent(action: action, metadata: metadata)
        return
    }

    let actionValue: AIChatLifecycleAction
    switch action {
    case "ai_run_start":
        actionValue = .runStart
    case "ai_run_started":
        actionValue = .runStarted
    case "ai_run_fail":
        actionValue = .runFail
    default:
        actionValue = .storeLifecycle
    }
    let requestId = metadata["backendRequestId"].flatMap(aiChatRuntimeNonPlaceholderString)
    let scope = IOSObservationScope(
        feature: .aiChat,
        userId: nil,
        workspaceId: nil,
        requestId: requestId,
        clientRequestId: nil,
        sessionId: metadata["sessionId"],
        runId: metadata["runId"],
        cloudState: nil,
        configurationMode: nil
    )
    let observation = AIChatLifecycleObservation(
        action: actionValue,
        scope: scope,
        sessionId: metadata["sessionId"].flatMap(aiChatRuntimeNonPlaceholderString),
        runId: metadata["runId"].flatMap(aiChatRuntimeNonPlaceholderString),
        conversationScopeId: nil,
        eventType: nil,
        statusCode: metadata["statusCode"].flatMap(Int.init),
        backendCode: metadata["backendCode"].flatMap(aiChatRuntimeNonPlaceholderString),
        backendRequestId: requestId,
        clientRequestId: nil,
        stage: metadata["stage"].flatMap(AIChatFailureStage.init(rawValue:)),
        errorKind: metadata["errorKind"].flatMap(AIChatFailureKind.init(rawValue:)),
        failureKind: metadata["failureKind"].flatMap(aiChatRuntimeNonPlaceholderString),
        attempt: nil,
        maxAttempts: nil,
        delayNanoseconds: nil,
        outgoingContentCount: metadata["outgoingContentCount"].flatMap(Int.init),
        contentCount: nil,
        textLength: nil,
        summaryLength: nil,
        suggestionCount: nil,
        isError: nil,
        isStopped: nil,
        outcome: metadata["hasActiveRun"],
        reason: metadata["failureKind"].flatMap(aiChatRuntimeNonPlaceholderString)
            ?? metadata["errorKind"].flatMap(aiChatRuntimeNonPlaceholderString),
        errorSummary: nil
    )
    FlashcardsObservability.addBreadcrumb(.aiChatLifecycle(observation))
}

private func aiChatLiveErrorRequestId(_ error: Error) -> String? {
    if let diagnosticError = error as? any AIChatFailureDiagnosticProviding,
       let requestId = diagnosticError.diagnostics.backendRequestId.flatMap(aiChatRuntimeNonPlaceholderString) {
        return requestId
    }

    guard let liveStreamError = error as? AIChatLiveStreamError else {
        return nil
    }

    switch liveStreamError {
    case .invalidUrl, .invalidResponse:
        return nil
    case .transportFailure(_, let requestId, _):
        return requestId.flatMap(aiChatRuntimeNonPlaceholderString)
    case .staleStream(_, let requestId, _):
        return requestId.flatMap(aiChatRuntimeNonPlaceholderString)
    case .invalidStatusCode(_, let errorDetails, _, _):
        return errorDetails.requestId.flatMap(aiChatRuntimeNonPlaceholderString)
    }
}

private func aiChatLiveErrorClientRequestId(_ error: Error) -> String? {
    if let diagnosticError = error as? any AIChatFailureDiagnosticProviding {
        return aiChatRuntimeNonPlaceholderString(diagnosticError.diagnostics.clientRequestId)
    }

    guard let liveStreamError = error as? AIChatLiveStreamError else {
        return nil
    }

    switch liveStreamError {
    case .invalidUrl(_, let clientRequestId):
        return aiChatRuntimeNonPlaceholderString(clientRequestId)
    case .invalidResponse(let clientRequestId):
        return aiChatRuntimeNonPlaceholderString(clientRequestId)
    case .transportFailure(_, _, let clientRequestId):
        return aiChatRuntimeNonPlaceholderString(clientRequestId)
    case .staleStream(_, _, let clientRequestId):
        return aiChatRuntimeNonPlaceholderString(clientRequestId)
    case .invalidStatusCode(_, _, _, let clientRequestId):
        return aiChatRuntimeNonPlaceholderString(clientRequestId)
    }
}

private func logAIChatRuntimeLiveEvent(action: String, metadata: [String: String]) {
    let actionValue: AILiveLifecycleAction = AILiveLifecycleAction(rawValue: action) ?? .eventReceived
    let requestId: String? = metadata["requestId"].flatMap(aiChatRuntimeNonPlaceholderString)
    let backendRequestId: String? = metadata["backendRequestId"].flatMap(aiChatRuntimeNonPlaceholderString)
    let clientRequestId: String? = metadata["clientRequestId"].flatMap(aiChatRuntimeNonPlaceholderString)
    let sessionId: String = metadata["sessionId"].flatMap(aiChatRuntimeNonPlaceholderString) ?? "unknown"
    let scope = IOSObservationScope(
        feature: .aiLive,
        userId: nil,
        workspaceId: nil,
        requestId: backendRequestId ?? requestId,
        clientRequestId: clientRequestId,
        sessionId: sessionId,
        runId: metadata["runId"].flatMap(aiChatRuntimeNonPlaceholderString),
        cloudState: nil,
        configurationMode: nil
    )
    let observation = AILiveLifecycleObservation(
        action: actionValue,
        scope: scope,
        sessionId: sessionId,
        runId: metadata["runId"].flatMap(aiChatRuntimeNonPlaceholderString),
        afterCursor: metadata["afterCursor"].flatMap(aiChatRuntimeNonPlaceholderString),
        requestId: requestId,
        backendRequestId: backendRequestId,
        backendCode: metadata["backendCode"].flatMap(aiChatRuntimeNonPlaceholderString),
        statusCode: metadata["statusCode"].flatMap(Int.init),
        eventType: metadata["eventType"].flatMap(aiChatRuntimeNonPlaceholderString),
        sequenceNumber: metadata["sequenceNumber"].flatMap(Int.init),
        cursor: metadata["cursor"].flatMap(aiChatRuntimeNonPlaceholderString),
        streamEpoch: metadata["streamEpoch"].flatMap(aiChatRuntimeNonPlaceholderString),
        itemId: metadata["itemId"].flatMap(aiChatRuntimeNonPlaceholderString),
        toolName: metadata["toolName"].flatMap(aiChatRuntimeNonPlaceholderString),
        toolStatus: metadata["toolStatus"].flatMap(aiChatRuntimeNonPlaceholderString),
        contentCount: metadata["contentCount"].flatMap(Int.init),
        textLength: metadata["textLength"].flatMap(Int.init),
        summaryLength: metadata["summaryLength"].flatMap(Int.init),
        suggestionCount: metadata["suggestionCount"].flatMap(Int.init),
        isError: metadata["isError"].flatMap(aiChatRuntimeBool),
        isStopped: metadata["isStopped"].flatMap(aiChatRuntimeBool),
        outcome: metadata["outcome"].flatMap(aiChatRuntimeNonPlaceholderString),
        failureKind: metadata["failureKind"].flatMap(aiChatRuntimeNonPlaceholderString)
            ?? metadata["errorKind"].flatMap(aiChatRuntimeNonPlaceholderString),
        stage: metadata["stage"].flatMap(AIChatFailureStage.init(rawValue:)),
        errorKind: metadata["errorKind"].flatMap(AIChatFailureKind.init(rawValue:)),
        resumeAttempt: metadata["resumeAttempt"].flatMap(Int.init)
    )
    FlashcardsObservability.addBreadcrumb(.aiLiveLifecycle(observation))
}

private func aiChatRuntimeBool(_ value: String) -> Bool? {
    switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "true":
        return true
    case "false":
        return false
    default:
        return nil
    }
}

private func aiChatRuntimeNonPlaceholderString(_ value: String) -> String? {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false, trimmedValue != "-" else {
        return nil
    }

    return trimmedValue
}

enum AIChatLiveStreamSetupError: LocalizedError, AIChatFailureDiagnosticProviding {
    case missingRunId(
        sessionId: String,
        afterCursor: String?,
        resumeAttemptSequence: Int?,
        clientRequestId: String
    )

    var diagnostics: AIChatFailureDiagnostics {
        switch self {
        case .missingRunId(_, let afterCursor, let resumeAttemptSequence, let clientRequestId):
            let snippet = afterCursor.map { cursor in
                "afterCursorLength=\(cursor.count)"
            } ?? "afterCursorLength=0"
            return AIChatFailureDiagnostics(
                clientRequestId: clientRequestId,
                backendRequestId: nil,
                stage: .requestBuild,
                errorKind: .invalidStreamContract,
                statusCode: nil,
                eventType: nil,
                toolName: nil,
                toolCallId: nil,
                lineNumber: nil,
                rawSnippet: snippet,
                decoderSummary: "AI live attach started without a runId.",
                continuationAttempt: resumeAttemptSequence,
                continuationToolCallIds: []
            )
        }
    }

    var errorDescription: String? {
        return "AI live stream is missing the active run identifier."
    }
}

private func aiChatRuntimeErrorMetadata(
    error: Error,
    sessionId: String,
    runId: String,
    afterCursor: String?,
    resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
) -> [String: String] {
    var metadata: [String: String] = [
        "sessionId": sessionId,
        "runId": runId.isEmpty ? "-" : runId,
        "afterCursor": afterCursor ?? "-",
        "error": error.localizedDescription,
    ]

    if let resumeAttemptDiagnostics {
        metadata["resumeAttempt"] = resumeAttemptDiagnostics.headerValue
    }

    for (key, value) in aiChatErrorLogMetadata(error: error) {
        metadata[key] = value
    }

    return metadata
}
