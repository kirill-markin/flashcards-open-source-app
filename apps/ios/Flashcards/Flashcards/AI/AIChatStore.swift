import Foundation
import Observation

fileprivate struct AIChatStatePersistKey: Hashable, Sendable {
    let workspaceId: String?
}

fileprivate struct AIChatQueuedPersistedState: Sendable {
    let version: Int
    let state: AIChatPersistedState
}

fileprivate final class AIChatStatePersistCoordinator: @unchecked Sendable {
    private let lock: NSLock
    private var latestVersions: [AIChatStatePersistKey: Int]

    init() {
        self.lock = NSLock()
        self.latestVersions = [:]
    }

    func reserveNextVersion(for key: AIChatStatePersistKey) -> Int {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }

        let nextVersion = (self.latestVersions[key] ?? 0) + 1
        self.latestVersions[key] = nextVersion
        return nextVersion
    }

    func saveImmediately(for key: AIChatStatePersistKey, operation: () -> Void) {
        self.lock.lock()
        let nextVersion = (self.latestVersions[key] ?? 0) + 1
        self.latestVersions[key] = nextVersion
        operation()
        self.lock.unlock()
    }

    func saveIfCurrent(
        for key: AIChatStatePersistKey,
        version: Int,
        operation: () -> Void
    ) -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }

        guard self.latestVersions[key] == version else {
            return false
        }

        operation()
        return true
    }
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
    @ObservationIgnored fileprivate let statePersistCoordinator: AIChatStatePersistCoordinator
    @ObservationIgnored fileprivate var activeStatePersistKey: AIChatStatePersistKey?
    @ObservationIgnored fileprivate var pendingPersistStates: [AIChatStatePersistKey: AIChatQueuedPersistedState]
    @ObservationIgnored var activeDraftPersistTask: Task<Void, Never>?
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
    @ObservationIgnored var suppressDraftRestore: Bool
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

        await self.waitForPendingStatePersistence(workspaceId: origin.workspaceId)
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
            pendingToolRunPostSync: false,
            requiresRemoteSessionProvisioning: persistedState.requiresRemoteSessionProvisioning,
            suppressDraftRestore: persistedState.suppressDraftRestore
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

    func waitForPendingStatePersistence(workspaceId: String?) async {
        while true {
            let persistTask = self.activePersistTask
            let hasPendingState = self.hasPendingStatePersistence(workspaceId: workspaceId)

            if let persistTask {
                if hasPendingState == false {
                    return
                }

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
        self.activeStatePersistKey != nil || self.pendingPersistStates.isEmpty == false
    }

    func hasPendingStatePersistence(workspaceId: String?) -> Bool {
        let key = AIChatStatePersistKey(workspaceId: workspaceId)
        return self.activeStatePersistKey == key || self.pendingPersistStates[key] != nil
    }

    func startPersistTaskIfNeeded() {
        guard self.activePersistTask == nil else {
            return
        }
        guard self.pendingPersistStates.isEmpty == false else {
            return
        }

        self.activePersistTask = Task { [weak self] in
            while let self {
                await Task.yield()
                let nextPersistState = await MainActor.run { () -> (AIChatStatePersistKey, AIChatQueuedPersistedState)? in
                    guard let nextKey = self.pendingPersistStates.keys.first,
                          let nextState = self.pendingPersistStates.removeValue(forKey: nextKey)
                    else {
                        return nil
                    }

                    self.activeStatePersistKey = nextKey
                    return (nextKey, nextState)
                }
                guard let nextPersistState else {
                    break
                }

                let (nextKey, nextQueuedState) = nextPersistState
                _ = self.statePersistCoordinator.saveIfCurrent(
                    for: nextKey,
                    version: nextQueuedState.version,
                    operation: {
                        self.historyStore.saveStateSynchronously(
                            workspaceId: nextKey.workspaceId,
                            state: nextQueuedState.state
                        )
                    }
                )
                await MainActor.run { [weak self] in
                    if self?.activeStatePersistKey == nextKey {
                        self?.activeStatePersistKey = nil
                    }
                }
            }

            let shouldRestart = await MainActor.run { () -> Bool in
                guard let self else {
                    return false
                }

                self.activeStatePersistKey = nil
                self.activePersistTask = nil
                return self.pendingPersistStates.isEmpty == false
            }

            if shouldRestart {
                await MainActor.run { [weak self] in
                    self?.startPersistTaskIfNeeded()
                }
            }
        }
    }

    func schedulePersistState(
        workspaceId: String?,
        state: AIChatPersistedState
    ) {
        let key = AIChatStatePersistKey(workspaceId: workspaceId)
        let version = self.statePersistCoordinator.reserveNextVersion(for: key)
        self.pendingPersistStates[key] = AIChatQueuedPersistedState(version: version, state: state)
        self.startPersistTaskIfNeeded()
    }

    func schedulePersistState(state: AIChatPersistedState) {
        self.schedulePersistState(workspaceId: self.historyWorkspaceId(), state: state)
    }

    func persistStateSynchronously(state: AIChatPersistedState) {
        let workspaceId = self.historyWorkspaceId()
        let key = AIChatStatePersistKey(workspaceId: workspaceId)
        self.pendingPersistStates.removeValue(forKey: key)
        self.statePersistCoordinator.saveImmediately(
            for: key,
            operation: {
                self.historyStore.saveStateSynchronously(
                    workspaceId: workspaceId,
                    state: state
                )
            }
        )
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
    }

    func persistDraftStateSynchronously(
        workspaceId: String?,
        sessionId: String?,
        draft: AIChatComposerDraft
    ) {
        self.historyStore.saveDraftSynchronously(
            workspaceId: workspaceId,
            sessionId: sessionId,
            draft: draft
        )
    }

    func isDraftRestoreSuppressed(
        workspaceId: String?,
        sessionId: String?,
        persistedState: AIChatPersistedState
    ) -> Bool {
        self.historyStore.loadDraftRestoreSuppression(
            workspaceId: workspaceId,
            sessionId: sessionId
        ) || persistedState.suppressDraftRestore
    }

    func persistDraftRestoreSuppressionSynchronously(
        workspaceId: String?,
        sessionId: String?,
        isSuppressed: Bool
    ) {
        self.historyStore.saveDraftRestoreSuppressionSynchronously(
            workspaceId: workspaceId,
            sessionId: sessionId,
            isSuppressed: isSuppressed
        )
    }

    func persistDraftStateImmediately(
        workspaceId: String?,
        sessionId: String?,
        draft: AIChatComposerDraft
    ) {
        self.persistDraftStateSynchronously(
            workspaceId: workspaceId,
            sessionId: sessionId,
            draft: draft
        )
    }

    func schedulePersistDraftState(
        workspaceId: String?,
        sessionId: String?,
        draft: AIChatComposerDraft
    ) {
        self.persistDraftStateSynchronously(
            workspaceId: workspaceId,
            sessionId: sessionId,
            draft: draft
        )
    }

    func currentPersistedState() -> AIChatPersistedState {
        return AIChatPersistedState(
            messages: self.messages,
            chatSessionId: self.chatSessionId,
            lastKnownChatConfig: self.serverChatConfig,
            pendingToolRunPostSync: self.pendingToolRunPostSync,
            requiresRemoteSessionProvisioning: self.requiresRemoteSessionProvisioning,
            suppressDraftRestore: self.suppressDraftRestore
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
        let persistedDraft = historyStore.loadDraft(
            workspaceId: initialHistoryWorkspaceId,
            sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId
        )
        let shouldSuppressInitialDraftRestore = historyStore.loadDraftRestoreSuppression(
            workspaceId: initialHistoryWorkspaceId,
            sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId
        ) || persistedState.suppressDraftRestore
        let initialDraft = shouldSuppressInitialDraftRestore
            ? AIChatComposerDraft(inputText: "", pendingAttachments: [])
            : persistedDraft
        if shouldSuppressInitialDraftRestore {
            historyStore.saveDraftSynchronously(
                workspaceId: initialHistoryWorkspaceId,
                sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
                draft: initialDraft
            )
            historyStore.saveDraftRestoreSuppressionSynchronously(
                workspaceId: initialHistoryWorkspaceId,
                sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
                isSuppressed: false
            )
        }
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
        self.statePersistCoordinator = AIChatStatePersistCoordinator()
        self.activeStatePersistKey = nil
        self.pendingPersistStates = [:]
        self.activeDraftPersistTask = nil
        self.activeConversationId = nil
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
        self.runHadToolCalls = persistedState.pendingToolRunPostSync
        self.pendingToolRunPostSync = persistedState.pendingToolRunPostSync
        self.suppressDraftRestore = shouldSuppressInitialDraftRestore
        self.activeToolRunPostSyncTask = nil
        self.nextResumeAttemptSequence = 0
        self.nextNewSessionRequestSequence = 0
        self.activeResumeErrorAttemptSequence = nil
        self.activeLiveResumeAttemptSequence = nil
        self.requiresRemoteSessionProvisioning = persistedState.requiresRemoteSessionProvisioning
        self.optimisticOutgoingTurnState = restoredAIChatOptimisticOutgoingTurnState(
            messages: persistedState.messages
        )
        self.activateAccessContext(
            force: true,
            nextAccessContext: self.currentAccessContext()
        )
    }
}
