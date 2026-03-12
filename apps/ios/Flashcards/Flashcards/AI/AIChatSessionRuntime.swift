import Foundation

private let aiChatLocalToolExecutionErrorCode: String = "LOCAL_TOOL_EXECUTION_FAILED"
private let aiChatMaximumConsecutiveToolExecutionFailures: Int = 3

private struct AIChatLocalToolExecutionErrorOutput: Encodable {
    let ok: Bool
    let error: AIChatLocalToolExecutionErrorPayload
}

private struct AIChatLocalToolExecutionErrorPayload: Encodable {
    let code: String
    let message: String
}

private struct AIChatRuntimeFailure: LocalizedError, AIChatFailureDiagnosticProviding {
    let message: String
    let diagnostics: AIChatFailureDiagnostics

    var errorDescription: String? {
        self.message
    }
}

actor AIChatSessionRuntime {
    private let historyStore: any AIChatHistoryStoring
    private let chatService: any AIChatStreaming
    private let toolExecutor: any AIToolExecuting
    private let snapshotLoader: any AIChatSnapshotLoading
    private let streamFlushInterval: TimeInterval
    private let historyCheckpointInterval: TimeInterval

    private var persistedState: AIChatPersistedState
    private var pendingAssistantText: String
    private var hasFlushedFirstAssistantDelta: Bool
    private var lastStreamFlushAt: Date
    private var lastHistoryCheckpointAt: Date
    private var consecutiveToolExecutionFailures: Int

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
        self.hasFlushedFirstAssistantDelta = false
        self.lastStreamFlushAt = .distantPast
        self.lastHistoryCheckpointAt = .distantPast
        self.consecutiveToolExecutionFailures = 0
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
                            let errorOutput = try makeLocalToolExecutionErrorOutput(message: errorText)
                            try await self.handleToolCompletion(
                                toolCallId: toolCallRequest.toolCallId,
                                output: errorOutput,
                                didMutateAppState: false,
                                eventHandler: eventHandler
                            )
                            self.consecutiveToolExecutionFailures += 1
                            if self.consecutiveToolExecutionFailures >= aiChatMaximumConsecutiveToolExecutionFailures {
                                throw makeTerminalToolExecutionFailure(
                                    requestId: outcome.requestId,
                                    toolCallRequest: toolCallRequest,
                                    errorMessage: errorText
                                )
                            }
                            continue
                        }

                        self.consecutiveToolExecutionFailures = 0
                        try await self.handleToolCompletion(
                            toolCallId: toolCallRequest.toolCallId,
                            output: result.output,
                            didMutateAppState: result.didMutateAppState,
                            eventHandler: eventHandler
                        )
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
        self.hasFlushedFirstAssistantDelta = false
        self.consecutiveToolExecutionFailures = 0
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
        await self.flushPendingAssistantText(eventHandler: eventHandler)
        let requestedToolCall = AIChatToolCall(
            id: toolCallRequest.toolCallId,
            name: toolCallRequest.name,
            status: .started,
            input: toolCallRequest.input,
            output: nil
        )
        self.persistedState = upsertAssistantToolCall(
            state: self.persistedState,
            toolCall: requestedToolCall
        )
        await self.historyStore.saveState(state: self.persistedState)
        self.lastHistoryCheckpointAt = Date()
        await eventHandler(.setRepairStatus(nil))
        await eventHandler(.upsertToolCall(requestedToolCall))
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
        self.persistedState = completeAssistantToolCall(
            state: self.persistedState,
            toolCallId: toolCallId,
            output: output
        )
        await self.historyStore.saveState(state: self.persistedState)
        self.lastHistoryCheckpointAt = Date()

        if let completedToolCall = assistantToolCall(
            state: self.persistedState,
            toolCallId: toolCallId
        ) {
            await eventHandler(.upsertToolCall(completedToolCall))
        }

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

private func makeLocalToolExecutionErrorOutput(message: String) throws -> String {
    let payload = AIChatLocalToolExecutionErrorOutput(
        ok: false,
        error: AIChatLocalToolExecutionErrorPayload(
            code: aiChatLocalToolExecutionErrorCode,
            message: message
        )
    )
    let data = try JSONEncoder().encode(payload)
    guard let encoded = String(data: data, encoding: .utf8) else {
        throw LocalStoreError.validation("Failed to encode local tool execution error output as UTF-8")
    }
    return encoded
}

private func makeTerminalToolExecutionFailure(
    requestId: String?,
    toolCallRequest: AIToolCallRequest,
    errorMessage: String
) -> AIChatRuntimeFailure {
    let message = "Tool execution failed \(aiChatMaximumConsecutiveToolExecutionFailures) times in a row. Last error: \(errorMessage)"
    return AIChatRuntimeFailure(
        message: message,
        diagnostics: AIChatFailureDiagnostics(
            clientRequestId: toolCallRequest.toolCallId,
            backendRequestId: requestId,
            stage: .toolExecution,
            errorKind: .toolExecutionFailed,
            statusCode: nil,
            eventType: "tool_call_request",
            toolName: toolCallRequest.name,
            toolCallId: toolCallRequest.toolCallId,
            lineNumber: nil,
            rawSnippet: aiChatTruncatedSnippet(toolCallRequest.input),
            decoderSummary: errorMessage
        )
    )
}

private func makeRuntimeRequestBody(state: AIChatPersistedState) -> AILocalChatRequestBody {
    AILocalChatRequestBody(
        messages: state.messages.flatMap { message in
            makeWireMessages(message: message)
        },
        model: state.selectedModelId,
        timezone: TimeZone.current.identifier,
        devicePlatform: "ios"
    )
}

private func makeWireMessages(message: AIChatMessage) -> [AILocalChatWireMessage] {
    var wireMessages: [AILocalChatWireMessage] = [
        AILocalChatWireMessage(
            role: message.role.rawValue,
            content: message.content,
            toolCallId: nil,
            name: nil,
            output: nil
        )
    ]

    guard message.role == .assistant else {
        return wireMessages
    }

    for part in message.content {
        guard case .toolCall(let toolCall) = part else {
            continue
        }
        guard toolCall.status == .completed else {
            continue
        }
        guard aiChatLocalToolNames.contains(toolCall.name) else {
            continue
        }
        guard let output = toolCall.output else {
            continue
        }

        wireMessages.append(
            AILocalChatWireMessage(
                role: "tool",
                content: nil,
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
        content: appendingText(
            content: lastMessage.content,
            text: text
        ),
        timestamp: lastMessage.timestamp,
        isError: lastMessage.isError
    )
    return AIChatPersistedState(messages: messages, selectedModelId: state.selectedModelId)
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
    var updatedContent = lastMessage.content
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
    return AIChatPersistedState(messages: messages, selectedModelId: state.selectedModelId)
}

private func completeAssistantToolCall(
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
    let updatedContent = lastMessage.content.map { part in
        guard case .toolCall(let toolCall) = part else {
            return part
        }

        if toolCall.id == toolCallId {
            return .toolCall(
                AIChatToolCall(
                    id: toolCall.id,
                    name: toolCall.name,
                    status: .completed,
                    input: toolCall.input,
                    output: output
                )
            )
        }

        return part
    }

    messages[lastIndex] = AIChatMessage(
        id: lastMessage.id,
        role: lastMessage.role,
        content: updatedContent,
        timestamp: lastMessage.timestamp,
        isError: lastMessage.isError
    )
    return AIChatPersistedState(messages: messages, selectedModelId: state.selectedModelId)
}

private func assistantToolCall(
    state: AIChatPersistedState,
    toolCallId: String
) -> AIChatToolCall? {
    guard let lastMessage = state.messages.last, lastMessage.role == .assistant else {
        return nil
    }

    for part in lastMessage.content {
        guard case .toolCall(let toolCall) = part else {
            continue
        }

        if toolCall.id == toolCallId {
            return toolCall
        }
    }

    return nil
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
                timestamp: currentIsoTimestamp(),
                isError: true
            )
        )
    }

    return AIChatPersistedState(messages: messages, selectedModelId: state.selectedModelId)
}

private func appendingText(content: [AIChatContentPart], text: String) -> [AIChatContentPart] {
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

private func extractAIChatText(from content: [AIChatContentPart]) -> String {
    content.reduce(into: "") { partialResult, part in
        if case .text(let text) = part {
            partialResult.append(text)
        }
    }
}
