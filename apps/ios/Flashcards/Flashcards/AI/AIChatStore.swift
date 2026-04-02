import Foundation
import Observation

let aiChatBootstrapPageLimit: Int = 20

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

private struct AIChatAccessContext: Equatable {
    let workspaceId: String?
    let cloudState: CloudAccountState?
    let linkedUserId: String?
    let activeWorkspaceId: String?
}

@MainActor
@Observable
final class AIChatStore {
    var inputText: String
    var messages: [AIChatMessage]
    private(set) var pendingAttachments: [AIChatAttachment]
    var serverChatConfig: AIChatServerConfig
    var hasExternalProviderConsent: Bool
    var composerPhase: AIChatComposerPhase
    private(set) var dictationState: AIChatDictationState
    private(set) var activeAlert: AIChatAlert?
    var repairStatus: AIChatRepairAttemptStatus?
    private(set) var completedDictationTranscript: AIChatCompletedDictationTranscript?
    private(set) var bootstrapPhase: AIChatBootstrapPhase

    @ObservationIgnored let flashcardsStore: FlashcardsStore
    @ObservationIgnored let historyStore: any AIChatHistoryStoring
    @ObservationIgnored let chatService: any AIChatSessionServicing
    @ObservationIgnored private let voiceRecorder: any AIChatVoiceRecording
    @ObservationIgnored private let audioTranscriber: any AIChatAudioTranscribing
    @ObservationIgnored let runtime: AIChatSessionRuntime
    @ObservationIgnored var chatSessionId: String
    @ObservationIgnored private var activeSendTask: Task<Void, Never>?
    @ObservationIgnored private var activeDictationTask: Task<Void, Never>?
    @ObservationIgnored private var activeWarmUpTask: Task<Void, Never>?
    @ObservationIgnored var activeBootstrapTask: Task<Void, Never>?
    @ObservationIgnored private var activeConversationId: String?
    @ObservationIgnored private var activeAccessContext: AIChatAccessContext?
    @ObservationIgnored var hasOlderMessages: Bool
    @ObservationIgnored var oldestCursor: String?
    @ObservationIgnored var liveCursor: String?
    @ObservationIgnored var activeLiveStream: AIChatLiveStreamEnvelope?
    @ObservationIgnored var activeStreamingMessageId: String?
    @ObservationIgnored var activeStreamingItemId: String?
    @ObservationIgnored var shouldKeepLiveAttached: Bool
    @ObservationIgnored var nextResumeAttemptSequence: Int
    @ObservationIgnored var activeResumeErrorAttemptSequence: Int?
    @ObservationIgnored var activeLiveResumeAttemptSequence: Int?

    convenience init(
        flashcardsStore: FlashcardsStore,
        historyStore: any AIChatHistoryStoring,
        chatService: any AIChatSessionServicing,
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
        chatService: any AIChatSessionServicing,
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
            chatService: chatService,
            contextLoader: contextLoader,
            urlSession: URLSession.shared
        )

        let initialHistoryWorkspaceId = makeAIChatHistoryScopedWorkspaceId(
            workspaceId: flashcardsStore.workspace?.workspaceId,
            cloudSettings: flashcardsStore.cloudSettings
        )
        historyStore.activateWorkspace(workspaceId: initialHistoryWorkspaceId)
        let persistedState = historyStore.loadState()
        self.inputText = ""
        self.messages = persistedState.messages
        self.pendingAttachments = []
        self.serverChatConfig = persistedState.lastKnownChatConfig ?? aiChatDefaultServerConfig
        self.hasExternalProviderConsent = hasAIChatExternalProviderConsent(userDefaults: flashcardsStore.userDefaults)
        self.chatSessionId = persistedState.chatSessionId
        self.composerPhase = .idle
        self.dictationState = .idle
        self.activeAlert = nil
        self.repairStatus = nil
        self.completedDictationTranscript = nil
        self.bootstrapPhase = .ready
        self.activeDictationTask = nil
        self.activeWarmUpTask = nil
        self.activeBootstrapTask = nil
        self.activeConversationId = nil
        self.activeAccessContext = nil
        self.hasOlderMessages = false
        self.oldestCursor = nil
        self.liveCursor = nil
        self.activeLiveStream = nil
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
        self.shouldKeepLiveAttached = false
        self.nextResumeAttemptSequence = 0
        self.activeResumeErrorAttemptSequence = nil
        self.activeLiveResumeAttemptSequence = nil
        self.activateAccessContext(force: true)
    }

    var canSendMessage: Bool {
        self.isChatInteractive
            && self.composerPhase == .idle
            && self.dictationState == .idle
            && self.hasExternalProviderConsent
            && (self.trimmedInputText().isEmpty == false || self.pendingAttachments.isEmpty == false)
    }

    var canStopResponse: Bool {
        self.isChatInteractive
            && (self.composerPhase == .startingRun || self.composerPhase == .running)
    }

    var isComposerBusy: Bool {
        self.bootstrapPhase == .loading || self.composerPhase != .idle
    }

    var isStreaming: Bool {
        self.composerPhase == .startingRun || self.composerPhase == .running || self.composerPhase == .stopping
    }

    var usesGuestAIRestrictions: Bool {
        self.flashcardsStore.cloudSettings?.cloudState != .linked
    }

    var isChatInteractive: Bool {
        self.bootstrapPhase == .ready
    }

    var bootstrapFailureMessage: String? {
        guard case .failed(let message) = self.bootstrapPhase else {
            return nil
        }

        return message
    }

    func appendAttachment(_ attachment: AIChatAttachment) {
        guard self.isChatInteractive else {
            return
        }
        guard self.serverChatConfig.features.attachmentsEnabled else {
            return
        }
        guard self.hasExternalProviderConsent else {
            self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return
        }

        self.pendingAttachments.append(attachment)
    }

    func removeAttachment(id: String) {
        guard self.isChatInteractive else {
            return
        }
        self.pendingAttachments.removeAll { attachment in
            attachment.id == id
        }
    }

    func showAlert(_ alert: AIChatAlert) {
        self.activeAlert = alert
    }

    func showGeneralError(message: String) {
        self.activeResumeErrorAttemptSequence = nil
        self.activeAlert = .generalError(message: message)
    }

    func showResumeGeneralError(message: String, resumeAttemptSequence: Int) {
        self.activeResumeErrorAttemptSequence = resumeAttemptSequence
        self.activeAlert = .generalError(message: message)
    }

    func nextResumeAttemptDiagnostics() -> AIChatResumeAttemptDiagnostics {
        self.nextResumeAttemptSequence += 1
        return AIChatResumeAttemptDiagnostics(sequence: self.nextResumeAttemptSequence)
    }

    func clearStaleResumeErrorIfNeeded(connectedResumeAttemptSequence: Int?) {
        guard let connectedResumeAttemptSequence else {
            return
        }
        guard let activeResumeErrorAttemptSequence = self.activeResumeErrorAttemptSequence else {
            return
        }
        guard activeResumeErrorAttemptSequence < connectedResumeAttemptSequence else {
            return
        }
        guard case .generalError(let message) = self.activeAlert,
              message == "AI live stream is unavailable for the active run."
        else {
            return
        }

        self.activeResumeErrorAttemptSequence = nil
        self.activeAlert = nil
    }

    func showMicrophoneSettingsAlert() {
        self.activeAlert = .microphoneSettings
    }

    func showAttachmentSettingsAlert(source: AIChatAttachmentSettingsSource) {
        self.activeAlert = .attachmentSettings(source: source)
    }

    func clearHistory() {
        guard self.isChatInteractive else {
            return
        }
        let requestedSessionId = self.chatSessionId.isEmpty ? nil : self.chatSessionId
        self.clearLocalHistory()

        Task {
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let response = try await self.chatService.createNewSession(
                    session: session,
                    sessionId: requestedSessionId
                )
                await MainActor.run {
                    self.inputText = ""
                    self.messages = []
                    self.pendingAttachments = []
                    self.activeAlert = nil
                    self.repairStatus = nil
                    self.completedDictationTranscript = nil
                    self.activeConversationId = nil
                    self.chatSessionId = response.sessionId
                    self.serverChatConfig = response.chatConfig
                }
                await self.historyStore.saveState(state: AIChatPersistedState(
                    messages: [],
                    chatSessionId: response.sessionId,
                    lastKnownChatConfig: response.chatConfig
                ))
            } catch {
                await MainActor.run {
                    self.showGeneralError(message: Flashcards.errorMessage(error: error))
                }
            }
        }
    }

    func clearLocalHistory() {
        self.cancelStreaming()
        self.cancelDictation()
        self.inputText = ""
        self.messages = []
        self.pendingAttachments = []
        self.activeAlert = nil
        self.repairStatus = nil
        self.completedDictationTranscript = nil
        self.activeConversationId = nil
        self.hasOlderMessages = false
        self.oldestCursor = nil
        self.liveCursor = nil
        self.activeLiveStream = nil
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
        self.activeResumeErrorAttemptSequence = nil
        self.activeLiveResumeAttemptSequence = nil
        let clearedState = AIChatPersistedState(
            messages: [],
            chatSessionId: "",
            lastKnownChatConfig: self.serverChatConfig
        )
        self.chatSessionId = clearedState.chatSessionId
        Task {
            await self.historyStore.saveState(state: clearedState)
        }
    }

    func prepareForWorkspaceChange() {
        self.activeBootstrapTask?.cancel()
        self.activeBootstrapTask = nil
        self.activeWarmUpTask?.cancel()
        self.activeWarmUpTask = nil
        self.cancelStreaming()
        self.cancelDictation()
        self.activeAlert = nil
        self.repairStatus = nil
        self.completedDictationTranscript = nil
        self.activeConversationId = nil
        self.activeResumeErrorAttemptSequence = nil
        self.activeLiveResumeAttemptSequence = nil
        self.pendingAttachments = []
        self.inputText = ""
        self.bootstrapPhase = .loading
    }

    func activateWorkspace() {
        self.activateAccessContext(force: true)
    }

    func refreshAccessContextIfNeeded() {
        self.activateAccessContext(force: false)
    }

    func acceptExternalProviderConsent() {
        grantAIChatExternalProviderConsent(userDefaults: self.flashcardsStore.userDefaults)
        self.hasExternalProviderConsent = true
    }

    func refreshExternalProviderConsentState() {
        self.hasExternalProviderConsent = hasAIChatExternalProviderConsent(
            userDefaults: self.flashcardsStore.userDefaults
        )
    }

    func retryLinkedBootstrap() {
        self.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
    }

    func cancelStreaming() {
        self.activeSendTask?.cancel()
        self.activeSendTask = nil
        Task {
            await self.runtime.detach()
        }
        self.composerPhase = .stopping
        self.repairStatus = nil
        self.clearOptimisticAssistantStatusIfNeeded()

        let sessionId = self.chatSessionId
        guard sessionId.isEmpty == false else {
            self.composerPhase = .idle
            let state = self.currentPersistedState()
            Task { await self.historyStore.saveState(state: state) }
            return
        }

        Task {
            defer {
                if self.composerPhase == .stopping {
                    self.composerPhase = .idle
                }
                Task { await self.historyStore.saveState(state: self.currentPersistedState()) }
            }
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let stopResponse = try await self.chatService.stopRun(session: session, sessionId: sessionId)
                if stopResponse.stopped, stopResponse.stillRunning == false {
                    self.finalizeStoppedAssistantMessageIfNeeded()
                    self.composerPhase = .idle
                    self.repairStatus = nil
                }
            } catch {
            }
        }
    }

    func toggleDictation() {
        guard self.isChatInteractive else {
            return
        }
        guard self.serverChatConfig.features.dictationEnabled || self.dictationState != .idle else {
            return
        }

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

    func shutdownForTests() {
        self.activeBootstrapTask?.cancel()
        self.activeBootstrapTask = nil
        self.activeWarmUpTask?.cancel()
        self.activeWarmUpTask = nil
        self.cancelStreaming()
        self.cancelDictation()
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
        guard self.isChatInteractive else {
            return
        }
        guard self.composerPhase != .preparingSend && self.composerPhase != .startingRun else {
            return
        }
        guard self.flashcardsStore.cloudSettings?.cloudState == .linked else {
            return
        }
        guard self.hasExternalProviderConsent else {
            return
        }

        guard self.activeWarmUpTask == nil else {
            return
        }

        self.activeWarmUpTask = Task {
            defer {
                self.activeWarmUpTask = nil
            }
            await self.flashcardsStore.warmUpAuthenticatedCloudSessionForAI()
            self.resumeVisibleSessionIfNeeded()
        }
    }

    func sendMessage() {
        guard self.isChatInteractive else {
            return
        }
        if self.isComposerBusy || self.dictationState != .idle {
            return
        }

        let content = self.makeOutgoingContent()
        if content.isEmpty {
            return
        }

        guard self.hasExternalProviderConsent else {
            self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return
        }

        self.activeAlert = nil
        self.repairStatus = nil
        self.composerPhase = .preparingSend
        let conversationId = UUID().uuidString.lowercased()
        let draftText = self.inputText
        let draftAttachments = self.pendingAttachments

        let task = Task {
            var didAppendOptimisticMessages = false
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                try await self.ensureAIChatReadyForSend(linkedSession: session)
                self.messages.append(
                    AIChatMessage(
                        id: UUID().uuidString.lowercased(),
                        role: .user,
                        content: content,
                        timestamp: nowIsoTimestamp(),
                        isError: false,
                        isStopped: false,
                        cursor: nil,
                        itemId: nil
                    )
                )
                let assistantMessage = AIChatMessage(
                    id: UUID().uuidString.lowercased(),
                    role: .assistant,
                    content: [.text(aiChatOptimisticAssistantStatusText)],
                    timestamp: nowIsoTimestamp(),
                    isError: false,
                    isStopped: false,
                    cursor: nil,
                    itemId: nil
                )
                self.messages.append(assistantMessage)
                self.activeStreamingMessageId = assistantMessage.id
                self.activeStreamingItemId = nil
                didAppendOptimisticMessages = true
                self.composerPhase = .startingRun
                self.activeConversationId = conversationId
                try await self.runtime.run(
                    session: session,
                    sessionId: self.chatSessionId,
                    afterCursor: self.liveCursor,
                    outgoingContent: content,
                    eventHandler: { [weak self] event in
                        await self?.handleRuntimeEvent(event, conversationId: conversationId)
                    }
                )
                if session.authorization.isGuest == false {
                    do {
                        _ = try await self.flashcardsStore.runLinkedSync(linkedSession: session)
                    } catch {
                        self.flashcardsStore.globalErrorMessage = Flashcards.errorMessage(error: error)
                    }
                }
            } catch is CancellationError {
            } catch {
                self.handleSendMessageError(
                    error,
                    didAcceptRun: self.composerPhase == .running,
                    didAppendOptimisticMessages: didAppendOptimisticMessages,
                    draftText: draftText,
                    draftAttachments: draftAttachments
                )
            }

            if self.activeConversationId == conversationId {
                if self.shouldResetComposerPhaseAfterSendTaskCompletion() {
                    self.composerPhase = .idle
                }
                self.activeConversationId = nil
            }
            self.activeSendTask = nil
        }

        self.activeSendTask = task
    }

    private func ensureAIChatReadyForSend(linkedSession: CloudLinkedSession) async throws {
        guard self.bootstrapPhase == .ready else {
            throw LocalStoreError.validation("AI chat is still loading.")
        }
        if linkedSession.authorization.isGuest == false && self.chatSessionId.isEmpty {
            throw LocalStoreError.validation("AI chat session is unavailable. Reload the AI tab and try again.")
        }
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

    private func shouldResetComposerPhaseAfterSendTaskCompletion() -> Bool {
        if self.composerPhase == .idle || self.composerPhase == .stopping {
            return false
        }

        if self.composerPhase == .running {
            return false
        }

        if self.activeStreamingMessageId != nil || self.activeStreamingItemId != nil {
            return false
        }

        return true
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
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let recordedAudio = try await self.voiceRecorder.stopRecording()
                defer {
                    try? FileManager.default.removeItem(at: recordedAudio.fileUrl)
                }

                let transcription = try await self.audioTranscriber.transcribe(
                    session: session,
                    sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
                    recordedAudio: recordedAudio
                )
                self.chatSessionId = transcription.sessionId
                await self.historyStore.saveState(state: self.currentPersistedState())
                self.completedDictationTranscript = AIChatCompletedDictationTranscript(
                    id: UUID().uuidString.lowercased(),
                    transcript: transcription.text
                )
            } catch is CancellationError {
            } catch let recorderError as AIChatVoiceRecorderError {
                self.handleFinishDictationError(recorderError)
            } catch let transcriptionError as AIChatTranscriptionError {
                switch transcriptionError {
                case .guestLimitReached:
                    await self.appendStandaloneAssistantAccountUpgradePromptAndPersist(
                        message: aiChatGuestQuotaReachedMessage,
                        buttonTitle: aiChatGuestQuotaButtonTitle
                    )
                default:
                    self.showGeneralError(message: Flashcards.errorMessage(error: transcriptionError))
                }
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

    func currentPersistedState() -> AIChatPersistedState {
        return AIChatPersistedState(
            messages: self.messages,
            chatSessionId: self.chatSessionId,
            lastKnownChatConfig: self.serverChatConfig
        )
    }

    private func handleSendMessageError(
        _ error: Error,
        didAcceptRun: Bool,
        didAppendOptimisticMessages: Bool,
        draftText: String,
        draftAttachments: [AIChatAttachment]
    ) {
        let latestPersistedState = self.historyStore.loadState()
        self.chatSessionId = latestPersistedState.chatSessionId
        self.repairStatus = nil
        self.composerPhase = .idle
        self.activeLiveStream = nil
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil

        if didAcceptRun == false && didAppendOptimisticMessages {
            self.messages = latestPersistedState.messages
            self.inputText = draftText
            self.pendingAttachments = draftAttachments
        }

        if didAcceptRun == false && isAIChatOfflineSendError(error: error) {
            self.showGeneralError(message: Flashcards.errorMessage(error: error))
            return
        }

        if
            didAcceptRun == false,
            let serviceError = error as? AIChatServiceError,
            case .invalidResponse(let errorDetails, _, _) = serviceError,
            errorDetails.code == "CHAT_ACTIVE_RUN_IN_PROGRESS"
        {
            self.showGeneralError(message: "A response is already in progress. Wait for it to finish or stop it before sending another message.")
            return
        }

        if didAcceptRun == false {
            self.showGeneralError(message: Flashcards.errorMessage(error: error))
            return
        }

        self.showGeneralError(message: Flashcards.errorMessage(error: error))
    }

    private func currentAccessContext() -> AIChatAccessContext {
        AIChatAccessContext(
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            cloudState: self.flashcardsStore.cloudSettings?.cloudState,
            linkedUserId: self.flashcardsStore.cloudSettings?.linkedUserId,
            activeWorkspaceId: self.flashcardsStore.cloudSettings?.activeWorkspaceId
        )
    }

    private func historyWorkspaceId() -> String? {
        makeAIChatHistoryScopedWorkspaceId(
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            cloudSettings: self.flashcardsStore.cloudSettings
        )
    }

    private func activateAccessContext(force: Bool) {
        let nextAccessContext = self.currentAccessContext()
        if force == false, self.activeAccessContext == nextAccessContext {
            return
        }

        if self.shouldPreserveActiveGuestSendDuringAccessContextChange(nextAccessContext: nextAccessContext) {
            self.activeAccessContext = nextAccessContext
            self.historyStore.activateWorkspace(workspaceId: self.historyWorkspaceId())
            let state = self.currentPersistedState()
            Task {
                await self.historyStore.saveState(state: state)
            }
            return
        }

        self.activeAccessContext = nextAccessContext
        self.activeBootstrapTask?.cancel()
        self.activeBootstrapTask = nil
        self.cancelStreaming()
        self.cancelDictation()
        self.historyStore.activateWorkspace(workspaceId: self.historyWorkspaceId())
        let persistedState = self.historyStore.loadState()
        self.restorePersistedState(persistedState)

        guard self.hasExternalProviderConsent else {
            self.bootstrapPhase = .ready
            return
        }

        if nextAccessContext.cloudState == .linked {
            self.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
            return
        }

        self.bootstrapPhase = .ready
        self.startPassiveSnapshotRefreshIfPossible(baselineState: persistedState)
    }

    private func shouldPreserveActiveGuestSendDuringAccessContextChange(
        nextAccessContext: AIChatAccessContext
    ) -> Bool {
        guard self.activeSendTask != nil else {
            return false
        }
        guard let activeAccessContext = self.activeAccessContext else {
            return false
        }
        guard activeAccessContext.cloudState != .linked else {
            return false
        }
        return nextAccessContext.cloudState == .guest
    }

    private func restorePersistedState(_ persistedState: AIChatPersistedState) {
        self.inputText = ""
        self.messages = persistedState.messages
        self.pendingAttachments = []
        self.serverChatConfig = persistedState.lastKnownChatConfig ?? aiChatDefaultServerConfig
        self.chatSessionId = persistedState.chatSessionId
        self.composerPhase = .idle
        self.dictationState = .idle
        self.activeAlert = nil
        self.repairStatus = nil
        self.completedDictationTranscript = nil
        self.activeConversationId = nil
        self.hasOlderMessages = false
        self.oldestCursor = nil
        self.liveCursor = nil
        self.activeLiveStream = nil
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
        self.activeResumeErrorAttemptSequence = nil
        self.activeLiveResumeAttemptSequence = nil
    }

    func startLinkedBootstrap(
        forceReloadState: Bool,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) {
        self.activeBootstrapTask?.cancel()
        self.activeBootstrapTask = nil
        if forceReloadState {
            self.historyStore.activateWorkspace(workspaceId: self.historyWorkspaceId())
            self.restorePersistedState(self.historyStore.loadState())
        }
        self.bootstrapPhase = .loading

        let bootstrapContext = self.currentAccessContext()
        self.activeBootstrapTask = Task {
            defer {
                self.activeBootstrapTask = nil
            }

            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let bootstrap = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
                    limit: aiChatBootstrapPageLimit,
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics
                )
                guard self.activeAccessContext == bootstrapContext else {
                    return
                }
                self.applyBootstrap(bootstrap)
                self.bootstrapPhase = .ready
                self.attachBootstrapLiveIfNeeded(
                    response: bootstrap,
                    session: session,
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics
                )
            } catch is CancellationError {
            } catch {
                guard self.activeAccessContext == bootstrapContext else {
                    return
                }
                self.messages = []
                self.chatSessionId = ""
                self.pendingAttachments = []
                self.inputText = ""
                self.composerPhase = .idle
                self.repairStatus = nil
                self.bootstrapPhase = .failed(Flashcards.errorMessage(error: error))
            }
        }
    }

    private func startPassiveSnapshotRefreshIfPossible(baselineState: AIChatPersistedState) {
        guard self.hasExternalProviderConsent else {
            return
        }

        Task {
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let bootstrap = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: baselineState.chatSessionId.isEmpty ? nil : baselineState.chatSessionId,
                    limit: aiChatBootstrapPageLimit,
                    resumeAttemptDiagnostics: nil
                )
                guard self.currentPersistedState() == baselineState else {
                    return
                }
                self.applyBootstrap(bootstrap)
                self.attachBootstrapLiveIfNeeded(response: bootstrap, session: session, resumeAttemptDiagnostics: nil)
            } catch {
            }
        }
    }

    private func handleRuntimeEvent(_ event: AIChatRuntimeEvent, conversationId: String) async {
        if let activeConversationId = self.activeConversationId, activeConversationId != conversationId {
            return
        }

        switch event {
        case .accepted(let response):
            self.chatSessionId = response.sessionId
            self.serverChatConfig = response.chatConfig
            self.activeLiveStream = response.liveStream
            self.inputText = ""
            self.pendingAttachments = []
            if response.runState == "running" {
                self.composerPhase = .running
                self.attachActiveLiveStreamIfPossible()
            } else {
                self.composerPhase = .startingRun
                self.reconcileAcceptedNonRunningResponse(sessionId: response.sessionId)
            }
        case .liveEvent(let liveEvent):
            self.handleLiveEvent(liveEvent)
        case .applySnapshot(let snapshot):
            self.applySnapshot(snapshot)
        case .appendAssistantAccountUpgradePrompt(let message, let buttonTitle):
            self.appendAssistantAccountUpgradePrompt(message: message, buttonTitle: buttonTitle)
        case .finish:
            self.repairStatus = nil
            if self.activeConversationId == conversationId {
                self.composerPhase = .idle
            }
        case .fail(let message):
            self.repairStatus = nil
            self.showGeneralError(message: message)
            if self.activeConversationId == conversationId {
                self.composerPhase = .idle
            }
        }
    }

    private func applySnapshot(_ snapshot: AIChatSessionSnapshot) {
        self.messages = snapshot.messages
        self.chatSessionId = snapshot.sessionId
        self.serverChatConfig = snapshot.chatConfig
        self.composerPhase = snapshot.runState == "running" ? .running : .idle
        self.hasOlderMessages = false
        self.oldestCursor = nil
        self.liveCursor = nil
        self.activeLiveStream = nil
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
        Task {
            await self.historyStore.saveState(state: self.currentPersistedState())
        }
    }

    func markAssistantError(message: String) {
        let targetIndex = self.activeStreamingMessageId.flatMap { messageId in
            self.messages.firstIndex(where: { $0.id == messageId && $0.role == .assistant })
        } ?? self.messages.indices.last(where: { self.messages[$0].role == .assistant })

        if let targetIndex {
            let lastMessage = self.messages[targetIndex]
            let separator = extractAIChatTextContent(parts: lastMessage.content).isEmpty ? "" : "\n\n"
            self.messages[targetIndex] = AIChatMessage(
                id: lastMessage.id,
                role: lastMessage.role,
                content: appendingAIChatText(content: lastMessage.content, text: separator + message),
                timestamp: lastMessage.timestamp,
                isError: true,
                isStopped: lastMessage.isStopped,
                cursor: lastMessage.cursor,
                itemId: lastMessage.itemId
            )
        } else {
            self.messages.append(
                AIChatMessage(
                    id: UUID().uuidString.lowercased(),
                    role: .assistant,
                    content: [.text(message)],
                    timestamp: nowIsoTimestamp(),
                    isError: true,
                    isStopped: false,
                    cursor: nil,
                    itemId: nil
                )
            )
        }

        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
    }

    private func appendAssistantAccountUpgradePrompt(message: String, buttonTitle: String) {
        if let lastIndex = self.messages.indices.last, self.messages[lastIndex].role == .assistant {
            let lastMessage = self.messages[lastIndex]
            self.messages[lastIndex] = AIChatMessage(
                id: lastMessage.id,
                role: lastMessage.role,
                content: [.accountUpgradePrompt(message: message, buttonTitle: buttonTitle)],
                timestamp: lastMessage.timestamp,
                isError: false,
                isStopped: lastMessage.isStopped,
                cursor: lastMessage.cursor,
                itemId: lastMessage.itemId
            )
            return
        }

        self.messages.append(
            AIChatMessage(
                id: UUID().uuidString.lowercased(),
                role: .assistant,
                content: [.accountUpgradePrompt(message: message, buttonTitle: buttonTitle)],
                timestamp: nowIsoTimestamp(),
                isError: false,
                isStopped: false,
                cursor: nil,
                itemId: nil
            )
        )
    }

    private func appendStandaloneAssistantAccountUpgradePromptAndPersist(
        message: String,
        buttonTitle: String
    ) async {
        self.messages.append(
            AIChatMessage(
                id: UUID().uuidString.lowercased(),
                role: .assistant,
                content: [.accountUpgradePrompt(message: message, buttonTitle: buttonTitle)],
                timestamp: nowIsoTimestamp(),
                isError: false,
                isStopped: false,
                cursor: nil,
                itemId: nil
            )
        )
        await self.historyStore.saveState(state: self.currentPersistedState())
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
            isError: lastMessage.isError,
            isStopped: lastMessage.isStopped,
            cursor: lastMessage.cursor,
            itemId: lastMessage.itemId
        )
    }

    private func finalizeStoppedAssistantMessageIfNeeded() {
        guard let activeStreamingMessageId = self.activeStreamingMessageId,
              let messageIndex = self.messages.firstIndex(where: { $0.id == activeStreamingMessageId }) else {
            return
        }

        let message = self.messages[messageIndex]
        self.messages[messageIndex] = AIChatMessage(
            id: message.id,
            role: message.role,
            content: removingOptimisticAIChatStatus(content: message.content),
            timestamp: message.timestamp,
            isError: message.isError,
            isStopped: true,
            cursor: message.cursor,
            itemId: message.itemId
        )
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
    }
}

func isOptimisticAIChatStatusContent(content: [AIChatContentPart]) -> Bool {
    guard content.count == 1 else {
        return false
    }
    guard case .text(let text) = content[0] else {
        return false
    }

    return text == aiChatOptimisticAssistantStatusText
}

func logAIChatStoreEvent(action: String, metadata: [String: String]) {
    logFlashcardsError(domain: "ios_ai_store", action: action, metadata: metadata)
}

private func isAIChatOfflineSendError(error: Error) -> Bool {
    if let urlError = error as? URLError {
        return urlError.code == .notConnectedToInternet
    }

    let nsError = error as NSError
    if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorNotConnectedToInternet {
        return true
    }

    guard let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? Error else {
        return false
    }

    return isAIChatOfflineSendError(error: underlyingError)
}

private func removingOptimisticAIChatStatus(content: [AIChatContentPart]) -> [AIChatContentPart] {
    return isOptimisticAIChatStatusContent(content: content) ? [] : content
}

func appendingAIChatText(content: [AIChatContentPart], text: String) -> [AIChatContentPart] {
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

func upsertingAIChatToolCall(
    content: [AIChatContentPart],
    toolCall: AIChatToolCall
) -> [AIChatContentPart] {
    var updatedContent = removingOptimisticAIChatStatus(content: content)
    if let existingIndex = updatedContent.firstIndex(where: { part in
        if case .toolCall(let existing) = part {
            return existing.id == toolCall.id
        }
        return false
    }) {
        updatedContent[existingIndex] = .toolCall(toolCall)
        return updatedContent
    }

    updatedContent.append(.toolCall(toolCall))
    return updatedContent
}

func upsertingAIChatReasoningSummary(
    content: [AIChatContentPart],
    reasoningSummary: AIChatReasoningSummary
) -> [AIChatContentPart] {
    var updatedContent = removingOptimisticAIChatStatus(content: content)
    if let existingIndex = updatedContent.firstIndex(where: { part in
        if case .reasoningSummary(let existing) = part {
            return existing.id == reasoningSummary.id
        }
        return false
    }) {
        if case .reasoningSummary(let existing) = updatedContent[existingIndex] {
            updatedContent[existingIndex] = .reasoningSummary(
                AIChatReasoningSummary(
                    id: existing.id,
                    summary: reasoningSummary.summary.isEmpty ? existing.summary : reasoningSummary.summary,
                    status: reasoningSummary.status
                )
            )
        }
        return updatedContent
    }

    updatedContent.insert(.reasoningSummary(reasoningSummary), at: 0)
    return updatedContent
}

func completingAIChatReasoningSummary(
    content: [AIChatContentPart],
    reasoningId: String
) -> [AIChatContentPart] {
    removingOptimisticAIChatStatus(content: content).compactMap { part in
        guard case .reasoningSummary(let reasoningSummary) = part else {
            return part
        }

        guard reasoningSummary.id == reasoningId else {
            return part
        }

        if reasoningSummary.summary.isEmpty {
            return nil
        }

        return .reasoningSummary(
            AIChatReasoningSummary(
                id: reasoningSummary.id,
                summary: reasoningSummary.summary,
                status: .completed
            )
        )
    }
}

func finalizingAIChatContent(
    content: [AIChatContentPart]
) -> [AIChatContentPart] {
    removingOptimisticAIChatStatus(content: content).compactMap { part in
        guard case .reasoningSummary(let reasoningSummary) = part else {
            return part
        }

        if reasoningSummary.summary.isEmpty {
            return nil
        }

        return .reasoningSummary(
            AIChatReasoningSummary(
                id: reasoningSummary.id,
                summary: reasoningSummary.summary,
                status: .completed
            )
        )
    }
}

private func reasoningSummaryText(
    reasoningSummary: AIChatReasoningSummary
) -> String {
    if reasoningSummary.summary.isEmpty {
        return "Thinking..."
    }

    return reasoningSummary.summary
}

private func extractAIChatTextContent(parts: [AIChatContentPart]) -> String {
    if isOptimisticAIChatStatusContent(content: parts) {
        return ""
    }

    return parts.reduce(into: "") { partialResult, part in
        switch part {
        case .text(let text):
            partialResult.append(text)
        case .reasoningSummary(let reasoningSummary):
            partialResult.append(reasoningSummaryText(reasoningSummary: reasoningSummary))
        default:
            break
        }
    }
}
