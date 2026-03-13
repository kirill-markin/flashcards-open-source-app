import Foundation

enum AIChatAttachmentSettingsSource: String, Equatable {
    case camera
    case photos
    case files

    var title: String {
        switch self {
        case .camera:
            return "Camera Access Needed"
        case .photos:
            return "Photo Access Needed"
        case .files:
            return "File Access Needed"
        }
    }

    var message: String {
        switch self {
        case .camera:
            return "Camera access is turned off for Flashcards Open Source App. Open Settings to allow it."
        case .photos:
            return "Photo access is turned off for Flashcards Open Source App. Open Settings to allow it."
        case .files:
            return "File access is turned off for Flashcards Open Source App. Open Settings to allow it."
        }
    }
}

enum AIChatAlert: Identifiable, Equatable {
    case microphoneSettings
    case attachmentSettings(source: AIChatAttachmentSettingsSource)
    case generalError(message: String)

    var id: String {
        switch self {
        case .microphoneSettings:
            return "microphone-settings"
        case .attachmentSettings(let source):
            return "attachment-settings-\(source.rawValue)"
        case .generalError(let message):
            return "general-error-\(message)"
        }
    }

    var title: String {
        switch self {
        case .microphoneSettings:
            return "Microphone Access Needed"
        case .attachmentSettings(let source):
            return source.title
        case .generalError:
            return "Error"
        }
    }

    var message: String {
        switch self {
        case .microphoneSettings:
            return "Microphone access is turned off for Flashcards Open Source App. Open Settings to allow it."
        case .attachmentSettings(let source):
            return source.message
        case .generalError(let message):
            return message
        }
    }

    var showsSettingsAction: Bool {
        switch self {
        case .microphoneSettings, .attachmentSettings:
            return true
        case .generalError:
            return false
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
    @Published private(set) var activeAlert: AIChatAlert?
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
        self.activeAlert = nil
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

    func showAlert(_ alert: AIChatAlert) {
        self.activeAlert = alert
    }

    func showGeneralError(message: String) {
        self.activeAlert = .generalError(message: message)
    }

    func showMicrophoneSettingsAlert() {
        self.activeAlert = .microphoneSettings
    }

    func showAttachmentSettingsAlert(source: AIChatAttachmentSettingsSource) {
        self.activeAlert = .attachmentSettings(source: source)
    }

    func clearHistory() {
        self.cancelStreaming()
        self.cancelDictation()
        self.messages = []
        self.pendingAttachments = []
        self.activeAlert = nil
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
        self.clearOptimisticAssistantStatusIfNeeded()
        let state = self.currentPersistedState()
        Task {
            await self.historyStore.saveState(state: state)
        }
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

    func dismissAlert() {
        self.activeAlert = nil
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
            self.showGeneralError(message: "AI chat requires cloud sign-in.")
            return
        }

        self.activeAlert = nil
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
                content: [.text(aiChatOptimisticAssistantStatusText)],
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

        self.activeAlert = nil
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
                self.showGeneralError(message: localizedMessage(error: error))
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
                    self.showGeneralError(message: "AI chat requires cloud sign-in.")
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
                self.showGeneralError(message: localizedMessage(error: transcriptionError))
            } catch {
                self.showGeneralError(message: localizedMessage(error: error))
            }

            self.dictationState = .idle
        }
    }

    private func handleStartDictationError(_ error: AIChatVoiceRecorderError) {
        switch error {
        case .microphoneDenied:
            return
        case .microphoneBlocked:
            self.showMicrophoneSettingsAlert()
        default:
            self.showGeneralError(message: localizedMessage(error: error))
        }
    }

    private func handleFinishDictationError(_ error: AIChatVoiceRecorderError) {
        switch error {
        case .emptyRecording:
            return
        case .microphoneBlocked:
            self.showMicrophoneSettingsAlert()
        default:
            self.showGeneralError(message: localizedMessage(error: error))
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
        var updatedContent = removingOptimisticAIChatStatus(content: lastMessage.content)
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

    private func clearOptimisticAssistantStatusIfNeeded() {
        guard let lastIndex = self.messages.indices.last else {
            return
        }
        guard self.messages[lastIndex].role == .assistant else {
            return
        }
        guard isOptimisticAIChatStatusContent(content: self.messages[lastIndex].content) else {
            return
        }

        let lastMessage = self.messages[lastIndex]
        self.messages[lastIndex] = AIChatMessage(
            id: lastMessage.id,
            role: lastMessage.role,
            content: [],
            timestamp: lastMessage.timestamp,
            isError: lastMessage.isError
        )
    }
}

private func isOptimisticAIChatStatusContent(content: [AIChatContentPart]) -> Bool {
    guard content.count == 1 else {
        return false
    }
    guard case .text(let text) = content[0] else {
        return false
    }

    return text == aiChatOptimisticAssistantStatusText
}

private func removingOptimisticAIChatStatus(content: [AIChatContentPart]) -> [AIChatContentPart] {
    return isOptimisticAIChatStatusContent(content: content) ? [] : content
}

private func appendingAIChatText(content: [AIChatContentPart], text: String) -> [AIChatContentPart] {
    guard text.isEmpty == false else {
        return content
    }

    if isOptimisticAIChatStatusContent(content: content) {
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

private func extractAIChatTextContent(parts: [AIChatContentPart]) -> String {
    if isOptimisticAIChatStatusContent(content: parts) {
        return ""
    }

    return parts.reduce(into: "") { partialResult, part in
        if case .text(let text) = part {
            partialResult.append(text)
        }
    }
}
