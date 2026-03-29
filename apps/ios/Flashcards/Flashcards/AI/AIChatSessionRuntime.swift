import Foundation

private let aiChatSnapshotPollIntervalNanoseconds: UInt64 = 1_000_000_000
private let aiChatRunTimeoutSeconds: TimeInterval = 60

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
    private let historyStore: any AIChatHistoryStoring
    private let chatService: any AIChatSessionServicing
    private let contextLoader: any AIChatContextLoading

    private var persistedState: AIChatPersistedState

    init(
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatSessionServicing,
        contextLoader: any AIChatContextLoading
    ) {
        self.historyStore = historyStore
        self.chatService = chatService
        self.contextLoader = contextLoader
        self.persistedState = AIChatPersistedState(messages: [])
    }

    func run(
        session: CloudLinkedSession,
        initialState: AIChatPersistedState,
        outgoingContent: [AIChatContentPart],
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async {
        _ = self.contextLoader
        self.persistedState = initialState
        await self.historyStore.saveState(state: initialState)
        let runStartedAt = Date()
        logAIChatRuntimeEvent(
            action: "ai_run_start",
            metadata: [
                "sessionId": initialState.chatSessionId.isEmpty ? "-" : initialState.chatSessionId,
                "outgoingContentCount": String(outgoingContent.count)
            ]
        )

        do {
            let startResponse = try await self.chatService.startRun(
                session: session,
                request: AIChatStartRunRequestBody(
                    sessionId: initialState.chatSessionId.isEmpty ? nil : initialState.chatSessionId,
                    content: outgoingContent,
                    timezone: TimeZone.current.identifier
                )
            )
            self.persistedState = AIChatPersistedState(
                messages: self.persistedState.messages,
                chatSessionId: startResponse.sessionId,
                lastKnownChatConfig: startResponse.chatConfig
            )
            await self.historyStore.saveState(state: self.persistedState)
            logAIChatRuntimeEvent(
                action: "ai_run_started",
                metadata: [
                    "sessionId": startResponse.sessionId,
                    "runState": startResponse.runState
                ]
            )

            var lastSnapshotFingerprint: String? = nil
            while true {
                try Task.checkCancellation()

                let snapshot = try await self.chatService.loadSnapshot(
                    session: session,
                    sessionId: self.persistedState.chatSessionId
                )
                let fingerprint = makeSnapshotFingerprint(snapshot: snapshot)
                logAIChatRuntimeEvent(
                    action: "ai_snapshot_poll",
                    metadata: [
                        "sessionId": snapshot.sessionId,
                        "runState": snapshot.runState,
                        "messagesCount": String(snapshot.messages.count),
                        "fingerprint": fingerprint
                    ]
                )
                if lastSnapshotFingerprint != fingerprint {
                    await self.applySnapshot(snapshot, eventHandler: eventHandler)
                    lastSnapshotFingerprint = fingerprint
                    logAIChatRuntimeEvent(
                        action: "ai_snapshot_changed",
                        metadata: [
                            "sessionId": snapshot.sessionId,
                            "runState": snapshot.runState,
                            "messagesCount": String(snapshot.messages.count),
                            "fingerprint": fingerprint
                        ]
                    )
                }

                if snapshot.runState != "running" {
                    logAIChatRuntimeEvent(
                        action: "ai_run_finish",
                        metadata: [
                            "sessionId": snapshot.sessionId,
                            "runState": snapshot.runState,
                            "durationSeconds": String(Int(Date().timeIntervalSince(runStartedAt)))
                        ]
                    )
                    break
                }

                let elapsedSeconds = Date().timeIntervalSince(runStartedAt)
                if elapsedSeconds >= aiChatRunTimeoutSeconds {
                    logAIChatRuntimeEvent(
                        action: "ai_run_timeout",
                        metadata: [
                            "sessionId": snapshot.sessionId,
                            "runState": snapshot.runState,
                            "durationSeconds": String(Int(elapsedSeconds))
                        ]
                    )
                    throw AIChatRuntimeError.runTimedOut(
                        sessionId: snapshot.sessionId,
                        timeoutSeconds: aiChatRunTimeoutSeconds
                    )
                }

                try await Task.sleep(nanoseconds: aiChatSnapshotPollIntervalNanoseconds)
            }

            await eventHandler(.finish)
        } catch is CancellationError {
            await self.handleCancellation(session: session, eventHandler: eventHandler)
        } catch {
            logAIChatRuntimeEvent(
                action: "ai_run_fail",
                metadata: [
                    "sessionId": self.persistedState.chatSessionId.isEmpty ? "-" : self.persistedState.chatSessionId,
                    "error": error.localizedDescription
                ]
            )
            await self.fail(error: error, eventHandler: eventHandler)
        }
    }

    private func applySnapshot(
        _ snapshot: AIChatSessionSnapshot,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async {
        self.persistedState = AIChatPersistedState(
            messages: snapshot.messages,
            chatSessionId: snapshot.sessionId,
            lastKnownChatConfig: snapshot.chatConfig
        )
        await self.historyStore.saveState(state: self.persistedState)
        await eventHandler(.applySnapshot(snapshot))
    }

    private func handleCancellation(
        session: CloudLinkedSession,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async {
        if self.persistedState.chatSessionId.isEmpty == false {
            _ = try? await self.chatService.stopRun(
                session: session,
                sessionId: self.persistedState.chatSessionId
            )
            if let snapshot = try? await self.chatService.loadSnapshot(
                session: session,
                sessionId: self.persistedState.chatSessionId
            ) {
                await self.applySnapshot(snapshot, eventHandler: eventHandler)
            }
        }

        await eventHandler(.finish)
    }

    private func fail(
        error: Error,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async {
        if isGuestAiLimitError(error: error) {
            self.persistedState = markAssistantAccountUpgradePrompt(
                state: self.persistedState,
                message: aiChatGuestQuotaReachedMessage,
                buttonTitle: aiChatGuestQuotaButtonTitle
            )
            await self.historyStore.saveState(state: self.persistedState)
            await eventHandler(.appendAssistantAccountUpgradePrompt(
                message: aiChatGuestQuotaReachedMessage,
                buttonTitle: aiChatGuestQuotaButtonTitle
            ))
            await eventHandler(.finish)
            return
        }

        let message = Flashcards.errorMessage(error: error)
        self.persistedState = markAssistantError(state: self.persistedState, message: message)
        await self.historyStore.saveState(state: self.persistedState)
        await eventHandler(.fail(message))
    }
}

private func makeSnapshotFingerprint(snapshot: AIChatSessionSnapshot) -> String {
    "\(snapshot.updatedAt):\(snapshot.mainContentInvalidationVersion):\(snapshot.runState):\(snapshot.messages.count)"
}

private func markAssistantError(state: AIChatPersistedState, message: String) -> AIChatPersistedState {
    var messages = state.messages
    if let lastIndex = messages.indices.last, messages[lastIndex].role == .assistant {
        let lastMessage = messages[lastIndex]
        let separator = extractAIChatRuntimeText(parts: lastMessage.content).isEmpty ? "" : "\n\n"
        messages[lastIndex] = AIChatMessage(
            id: lastMessage.id,
            role: .assistant,
            content: appendAIChatRuntimeText(
                content: lastMessage.content,
                text: separator + message
            ),
            timestamp: lastMessage.timestamp,
            isError: true
        )
    } else {
        messages.append(
            AIChatMessage(
                id: UUID().uuidString.lowercased(),
                role: .assistant,
                content: [.text(message)],
                timestamp: nowIsoTimestamp(),
                isError: true
            )
        )
    }

    return AIChatPersistedState(
        messages: messages,
        chatSessionId: state.chatSessionId,
        lastKnownChatConfig: state.lastKnownChatConfig
    )
}

private func markAssistantAccountUpgradePrompt(
    state: AIChatPersistedState,
    message: String,
    buttonTitle: String
) -> AIChatPersistedState {
    var messages = state.messages
    if let lastIndex = messages.indices.last, messages[lastIndex].role == .assistant {
        let lastMessage = messages[lastIndex]
        messages[lastIndex] = AIChatMessage(
            id: lastMessage.id,
            role: .assistant,
            content: [.accountUpgradePrompt(message: message, buttonTitle: buttonTitle)],
            timestamp: lastMessage.timestamp,
            isError: false
        )
    } else {
        messages.append(
            AIChatMessage(
                id: UUID().uuidString.lowercased(),
                role: .assistant,
                content: [.accountUpgradePrompt(message: message, buttonTitle: buttonTitle)],
                timestamp: nowIsoTimestamp(),
                isError: false
            )
        )
    }

    return AIChatPersistedState(
        messages: messages,
        chatSessionId: state.chatSessionId,
        lastKnownChatConfig: state.lastKnownChatConfig
    )
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

private func extractAIChatRuntimeText(parts: [AIChatContentPart]) -> String {
    parts.reduce(into: "") { partialResult, part in
        if case .text(let text) = part {
            partialResult.append(text)
        }
    }
}

private func appendAIChatRuntimeText(content: [AIChatContentPart], text: String) -> [AIChatContentPart] {
    guard text.isEmpty == false else {
        return content
    }

    var updatedContent = content
    if let lastPart = updatedContent.last, case .text(let existingText) = lastPart {
        updatedContent[updatedContent.count - 1] = .text(existingText + text)
    } else {
        updatedContent.append(.text(text))
    }

    return updatedContent
}

private func logAIChatRuntimeEvent(action: String, metadata: [String: String]) {
    logFlashcardsError(domain: "ios_ai_runtime", action: action, metadata: metadata)
}
