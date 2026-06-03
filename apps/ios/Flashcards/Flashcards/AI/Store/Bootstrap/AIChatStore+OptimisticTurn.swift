import Foundation

struct AIChatPreSendSnapshot: Sendable {
    let persistedState: AIChatPersistedState
    let requiresRemoteSessionProvisioning: Bool
    let outgoingContent: [AIChatContentPart]
}

struct AIChatOptimisticOutgoingTurn {
    let userMessage: AIChatMessage
    let assistantMessage: AIChatMessage
}

extension AIChatStore {
    func appendOptimisticOutgoingTurn(content: [AIChatContentPart]) {
        let userMessage = AIChatMessage(
            id: UUID().uuidString.lowercased(),
            role: .user,
            content: content,
            timestamp: nowIsoTimestamp(),
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        self.messages.append(userMessage)
        let assistantMessage = AIChatMessage(
            id: UUID().uuidString.lowercased(),
            role: .assistant,
            content: [],
            timestamp: nowIsoTimestamp(),
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        self.messages.append(assistantMessage)
        self.setOptimisticOutgoingTurnState(
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessage.id
        )
        self.activeStreamingMessageId = assistantMessage.id
        self.activeStreamingItemId = nil
    }

    func currentOptimisticOutgoingTurn() -> AIChatOptimisticOutgoingTurn? {
        guard let optimisticOutgoingTurnState = self.optimisticOutgoingTurnState else {
            return nil
        }
        guard
            let assistantIndex = self.messages.lastIndex(where: { message in
                message.id == optimisticOutgoingTurnState.assistantMessageId
            }),
            assistantIndex > 0
        else {
            return nil
        }

        let assistantMessage = self.messages[assistantIndex]
        let userMessage = self.messages[assistantIndex - 1]
        guard assistantIndex == self.messages.count - 1 else {
            return nil
        }
        guard userMessage.id == optimisticOutgoingTurnState.userMessageId else {
            return nil
        }
        guard userMessage.role == .user else {
            return nil
        }
        guard assistantMessage.role == .assistant else {
            return nil
        }
        guard assistantMessage.isStopped == false else {
            return nil
        }
        guard assistantMessage.isError == false else {
            return nil
        }

        return AIChatOptimisticOutgoingTurn(
            userMessage: userMessage,
            assistantMessage: assistantMessage
        )
    }

    func storePreSendSnapshot(_ snapshot: AIChatPreSendSnapshot, conversationId: String) {
        self.storedPreSendSnapshotConversationId = conversationId
        self.storedPreSendSnapshot = snapshot
    }

    func preSendSnapshot(conversationId: String) -> AIChatPreSendSnapshot? {
        guard self.storedPreSendSnapshotConversationId == conversationId else {
            return nil
        }

        return self.storedPreSendSnapshot
    }

    func clearPreSendSnapshot(conversationId: String) {
        guard self.storedPreSendSnapshotConversationId == conversationId else {
            return
        }

        self.storedPreSendSnapshotConversationId = nil
        self.storedPreSendSnapshot = nil
    }

    func clearAllPreSendSnapshots() {
        self.storedPreSendSnapshotConversationId = nil
        self.storedPreSendSnapshot = nil
    }

    func setOptimisticOutgoingTurnState(
        userMessageId: String,
        assistantMessageId: String
    ) {
        self.optimisticOutgoingTurnState = AIChatOptimisticOutgoingTurnState(
            userMessageId: userMessageId,
            assistantMessageId: assistantMessageId
        )
    }

    func clearOptimisticOutgoingTurnState() {
        self.optimisticOutgoingTurnState = nil
    }

    func isOptimisticAssistantPlaceholder(messageId: String) -> Bool {
        self.optimisticOutgoingTurnState?.assistantMessageId == messageId
    }

    @discardableResult
    func consumeOptimisticAssistantPlaceholder(messageId: String) -> Bool {
        guard self.isOptimisticAssistantPlaceholder(messageId: messageId) else {
            return false
        }

        self.clearOptimisticOutgoingTurnState()
        return true
    }
}

func restoredAIChatOptimisticOutgoingTurnState(
    messages: [AIChatMessage]
) -> AIChatOptimisticOutgoingTurnState? {
    guard messages.count >= 2 else {
        return nil
    }

    let assistantMessage = messages[messages.count - 1]
    let userMessage = messages[messages.count - 2]
    guard userMessage.role == .user else {
        return nil
    }
    guard userMessage.cursor == nil else {
        return nil
    }
    guard userMessage.itemId == nil else {
        return nil
    }
    guard userMessage.isError == false else {
        return nil
    }
    guard userMessage.isStopped == false else {
        return nil
    }
    guard assistantMessage.role == .assistant else {
        return nil
    }
    guard isOptimisticAIChatStatusContent(content: assistantMessage.content) else {
        return nil
    }
    guard assistantMessage.isError == false else {
        return nil
    }
    guard assistantMessage.isStopped == false else {
        return nil
    }

    return AIChatOptimisticOutgoingTurnState(
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id
    )
}
