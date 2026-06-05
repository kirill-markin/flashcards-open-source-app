import Foundation

struct AIChatToolRunPostSyncOrigin: Equatable, Sendable {
    let workspaceId: String?
    let sessionId: String
}

extension AIChatStore {
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
            lastKnownChatFeatures: persistedState.lastKnownChatFeatures,
            pendingToolRunPostSync: false,
            requiresRemoteSessionProvisioning: persistedState.requiresRemoteSessionProvisioning,
            suppressDraftRestore: persistedState.suppressDraftRestore
        )
        await self.historyStore.saveState(workspaceId: origin.workspaceId, state: clearedState)
    }

    /// The accepted run response only confirms that the backend started or
    /// completed the run. Tool-backed changes are synced only after the run is
    /// terminal so the local review state refreshes once from the final data.
    func syncLinkedDataAfterTerminalRunIfNeeded() {
        guard self.hasPendingToolRunPostSync() else {
            return
        }
        guard self.activeToolRunPostSyncTask == nil else {
            return
        }

        let origin = self.currentToolRunPostSyncOrigin()
        let linkedSession: CloudLinkedSession
        do {
            linkedSession = try self.flashcardsStore.currentActiveCloudSessionForAI()
        } catch {
            self.flashcardsStore.globalErrorMessage = Flashcards.errorMessage(error: error)
            return
        }
        let postSyncTask = Task { @MainActor in
            defer {
                self.activeToolRunPostSyncTask = nil
            }

            do {
                guard self.hasPendingToolRunPostSync(origin: origin) else {
                    return
                }

                _ = try await self.flashcardsStore.runLinkedSyncPreservingSessionContext(
                    linkedSession: linkedSession
                )
                await self.completeToolRunPostSyncAfterSuccess(origin: origin)
            } catch {
                if self.isCurrentToolRunPostSyncOrigin(origin) && self.pendingToolRunPostSync {
                    self.schedulePersistCurrentState()
                    await self.waitForPendingStatePersistence()
                }
                self.flashcardsStore.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }

        self.activeToolRunPostSyncTask = postSyncTask
    }
}
