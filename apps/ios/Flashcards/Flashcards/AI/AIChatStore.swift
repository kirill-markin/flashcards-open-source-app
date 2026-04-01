import Foundation
import Observation

private let aiChatBootstrapPageLimit: Int = 20

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
    private(set) var messages: [AIChatMessage]
    private(set) var pendingAttachments: [AIChatAttachment]
    private(set) var serverChatConfig: AIChatServerConfig
    private(set) var composerPhase: AIChatComposerPhase
    private(set) var dictationState: AIChatDictationState
    private(set) var activeAlert: AIChatAlert?
    private(set) var repairStatus: AIChatRepairAttemptStatus?
    private(set) var completedDictationTranscript: AIChatCompletedDictationTranscript?
    private(set) var bootstrapPhase: AIChatBootstrapPhase

    @ObservationIgnored private let flashcardsStore: FlashcardsStore
    @ObservationIgnored private let historyStore: any AIChatHistoryStoring
    @ObservationIgnored private let chatService: any AIChatSessionServicing
    @ObservationIgnored private let voiceRecorder: any AIChatVoiceRecording
    @ObservationIgnored private let audioTranscriber: any AIChatAudioTranscribing
    @ObservationIgnored private let runtime: AIChatSessionRuntime
    @ObservationIgnored private var chatSessionId: String
    @ObservationIgnored private var activeSendTask: Task<Void, Never>?
    @ObservationIgnored private var activeDictationTask: Task<Void, Never>?
    @ObservationIgnored private var activeWarmUpTask: Task<Void, Never>?
    @ObservationIgnored private var activeBootstrapTask: Task<Void, Never>?
    @ObservationIgnored private var activeConversationId: String?
    @ObservationIgnored private var activeAccessContext: AIChatAccessContext?
    @ObservationIgnored private var hasOlderMessages: Bool
    @ObservationIgnored private var oldestCursor: String?
    @ObservationIgnored private var liveCursor: String?
    @ObservationIgnored private var activeLiveStream: AIChatLiveStreamEnvelope?
    @ObservationIgnored private var activeStreamingMessageId: String?
    @ObservationIgnored private var activeStreamingItemId: String?

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

    var hasExternalProviderConsent: Bool {
        hasAIChatExternalProviderConsent(userDefaults: self.flashcardsStore.userDefaults)
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
        self.activeAlert = .generalError(message: message)
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

    func retryLinkedBootstrap() {
        self.startLinkedBootstrap(forceReloadState: false)
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
        guard self.isComposerBusy == false else {
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
                await self.runtime.run(
                    session: session,
                    sessionId: self.chatSessionId,
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
                if self.composerPhase != .idle && self.composerPhase != .stopping {
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

    private func currentPersistedState() -> AIChatPersistedState {
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
            self.flashcardsStore.enqueueTransientBanner(banner: makeAIChatOfflineBanner())
            return
        }

        if
            didAcceptRun == false,
            let serviceError = error as? AIChatServiceError,
            case .invalidResponse(let errorDetails, _, _) = serviceError,
            errorDetails.code == "CHAT_ACTIVE_RUN_IN_PROGRESS"
        {
            self.flashcardsStore.enqueueTransientBanner(banner: makeAIChatActiveRunBanner())
            return
        }

        if didAcceptRun == false {
            self.showGeneralError(message: Flashcards.errorMessage(error: error))
            return
        }

        self.markAssistantError(message: Flashcards.errorMessage(error: error))
        let state = self.currentPersistedState()
        Task {
            await self.historyStore.saveState(state: state)
        }
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
            self.startLinkedBootstrap(forceReloadState: false)
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
    }

    private func startLinkedBootstrap(forceReloadState: Bool) {
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
                    limit: aiChatBootstrapPageLimit
                )
                guard self.activeAccessContext == bootstrapContext else {
                    return
                }
                self.applyBootstrap(bootstrap)
                self.bootstrapPhase = .ready
                self.attachBootstrapLiveIfNeeded(response: bootstrap, session: session)
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
                    limit: aiChatBootstrapPageLimit
                )
                guard self.currentPersistedState() == baselineState else {
                    return
                }
                self.applyBootstrap(bootstrap)
                self.attachBootstrapLiveIfNeeded(response: bootstrap, session: session)
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
            self.composerPhase = response.runState == "running" ? .running : .idle
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
            self.markAssistantError(message: message)
            if self.activeConversationId == conversationId {
                self.composerPhase = .idle
            }
        }
    }

    private func handleLiveEvent(_ event: AIChatLiveEvent) {
        logAIChatStoreEvent(
            action: "ai_live_event_handle_start",
            metadata: self.metadataForLiveEvent(event)
        )

        switch event {
        case .assistantDelta(let text, let cursor, let itemId):
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: true
            )
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: appendingAIChatText(content: message.content, text: text),
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.liveCursor = cursor
            logAIChatStoreEvent(
                action: "ai_live_event_handle_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_delta",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: ["textLength": String(text.count)]
                )
            )

        case .assistantToolCall(let toolCall, let cursor, let itemId):
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: true
            )
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: upsertingAIChatToolCall(content: message.content, toolCall: toolCall),
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.liveCursor = cursor
            logAIChatStoreEvent(
                action: "ai_live_event_handle_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_tool_call",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: [
                        "toolName": toolCall.name,
                        "toolStatus": toolCall.status.rawValue
                    ]
                )
            )

        case .assistantReasoningStarted(let reasoningId, let cursor, let itemId):
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: true
            )
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: upsertingAIChatReasoningSummary(
                    content: message.content,
                    reasoningSummary: AIChatReasoningSummary(
                        id: reasoningId,
                        summary: "",
                        status: .started
                    )
                ),
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.liveCursor = cursor
            logAIChatStoreEvent(
                action: "ai_live_event_handle_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_reasoning_started",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: ["reasoningId": reasoningId]
                )
            )

        case .assistantReasoningSummary(let reasoningId, let summary, let cursor, let itemId):
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: true
            )
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: upsertingAIChatReasoningSummary(
                    content: message.content,
                    reasoningSummary: AIChatReasoningSummary(
                        id: reasoningId,
                        summary: summary,
                        status: .started
                    )
                ),
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.liveCursor = cursor
            logAIChatStoreEvent(
                action: "ai_live_event_handle_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_reasoning_summary",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: [
                        "reasoningId": reasoningId,
                        "summaryLength": String(summary.count)
                    ]
                )
            )

        case .assistantReasoningDone(let reasoningId, let cursor, let itemId):
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: true
            )
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: completingAIChatReasoningSummary(content: message.content, reasoningId: reasoningId),
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.liveCursor = cursor
            logAIChatStoreEvent(
                action: "ai_live_event_handle_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_reasoning_done",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: ["reasoningId": reasoningId]
                )
            )

        case .assistantMessageDone(let cursor, let itemId, let isError, let isStopped):
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: false
            )
            guard messageIndex >= 0 else {
                logAIChatStoreEvent(
                    action: "ai_live_terminal_event_dropped",
                    metadata: self.metadataForAppliedStreamingEvent(
                        eventType: "assistant_message_done",
                        cursor: cursor,
                        itemId: itemId,
                        messageIndex: messageIndex,
                        extra: [
                            "isError": isError ? "true" : "false",
                            "isStopped": isStopped ? "true" : "false"
                        ]
                    )
                )
                return
            }
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: finalizingAIChatContent(content: message.content),
                timestamp: message.timestamp,
                isError: isError,
                isStopped: isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.liveCursor = cursor
            self.activeStreamingMessageId = nil
            self.activeStreamingItemId = nil
            self.composerPhase = .idle
            self.repairStatus = nil
            logAIChatStoreEvent(
                action: "ai_live_terminal_event_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_message_done",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: [
                        "isError": isError ? "true" : "false",
                        "isStopped": isStopped ? "true" : "false"
                    ]
                )
            )

        case .runState(let state):
            if state != "running" {
                logAIChatStoreEvent(
                    action: "ai_live_run_state_non_running",
                    metadata: [
                        "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
                        "runState": state,
                        "activeStreamingMessageId": self.activeStreamingMessageId ?? "-",
                        "activeStreamingItemId": self.activeStreamingItemId ?? "-",
                        "messagesCount": String(self.messages.count)
                    ]
                )
                if self.activeStreamingMessageId != nil {
                    self.markAssistantError(message: "AI live stream ended before message completion.")
                    self.activeStreamingMessageId = nil
                    self.activeStreamingItemId = nil
                }
                self.composerPhase = .idle
                self.repairStatus = nil
            }

        case .repairStatus(let status):
            self.repairStatus = status
            logAIChatStoreEvent(
                action: "ai_live_repair_status_applied",
                metadata: [
                    "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
                    "attempt": String(status.attempt),
                    "maxAttempts": String(status.maxAttempts),
                    "toolName": status.toolName ?? "-"
                ]
            )

        case .error(let message):
            self.markAssistantError(message: message)
            self.activeStreamingMessageId = nil
            self.activeStreamingItemId = nil
            self.composerPhase = .idle
            logAIChatStoreEvent(
                action: "ai_live_error_applied",
                metadata: [
                    "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
                    "message": message,
                    "messagesCount": String(self.messages.count)
                ]
            )

        case .stopAck:
            logAIChatStoreEvent(
                action: "ai_live_stop_ack_ignored",
                metadata: [
                    "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId
                ]
            )
            break

        case .resetRequired:
            logAIChatStoreEvent(
                action: "ai_live_reset_required",
                metadata: [
                    "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
                    "liveCursor": self.liveCursor ?? "-"
                ]
            )
            self.reloadConversationFromBootstrap()
        }
    }

    private func applyBootstrap(_ response: AIChatBootstrapResponse) {
        self.messages = response.messages
        self.chatSessionId = response.sessionId
        self.serverChatConfig = response.chatConfig
        self.hasOlderMessages = response.hasOlder
        self.oldestCursor = response.oldestCursor
        self.liveCursor = response.liveCursor
        self.activeLiveStream = response.liveStream
        self.composerPhase = response.runState == "running" ? .running : .idle

        if response.runState == "running",
           let lastAssistantMessage = response.messages.last(where: { $0.role == .assistant })
        {
            self.activeStreamingMessageId = lastAssistantMessage.id
            self.activeStreamingItemId = lastAssistantMessage.itemId
        } else {
            self.activeStreamingMessageId = nil
            self.activeStreamingItemId = nil
        }

        Task {
            await self.historyStore.saveState(state: self.currentPersistedState())
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

    private func attachBootstrapLiveIfNeeded(
        response: AIChatBootstrapResponse,
        session: CloudLinkedSession
    ) {
        guard response.runState == "running" else {
            Task {
                await self.runtime.detach()
            }
            return
        }

        guard let liveStream = response.liveStream else {
            self.markAssistantError(message: "AI live stream is unavailable for the active run.")
            self.composerPhase = .idle
            return
        }

        Task {
            await self.runtime.detach()
            await self.runtime.attachLive(
                liveStream: liveStream,
                sessionId: response.sessionId,
                afterCursor: response.liveCursor,
                configurationMode: session.configurationMode,
                eventHandler: { [weak self] event in
                    await self?.handleLiveEvent(event)
                }
            )
        }
    }

    private func reloadConversationFromBootstrap() {
        Task {
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let response = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
                    limit: aiChatBootstrapPageLimit
                )
                self.applyBootstrap(response)
                self.attachBootstrapLiveIfNeeded(response: response, session: session)
            } catch {
                self.markAssistantError(message: Flashcards.errorMessage(error: error))
                self.composerPhase = .idle
            }
        }
    }

    private func resolveStreamingAssistantMessageIndex(
        itemId: String,
        cursor: String,
        allowsPlaceholderAdoption: Bool
    ) -> Int {
        if let existingIndex = self.messages.firstIndex(where: { message in
            message.role == .assistant && message.itemId == itemId
        }) {
            self.activeStreamingMessageId = self.messages[existingIndex].id
            self.activeStreamingItemId = itemId
            return existingIndex
        }

        if let activeStreamingMessageId = self.activeStreamingMessageId,
           let existingIndex = self.messages.firstIndex(where: { message in
               message.id == activeStreamingMessageId && message.role == .assistant
           })
        {
            let message = self.messages[existingIndex]
            self.messages[existingIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.activeStreamingItemId = itemId
            return existingIndex
        }

        guard allowsPlaceholderAdoption else {
            return -1
        }

        if let existingIndex = self.messages.indices.reversed().first(where: { index in
            let message = self.messages[index]
            return message.role == .assistant && message.itemId == nil && message.isStopped == false
        }) {
            let message = self.messages[existingIndex]
            self.messages[existingIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.activeStreamingMessageId = message.id
            self.activeStreamingItemId = itemId
            return existingIndex
        }

        let message = AIChatMessage(
            id: UUID().uuidString.lowercased(),
            role: .assistant,
            content: [],
            timestamp: nowIsoTimestamp(),
            isError: false,
            isStopped: false,
            cursor: cursor,
            itemId: itemId
        )
        self.messages.append(message)
        self.activeStreamingMessageId = message.id
        self.activeStreamingItemId = itemId
        return self.messages.count - 1
    }

    private func markAssistantError(message: String) {
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

    private func metadataForLiveEvent(_ event: AIChatLiveEvent) -> [String: String] {
        var metadata: [String: String] = [
            "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
            "liveCursor": self.liveCursor ?? "-",
            "activeStreamingMessageId": self.activeStreamingMessageId ?? "-",
            "activeStreamingItemId": self.activeStreamingItemId ?? "-",
            "messagesCount": String(self.messages.count)
        ]

        switch event {
        case .runState(let state):
            metadata["eventType"] = "run_state"
            metadata["runState"] = state
        case .assistantDelta(let text, let cursor, let itemId):
            metadata["eventType"] = "assistant_delta"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["textLength"] = String(text.count)
        case .assistantToolCall(let toolCall, let cursor, let itemId):
            metadata["eventType"] = "assistant_tool_call"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["toolName"] = toolCall.name
            metadata["toolStatus"] = toolCall.status.rawValue
        case .assistantReasoningStarted(let reasoningId, let cursor, let itemId):
            metadata["eventType"] = "assistant_reasoning_started"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["reasoningId"] = reasoningId
        case .assistantReasoningSummary(let reasoningId, let summary, let cursor, let itemId):
            metadata["eventType"] = "assistant_reasoning_summary"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["reasoningId"] = reasoningId
            metadata["summaryLength"] = String(summary.count)
        case .assistantReasoningDone(let reasoningId, let cursor, let itemId):
            metadata["eventType"] = "assistant_reasoning_done"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["reasoningId"] = reasoningId
        case .assistantMessageDone(let cursor, let itemId, let isError, let isStopped):
            metadata["eventType"] = "assistant_message_done"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["isError"] = isError ? "true" : "false"
            metadata["isStopped"] = isStopped ? "true" : "false"
        case .repairStatus(let status):
            metadata["eventType"] = "repair_status"
            metadata["attempt"] = String(status.attempt)
            metadata["maxAttempts"] = String(status.maxAttempts)
            metadata["toolName"] = status.toolName ?? "-"
        case .error(let message):
            metadata["eventType"] = "error"
            metadata["message"] = message
        case .stopAck(let sessionId):
            metadata["eventType"] = "stop_ack"
            metadata["ackSessionId"] = sessionId
        case .resetRequired:
            metadata["eventType"] = "reset_required"
        }

        return metadata
    }

    private func metadataForAppliedStreamingEvent(
        eventType: String,
        cursor: String,
        itemId: String,
        messageIndex: Int,
        extra: [String: String]
    ) -> [String: String] {
        var metadata: [String: String] = [
            "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
            "eventType": eventType,
            "cursor": cursor,
            "itemId": itemId,
            "messageIndex": String(messageIndex),
            "liveCursor": self.liveCursor ?? "-",
            "activeStreamingMessageId": self.activeStreamingMessageId ?? "-",
            "activeStreamingItemId": self.activeStreamingItemId ?? "-",
            "messagesCount": String(self.messages.count)
        ]

        for (key, value) in extra {
            metadata[key] = value
        }

        return metadata
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

private func isOptimisticAIChatStatusContent(content: [AIChatContentPart]) -> Bool {
    guard content.count == 1 else {
        return false
    }
    guard case .text(let text) = content[0] else {
        return false
    }

    return text == aiChatOptimisticAssistantStatusText
}

private func logAIChatStoreEvent(action: String, metadata: [String: String]) {
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

private func upsertingAIChatToolCall(
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

private func upsertingAIChatReasoningSummary(
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

private func completingAIChatReasoningSummary(
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

private func finalizingAIChatContent(
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
