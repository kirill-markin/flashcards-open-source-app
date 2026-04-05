import Foundation
import Observation

@MainActor
@Observable
final class AIChatStore {
    var conversationState: AIChatConversationState
    var composerState: AIChatComposerState
    var surfaceState: AIChatSurfaceState
    var runLifecycle: AIChatRunLifecycle
    var activeRunSession: AIChatActiveRunSession?

    var inputText: String {
        get { self.composerState.inputText }
        set {
            var updatedState = self.composerState
            updatedState.inputText = newValue
            self.composerState = updatedState
        }
    }

    var messages: [AIChatMessage] {
        get { self.conversationState.messages }
        set {
            var updatedState = self.conversationState
            updatedState.messages = newValue
            self.conversationState = updatedState
        }
    }

    var pendingAttachments: [AIChatAttachment] {
        get { self.composerState.pendingAttachments }
        set {
            var updatedState = self.composerState
            updatedState.pendingAttachments = newValue
            self.composerState = updatedState
        }
    }

    var composerSuggestions: [AIChatComposerSuggestion] {
        get { self.composerState.serverSuggestions }
        set {
            var updatedState = self.composerState
            updatedState.serverSuggestions = newValue
            self.composerState = updatedState
        }
    }

    var serverChatConfig: AIChatServerConfig
    var hasExternalProviderConsent: Bool

    var composerPhase: AIChatComposerPhase {
        self.runLifecycle.composerPhase
    }

    var dictationState: AIChatDictationState {
        get { self.composerState.dictationState }
        set {
            var updatedState = self.composerState
            updatedState.dictationState = newValue
            self.composerState = updatedState
        }
    }

    var activeAlert: AIChatAlert?
    var repairStatus: AIChatRepairAttemptStatus?

    var completedDictationTranscript: AIChatCompletedDictationTranscript? {
        get { self.composerState.completedDictationTranscript }
        set {
            var updatedState = self.composerState
            updatedState.completedDictationTranscript = newValue
            self.composerState = updatedState
        }
    }

    var bootstrapPhase: AIChatBootstrapPhase {
        get { self.surfaceState.bootstrapPhase }
        set {
            var updatedState = self.surfaceState
            updatedState.bootstrapPhase = newValue
            self.surfaceState = updatedState
        }
    }

    @ObservationIgnored let flashcardsStore: FlashcardsStore
    @ObservationIgnored let historyStore: any AIChatHistoryStoring
    @ObservationIgnored let chatService: any AIChatSessionServicing
    @ObservationIgnored let voiceRecorder: any AIChatVoiceRecording
    @ObservationIgnored let audioTranscriber: any AIChatAudioTranscribing
    @ObservationIgnored let runtime: AIChatSessionRuntime
    @ObservationIgnored var chatSessionId: String
    @ObservationIgnored var conversationScopeId: String
    @ObservationIgnored var activeSendTask: Task<Void, Never>?
    @ObservationIgnored var activeDictationTask: Task<Void, Never>?
    @ObservationIgnored var activeWarmUpTask: Task<Void, Never>?
    @ObservationIgnored var activeBootstrapTask: Task<Void, Never>?
    @ObservationIgnored var activeNewSessionTask: Task<Void, Never>?
    @ObservationIgnored var activePersistTask: Task<Void, Never>?
    @ObservationIgnored var pendingPersistState: AIChatPersistedState?
    @ObservationIgnored var activeConversationId: String?
    @ObservationIgnored var activeStreamingMessageId: String?
    @ObservationIgnored var activeStreamingItemId: String?
    @ObservationIgnored var nextResumeAttemptSequence: Int
    @ObservationIgnored var nextNewSessionRequestSequence: Int
    @ObservationIgnored var activeResumeErrorAttemptSequence: Int?
    @ObservationIgnored var activeLiveResumeAttemptSequence: Int?

    var hasOlderMessages: Bool {
        get { self.conversationState.hasOlderMessages }
        set {
            var updatedState = self.conversationState
            updatedState.hasOlderMessages = newValue
            self.conversationState = updatedState
        }
    }

    var oldestCursor: String? {
        get { self.conversationState.oldestCursor }
        set {
            var updatedState = self.conversationState
            updatedState.oldestCursor = newValue
            self.conversationState = updatedState
        }
    }

    var activeRunId: String? {
        self.activeRunSession?.runId
    }

    var activeLiveStream: AIChatLiveStreamEnvelope? {
        self.activeRunSession?.liveStream
    }

    var liveCursor: String? {
        self.activeRunSession?.liveCursor
    }

    var activeStreamEpoch: String? {
        self.activeRunSession?.streamEpoch
    }

    var shouldKeepLiveAttached: Bool {
        get { self.surfaceState.shouldKeepLiveAttached }
        set {
            var updatedState = self.surfaceState
            updatedState.shouldKeepLiveAttached = newValue
            self.surfaceState = updatedState
        }
    }

    func transitionToIdle() {
        self.runLifecycle = .idle
        self.activeRunSession = nil
    }

    func transitionToPreparingSend() {
        self.runLifecycle = .preparingSend
        self.activeRunSession = nil
    }

    func transitionToStartingRun() {
        self.runLifecycle = .starting
        self.activeRunSession = nil
    }

    func transitionToStreaming(activeRun: AIChatActiveRunSession) {
        self.activeRunSession = activeRun
        self.runLifecycle = .streaming(activeRun)
    }

    func transitionToStopping(runId: String?) {
        self.runLifecycle = .stopping(previousRunId: runId)
    }

    func updateActiveRunSession(
        _ transform: (AIChatActiveRunSession) -> AIChatActiveRunSession
    ) {
        guard let activeRunSession = self.activeRunSession else {
            return
        }

        let updatedSession = transform(activeRunSession)
        self.activeRunSession = updatedSession
        if case .streaming = self.runLifecycle {
            self.runLifecycle = .streaming(updatedSession)
        }
    }

    func setActiveRunCursor(cursor: String?) {
        self.updateActiveRunSession { activeRunSession in
            var updatedSession = activeRunSession
            updatedSession.liveCursor = cursor
            return updatedSession
        }
    }

    func setActiveRunStreamEpoch(streamEpoch: String?) {
        self.updateActiveRunSession { activeRunSession in
            var updatedSession = activeRunSession
            updatedSession.streamEpoch = streamEpoch
            return updatedSession
        }
    }

    func clearActiveRunSession() {
        self.activeRunSession = nil
    }

    func schedulePersistState(state: AIChatPersistedState) {
        self.pendingPersistState = state
        guard self.activePersistTask == nil else {
            return
        }

        self.activePersistTask = Task { [weak self] in
            while let self {
                await Task.yield()
                let nextState = await MainActor.run { () -> AIChatPersistedState? in
                    let pendingState = self.pendingPersistState
                    self.pendingPersistState = nil
                    return pendingState
                }
                guard let nextState else {
                    break
                }

                await self.historyStore.saveState(state: nextState)
            }

            await MainActor.run { [weak self] in
                self?.activePersistTask = nil
            }
        }
    }

    func schedulePersistCurrentState() {
        self.schedulePersistState(state: self.currentPersistedState())
    }

    func currentPersistedState() -> AIChatPersistedState {
        return AIChatPersistedState(
            messages: self.messages,
            chatSessionId: self.chatSessionId,
            lastKnownChatConfig: self.serverChatConfig
        )
    }

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
        let initialConsentState = hasAIChatExternalProviderConsent(userDefaults: flashcardsStore.userDefaults)
        self.conversationState = AIChatConversationState(
            messages: persistedState.messages,
            hasOlderMessages: false,
            oldestCursor: nil
        )
        self.composerState = AIChatComposerState(
            inputText: "",
            pendingAttachments: [],
            serverSuggestions: [],
            dictationState: .idle,
            completedDictationTranscript: nil
        )
        self.surfaceState = AIChatSurfaceState(
            activity: AIChatSurfaceActivity(
                isSceneActive: false,
                isAITabSelected: false,
                hasExternalProviderConsent: initialConsentState,
                workspaceId: flashcardsStore.workspace?.workspaceId,
                cloudState: flashcardsStore.cloudSettings?.cloudState,
                linkedUserId: flashcardsStore.cloudSettings?.linkedUserId,
                activeWorkspaceId: flashcardsStore.cloudSettings?.activeWorkspaceId
            ),
            activeAccessContext: nil,
            bootstrapPhase: .ready,
            shouldKeepLiveAttached: false
        )
        self.runLifecycle = .idle
        self.activeRunSession = nil
        self.serverChatConfig = persistedState.lastKnownChatConfig ?? aiChatDefaultServerConfig
        self.hasExternalProviderConsent = initialConsentState
        self.chatSessionId = persistedState.chatSessionId
        self.conversationScopeId = persistedState.chatSessionId
        self.activeAlert = nil
        self.repairStatus = nil
        self.activeDictationTask = nil
        self.activeWarmUpTask = nil
        self.activeBootstrapTask = nil
        self.activeNewSessionTask = nil
        self.activePersistTask = nil
        self.pendingPersistState = nil
        self.activeConversationId = nil
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
        self.nextResumeAttemptSequence = 0
        self.nextNewSessionRequestSequence = 0
        self.activeResumeErrorAttemptSequence = nil
        self.activeLiveResumeAttemptSequence = nil
        self.activateAccessContext(
            force: true,
            nextAccessContext: self.currentAccessContext()
        )
    }
}
