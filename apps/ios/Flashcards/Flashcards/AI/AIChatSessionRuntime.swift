import Foundation

private let aiChatRunTimeoutSeconds: TimeInterval = 600

private enum AIChatRuntimeError: LocalizedError {
    case runTimedOut(sessionId: String, timeoutSeconds: TimeInterval)

    var errorDescription: String? {
        switch self {
        case .runTimedOut(let sessionId, let timeoutSeconds):
            return "AI chat run timed out after \(Int(timeoutSeconds)) seconds for session \(sessionId)."
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
        liveUrl: String,
        authorization: String,
        sessionId: String,
        afterCursor: String?,
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
                let stream = await self.liveStreamClient.connect(
                    liveUrl: liveUrl,
                    authorization: authorization,
                    sessionId: sessionId,
                    afterCursor: afterCursor
                )
                for try await event in stream {
                    try Task.checkCancellation()
                    await eventHandler(event)
                }
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
