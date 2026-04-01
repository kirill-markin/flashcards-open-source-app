import Foundation

private let aiChatRunTimeoutSeconds: TimeInterval = 600

private enum AIChatRuntimeError: LocalizedError {
    case runTimedOut(sessionId: String, timeoutSeconds: TimeInterval)
    case liveStreamUnavailable(sessionId: String)
    case liveStreamEndedBeforeCompletion(sessionId: String)

    var errorDescription: String? {
        switch self {
        case .runTimedOut(let sessionId, let timeoutSeconds):
            return "AI chat run timed out after \(Int(timeoutSeconds)) seconds for session \(sessionId)."
        case .liveStreamUnavailable(let sessionId):
            return "AI live stream is unavailable for session \(sessionId)."
        case .liveStreamEndedBeforeCompletion(let sessionId):
            return "AI live stream ended before message completion for session \(sessionId)."
        }
    }
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

    func run(
        session: CloudLinkedSession,
        sessionId: String,
        afterCursor: String?,
        outgoingContent: [AIChatContentPart],
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async {
        _ = self.contextLoader
        logAIChatRuntimeEvent(
            action: "ai_run_start",
            metadata: [
                "sessionId": sessionId.isEmpty ? "-" : sessionId,
                "outgoingContentCount": String(outgoingContent.count)
            ]
        )

        do {
            var effectiveSessionId = sessionId
            if effectiveSessionId.isEmpty {
                if session.authorization.isGuest == false {
                    throw LocalStoreError.validation("AI chat session is unavailable for the linked account.")
                }
                let recoveredSnapshot = try await self.chatService.loadSnapshot(
                    session: session,
                    sessionId: nil
                )
                effectiveSessionId = recoveredSnapshot.sessionId
            }

            let startResponse = try await self.chatService.startRun(
                session: session,
                request: AIChatStartRunRequestBody(
                    sessionId: effectiveSessionId.isEmpty ? nil : effectiveSessionId,
                    clientRequestId: makeAIChatClientRequestId(),
                    content: outgoingContent,
                    timezone: TimeZone.current.identifier
                )
            )
            await eventHandler(.accepted(startResponse))
            logAIChatRuntimeEvent(
                action: "ai_run_started",
                metadata: [
                    "sessionId": startResponse.sessionId,
                    "runState": startResponse.runState
                ]
            )

            if startResponse.runState == "running" {
                return
            }

            await eventHandler(.finish)
        } catch is CancellationError {
            await eventHandler(.finish)
        } catch {
            logAIChatRuntimeEvent(
                action: "ai_run_fail",
                metadata: [
                    "sessionId": sessionId.isEmpty ? "-" : sessionId,
                    "error": error.localizedDescription
                ]
            )
            if isGuestAiLimitError(error: error) {
                await eventHandler(.appendAssistantAccountUpgradePrompt(
                    message: aiChatGuestQuotaReachedMessage,
                    buttonTitle: aiChatGuestQuotaButtonTitle
                ))
                await eventHandler(.finish)
                return
            }
            await eventHandler(.fail(Flashcards.errorMessage(error: error)))
        }
    }

    func attachLive(
        liveStream: AIChatLiveStreamEnvelope,
        sessionId: String,
        afterCursor: String?,
        configurationMode: CloudServiceConfigurationMode,
        eventHandler: @escaping @Sendable (AIChatLiveEvent) async -> Void
    ) {
        detach()
        activeLiveTask = Task {
            logAIChatRuntimeEvent(
                action: "ai_live_attach",
                metadata: [
                    "sessionId": sessionId,
                    "afterCursor": afterCursor ?? "-"
                ]
            )
            do {
                try await self.consumeLiveStream(
                    liveStream: liveStream,
                    sessionId: sessionId,
                    afterCursor: afterCursor,
                    configurationMode: configurationMode,
                    eventHandler: eventHandler
                )
            } catch is CancellationError {
            } catch {
                logAIChatRuntimeEvent(
                    action: "ai_live_error",
                    metadata: [
                        "sessionId": sessionId,
                        "error": error.localizedDescription
                    ]
                )
                await eventHandler(.error(error.localizedDescription))
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
        afterCursor: String?,
        configurationMode: CloudServiceConfigurationMode,
        eventHandler: @escaping @Sendable (AIChatLiveEvent) async -> Void
    ) async throws {
        let stream = await self.liveStreamClient.connect(
            liveUrl: liveStream.url,
            authorization: liveStream.authorization,
            sessionId: sessionId,
            afterCursor: afterCursor,
            configurationMode: configurationMode
        )

        var sawTerminalMessage = false
        var sawExplicitFailure = false

        for try await event in stream {
            try Task.checkCancellation()
            await eventHandler(event)

            switch event {
            case .assistantMessageDone:
                sawTerminalMessage = true
                return
            case .error, .resetRequired:
                sawExplicitFailure = true
                return
            case .runState(let state):
                if state != "running" {
                    throw AIChatRuntimeError.liveStreamEndedBeforeCompletion(sessionId: sessionId)
                }
            case .assistantDelta,
                    .assistantToolCall,
                    .assistantReasoningStarted,
                    .assistantReasoningSummary,
                    .assistantReasoningDone,
                    .repairStatus,
                    .stopAck:
                break
            }
        }

        if sawTerminalMessage || sawExplicitFailure {
            return
        }

        throw AIChatRuntimeError.liveStreamEndedBeforeCompletion(sessionId: sessionId)
    }
}

private func isGuestAiLimitError(error: Error) -> Bool {
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
    logFlashcardsError(domain: "ios_ai_runtime", action: action, metadata: metadata)
}
