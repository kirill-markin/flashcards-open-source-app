import Foundation

extension AIChatStore {
    func clearHistory() {
        guard self.isChatInteractive else {
            return
        }
        let requestedSessionId = self.chatSessionId.isEmpty ? nil : self.chatSessionId
        let shouldKeepLiveAttached = self.surfaceState.activity.isVisible
        self.shouldKeepLiveAttached = false
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
                    self.applyComposerSuggestions(response.composerSuggestions)
                    self.activeAlert = nil
                    self.repairStatus = nil
                    self.completedDictationTranscript = nil
                    self.activeConversationId = nil
                    self.chatSessionId = response.sessionId
                    self.conversationScopeId = response.sessionId
                    self.serverChatConfig = response.chatConfig
                    self.transitionToIdle()
                    self.shouldKeepLiveAttached = shouldKeepLiveAttached
                    self.activeStreamingMessageId = nil
                    self.activeStreamingItemId = nil
                }
                await MainActor.run {
                    self.schedulePersistState(
                        state: AIChatPersistedState(
                            messages: [],
                            chatSessionId: response.sessionId,
                            lastKnownChatConfig: response.chatConfig
                        )
                    )
                }
            } catch {
                await MainActor.run {
                    self.shouldKeepLiveAttached = shouldKeepLiveAttached
                    self.showGeneralError(error: error)
                }
            }
        }
    }

    func clearLocalHistory() {
        self.activeBootstrapTask?.cancel()
        self.activeBootstrapTask = nil
        self.activeWarmUpTask?.cancel()
        self.activeWarmUpTask = nil
        self.cancelStreaming()
        self.cancelDictation()
        self.inputText = ""
        self.messages = []
        self.pendingAttachments = []
        self.applyComposerSuggestions([])
        self.activeAlert = nil
        self.repairStatus = nil
        self.completedDictationTranscript = nil
        self.activeConversationId = nil
        self.conversationScopeId = ""
        self.hasOlderMessages = false
        self.oldestCursor = nil
        self.transitionToIdle()
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
        self.conversationScopeId = ""
        self.schedulePersistState(state: clearedState)
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
        self.conversationScopeId = ""
        self.applyComposerSuggestions([])
        self.activeResumeErrorAttemptSequence = nil
        self.activeLiveResumeAttemptSequence = nil
        self.transitionToIdle()
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
        self.pendingAttachments = []
        self.inputText = ""
        self.bootstrapPhase = .loading
    }

    func activateWorkspace() {
        self.activateAccessContext(
            force: true,
            nextAccessContext: self.currentAccessContext()
        )
    }

    func refreshAccessContextIfNeeded() {
        self.activateAccessContext(
            force: false,
            nextAccessContext: self.currentAccessContext()
        )
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

    func updateSurface(activity: AIChatSurfaceActivity) {
        let previousActivity = self.surfaceState.activity
        let didAccessContextChange = previousActivity.accessContext != activity.accessContext
        let didVisibilityChange = previousActivity.isVisible != activity.isVisible
        let didBecomeVisible = previousActivity.isVisible == false && activity.isVisible
        let didBecomeHidden = previousActivity.isVisible && activity.isVisible == false
        self.surfaceState.activity = activity
        self.hasExternalProviderConsent = activity.hasExternalProviderConsent

        if didBecomeHidden || aiChatSurfaceShouldCancelDictation(activity: activity) {
            self.cancelDictation()
        }

        if didAccessContextChange {
            self.activateAccessContext(
                force: true,
                nextAccessContext: activity.accessContext
            )
        }

        if didVisibilityChange {
            self.setChatVisibility(isVisible: activity.isVisible)
        }

        if aiChatSurfaceShouldWarmUp(
            activity: activity,
            bootstrapPhase: self.bootstrapPhase,
            composerPhase: self.composerPhase
        ) && (didBecomeVisible || didAccessContextChange) {
            self.warmUpSessionIfNeeded()
        }
    }

    func retryLinkedBootstrap() {
        self.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
    }

    func currentAccessContext() -> AIChatAccessContext {
        AIChatAccessContext(
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            cloudState: self.flashcardsStore.cloudSettings?.cloudState,
            linkedUserId: self.flashcardsStore.cloudSettings?.linkedUserId,
            activeWorkspaceId: self.flashcardsStore.cloudSettings?.activeWorkspaceId
        )
    }

    func historyWorkspaceId() -> String? {
        makeAIChatHistoryScopedWorkspaceId(
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            cloudSettings: self.flashcardsStore.cloudSettings
        )
    }

    func activateAccessContext(force: Bool, nextAccessContext: AIChatAccessContext) {
        if force == false, self.surfaceState.activeAccessContext == nextAccessContext {
            return
        }

        if self.shouldPreserveActiveGuestSendDuringAccessContextChange(nextAccessContext: nextAccessContext) {
            self.surfaceState.activeAccessContext = nextAccessContext
            self.historyStore.activateWorkspace(workspaceId: self.historyWorkspaceId())
            self.schedulePersistCurrentState()
            return
        }

        self.surfaceState.activeAccessContext = nextAccessContext
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

    func shouldPreserveActiveGuestSendDuringAccessContextChange(
        nextAccessContext: AIChatAccessContext
    ) -> Bool {
        guard self.activeSendTask != nil else {
            return false
        }
        guard let activeAccessContext = self.surfaceState.activeAccessContext else {
            return false
        }
        guard activeAccessContext.cloudState != .linked else {
            return false
        }
        return nextAccessContext.cloudState == .guest
    }

    func restorePersistedState(_ persistedState: AIChatPersistedState) {
        self.inputText = ""
        self.messages = persistedState.messages
        self.pendingAttachments = []
        self.serverChatConfig = persistedState.lastKnownChatConfig ?? aiChatDefaultServerConfig
        self.chatSessionId = persistedState.chatSessionId
        self.conversationScopeId = persistedState.chatSessionId
        self.transitionToIdle()
        self.dictationState = .idle
        self.activeAlert = nil
        self.repairStatus = nil
        self.completedDictationTranscript = nil
        self.activeConversationId = nil
        self.hasOlderMessages = false
        self.oldestCursor = nil
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
        self.activeResumeErrorAttemptSequence = nil
        self.activeLiveResumeAttemptSequence = nil
    }

    func startPassiveSnapshotRefreshIfPossible(baselineState: AIChatPersistedState) {
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
                self.attachBootstrapLiveIfNeeded(
                    response: bootstrap,
                    session: session,
                    resumeAttemptDiagnostics: nil
                )
            } catch {
            }
        }
    }
}

private func aiChatSurfaceShouldCancelDictation(activity: AIChatSurfaceActivity) -> Bool {
    activity.isSceneActive == false || activity.isAITabSelected == false
}

private func aiChatSurfaceShouldWarmUp(
    activity: AIChatSurfaceActivity,
    bootstrapPhase: AIChatBootstrapPhase,
    composerPhase: AIChatComposerPhase
) -> Bool {
    guard activity.isVisible else {
        return false
    }
    guard activity.cloudState == .linked else {
        return false
    }
    guard bootstrapPhase == .ready else {
        return false
    }

    return composerPhase != .preparingSend && composerPhase != .startingRun
}
