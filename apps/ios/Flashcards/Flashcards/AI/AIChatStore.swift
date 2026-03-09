import Foundation

@MainActor
final class AIChatStore: ObservableObject {
    @Published var inputText: String
    @Published private(set) var messages: [AIChatMessage]
    @Published private(set) var selectedModelId: String
    @Published private(set) var isStreaming: Bool
    @Published private(set) var errorMessage: String
    @Published private(set) var repairStatus: AIChatRepairAttemptStatus?

    private let flashcardsStore: FlashcardsStore
    private let historyStore: any AIChatHistoryStoring
    private let chatService: any AIChatStreaming
    private let toolExecutor: any AIToolExecuting
    private var activeSendTask: Task<Void, Never>?

    init(
        flashcardsStore: FlashcardsStore,
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatStreaming,
        toolExecutor: any AIToolExecuting
    ) {
        self.flashcardsStore = flashcardsStore
        self.historyStore = historyStore
        self.chatService = chatService
        self.toolExecutor = toolExecutor

        let persistedState = historyStore.loadState()
        self.inputText = ""
        self.messages = persistedState.messages
        self.selectedModelId = persistedState.selectedModelId
        self.isStreaming = false
        self.errorMessage = ""
        self.repairStatus = nil
    }

    var isModelLocked: Bool {
        self.isStreaming || self.messages.isEmpty == false
    }

    var canSendMessage: Bool {
        self.isStreaming == false
            && self.flashcardsStore.cloudSettings?.cloudState == .linked
            && self.trimmedInputText().isEmpty == false
    }

    func setSelectedModel(modelId: String) {
        if self.isModelLocked {
            return
        }

        self.selectedModelId = modelId
        self.persistState()
    }

    func clearHistory() {
        self.cancelStreaming()
        self.messages = []
        self.errorMessage = ""
        self.repairStatus = nil
        self.historyStore.clearState()
    }

    func cancelStreaming() {
        self.activeSendTask?.cancel()
        self.activeSendTask = nil
        self.isStreaming = false
        self.repairStatus = nil
    }

    func sendMessage() {
        if self.isStreaming {
            return
        }

        let trimmedText = self.trimmedInputText()
        if trimmedText.isEmpty {
            return
        }

        guard self.flashcardsStore.cloudSettings?.cloudState == .linked else {
            self.errorMessage = "AI chat requires cloud sign-in."
            return
        }

        self.errorMessage = ""
        self.repairStatus = nil
        self.messages.append(
            AIChatMessage(
                id: UUID().uuidString.lowercased(),
                role: .user,
                text: trimmedText,
                toolCalls: [],
                timestamp: currentIsoTimestamp(),
                isError: false
            )
        )
        self.messages.append(
            AIChatMessage(
                id: UUID().uuidString.lowercased(),
                role: .assistant,
                text: "",
                toolCalls: [],
                timestamp: currentIsoTimestamp(),
                isError: false
            )
        )
        self.inputText = ""
        self.isStreaming = true
        self.persistState()

        let task = Task { @MainActor in
            var diagnosticsSession: CloudLinkedSession?
            do {
                let session = try await self.flashcardsStore.authenticatedCloudSessionForAI()
                diagnosticsSession = session
                try await self.runConversation(session: session)
                if Task.isCancelled == false {
                    self.repairStatus = nil
                    self.isStreaming = false
                    self.activeSendTask = nil
                    self.persistState()
                }
            } catch is CancellationError {
                self.repairStatus = nil
                self.isStreaming = false
                self.activeSendTask = nil
            } catch {
                let diagnosticsBody = self.makeFailureReportBody(error: error)
                self.repairStatus = nil
                self.markAssistantError(message: localizedMessage(error: error))
                if let diagnosticsBody, let diagnosticsSession {
                    Task {
                        await self.chatService.reportFailureDiagnostics(session: diagnosticsSession, body: diagnosticsBody)
                    }
                }
                self.isStreaming = false
                self.activeSendTask = nil
                self.persistState()
            }
        }

        self.activeSendTask = task
    }

    private func runConversation(session: CloudLinkedSession) async throws {
        while true {
            let request = self.makeRequestBody()
            let outcome = try await self.chatService.streamTurn(
                session: session,
                request: request,
                onDelta: { [weak self] text in
                    await self?.appendAssistantText(text: text)
                },
                onToolCallRequest: { [weak self] toolCallRequest in
                    await self?.appendToolCallRequest(toolCallRequest: toolCallRequest)
                },
                onRepairAttempt: { [weak self] status in
                    await self?.setRepairStatus(status: status)
                }
            )
            if outcome.awaitsToolResults == false {
                self.repairStatus = nil
                return
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

            let latestUserText = self.latestUserText()
            for toolCallRequest in requestedToolCalls {
                do {
                    let output = try await self.toolExecutor.execute(
                        toolCallRequest: toolCallRequest,
                        latestUserText: latestUserText,
                        requestId: outcome.requestId
                    )
                    self.completeToolCall(toolCallId: toolCallRequest.toolCallId, output: output)
                    self.persistState()
                } catch {
                    let errorText = localizedMessage(error: error)
                    self.completeToolCall(toolCallId: toolCallRequest.toolCallId, output: errorText)
                    self.persistState()
                    throw error
                }
            }
        }
    }

    private func trimmedInputText() -> String {
        self.inputText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func persistState() {
        self.historyStore.saveState(
            state: AIChatPersistedState(messages: self.messages, selectedModelId: self.selectedModelId)
        )
    }

    private func makeRequestBody() -> AILocalChatRequestBody {
        AILocalChatRequestBody(
            messages: self.messages.flatMap { message in
                self.makeWireMessages(message: message)
            },
            model: self.selectedModelId,
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

    private func latestUserText() -> String {
        self.messages.reversed().first(where: { message in
            message.role == .user
        })?.text ?? ""
    }

    private func appendAssistantText(text: String) {
        guard let lastIndex = self.messages.indices.last else {
            return
        }
        guard self.messages[lastIndex].role == .assistant else {
            return
        }

        let lastMessage = self.messages[lastIndex]
        self.messages[lastIndex] = AIChatMessage(
            id: lastMessage.id,
            role: lastMessage.role,
            text: lastMessage.text + text,
            toolCalls: lastMessage.toolCalls,
            timestamp: lastMessage.timestamp,
            isError: lastMessage.isError
        )
        self.persistState()
    }

    private func appendToolCallRequest(toolCallRequest: AIToolCallRequest) {
        guard let lastIndex = self.messages.indices.last else {
            return
        }
        guard self.messages[lastIndex].role == .assistant else {
            return
        }

        self.repairStatus = nil
        let lastMessage = self.messages[lastIndex]
        self.messages[lastIndex] = AIChatMessage(
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
        self.persistState()
    }

    private func completeToolCall(toolCallId: String, output: String) {
        guard let lastIndex = self.messages.indices.last else {
            return
        }
        guard self.messages[lastIndex].role == .assistant else {
            return
        }

        let lastMessage = self.messages[lastIndex]
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

        self.messages[lastIndex] = AIChatMessage(
            id: lastMessage.id,
            role: lastMessage.role,
            text: lastMessage.text,
            toolCalls: updatedToolCalls,
            timestamp: lastMessage.timestamp,
            isError: lastMessage.isError
        )
    }

    private func setRepairStatus(status: AIChatRepairAttemptStatus) {
        self.repairStatus = status
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
            selectedModel: self.selectedModelId,
            messageCount: self.makeRequestBody().messages.count,
            appVersion: aiChatAppVersion(),
            devicePlatform: "ios"
        )
    }

    private func markAssistantError(message: String) {
        if let lastIndex = self.messages.indices.last, self.messages[lastIndex].role == .assistant {
            let lastMessage = self.messages[lastIndex]
            let nextText = lastMessage.text.isEmpty ? message : "\(lastMessage.text)\n\n\(message)"
            self.messages[lastIndex] = AIChatMessage(
                id: lastMessage.id,
                role: lastMessage.role,
                text: nextText,
                toolCalls: lastMessage.toolCalls,
                timestamp: lastMessage.timestamp,
                isError: true
            )
        } else {
            self.messages.append(
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
    }
}
