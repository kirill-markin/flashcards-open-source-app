import Foundation
import Observation

fileprivate struct AIChatDraftPersistKey: Hashable, Sendable {
    let workspaceId: String?
    let sessionId: String?
}

fileprivate struct AIChatStatePersistKey: Hashable, Sendable {
    let workspaceId: String?
}

struct AIChatToolRunPostSyncOrigin: Equatable, Sendable {
    let workspaceId: String?
    let sessionId: String
}

struct AIChatRemoteSessionProvisionRequest {
    let sessionId: String
    let task: Task<AIChatNewSessionResponse, Error>
}

struct AIChatOptimisticOutgoingTurnState {
    let userMessageId: String
    let assistantMessageId: String
}

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
            self.schedulePersistCurrentDraftState()
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
            self.schedulePersistCurrentDraftState()
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
    @ObservationIgnored var activeRemoteSessionProvisionRequest: AIChatRemoteSessionProvisionRequest?
    @ObservationIgnored var activePersistTask: Task<Void, Never>?
    @ObservationIgnored fileprivate var pendingPersistStates: [AIChatStatePersistKey: AIChatPersistedState]
    @ObservationIgnored var activeDraftPersistTask: Task<Void, Never>?
    @ObservationIgnored fileprivate var pendingDraftPersistStates: [AIChatDraftPersistKey: AIChatComposerDraft]
    @ObservationIgnored var activeConversationId: String?
    @ObservationIgnored var storedPreSendSnapshotConversationId: String?
    @ObservationIgnored var storedPreSendSnapshot: AIChatPreSendSnapshot?
    @ObservationIgnored var activeStreamingMessageId: String?
    @ObservationIgnored var activeStreamingItemId: String?
    @ObservationIgnored var runHadToolCalls: Bool
    @ObservationIgnored var pendingToolRunPostSync: Bool
    @ObservationIgnored var activeToolRunPostSyncTask: Task<Void, Never>?
    @ObservationIgnored var nextResumeAttemptSequence: Int
    @ObservationIgnored var nextNewSessionRequestSequence: Int
    @ObservationIgnored var activeResumeErrorAttemptSequence: Int?
    @ObservationIgnored var activeLiveResumeAttemptSequence: Int?
    @ObservationIgnored var requiresRemoteSessionProvisioning: Bool
    @ObservationIgnored var optimisticOutgoingTurnState: AIChatOptimisticOutgoingTurnState?

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
        self.surfaceState.activity.isVisible
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

    func resetRunToolCallTracking() {
        self.runHadToolCalls = false
        self.pendingToolRunPostSync = false
    }

    func markRunHadToolCalls() {
        self.runHadToolCalls = true
        let shouldPersistPendingFlag = self.pendingToolRunPostSync == false
        self.pendingToolRunPostSync = true
        if shouldPersistPendingFlag {
            self.schedulePersistCurrentState()
        }
    }

    func markRunHadToolCallsFromMessages(messages: [AIChatMessage]) {
        if aiChatCurrentRunHasAssistantToolCalls(messages: messages) {
            self.markRunHadToolCalls()
        }
    }

    func markRunHadToolCallsFromSnapshot(
        activeRun: AIChatActiveRun?,
        messages: [AIChatMessage]
    ) {
        if aiChatSnapshotRunHasToolCalls(activeRun: activeRun, messages: messages) {
            self.markRunHadToolCalls()
        }
    }

    func hasPendingToolRunPostSync() -> Bool {
        self.pendingToolRunPostSync
    }

    func hasPendingToolRunPostSync(origin: AIChatToolRunPostSyncOrigin) -> Bool {
        if self.isCurrentToolRunPostSyncOrigin(origin) {
            return self.pendingToolRunPostSync
        }

        let persistedState = self.historyStore.loadState(workspaceId: origin.workspaceId)
        return persistedState.chatSessionId == origin.sessionId && persistedState.pendingToolRunPostSync
    }

    func currentToolRunPostSyncOrigin() -> AIChatToolRunPostSyncOrigin {
        AIChatToolRunPostSyncOrigin(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId
        )
    }

    func isCurrentToolRunPostSyncOrigin(_ origin: AIChatToolRunPostSyncOrigin) -> Bool {
        self.historyWorkspaceId() == origin.workspaceId
            && self.chatSessionId == origin.sessionId
    }

    func completeToolRunPostSyncAfterSuccess() {
        self.runHadToolCalls = false
        self.pendingToolRunPostSync = false
    }

    func completeToolRunPostSyncAfterSuccess(origin: AIChatToolRunPostSyncOrigin) async {
        if self.isCurrentToolRunPostSyncOrigin(origin) {
            self.completeToolRunPostSyncAfterSuccess()
            self.schedulePersistCurrentState()
            await self.waitForPendingStatePersistence()
            return
        }

        if self.historyWorkspaceId() == origin.workspaceId {
            return
        }

        await self.waitForPendingStatePersistence()
        let persistedState = self.historyStore.loadState(workspaceId: origin.workspaceId)
        guard persistedState.chatSessionId == origin.sessionId else {
            return
        }
        guard persistedState.pendingToolRunPostSync else {
            return
        }

        let clearedState = AIChatPersistedState(
            messages: persistedState.messages,
            chatSessionId: persistedState.chatSessionId,
            lastKnownChatConfig: persistedState.lastKnownChatConfig,
            pendingToolRunPostSync: false
        )
        await self.historyStore.saveState(workspaceId: origin.workspaceId, state: clearedState)
    }

    func waitForPendingStatePersistence() async {
        while true {
            let persistTask = self.activePersistTask
            let hasPendingState = self.hasPendingStatePersistence()

            if let persistTask {
                await persistTask.value
                continue
            }

            if hasPendingState {
                await Task.yield()
                continue
            }

            return
        }
    }

    func hasPendingStatePersistence() -> Bool {
        self.pendingPersistStates.isEmpty == false
    }

    func schedulePersistState(
        workspaceId: String?,
        state: AIChatPersistedState
    ) {
        let key = AIChatStatePersistKey(workspaceId: workspaceId)
        self.pendingPersistStates[key] = state
        guard self.activePersistTask == nil else {
            return
        }

        self.activePersistTask = Task { [weak self] in
            while let self {
                await Task.yield()
                let nextPersistState = await MainActor.run { () -> (AIChatStatePersistKey, AIChatPersistedState)? in
                    guard let nextKey = self.pendingPersistStates.keys.first,
                          let nextState = self.pendingPersistStates.removeValue(forKey: nextKey)
                    else {
                        return nil
                    }

                    return (nextKey, nextState)
                }
                guard let nextPersistState else {
                    break
                }

                let (nextKey, nextState) = nextPersistState
                await self.historyStore.saveState(workspaceId: nextKey.workspaceId, state: nextState)
            }

            await MainActor.run { [weak self] in
                self?.activePersistTask = nil
            }
        }
    }

    func schedulePersistState(state: AIChatPersistedState) {
        self.schedulePersistState(workspaceId: self.historyWorkspaceId(), state: state)
    }

    func schedulePersistCurrentState() {
        self.schedulePersistState(state: self.currentPersistedState())
    }

    func schedulePersistCurrentDraftState() {
        self.schedulePersistDraftState(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
            draft: self.currentComposerDraft()
        )
    }

    func cancelPendingDraftPersistence() {
        self.activeDraftPersistTask?.cancel()
        self.activeDraftPersistTask = nil
        self.pendingDraftPersistStates.removeAll()
    }

    func schedulePersistDraftState(
        workspaceId: String?,
        sessionId: String?,
        draft: AIChatComposerDraft
    ) {
        let key = AIChatDraftPersistKey(workspaceId: workspaceId, sessionId: sessionId)
        self.pendingDraftPersistStates[key] = draft
        guard self.activeDraftPersistTask == nil else {
            return
        }

        self.activeDraftPersistTask = Task { [weak self] in
            while let self {
                await Task.yield()
                guard Task.isCancelled == false else {
                    break
                }
                let nextDraftState = await MainActor.run { () -> (AIChatDraftPersistKey, AIChatComposerDraft)? in
                    guard let nextKey = self.pendingDraftPersistStates.keys.first,
                          let nextDraft = self.pendingDraftPersistStates.removeValue(forKey: nextKey)
                    else {
                        return nil
                    }

                    return (nextKey, nextDraft)
                }
                guard let nextDraftState else {
                    break
                }

                let (nextKey, nextDraft) = nextDraftState
                guard Task.isCancelled == false else {
                    break
                }
                await self.historyStore.saveDraft(
                    workspaceId: nextKey.workspaceId,
                    sessionId: nextKey.sessionId,
                    draft: nextDraft
                )
            }

            await MainActor.run { [weak self] in
                self?.activeDraftPersistTask = nil
            }
        }
    }

    func currentPersistedState() -> AIChatPersistedState {
        return AIChatPersistedState(
            messages: self.messages,
            chatSessionId: self.chatSessionId,
            lastKnownChatConfig: self.serverChatConfig,
            pendingToolRunPostSync: self.pendingToolRunPostSync
        )
    }

    func currentComposerDraft() -> AIChatComposerDraft {
        AIChatComposerDraft(
            inputText: self.inputText,
            pendingAttachments: self.pendingAttachments
        )
    }

    func applyComposerDraft(
        inputText: String,
        pendingAttachments: [AIChatAttachment]
    ) {
        var updatedState = self.composerState
        updatedState.inputText = inputText
        updatedState.pendingAttachments = pendingAttachments
        self.composerState = updatedState
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
            bootstrapPhase: .ready
        )
        self.runLifecycle = .idle
        self.activeRunSession = nil
        self.serverChatConfig = persistedState.lastKnownChatConfig ?? aiChatDefaultServerConfig
        self.hasExternalProviderConsent = initialConsentState
        self.chatSessionId = aiChatResolvedSessionId(
            workspaceId: initialHistoryWorkspaceId,
            sessionId: persistedState.chatSessionId
        )
        self.conversationScopeId = self.chatSessionId
        let initialDraft = historyStore.loadDraft(
            workspaceId: initialHistoryWorkspaceId,
            sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId
        )
        self.composerState = AIChatComposerState(
            inputText: initialDraft.inputText,
            pendingAttachments: initialDraft.pendingAttachments,
            serverSuggestions: [],
            dictationState: .idle,
            completedDictationTranscript: nil
        )
        self.activeAlert = nil
        self.repairStatus = nil
        self.activeDictationTask = nil
        self.activeWarmUpTask = nil
        self.activeBootstrapTask = nil
        self.activeNewSessionTask = nil
        self.activeRemoteSessionProvisionRequest = nil
        self.activePersistTask = nil
        self.pendingPersistStates = [:]
        self.activeDraftPersistTask = nil
        self.pendingDraftPersistStates = [:]
        self.activeConversationId = nil
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
        self.runHadToolCalls = persistedState.pendingToolRunPostSync
        self.pendingToolRunPostSync = persistedState.pendingToolRunPostSync
        self.activeToolRunPostSyncTask = nil
        self.nextResumeAttemptSequence = 0
        self.nextNewSessionRequestSequence = 0
        self.activeResumeErrorAttemptSequence = nil
        self.activeLiveResumeAttemptSequence = nil
        self.requiresRemoteSessionProvisioning = false
        self.optimisticOutgoingTurnState = restoredAIChatOptimisticOutgoingTurnState(
            messages: persistedState.messages
        )
        self.activateAccessContext(
            force: true,
            nextAccessContext: self.currentAccessContext()
        )
    }
}
