import Foundation

extension AIChatStore {
    func handleRuntimeEvent(_ event: AIChatRuntimeEvent, conversationId: String) async {
        guard self.activeConversationId == conversationId else {
            return
        }

        switch event {
        case .accepted(let response):
            self.suppressDraftRestore = false
            self.persistDraftRestoreSuppressionSynchronously(
                workspaceId: self.historyWorkspaceId(),
                sessionId: response.envelope.sessionId.isEmpty ? nil : response.envelope.sessionId,
                isSuppressed: false
            )
            let reconciliation = self.acceptedEnvelopeReconciliation(
                for: response.envelope,
                conversationId: conversationId
            )

            if reconciliation == .preserveOptimisticMessages {
                self.applyAcceptedEnvelopeMetadata(response.envelope)
                self.markRunHadToolCallsFromSnapshot(
                    activeRun: response.activeRun,
                    messages: response.envelope.conversation.messages
                )
            } else if reconciliation == .reloadCanonicalConversation {
                self.reconcileStaleAcceptedTerminalEnvelope(response.envelope)
            } else {
                self.applyEnvelope(response.envelope)
                self.markRunHadToolCallsFromSnapshot(
                    activeRun: response.activeRun,
                    messages: response.envelope.conversation.messages
                )
            }
            self.applyComposerDraft(inputText: "", pendingAttachments: [])
            self.schedulePersistCurrentDraftState()
            self.persistStateSynchronously(state: self.currentPersistedState())
            self.repairStatus = nil
            if response.activeRun != nil {
                self.attachActiveLiveStreamIfPossible()
            } else if reconciliation == .reloadCanonicalConversation {
                self.clearPreSendSnapshot(conversationId: conversationId)
            } else {
                self.transitionToIdle()
                self.syncLinkedDataAfterTerminalRunIfNeeded()
                self.clearPreSendSnapshot(conversationId: conversationId)
            }
        case .liveEvent(let liveEvent):
            self.handleLiveEvent(liveEvent)
        case .appendAssistantAccountUpgradePrompt(let message, let buttonTitle):
            self.appendAssistantAccountUpgradePrompt(message: message, buttonTitle: buttonTitle)
        case .finish:
            self.repairStatus = nil
            self.clearOptimisticOutgoingTurnState()
            if self.activeConversationId == conversationId {
                self.transitionToIdle()
            }
        case .fail(let message):
            self.repairStatus = nil
            self.clearOptimisticOutgoingTurnState()
            self.showGeneralError(message: message)
            if self.activeConversationId == conversationId {
                self.transitionToIdle()
            }
        }
    }
}
