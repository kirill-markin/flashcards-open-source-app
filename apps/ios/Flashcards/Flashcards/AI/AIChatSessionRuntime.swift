import Foundation

private struct AIChatRuntimeFailure: LocalizedError, AIChatFailureDiagnosticProviding {
    let message: String
    let diagnostics: AIChatFailureDiagnostics

    var errorDescription: String? {
        self.message
    }
}

private func validateAIChatWireMessages(
    _ messages: [AIChatWireMessage]
) throws {
    for message in messages {
        if message.role != "assistant" && message.role != "user" {
            throw LocalStoreError.validation("AI chat request history contains an unsupported role.")
        }
    }
}

private actor AIChatLatencyCapture {
    private var body: AIChatLatencyReportBody?

    func capture(_ nextBody: AIChatLatencyReportBody) {
        if self.body == nil {
            self.body = nextBody
        }
    }

    func snapshot() -> AIChatLatencyReportBody? {
        self.body
    }
}

actor AIChatSessionRuntime {
    private let historyStore: any AIChatHistoryStoring
    private let chatService: any AIChatStreaming
    private let contextLoader: any AIChatContextLoading
    private let streamFlushInterval: TimeInterval
    private let historyCheckpointInterval: TimeInterval

    private var persistedState: AIChatPersistedState
    private var pendingAssistantText: String
    private var hasFlushedFirstAssistantDelta: Bool
    private var lastStreamFlushAt: Date
    private var lastHistoryCheckpointAt: Date

    init(
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatStreaming,
        contextLoader: any AIChatContextLoading,
        streamFlushInterval: TimeInterval,
        historyCheckpointInterval: TimeInterval
    ) {
        self.historyStore = historyStore
        self.chatService = chatService
        self.contextLoader = contextLoader
        self.streamFlushInterval = streamFlushInterval
        self.historyCheckpointInterval = historyCheckpointInterval
        self.persistedState = AIChatPersistedState(
            messages: [],
            selectedModelId: aiChatDefaultModelId,
            chatSessionId: makeAIChatSessionId(),
            codeInterpreterContainerId: nil
        )
        self.pendingAssistantText = ""
        self.hasFlushedFirstAssistantDelta = false
        self.lastStreamFlushAt = .distantPast
        self.lastHistoryCheckpointAt = .distantPast
    }

    func run(
        session: CloudLinkedSession,
        initialState: AIChatPersistedState,
        tapStartedAt: Date,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async -> AIChatRuntimeResult {
        await self.beginRun(state: initialState)
        let latencyCapture = AIChatLatencyCapture()

        do {
            let request = try await self.makeRequestBody()
            let outcome = try await self.chatService.streamTurn(
                session: session,
                request: request,
                tapStartedAt: tapStartedAt,
                onDelta: { [weak self] text in
                    guard let self else {
                        return
                    }

                    await self.handleDelta(text: text, eventHandler: eventHandler)
                },
                onToolCall: { [weak self] toolCall in
                    guard let self else {
                        return
                    }

                    await self.handleToolCall(toolCall: toolCall, eventHandler: eventHandler)
                },
                onToolCallRequest: { [weak self] toolCallRequest in
                    guard let self else {
                        return
                    }

                    await self.handleToolCallRequest(toolCallRequest: toolCallRequest, eventHandler: eventHandler)
                },
                onRepairAttempt: { status in
                    await eventHandler(.setRepairStatus(status))
                },
                onLatencyReported: { latencyBody in
                    await latencyCapture.capture(latencyBody)
                }
            )
            if let codeInterpreterContainerId = outcome.codeInterpreterContainerId {
                self.persistedState = AIChatPersistedState(
                    messages: self.persistedState.messages,
                    selectedModelId: self.persistedState.selectedModelId,
                    chatSessionId: self.persistedState.chatSessionId,
                    codeInterpreterContainerId: codeInterpreterContainerId
                )
            }
            await self.finish(eventHandler: eventHandler)
            return AIChatRuntimeResult(
                failureReportBody: nil,
                latencyReportBody: await latencyCapture.snapshot()
            )
        } catch is CancellationError {
            await self.cancel(eventHandler: eventHandler)
            return AIChatRuntimeResult(
                failureReportBody: nil,
                latencyReportBody: await latencyCapture.snapshot()
            )
        } catch {
            return await self.fail(
                error: error,
                eventHandler: eventHandler,
                latencyReportBody: await latencyCapture.snapshot()
            )
        }
    }

    private func beginRun(state: AIChatPersistedState) async {
        self.persistedState = state
        self.pendingAssistantText = ""
        self.hasFlushedFirstAssistantDelta = false
        let now = Date()
        self.lastStreamFlushAt = now
        self.lastHistoryCheckpointAt = now
        await self.historyStore.saveState(state: state)
    }

    private func handleDelta(
        text: String,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async {
        self.pendingAssistantText.append(text)

        if self.hasFlushedFirstAssistantDelta == false {
            await self.flushPendingAssistantText(eventHandler: eventHandler)
            return
        }

        let now = Date()
        if now.timeIntervalSince(self.lastStreamFlushAt) >= self.streamFlushInterval {
            await self.flushPendingAssistantText(eventHandler: eventHandler)
        }
        if now.timeIntervalSince(self.lastHistoryCheckpointAt) >= self.historyCheckpointInterval {
            await self.historyStore.saveState(state: self.stateWithPendingAssistantText())
            self.lastHistoryCheckpointAt = now
        }
    }

    private func handleToolCall(
        toolCall: AIChatToolCall,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async {
        await self.flushPendingAssistantText(eventHandler: eventHandler)
        self.persistedState = upsertAssistantToolCall(state: self.persistedState, toolCall: toolCall)
        await self.historyStore.saveState(state: self.persistedState)
        self.lastHistoryCheckpointAt = Date()
        await eventHandler(.setRepairStatus(nil))
        await eventHandler(.upsertToolCall(toolCall))
    }

    private func handleToolCallRequest(
        toolCallRequest: AIToolCallRequest,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async {
        let requestedToolCall = AIChatToolCall(
            id: toolCallRequest.toolCallId,
            name: toolCallRequest.name,
            status: .started,
            input: toolCallRequest.input,
            output: nil
        )
        await self.handleToolCall(toolCall: requestedToolCall, eventHandler: eventHandler)
    }

    private func finish(eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void) async {
        await self.flushPendingAssistantText(eventHandler: eventHandler)
        await self.historyStore.saveState(state: self.persistedState)
        await eventHandler(.setRepairStatus(nil))
        await eventHandler(.finish)
    }

    private func cancel(eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void) async {
        await self.flushPendingAssistantText(eventHandler: eventHandler)
        await self.historyStore.saveState(state: self.persistedState)
        await eventHandler(.setRepairStatus(nil))
        await eventHandler(.finish)
    }

    private func fail(
        error: Error,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void,
        latencyReportBody: AIChatLatencyReportBody?
    ) async -> AIChatRuntimeResult {
        await self.flushPendingAssistantText(eventHandler: eventHandler)
        let failureReportBody = self.makeFailureReportBody(error: error)
        let message = Flashcards.errorMessage(error: error)
        if isGuestAiLimitError(error: error) {
            self.persistedState = markAssistantAccountUpgradePrompt(
                state: self.persistedState,
                message: aiChatGuestQuotaReachedMessage,
                buttonTitle: aiChatGuestQuotaButtonTitle
            )
            await self.historyStore.saveState(state: self.persistedState)
            await eventHandler(.setRepairStatus(nil))
            await eventHandler(.appendAssistantAccountUpgradePrompt(
                message: aiChatGuestQuotaReachedMessage,
                buttonTitle: aiChatGuestQuotaButtonTitle
            ))
        } else {
            self.persistedState = markAssistantError(state: self.persistedState, message: message)
            await self.historyStore.saveState(state: self.persistedState)
            await eventHandler(.setRepairStatus(nil))
            await eventHandler(.fail(message))
        }
        return AIChatRuntimeResult(
            failureReportBody: failureReportBody,
            latencyReportBody: latencyReportBody
        )
    }

    private func flushPendingAssistantText(
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async {
        if self.pendingAssistantText.isEmpty {
            return
        }

        let text = self.pendingAssistantText
        self.pendingAssistantText = ""
        self.persistedState = appendAssistantText(state: self.persistedState, text: text)
        self.hasFlushedFirstAssistantDelta = true
        self.lastStreamFlushAt = Date()
        await eventHandler(.appendAssistantText(text))
    }

    private func stateWithPendingAssistantText() -> AIChatPersistedState {
        if self.pendingAssistantText.isEmpty {
            return self.persistedState
        }

        return appendAssistantText(state: self.persistedState, text: self.pendingAssistantText)
    }

    private func makeRequestBody() async throws -> AIChatTurnRequestBody {
        let context = try await self.contextLoader.loadContext()
        let requestBody = makeRuntimeRequestBody(
            state: self.persistedState,
            userContext: makeAIChatUserContext(totalCards: context.totalActiveCards)
        )
        try validateAIChatWireMessages(requestBody.messages)
        return requestBody
    }

    private func makeFailureReportBody(error: Error) -> AIChatFailureReportBody? {
        let diagnostics: AIChatFailureDiagnostics

        if let diagnosticError = error as? any AIChatFailureDiagnosticProviding {
            diagnostics = diagnosticError.diagnostics
        } else {
            return nil
        }

        return AIChatFailureReportBody(
            kind: "failure",
            clientRequestId: diagnostics.clientRequestId,
            backendRequestId: diagnostics.backendRequestId,
            stage: diagnostics.stage.rawValue,
            errorKind: diagnostics.errorKind.rawValue,
            statusCode: diagnostics.statusCode,
            eventType: diagnostics.eventType,
            toolName: diagnostics.toolName,
            toolCallId: diagnostics.toolCallId,
            lineNumber: diagnostics.lineNumber,
            rawSnippet: diagnostics.rawSnippet,
            decoderSummary: diagnostics.decoderSummary,
            continuationAttempt: diagnostics.continuationAttempt,
            continuationToolCallIds: diagnostics.continuationToolCallIds,
            selectedModel: self.persistedState.selectedModelId,
            messageCount: runtimeMessageCount(state: self.persistedState),
            appVersion: aiChatAppVersion(),
            devicePlatform: "ios"
        )
    }
}

func makeAIChatUserContext(totalCards: Int) -> AIChatUserContext {
    AIChatUserContext(totalCards: totalCards)
}

private func makeRuntimeRequestBody(
    state: AIChatPersistedState,
    userContext: AIChatUserContext
) -> AIChatTurnRequestBody {
    AIChatTurnRequestBody(
        messages: state.messages.flatMap { message in
            makeWireMessages(message: message)
        },
        model: state.selectedModelId,
        timezone: TimeZone.current.identifier,
        devicePlatform: "ios",
        chatSessionId: state.chatSessionId,
        codeInterpreterContainerId: state.codeInterpreterContainerId,
        userContext: userContext
    )
}

private func runtimeMessageCount(state: AIChatPersistedState) -> Int {
    state.messages.flatMap { message in
        makeWireMessages(message: message)
    }.count
}

private func makeWireMessages(message: AIChatMessage) -> [AIChatWireMessage] {
    [
        AIChatWireMessage(
            role: message.role.rawValue,
            content: message.role == .assistant
                ? message.content.filter { part in
                    if case .toolCall = part {
                        return false
                    }

                    return true
                }
                : message.content
        )
    ]
}

private func appendAssistantText(state: AIChatPersistedState, text: String) -> AIChatPersistedState {
    guard let lastIndex = state.messages.indices.last else {
        return state
    }
    guard state.messages[lastIndex].role == .assistant else {
        return state
    }

    var messages = state.messages
    let lastMessage = messages[lastIndex]
    messages[lastIndex] = AIChatMessage(
        id: lastMessage.id,
        role: lastMessage.role,
        content: appendingText(
            content: lastMessage.content,
            text: text
        ),
        timestamp: lastMessage.timestamp,
        isError: lastMessage.isError
    )
    return AIChatPersistedState(
        messages: messages,
        selectedModelId: state.selectedModelId,
        chatSessionId: state.chatSessionId,
        codeInterpreterContainerId: state.codeInterpreterContainerId
    )
}

private func upsertAssistantToolCall(
    state: AIChatPersistedState,
    toolCall: AIChatToolCall
) -> AIChatPersistedState {
    guard let lastIndex = state.messages.indices.last else {
        return state
    }
    guard state.messages[lastIndex].role == .assistant else {
        return state
    }

    var messages = state.messages
    let lastMessage = messages[lastIndex]
    var updatedContent = removingOptimisticAssistantStatus(content: lastMessage.content)
    if let contentIndex = updatedContent.firstIndex(where: { part in
        guard case .toolCall(let existingToolCall) = part else {
            return false
        }

        return existingToolCall.id == toolCall.id
    }) {
        updatedContent[contentIndex] = .toolCall(toolCall)
    } else {
        updatedContent.append(.toolCall(toolCall))
    }

    messages[lastIndex] = AIChatMessage(
        id: lastMessage.id,
        role: lastMessage.role,
        content: updatedContent,
        timestamp: lastMessage.timestamp,
        isError: lastMessage.isError
    )
    return AIChatPersistedState(
        messages: messages,
        selectedModelId: state.selectedModelId,
        chatSessionId: state.chatSessionId,
        codeInterpreterContainerId: state.codeInterpreterContainerId
    )
}

private func markAssistantError(state: AIChatPersistedState, message: String) -> AIChatPersistedState {
    var messages = state.messages

    if let lastIndex = messages.indices.last, messages[lastIndex].role == .assistant {
        let lastMessage = messages[lastIndex]
        let separator = extractAIChatText(from: lastMessage.content).isEmpty ? "" : "\n\n"
        messages[lastIndex] = AIChatMessage(
            id: lastMessage.id,
            role: lastMessage.role,
            content: appendingText(
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
        selectedModelId: state.selectedModelId,
        chatSessionId: state.chatSessionId,
        codeInterpreterContainerId: state.codeInterpreterContainerId
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
            role: lastMessage.role,
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
        selectedModelId: state.selectedModelId,
        chatSessionId: state.chatSessionId,
        codeInterpreterContainerId: state.codeInterpreterContainerId
    )
}

private func isGuestAiLimitError(error: Error) -> Bool {
    guard let serviceError = error as? AIChatServiceError else {
        return false
    }

    switch serviceError {
    case .backendError(let backendError, _):
        return isGuestAiLimitCode(backendError.code)
    case .invalidResponse(let errorDetails, _, _):
        return isGuestAiLimitCode(errorDetails.code)
    default:
        return false
    }
}

private func isOptimisticAssistantStatus(content: [AIChatContentPart]) -> Bool {
    guard content.count == 1 else {
        return false
    }
    guard case .text(let text) = content[0] else {
        return false
    }

    return text == aiChatOptimisticAssistantStatusText
}

private func removingOptimisticAssistantStatus(content: [AIChatContentPart]) -> [AIChatContentPart] {
    return isOptimisticAssistantStatus(content: content) ? [] : content
}

private func appendingText(content: [AIChatContentPart], text: String) -> [AIChatContentPart] {
    guard text.isEmpty == false else {
        return content
    }

    if isOptimisticAssistantStatus(content: content) {
        return [.text(text)]
    }

    var updatedContent = content
    if let lastPart = updatedContent.last, case .text(let existingText) = lastPart {
        updatedContent[updatedContent.count - 1] = .text(existingText + text)
    } else {
        updatedContent.append(.text(text))
    }

    return updatedContent
}

private func extractAIChatText(from content: [AIChatContentPart]) -> String {
    if isOptimisticAssistantStatus(content: content) {
        return ""
    }

    return content.reduce(into: "") { partialResult, part in
        if case .text(let text) = part {
            partialResult.append(text)
        }
    }
}
