import Foundation

actor AIChatSessionRuntime {
    private let historyStore: any AIChatHistoryStoring
    private let chatService: any AIChatStreaming
    private let toolExecutor: any AIToolExecuting
    private let snapshotLoader: any AIChatSnapshotLoading
    private let streamFlushInterval: TimeInterval
    private let historyCheckpointInterval: TimeInterval

    private var persistedState: AIChatPersistedState
    private var pendingAssistantText: String
    private var lastStreamFlushAt: Date
    private var lastHistoryCheckpointAt: Date

    init(
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatStreaming,
        toolExecutor: any AIToolExecuting,
        snapshotLoader: any AIChatSnapshotLoading,
        streamFlushInterval: TimeInterval,
        historyCheckpointInterval: TimeInterval
    ) {
        self.historyStore = historyStore
        self.chatService = chatService
        self.toolExecutor = toolExecutor
        self.snapshotLoader = snapshotLoader
        self.streamFlushInterval = streamFlushInterval
        self.historyCheckpointInterval = historyCheckpointInterval
        self.persistedState = AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
        self.pendingAssistantText = ""
        self.lastStreamFlushAt = .distantPast
        self.lastHistoryCheckpointAt = .distantPast
    }

    func run(
        session: CloudLinkedSession,
        initialState: AIChatPersistedState,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async -> AIChatRuntimeResult {
        await self.beginRun(state: initialState)

        do {
            while true {
                let request = self.makeRequestBody()
                let outcome = try await self.chatService.streamTurn(
                    session: session,
                    request: request,
                    onDelta: { [weak self] text in
                        guard let self else {
                            return
                        }

                        await self.handleDelta(text: text, eventHandler: eventHandler)
                    },
                    onToolCallRequest: { [weak self] toolCallRequest in
                        guard let self else {
                            return
                        }

                        await self.handleToolCallRequest(toolCallRequest: toolCallRequest, eventHandler: eventHandler)
                    },
                    onRepairAttempt: { [weak self] status in
                        guard let self else {
                            return
                        }

                        await self.handleRepairStatus(status: status, eventHandler: eventHandler)
                    }
                )
                await self.flushPendingAssistantText(eventHandler: eventHandler)
                if outcome.awaitsToolResults == false {
                    await self.finish(eventHandler: eventHandler)
                    return AIChatRuntimeResult(failureReportBody: nil)
                }

                let requestedToolCalls = outcome.requestedToolCalls
                if requestedToolCalls.isEmpty {
                    throw AIChatServiceError.invalidStreamContract(
                        "The assistant requested tool results without any tool calls.",
                        AIChatFailureDiagnostics(
                            clientRequestId: UUID().uuidString.lowercased(),
                            backendRequestId: outcome.requestId,
                            stage: .backendErrorEvent,
                            errorKind: .invalidStreamContract,
                            statusCode: nil,
                            eventType: "await_tool_results",
                            toolName: nil,
                            toolCallId: nil,
                            lineNumber: nil,
                            rawSnippet: nil,
                            decoderSummary: "await_tool_results without tool_call_request"
                        )
                    )
                }

                for toolCallRequest in requestedToolCalls {
                    do {
                        let result: AIToolExecutionResult
                        do {
                            result = try await self.toolExecutor.execute(
                                toolCallRequest: toolCallRequest,
                                requestId: outcome.requestId
                            )
                        } catch {
                            let errorText = localizedMessage(error: error)
                            try await self.handleToolCompletion(
                                toolCallId: toolCallRequest.toolCallId,
                                output: errorText,
                                didMutateAppState: false,
                                eventHandler: eventHandler
                            )
                            throw error
                        }

                        try await self.handleToolCompletion(
                            toolCallId: toolCallRequest.toolCallId,
                            output: result.output,
                            didMutateAppState: result.didMutateAppState,
                            eventHandler: eventHandler
                        )
                    } catch {
                        throw error
                    }
                }
            }
        } catch is CancellationError {
            await self.cancel(eventHandler: eventHandler)
            return AIChatRuntimeResult(failureReportBody: nil)
        } catch {
            return await self.fail(error: error, eventHandler: eventHandler)
        }
    }

    private func beginRun(state: AIChatPersistedState) async {
        self.persistedState = state
        self.pendingAssistantText = ""
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

        let now = Date()
        if now.timeIntervalSince(self.lastStreamFlushAt) >= self.streamFlushInterval {
            await self.flushPendingAssistantText(eventHandler: eventHandler)
        }
        if now.timeIntervalSince(self.lastHistoryCheckpointAt) >= self.historyCheckpointInterval {
            await self.historyStore.saveState(state: self.stateWithPendingAssistantText())
            self.lastHistoryCheckpointAt = now
        }
    }

    private func handleToolCallRequest(
        toolCallRequest: AIToolCallRequest,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async {
        await self.flushPendingAssistantText(eventHandler: eventHandler)
        self.persistedState = appendToolCallRequest(
            state: self.persistedState,
            toolCallRequest: toolCallRequest
        )
        await self.historyStore.saveState(state: self.persistedState)
        self.lastHistoryCheckpointAt = Date()
        await eventHandler(.setRepairStatus(nil))
        await eventHandler(.appendToolCallRequest(toolCallRequest))
    }

    private func handleRepairStatus(
        status: AIChatRepairAttemptStatus,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async {
        await eventHandler(.setRepairStatus(status))
    }

    private func handleToolCompletion(
        toolCallId: String,
        output: String,
        didMutateAppState: Bool,
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async throws {
        self.persistedState = completeToolCall(
            state: self.persistedState,
            toolCallId: toolCallId,
            output: output
        )
        await self.historyStore.saveState(state: self.persistedState)
        self.lastHistoryCheckpointAt = Date()
        await eventHandler(.completeToolCall(toolCallId: toolCallId, output: output))
        if didMutateAppState {
            let snapshot = try await self.snapshotLoader.loadSnapshot()
            await eventHandler(.applySnapshot(snapshot))
        }
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
        eventHandler: @escaping @Sendable (AIChatRuntimeEvent) async -> Void
    ) async -> AIChatRuntimeResult {
        await self.flushPendingAssistantText(eventHandler: eventHandler)
        let failureReportBody = self.makeFailureReportBody(error: error)
        let message = localizedMessage(error: error)
        self.persistedState = markAssistantError(state: self.persistedState, message: message)
        await self.historyStore.saveState(state: self.persistedState)
        await eventHandler(.setRepairStatus(nil))
        await eventHandler(.fail(message))
        return AIChatRuntimeResult(failureReportBody: failureReportBody)
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
        self.lastStreamFlushAt = Date()
        await eventHandler(.appendAssistantText(text))
    }

    private func stateWithPendingAssistantText() -> AIChatPersistedState {
        if self.pendingAssistantText.isEmpty {
            return self.persistedState
        }

        return appendAssistantText(state: self.persistedState, text: self.pendingAssistantText)
    }

    private func makeRequestBody() -> AILocalChatRequestBody {
        makeRuntimeRequestBody(state: self.persistedState)
    }

    private func makeFailureReportBody(error: Error) -> AIChatFailureReportBody? {
        let diagnostics: AIChatFailureDiagnostics

        if let diagnosticError = error as? any AIChatFailureDiagnosticProviding {
            diagnostics = diagnosticError.diagnostics
        } else if let toolError = error as? AIToolExecutionError, case .invalidToolInput(
            let requestId,
            let toolName,
            let toolCallId,
            _,
            let decoderSummary,
            let rawInputSnippet
        ) = toolError {
            diagnostics = AIChatFailureDiagnostics(
                clientRequestId: toolCallId,
                backendRequestId: requestId,
                stage: .toolInputDecode,
                errorKind: .invalidToolInput,
                statusCode: nil,
                eventType: "tool_call_request",
                toolName: toolName,
                toolCallId: toolCallId,
                lineNumber: nil,
                rawSnippet: rawInputSnippet,
                decoderSummary: decoderSummary
            )
        } else {
            return nil
        }

        return AIChatFailureReportBody(
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
            selectedModel: self.persistedState.selectedModelId,
            messageCount: self.makeRequestBody().messages.count,
            appVersion: aiChatAppVersion(),
            devicePlatform: "ios"
        )
    }
}

private func makeRuntimeRequestBody(state: AIChatPersistedState) -> AILocalChatRequestBody {
    AILocalChatRequestBody(
        messages: state.messages.flatMap { message in
            makeWireMessages(message: message)
        },
        model: state.selectedModelId,
        timezone: TimeZone.current.identifier
    )
}

private func makeWireMessages(message: AIChatMessage) -> [AILocalChatWireMessage] {
    if message.role == .user {
        return [
            AILocalChatWireMessage(
                role: "user",
                content: message.text,
                toolCalls: nil,
                toolCallId: nil,
                name: nil,
                output: nil
            )
        ]
    }

    var wireMessages: [AILocalChatWireMessage] = [
        AILocalChatWireMessage(
            role: "assistant",
            content: message.text,
            toolCalls: message.toolCalls.map { toolCall in
                AILocalAssistantToolCall(
                    toolCallId: toolCall.id,
                    name: toolCall.name,
                    input: toolCall.input
                )
            },
            toolCallId: nil,
            name: nil,
            output: nil
        )
    ]

    for toolCall in message.toolCalls {
        guard let output = toolCall.output else {
            continue
        }

        wireMessages.append(
            AILocalChatWireMessage(
                role: "tool",
                content: nil,
                toolCalls: nil,
                toolCallId: toolCall.id,
                name: toolCall.name,
                output: output
            )
        )
    }

    return wireMessages
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
        text: lastMessage.text + text,
        toolCalls: lastMessage.toolCalls,
        timestamp: lastMessage.timestamp,
        isError: lastMessage.isError
    )
    return AIChatPersistedState(messages: messages, selectedModelId: state.selectedModelId)
}

private func appendToolCallRequest(
    state: AIChatPersistedState,
    toolCallRequest: AIToolCallRequest
) -> AIChatPersistedState {
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
        text: lastMessage.text,
        toolCalls: lastMessage.toolCalls + [
            AIChatToolCall(
                id: toolCallRequest.toolCallId,
                name: toolCallRequest.name,
                status: .requested,
                input: toolCallRequest.input,
                output: nil
            )
        ],
        timestamp: lastMessage.timestamp,
        isError: lastMessage.isError
    )
    return AIChatPersistedState(messages: messages, selectedModelId: state.selectedModelId)
}

private func completeToolCall(
    state: AIChatPersistedState,
    toolCallId: String,
    output: String
) -> AIChatPersistedState {
    guard let lastIndex = state.messages.indices.last else {
        return state
    }
    guard state.messages[lastIndex].role == .assistant else {
        return state
    }

    var messages = state.messages
    let lastMessage = messages[lastIndex]
    let updatedToolCalls = lastMessage.toolCalls.map { toolCall in
        if toolCall.id == toolCallId {
            return AIChatToolCall(
                id: toolCall.id,
                name: toolCall.name,
                status: .completed,
                input: toolCall.input,
                output: output
            )
        }

        return toolCall
    }

    messages[lastIndex] = AIChatMessage(
        id: lastMessage.id,
        role: lastMessage.role,
        text: lastMessage.text,
        toolCalls: updatedToolCalls,
        timestamp: lastMessage.timestamp,
        isError: lastMessage.isError
    )
    return AIChatPersistedState(messages: messages, selectedModelId: state.selectedModelId)
}

private func markAssistantError(state: AIChatPersistedState, message: String) -> AIChatPersistedState {
    var messages = state.messages

    if let lastIndex = messages.indices.last, messages[lastIndex].role == .assistant {
        let lastMessage = messages[lastIndex]
        let nextText = lastMessage.text.isEmpty ? message : "\(lastMessage.text)\n\n\(message)"
        messages[lastIndex] = AIChatMessage(
            id: lastMessage.id,
            role: lastMessage.role,
            text: nextText,
            toolCalls: lastMessage.toolCalls,
            timestamp: lastMessage.timestamp,
            isError: true
        )
    } else {
        messages.append(
            AIChatMessage(
                id: UUID().uuidString.lowercased(),
                role: .assistant,
                text: message,
                toolCalls: [],
                timestamp: currentIsoTimestamp(),
                isError: true
            )
        )
    }

    return AIChatPersistedState(messages: messages, selectedModelId: state.selectedModelId)
}
