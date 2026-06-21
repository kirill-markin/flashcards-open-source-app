import Foundation

enum AIChatAcceptedEnvelopeReconciliation: Equatable, Sendable {
    case applyCanonicalEnvelope
    case preserveOptimisticMessages
    case reloadCanonicalConversation
}

extension AIChatStore {
    func acceptedEnvelopeReconciliation(
        for envelope: AIChatConversationEnvelope,
        conversationId: String
    ) -> AIChatAcceptedEnvelopeReconciliation {
        guard let optimisticTurn = self.currentOptimisticOutgoingTurn() else {
            return .applyCanonicalEnvelope
        }

        let acceptedEnvelopeContainsOutgoingTurn = self.acceptedEnvelopeContainsCurrentOutgoingTurn(
            envelope,
            conversationId: conversationId,
            optimisticTurn: optimisticTurn
        )

        if acceptedEnvelopeContainsOutgoingTurn {
            return .applyCanonicalEnvelope
        }

        if envelope.activeRun != nil {
            return .preserveOptimisticMessages
        }

        return .reloadCanonicalConversation
    }

    func applyAcceptedEnvelopeMetadata(_ envelope: AIChatConversationEnvelope) {
        self.chatSessionId = envelope.sessionId
        self.conversationScopeId = envelope.conversationScopeId
        self.requiresRemoteSessionProvisioning = false
        self.serverChatConfig = envelope.chatConfig
        self.applyComposerSuggestions(envelope.composerSuggestions)
        self.hasOlderMessages = envelope.conversation.hasOlder
        self.oldestCursor = envelope.conversation.oldestCursor
        self.repairStatus = nil

        guard let activeRun = envelope.activeRun else {
            self.finalizeAcceptedTerminalEnvelopeWhilePreservingOptimisticTurn()
            self.schedulePersistCurrentState()
            return
        }

        self.transitionToStreaming(
            activeRun: AIChatActiveRunSession(
                sessionId: envelope.sessionId,
                conversationScopeId: envelope.conversationScopeId,
                runId: activeRun.runId,
                liveStream: activeRun.live.stream,
                liveCursor: activeRun.live.cursor,
                streamEpoch: nil
            )
        )
        self.schedulePersistCurrentState()
    }

    func acceptedEnvelopeContainsCurrentOutgoingTurn(
        _ envelope: AIChatConversationEnvelope,
        conversationId: String,
        optimisticTurn: AIChatOptimisticOutgoingTurn
    ) -> Bool {
        if let preSendSnapshot = self.preSendSnapshot(conversationId: conversationId) {
            guard let baselineAnchorId = preSendSnapshot.persistedState.messages.last?.id else {
                return envelope.conversation.messages.contains { message in
                    message.role == .user && message.content == preSendSnapshot.outgoingContent
                }
            }
            guard
                let anchorIndex = envelope.conversation.messages.lastIndex(where: { message in
                    message.id == baselineAnchorId
                })
            else {
                return false
            }

            let messagesAfterAnchor = envelope.conversation.messages.suffix(
                envelope.conversation.messages.count - anchorIndex - 1
            )
            return messagesAfterAnchor.contains { message in
                message.role == .user && message.content == preSendSnapshot.outgoingContent
            }
        }

        return envelope.conversation.messages.contains { message in
            message.role == .user && message.content == optimisticTurn.userMessage.content
        }
    }

    func reconcileStaleAcceptedTerminalEnvelope(_ envelope: AIChatConversationEnvelope) {
        self.chatSessionId = envelope.sessionId
        self.conversationScopeId = envelope.conversationScopeId
        self.requiresRemoteSessionProvisioning = false
        self.serverChatConfig = envelope.chatConfig
        self.applyComposerSuggestions(envelope.composerSuggestions)
        self.hasOlderMessages = envelope.conversation.hasOlder
        self.oldestCursor = envelope.conversation.oldestCursor
        self.repairStatus = nil
        self.transitionToIdle()
        self.activeStreamingItemId = nil
        self.reloadCanonicalConversationAfterAcceptedTerminalEnvelope()
    }

    func finalizeAcceptedTerminalEnvelopeWhilePreservingOptimisticTurn() {
        self.transitionToIdle()
        self.activeStreamingItemId = nil

        guard
            let optimisticTurn = self.currentOptimisticOutgoingTurn(),
            self.messages.last?.id == optimisticTurn.assistantMessage.id
        else {
            self.activeStreamingMessageId = nil
            self.clearOptimisticOutgoingTurnState()
            return
        }

        self.messages.removeLast()
        self.activeStreamingMessageId = nil
        self.clearOptimisticOutgoingTurnState()
    }

    func restorePreSendState(_ preSendSnapshot: AIChatPreSendSnapshot) {
        let preSendState = preSendSnapshot.persistedState
        self.messages = preSendState.messages
        self.serverChatConfig = aiChatServerConfig(lastKnownFeatures: preSendState.lastKnownChatFeatures)
        self.applyComposerSuggestions(preSendState.composerSuggestions)
        self.requiresRemoteSessionProvisioning = preSendSnapshot.requiresRemoteSessionProvisioning
        self.runHadToolCalls = preSendState.pendingToolRunPostSync
        self.pendingToolRunPostSync = preSendState.pendingToolRunPostSync
        let resolvedSessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: preSendState.chatSessionId
        )
        self.chatSessionId = resolvedSessionId
        self.conversationScopeId = resolvedSessionId
        self.clearOptimisticOutgoingTurnState()
    }

    func applyEnvelope(_ envelope: AIChatConversationEnvelope) {
        self.messages = envelope.conversation.messages
        self.chatSessionId = envelope.sessionId
        self.conversationScopeId = envelope.conversationScopeId
        self.requiresRemoteSessionProvisioning = false
        self.serverChatConfig = envelope.chatConfig
        self.applyComposerSuggestions(envelope.composerSuggestions)
        self.hasOlderMessages = envelope.conversation.hasOlder
        self.oldestCursor = envelope.conversation.oldestCursor
        self.repairStatus = nil
        self.clearOptimisticOutgoingTurnState()

        if let activeRun = envelope.activeRun {
            self.transitionToStreaming(
                activeRun: AIChatActiveRunSession(
                    sessionId: envelope.sessionId,
                    conversationScopeId: envelope.conversationScopeId,
                    runId: activeRun.runId,
                    liveStream: activeRun.live.stream,
                    liveCursor: activeRun.live.cursor,
                    streamEpoch: nil
                )
            )
        } else {
            self.transitionToIdle()
        }

        if envelope.activeRun != nil,
           let lastAssistantMessage = envelope.conversation.messages.last(where: { $0.role == .assistant })
        {
            self.activeStreamingMessageId = lastAssistantMessage.id
            self.activeStreamingItemId = lastAssistantMessage.itemId
        } else {
            self.activeStreamingMessageId = nil
            self.activeStreamingItemId = nil
        }

        self.schedulePersistCurrentState()
    }
}
