import Foundation

@MainActor
final class AIChatStore: ObservableObject {
    @Published var inputText: String
    @Published private(set) var messages: [AIChatMessage]
    @Published private(set) var selectedModelId: String
    @Published private(set) var isStreaming: Bool
    @Published private(set) var errorMessage: String

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
        self.historyStore.clearState()
    }

    func cancelStreaming() {
        self.activeSendTask?.cancel()
        self.activeSendTask = nil
        self.isStreaming = false
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
            do {
                let session = try await self.flashcardsStore.authenticatedCloudSessionForAI()
                try await self.runConversation(session: session)
                if Task.isCancelled == false {
                    self.isStreaming = false
                    self.activeSendTask = nil
                    self.persistState()
                }
            } catch is CancellationError {
                self.isStreaming = false
                self.activeSendTask = nil
            } catch {
                self.markAssistantError(message: localizedMessage(error: error))
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
                }
            )

            if outcome.awaitsToolResults == false {
                return
            }

            let requestedToolCalls = outcome.requestedToolCalls
            if requestedToolCalls.isEmpty {
                throw AIChatServiceError.remoteError("The assistant requested tool results without any tool calls.")
            }

            let latestUserText = self.latestUserText()
            for toolCallRequest in requestedToolCalls {
                do {
                    let output = try await self.toolExecutor.execute(
                        toolCallRequest: toolCallRequest,
                        latestUserText: latestUserText
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
