import Foundation

enum AIChatDictationAlert: Identifiable, Equatable {
    case microphoneSettings
    case transcriptionFailure(message: String)

    var id: String {
        switch self {
        case .microphoneSettings:
            return "microphone-settings"
        case .transcriptionFailure(let message):
            return "transcription-failure-\(message)"
        }
    }

    var title: String {
        switch self {
        case .microphoneSettings:
            return "Microphone Access Needed"
        case .transcriptionFailure:
            return "Dictation Failed"
        }
    }

    var message: String {
        switch self {
        case .microphoneSettings:
            return "Microphone access is turned off for Flashcards. Open Settings to allow it."
        case .transcriptionFailure(let message):
            return message
        }
    }
}

struct AIChatCompletedDictationTranscript: Identifiable, Equatable {
    let id: String
    let transcript: String
}

@MainActor
final class AIChatStore: ObservableObject {
    @Published var inputText: String
    @Published private(set) var messages: [AIChatMessage]
    @Published private(set) var pendingAttachments: [AIChatAttachment]
    @Published private(set) var selectedModelId: String
    @Published private(set) var isStreaming: Bool
    @Published private(set) var dictationState: AIChatDictationState
    @Published private(set) var errorMessage: String
    @Published private(set) var dictationAlert: AIChatDictationAlert?
    @Published private(set) var repairStatus: AIChatRepairAttemptStatus?
    @Published private(set) var completedDictationTranscript: AIChatCompletedDictationTranscript?

    private let flashcardsStore: FlashcardsStore
    private let historyStore: any AIChatHistoryStoring
    private let chatService: any AIChatStreaming
    private let voiceRecorder: any AIChatVoiceRecording
    private let audioTranscriber: any AIChatAudioTranscribing
    private let runtime: AIChatSessionRuntime
    private var activeSendTask: Task<Void, Never>?
    private var activeDictationTask: Task<Void, Never>?
    private var activeConversationId: String?

    convenience init(
        flashcardsStore: FlashcardsStore,
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatStreaming,
        toolExecutor: any AIToolExecuting,
        snapshotLoader: any AIChatSnapshotLoading
    ) {
        self.init(
            flashcardsStore: flashcardsStore,
            historyStore: historyStore,
            chatService: chatService,
            toolExecutor: toolExecutor,
            snapshotLoader: snapshotLoader,
            voiceRecorder: AIChatDisabledVoiceRecorder(),
            audioTranscriber: AIChatDisabledAudioTranscriber()
        )
    }

    init(
        flashcardsStore: FlashcardsStore,
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatStreaming,
        toolExecutor: any AIToolExecuting,
        snapshotLoader: any AIChatSnapshotLoading,
        voiceRecorder: any AIChatVoiceRecording,
        audioTranscriber: any AIChatAudioTranscribing
    ) {
        self.flashcardsStore = flashcardsStore
        self.historyStore = historyStore
        self.chatService = chatService
        self.voiceRecorder = voiceRecorder
        self.audioTranscriber = audioTranscriber
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
        self.pendingAttachments = []
        self.selectedModelId = persistedState.selectedModelId
        self.isStreaming = false
        self.dictationState = .idle
        self.errorMessage = ""
        self.dictationAlert = nil
        self.repairStatus = nil
        self.completedDictationTranscript = nil
        self.activeDictationTask = nil
        self.activeConversationId = nil
    }

    var isModelLocked: Bool {
        self.isStreaming || self.messages.isEmpty == false
    }

    var canSendMessage: Bool {
        self.isStreaming == false
            && self.dictationState == .idle
            && self.flashcardsStore.cloudSettings?.cloudState == .linked
            && (self.trimmedInputText().isEmpty == false || self.pendingAttachments.isEmpty == false)
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

    func appendAttachment(_ attachment: AIChatAttachment) {
        self.pendingAttachments.append(attachment)
    }

    func removeAttachment(id: String) {
        self.pendingAttachments.removeAll { attachment in
            attachment.id == id
        }
    }

    func showError(message: String) {
        self.errorMessage = message
    }

    func clearHistory() {
        self.cancelStreaming()
        self.cancelDictation()
        self.messages = []
        self.pendingAttachments = []
        self.errorMessage = ""
        self.dictationAlert = nil
        self.repairStatus = nil
        self.completedDictationTranscript = nil
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

    func toggleDictation() {
        switch self.dictationState {
        case .idle:
            self.startDictation()
        case .recording:
            self.finishDictation()
        case .requestingPermission, .transcribing:
            return
        }
    }

    func cancelDictation() {
        self.activeDictationTask?.cancel()
        self.activeDictationTask = nil
        self.voiceRecorder.cancelRecording()
        self.dictationState = .idle
        self.completedDictationTranscript = nil
    }

    func dismissDictationAlert() {
        self.dictationAlert = nil
    }

    func consumeCompletedDictationTranscript(id: String) {
        guard self.completedDictationTranscript?.id == id else {
            return
        }

        self.completedDictationTranscript = nil
    }

    func applyPresentationRequest(request: AIChatPresentationRequest) {
        switch request {
        case .createCard:
            self.inputText = aiChatCreateCardDraftPrompt
        }
    }

    func warmUpSessionIfNeeded() {
        guard self.isStreaming == false else {
            return
        }
        guard self.flashcardsStore.cloudSettings?.cloudState == .linked else {
            return
        }

        Task {
            await self.flashcardsStore.warmUpAuthenticatedCloudSessionForAI()
        }
    }

    func sendMessage() {
        if self.isStreaming || self.dictationState != .idle {
            return
        }

        let tapStartedAt = Date()

        let content = self.makeOutgoingContent()
        if content.isEmpty {
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
                content: content,
                timestamp: currentIsoTimestamp(),
                isError: false
            )
        )
        self.messages.append(
            AIChatMessage(
                id: UUID().uuidString.lowercased(),
                role: .assistant,
                content: [],
                timestamp: currentIsoTimestamp(),
                isError: false
            )
        )
        self.inputText = ""
        self.pendingAttachments = []
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
                    tapStartedAt: tapStartedAt,
                    eventHandler: { [weak self] event in
                        await self?.handleRuntimeEvent(event, conversationId: conversationId)
                    }
                )
                if let diagnosticsBody = result.failureReportBody, let diagnosticsSession {
                    Task {
                        await self.chatService.reportFailureDiagnostics(session: diagnosticsSession, body: diagnosticsBody)
                    }
                }
                if let latencyReportBody = result.latencyReportBody, let diagnosticsSession {
                    Task {
                        await self.chatService.reportLatencyDiagnostics(session: diagnosticsSession, body: latencyReportBody)
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

    private func startDictation() {
        if self.dictationState != .idle {
            return
        }

        self.dictationAlert = nil
        self.completedDictationTranscript = nil
        self.dictationState = .requestingPermission
        self.activeDictationTask = Task { @MainActor in
            defer {
                self.activeDictationTask = nil
            }

            do {
                try await self.voiceRecorder.startRecording()
                self.dictationState = .recording
            } catch is CancellationError {
                self.dictationState = .idle
            } catch let recorderError as AIChatVoiceRecorderError {
                self.dictationState = .idle
                self.handleStartDictationError(recorderError)
            } catch {
                self.dictationState = .idle
                self.dictationAlert = .transcriptionFailure(message: localizedMessage(error: error))
            }
        }
    }

    private func finishDictation() {
        if self.dictationState != .recording {
            return
        }

        self.dictationState = .transcribing
        self.activeDictationTask = Task { @MainActor in
            defer {
                self.activeDictationTask = nil
            }

            do {
                guard self.flashcardsStore.cloudSettings?.cloudState == .linked else {
                    self.dictationState = .idle
                    self.errorMessage = "AI chat requires cloud sign-in."
                    return
                }

                let session = try await self.flashcardsStore.authenticatedCloudSessionForAI()
                let recordedAudio = try await self.voiceRecorder.stopRecording()
                defer {
                    try? FileManager.default.removeItem(at: recordedAudio.fileUrl)
                }

                let transcript = try await self.audioTranscriber.transcribe(
                    session: session,
                    recordedAudio: recordedAudio
                )
                self.completedDictationTranscript = AIChatCompletedDictationTranscript(
                    id: UUID().uuidString.lowercased(),
                    transcript: transcript
                )
            } catch is CancellationError {
            } catch let recorderError as AIChatVoiceRecorderError {
                self.handleFinishDictationError(recorderError)
            } catch let transcriptionError as AIChatTranscriptionError {
                self.dictationAlert = .transcriptionFailure(message: localizedMessage(error: transcriptionError))
            } catch {
                self.dictationAlert = .transcriptionFailure(message: localizedMessage(error: error))
            }

            self.dictationState = .idle
        }
    }

    private func handleStartDictationError(_ error: AIChatVoiceRecorderError) {
        switch error {
        case .microphoneDenied:
            return
        case .microphoneBlocked:
            self.dictationAlert = .microphoneSettings
        default:
            self.dictationAlert = .transcriptionFailure(message: localizedMessage(error: error))
        }
    }

    private func handleFinishDictationError(_ error: AIChatVoiceRecorderError) {
        switch error {
        case .emptyRecording:
            return
        case .microphoneBlocked:
            self.dictationAlert = .microphoneSettings
        default:
            self.dictationAlert = .transcriptionFailure(message: localizedMessage(error: error))
        }
    }

    private func makeOutgoingContent() -> [AIChatContentPart] {
        var content: [AIChatContentPart] = self.pendingAttachments.map { attachment in
            if attachment.isImage {
                return .image(mediaType: attachment.mediaType, base64Data: attachment.base64Data)
            }

            return .file(
                fileName: attachment.fileName,
                mediaType: attachment.mediaType,
                base64Data: attachment.base64Data
            )
        }

        let trimmedText = self.trimmedInputText()
        if trimmedText.isEmpty == false {
            content.append(.text(trimmedText))
        }

        return content
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
        case .upsertToolCall(let toolCall):
            self.upsertToolCall(toolCall: toolCall)
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
            content: appendingAIChatText(content: lastMessage.content, text: text),
            timestamp: lastMessage.timestamp,
            isError: lastMessage.isError
        )
    }

    private func upsertToolCall(toolCall: AIChatToolCall) {
        guard let lastIndex = self.messages.indices.last else {
            return
        }
        guard self.messages[lastIndex].role == .assistant else {
            return
        }

        self.repairStatus = nil
        let lastMessage = self.messages[lastIndex]
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

        self.messages[lastIndex] = AIChatMessage(
            id: lastMessage.id,
            role: lastMessage.role,
            content: updatedContent,
            timestamp: lastMessage.timestamp,
            isError: lastMessage.isError
        )
    }

    private func markAssistantError(message: String) {
        if let lastIndex = self.messages.indices.last, self.messages[lastIndex].role == .assistant {
            let lastMessage = self.messages[lastIndex]
            let separator = extractAIChatTextContent(parts: lastMessage.content).isEmpty ? "" : "\n\n"
            self.messages[lastIndex] = AIChatMessage(
                id: lastMessage.id,
                role: lastMessage.role,
                content: appendingAIChatText(content: lastMessage.content, text: separator + message),
                timestamp: lastMessage.timestamp,
                isError: true
            )
        } else {
            self.messages.append(
                AIChatMessage(
                    id: UUID().uuidString.lowercased(),
                    role: .assistant,
                    content: [.text(message)],
                    timestamp: currentIsoTimestamp(),
                    isError: true
                )
            )
        }
    }
}

private func appendingAIChatText(content: [AIChatContentPart], text: String) -> [AIChatContentPart] {
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

private func extractAIChatTextContent(parts: [AIChatContentPart]) -> String {
    parts.reduce(into: "") { partialResult, part in
        if case .text(let text) = part {
            partialResult.append(text)
        }
    }
}
