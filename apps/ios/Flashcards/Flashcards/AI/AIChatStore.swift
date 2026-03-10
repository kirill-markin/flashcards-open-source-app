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
    private let runtime: AIChatSessionRuntime
    private var activeSendTask: Task<Void, Never>?
    private var activeConversationId: String?

    init(
        flashcardsStore: FlashcardsStore,
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatStreaming,
        toolExecutor: any AIToolExecuting,
        snapshotLoader: any AIChatSnapshotLoading
    ) {
        self.flashcardsStore = flashcardsStore
        self.historyStore = historyStore
        self.chatService = chatService
        self.runtime = AIChatSessionRuntime(
            historyStore: historyStore,
            chatService: chatService,
            toolExecutor: toolExecutor,
            snapshotLoader: snapshotLoader,
            streamFlushInterval: 0.1,
            historyCheckpointInterval: 2.0
        )

        let persistedState = historyStore.loadState()
        self.inputText = ""
        self.messages = persistedState.messages
        self.selectedModelId = persistedState.selectedModelId
        self.isStreaming = false
        self.errorMessage = ""
        self.repairStatus = nil
        self.activeConversationId = nil
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
        let state = self.currentPersistedState()
        Task {
            await self.historyStore.saveState(state: state)
        }
    }

    func clearHistory() {
        self.cancelStreaming()
        self.messages = []
        self.errorMessage = ""
        self.repairStatus = nil
        self.activeConversationId = nil
        Task {
            await self.historyStore.clearState()
        }
    }

    func cancelStreaming() {
        self.activeSendTask?.cancel()
        self.activeSendTask = nil
        self.isStreaming = false
        self.repairStatus = nil
    }

    func applyPresentationRequest(request: AIChatPresentationRequest) {
        switch request {
        case .createCard:
            self.inputText = aiChatCreateCardDraftPrompt
        }
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

        let conversationId = UUID().uuidString.lowercased()
        self.activeConversationId = conversationId

        let initialState = self.currentPersistedState()
        let task = Task {
            var diagnosticsSession: CloudLinkedSession?
            do {
                let session = try await self.flashcardsStore.authenticatedCloudSessionForAI()
                diagnosticsSession = session
                let result = await self.runtime.run(
                    session: session,
                    initialState: initialState,
                    eventHandler: { [weak self] event in
                        await self?.handleRuntimeEvent(event, conversationId: conversationId)
                    }
                )
                if let diagnosticsBody = result.failureReportBody, let diagnosticsSession {
                    Task {
                        await self.chatService.reportFailureDiagnostics(session: diagnosticsSession, body: diagnosticsBody)
                    }
                }
            } catch is CancellationError {
            } catch {
                self.markAssistantError(message: localizedMessage(error: error))
                self.repairStatus = nil
                self.isStreaming = false
                let state = self.currentPersistedState()
                Task {
                    await self.historyStore.saveState(state: state)
                }
            }

            if self.activeConversationId == conversationId {
                self.isStreaming = false
                self.activeConversationId = nil
            }
            self.activeSendTask = nil
        }

        self.activeSendTask = task
    }

    private func trimmedInputText() -> String {
        self.inputText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func currentPersistedState() -> AIChatPersistedState {
        AIChatPersistedState(messages: self.messages, selectedModelId: self.selectedModelId)
    }

    private func handleRuntimeEvent(_ event: AIChatRuntimeEvent, conversationId: String) async {
        if let activeConversationId = self.activeConversationId, activeConversationId != conversationId {
            return
        }

        switch event {
        case .appendAssistantText(let text):
            self.appendAssistantText(text: text)
        case .appendToolCallRequest(let toolCallRequest):
            self.appendToolCallRequest(toolCallRequest: toolCallRequest)
        case .completeToolCall(let toolCallId, let output):
            self.completeToolCall(toolCallId: toolCallId, output: output)
        case .setRepairStatus(let status):
            self.repairStatus = status
        case .applySnapshot(let snapshot):
            self.flashcardsStore.applyExternalSnapshot(snapshot: snapshot)
        case .finish:
            self.repairStatus = nil
            if self.activeConversationId == conversationId {
                self.isStreaming = false
            }
        case .fail(let message):
            self.repairStatus = nil
            self.markAssistantError(message: message)
            if self.activeConversationId == conversationId {
                self.isStreaming = false
            }
        }
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
