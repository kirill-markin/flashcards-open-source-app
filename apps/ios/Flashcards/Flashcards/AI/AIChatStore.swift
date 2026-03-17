import Foundation
import Observation

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
@Observable
final class AIChatStore {
    var inputText: String
    private(set) var messages: [AIChatMessage]
    private(set) var pendingAttachments: [AIChatAttachment]
    private(set) var selectedModelId: String
    private(set) var isStreaming: Bool
    private(set) var dictationState: AIChatDictationState
    private(set) var activeAlert: AIChatAlert?
    private(set) var repairStatus: AIChatRepairAttemptStatus?
    private(set) var completedDictationTranscript: AIChatCompletedDictationTranscript?

    @ObservationIgnored private let flashcardsStore: FlashcardsStore
    @ObservationIgnored private let historyStore: any AIChatHistoryStoring
    @ObservationIgnored private let chatService: any AIChatStreaming
    @ObservationIgnored private let voiceRecorder: any AIChatVoiceRecording
    @ObservationIgnored private let audioTranscriber: any AIChatAudioTranscribing
    @ObservationIgnored private let runtime: AIChatSessionRuntime
    @ObservationIgnored private var chatSessionId: String
    @ObservationIgnored private var codeInterpreterContainerId: String?
    @ObservationIgnored private var activeSendTask: Task<Void, Never>?
    @ObservationIgnored private var activeDictationTask: Task<Void, Never>?
    @ObservationIgnored private var activeConversationId: String?

    convenience init(
        flashcardsStore: FlashcardsStore,
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatStreaming,
        contextLoader: any AIChatContextLoading
    ) {
        self.init(
            flashcardsStore: flashcardsStore,
            historyStore: historyStore,
            chatService: chatService,
            contextLoader: contextLoader,
            voiceRecorder: AIChatDisabledVoiceRecorder(),
            audioTranscriber: AIChatDisabledAudioTranscriber()
        )
    }

    init(
        flashcardsStore: FlashcardsStore,
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatStreaming,
        contextLoader: any AIChatContextLoading,
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
            contextLoader: contextLoader,
            streamFlushInterval: 0.1,
            historyCheckpointInterval: 2.0
        )

        let persistedState = historyStore.loadState()
        self.inputText = ""
        self.messages = persistedState.messages
        self.pendingAttachments = []
        self.selectedModelId = persistedState.selectedModelId
        self.chatSessionId = persistedState.chatSessionId
        self.codeInterpreterContainerId = persistedState.codeInterpreterContainerId
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
            && self.hasExternalProviderConsent
            && (self.trimmedInputText().isEmpty == false || self.pendingAttachments.isEmpty == false)
    }

    var hasExternalProviderConsent: Bool {
        hasAIChatExternalProviderConsent(userDefaults: self.flashcardsStore.userDefaults)
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
        guard self.hasExternalProviderConsent else {
            self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return
        }

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
        let clearedState = AIChatPersistedState(
            messages: [],
            selectedModelId: self.selectedModelId,
            chatSessionId: makeAIChatSessionId(),
            codeInterpreterContainerId: nil
        )
        self.chatSessionId = clearedState.chatSessionId
        self.codeInterpreterContainerId = clearedState.codeInterpreterContainerId
        Task {
            await self.historyStore.saveState(state: clearedState)
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
            guard self.hasExternalProviderConsent else {
                self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
                return
            }
            self.startDictation()
        case .recording:
            guard self.hasExternalProviderConsent else {
                self.cancelDictation()
                self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
                return
            }
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
        guard self.hasExternalProviderConsent else {
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
        guard self.hasExternalProviderConsent else {
            self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return
        }

        self.activeAlert = nil
        self.repairStatus = nil
        let conversationId = UUID().uuidString.lowercased()

        let task = Task {
            var diagnosticsSession: CloudLinkedSession?
            do {
                let session = try await self.flashcardsStore.authenticatedCloudSessionForAI()
                try await self.ensureAIChatReadyForSend(linkedSession: session)
                self.messages.append(
                    AIChatMessage(
                        id: UUID().uuidString.lowercased(),
                        role: .user,
                        content: content,
                        timestamp: nowIsoTimestamp(),
                        isError: false
                    )
                )
                self.messages.append(
                    AIChatMessage(
                        id: UUID().uuidString.lowercased(),
                        role: .assistant,
                        content: [.text(aiChatOptimisticAssistantStatusText)],
                        timestamp: nowIsoTimestamp(),
                        isError: false
                    )
                )
                self.inputText = ""
                self.pendingAttachments = []
                self.isStreaming = true
                self.activeConversationId = conversationId
                diagnosticsSession = session
                let initialState = self.currentPersistedState()
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
                let latestPersistedState = self.historyStore.loadState()
                self.chatSessionId = latestPersistedState.chatSessionId
                self.codeInterpreterContainerId = latestPersistedState.codeInterpreterContainerId
                do {
                    _ = try await self.flashcardsStore.runLinkedSync(linkedSession: session)
                } catch {
                    self.flashcardsStore.globalErrorMessage = Flashcards.errorMessage(error: error)
                }
            } catch is CancellationError {
            } catch {
                let latestPersistedState = self.historyStore.loadState()
                self.chatSessionId = latestPersistedState.chatSessionId
                self.codeInterpreterContainerId = latestPersistedState.codeInterpreterContainerId
                self.markAssistantError(message: Flashcards.errorMessage(error: error))
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

    private func ensureAIChatReadyForSend(linkedSession: CloudLinkedSession) async throws {
        guard let workspaceId = self.flashcardsStore.workspace?.workspaceId else {
            throw LocalStoreError.validation("Select a workspace before using AI chat.")
        }
        guard let database = self.flashcardsStore.database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        _ = try await self.flashcardsStore.runLinkedSync(linkedSession: linkedSession)
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: Int.max)
        if outboxEntries.isEmpty == false {
            throw LocalStoreError.validation("AI chat is blocked until all pending sync operations are uploaded.")
        }
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
                self.showGeneralError(message: Flashcards.errorMessage(error: error))
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
                guard self.hasExternalProviderConsent else {
                    self.dictationState = .idle
                    self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
                    return
                }
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
                self.showGeneralError(message: Flashcards.errorMessage(error: transcriptionError))
            } catch {
                self.showGeneralError(message: Flashcards.errorMessage(error: error))
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
            self.showGeneralError(message: Flashcards.errorMessage(error: error))
        }
    }

    private func handleFinishDictationError(_ error: AIChatVoiceRecorderError) {
        switch error {
        case .emptyRecording:
            return
        case .microphoneBlocked:
            self.showMicrophoneSettingsAlert()
        default:
            self.showGeneralError(message: Flashcards.errorMessage(error: error))
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
        return AIChatPersistedState(
            messages: self.messages,
            selectedModelId: self.selectedModelId,
            chatSessionId: self.chatSessionId,
            codeInterpreterContainerId: self.codeInterpreterContainerId
        )
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
                    timestamp: nowIsoTimestamp(),
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
