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
                _ = try await self.chatService.stopRun(session: session, sessionId: sessionId)
                let snapshot = try await self.chatService.loadSnapshot(
                    session: session,
                    sessionId: sessionId
                )
                self.applySnapshot(snapshot)
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
                guard session.authorization.isGuest == false else {
                    self.bootstrapPhase = .ready
                    return
                }
                let snapshot = try await self.chatService.loadSnapshot(
                    session: session,
                    sessionId: nil
                )
                guard self.activeAccessContext == bootstrapContext else {
                    return
                }
                self.applySnapshot(snapshot)
                self.bootstrapPhase = .ready
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
                let currentSessionId = baselineState.chatSessionId.isEmpty ? nil : baselineState.chatSessionId
                do {
                    let snapshot = try await self.chatService.loadSnapshot(
                        session: session,
                        sessionId: currentSessionId
                    )
                    self.applyRefreshedSnapshot(snapshot, baselineState: baselineState)
                } catch {
                    guard currentSessionId != nil else {
                        throw error
                    }

                    let repairedSnapshot = try await self.chatService.loadSnapshot(
                        session: session,
                        sessionId: nil
                    )
                    self.applyRefreshedSnapshot(repairedSnapshot, baselineState: baselineState)
                }
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
            self.inputText = ""
            self.pendingAttachments = []
            self.composerPhase = .running
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
        switch event {
        case .assistantDelta(let text, _, _):
            guard let lastIndex = self.messages.indices.last,
                  self.messages[lastIndex].role == .assistant else {
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

        case .assistantToolCall(let toolCall, _, _):
            guard let lastIndex = self.messages.indices.last,
                  self.messages[lastIndex].role == .assistant else {
                return
            }
            let lastMessage = self.messages[lastIndex]
            var updatedContent = removingOptimisticAIChatStatus(content: lastMessage.content)
            if let existingIndex = updatedContent.firstIndex(where: {
                if case .toolCall(let existing) = $0 { return existing.id == toolCall.id }
                return false
            }) {
                updatedContent[existingIndex] = .toolCall(toolCall)
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

        case .assistantMessageDone(_, _, let isError, _):
            if isError, let lastIndex = self.messages.indices.last,
               self.messages[lastIndex].role == .assistant
            {
                let lastMessage = self.messages[lastIndex]
                self.messages[lastIndex] = AIChatMessage(
                    id: lastMessage.id,
                    role: lastMessage.role,
                    content: lastMessage.content,
                    timestamp: lastMessage.timestamp,
                    isError: true
                )
            }

        case .runState(let state):
            if state != "running" {
                self.composerPhase = .idle
                self.repairStatus = nil
            }

        case .repairStatus(let status):
            self.repairStatus = status

        case .error(let message):
            self.markAssistantError(message: message)
            self.composerPhase = .idle

        case .stopAck:
            break

        case .resetRequired:
            Task {
                do {
                    let session = try await self.flashcardsStore.cloudSessionForAI()
                    let snapshot = try await self.chatService.loadSnapshot(
                        session: session,
                        sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId
                    )
                    self.applySnapshot(snapshot)
                } catch {
                }
            }
        }
    }

    private func applySnapshot(_ snapshot: AIChatSessionSnapshot) {
        self.messages = snapshot.messages
        self.chatSessionId = snapshot.sessionId
        self.serverChatConfig = snapshot.chatConfig
        self.composerPhase = snapshot.runState == "running" ? .running : .idle
        Task {
            await self.historyStore.saveState(state: self.currentPersistedState())
        }
    }

    private func applyRefreshedSnapshot(
        _ snapshot: AIChatSessionSnapshot,
        baselineState: AIChatPersistedState
    ) {
        guard self.currentPersistedState() == baselineState else {
            return
        }

        self.applySnapshot(snapshot)
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

    private func appendAssistantAccountUpgradePrompt(message: String, buttonTitle: String) {
        if let lastIndex = self.messages.indices.last, self.messages[lastIndex].role == .assistant {
            let lastMessage = self.messages[lastIndex]
            self.messages[lastIndex] = AIChatMessage(
                id: lastMessage.id,
                role: lastMessage.role,
                content: [.accountUpgradePrompt(message: message, buttonTitle: buttonTitle)],
                timestamp: lastMessage.timestamp,
                isError: false
            )
            return
        }

        self.messages.append(
            AIChatMessage(
                id: UUID().uuidString.lowercased(),
                role: .assistant,
                content: [.accountUpgradePrompt(message: message, buttonTitle: buttonTitle)],
                timestamp: nowIsoTimestamp(),
                isError: false
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
                isError: false
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
