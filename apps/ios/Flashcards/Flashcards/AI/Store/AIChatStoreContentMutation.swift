import Foundation

extension AIChatStore {
    func markAssistantError(message: String) {
        let targetIndex = self.activeStreamingMessageId.flatMap { messageId in
            self.messages.firstIndex(where: { $0.id == messageId && $0.role == .assistant })
        } ?? self.messages.indices.last(where: { self.messages[$0].role == .assistant })

        if let targetIndex {
            let lastMessage = self.messages[targetIndex]
            let separator = extractAIChatTextContent(parts: lastMessage.content).isEmpty ? "" : "\n\n"
            let replacesOptimisticPlaceholder = self.consumeOptimisticAssistantPlaceholder(
                messageId: lastMessage.id
            )
            self.messages[targetIndex] = AIChatMessage(
                id: lastMessage.id,
                role: lastMessage.role,
                content: appendingAIChatText(
                    content: lastMessage.content,
                    text: separator + message,
                    replacesOptimisticPlaceholder: replacesOptimisticPlaceholder
                ),
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

    func appendAssistantAccountUpgradePrompt(message: String, buttonTitle: String) {
        if let lastIndex = self.messages.indices.last {
            let lastMessage = self.messages[lastIndex]
            if lastMessage.role == .assistant,
               self.consumeOptimisticAssistantPlaceholder(messageId: lastMessage.id)
            {
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

    func appendStandaloneAssistantAccountUpgradePromptAndPersist(
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
        self.schedulePersistCurrentState()
    }

    func clearOptimisticAssistantStatusIfNeeded() {
        guard let optimisticTurn = self.currentOptimisticOutgoingTurn() else {
            return
        }

        self.messages[self.messages.count - 1] = AIChatMessage(
            id: optimisticTurn.assistantMessage.id,
            role: optimisticTurn.assistantMessage.role,
            content: [],
            timestamp: optimisticTurn.assistantMessage.timestamp,
            isError: optimisticTurn.assistantMessage.isError,
            isStopped: optimisticTurn.assistantMessage.isStopped,
            cursor: optimisticTurn.assistantMessage.cursor,
            itemId: optimisticTurn.assistantMessage.itemId
        )
        self.clearOptimisticOutgoingTurnState()
    }

    func finalizeStoppedAssistantMessageIfNeeded() {
        guard let activeStreamingMessageId = self.activeStreamingMessageId,
              let messageIndex = self.messages.firstIndex(where: { $0.id == activeStreamingMessageId }) else {
            return
        }

        let message = self.messages[messageIndex]
        let removesOptimisticPlaceholder = self.consumeOptimisticAssistantPlaceholder(
            messageId: message.id
        )
        self.messages[messageIndex] = AIChatMessage(
            id: message.id,
            role: message.role,
            content: removingOptimisticAIChatStatus(
                content: message.content,
                removesOptimisticPlaceholder: removesOptimisticPlaceholder
            ),
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

func isOptimisticAIChatStatusContent(content: [AIChatContentPart]) -> Bool {
    return content.isEmpty
}

private func removingOptimisticAIChatStatus(content: [AIChatContentPart]) -> [AIChatContentPart] {
    return removingOptimisticAIChatStatus(
        content: content,
        removesOptimisticPlaceholder: isOptimisticAIChatStatusContent(content: content)
    )
}

func appendingAIChatText(content: [AIChatContentPart], text: String) -> [AIChatContentPart] {
    return appendingAIChatText(
        content: content,
        text: text,
        replacesOptimisticPlaceholder: isOptimisticAIChatStatusContent(content: content)
    )
}

func appendingAIChatText(
    content: [AIChatContentPart],
    text: String,
    replacesOptimisticPlaceholder: Bool
) -> [AIChatContentPart] {
    guard text.isEmpty == false else {
        return content
    }

    if replacesOptimisticPlaceholder {
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

func upsertingAIChatToolCall(
    content: [AIChatContentPart],
    toolCall: AIChatToolCall
) -> [AIChatContentPart] {
    return upsertingAIChatToolCall(
        content: content,
        toolCall: toolCall,
        removesOptimisticPlaceholder: isOptimisticAIChatStatusContent(content: content)
    )
}

func upsertingAIChatToolCall(
    content: [AIChatContentPart],
    toolCall: AIChatToolCall,
    removesOptimisticPlaceholder: Bool
) -> [AIChatContentPart] {
    var updatedContent = removingOptimisticAIChatStatus(
        content: content,
        removesOptimisticPlaceholder: removesOptimisticPlaceholder
    )
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

/// Keeps reasoning blocks in their current assistant-content order.
///
/// New reasoning blocks must be appended so they do not jump ahead of already
/// streamed text or tool content while the assistant message is still growing.
func upsertingAIChatReasoningSummary(
    content: [AIChatContentPart],
    reasoningSummary: AIChatReasoningSummary
) -> [AIChatContentPart] {
    return upsertingAIChatReasoningSummary(
        content: content,
        reasoningSummary: reasoningSummary,
        removesOptimisticPlaceholder: isOptimisticAIChatStatusContent(content: content)
    )
}

func upsertingAIChatReasoningSummary(
    content: [AIChatContentPart],
    reasoningSummary: AIChatReasoningSummary,
    removesOptimisticPlaceholder: Bool
) -> [AIChatContentPart] {
    var updatedContent = removingOptimisticAIChatStatus(
        content: content,
        removesOptimisticPlaceholder: removesOptimisticPlaceholder
    )
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

    // Preserve the existing transcript order by appending new reasoning blocks
    // where they arrived, instead of prepending them to the message.
    updatedContent.append(.reasoningSummary(reasoningSummary))
    return updatedContent
}

func completingAIChatReasoningSummary(
    content: [AIChatContentPart],
    reasoningId: String
) -> [AIChatContentPart] {
    return completingAIChatReasoningSummary(
        content: content,
        reasoningId: reasoningId,
        removesOptimisticPlaceholder: isOptimisticAIChatStatusContent(content: content)
    )
}

func completingAIChatReasoningSummary(
    content: [AIChatContentPart],
    reasoningId: String,
    removesOptimisticPlaceholder: Bool
) -> [AIChatContentPart] {
    removingOptimisticAIChatStatus(
        content: content,
        removesOptimisticPlaceholder: removesOptimisticPlaceholder
    ).compactMap { part in
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

func finalizingAIChatContent(content: [AIChatContentPart]) -> [AIChatContentPart] {
    return finalizingAIChatContent(
        content: content,
        removesOptimisticPlaceholder: isOptimisticAIChatStatusContent(content: content)
    )
}

func finalizingAIChatContent(
    content: [AIChatContentPart],
    removesOptimisticPlaceholder: Bool
) -> [AIChatContentPart] {
    removingOptimisticAIChatStatus(
        content: content,
        removesOptimisticPlaceholder: removesOptimisticPlaceholder
    ).compactMap { part in
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

private func removingOptimisticAIChatStatus(
    content: [AIChatContentPart],
    removesOptimisticPlaceholder: Bool
) -> [AIChatContentPart] {
    removesOptimisticPlaceholder ? [] : content
}

func aiChatCurrentRunHasAssistantToolCalls(messages: [AIChatMessage]) -> Bool {
    guard let latestUserMessageIndex = messages.lastIndex(where: { $0.role == .user }) else {
        return false
    }

    let currentRunMessages = messages.suffix(from: messages.index(after: latestUserMessageIndex))
    return currentRunMessages.contains { message in
        guard message.role == .assistant else {
            return false
        }

        return message.content.contains { part in
            if case .toolCall = part {
                return true
            }

            return false
        }
    }
}

func aiChatActiveRunTailHasToolCalls(messages: [AIChatMessage]) -> Bool {
    for message in messages.reversed() {
        guard message.role == .assistant else {
            return false
        }
        guard message.isStopped == false else {
            return false
        }

        if message.content.contains(where: aiChatContentPartIsToolCall(part:)) {
            return true
        }
    }

    return false
}

func aiChatTerminalRunHasToolCalls(messages: [AIChatMessage]) -> Bool {
    if aiChatCurrentRunHasAssistantToolCalls(messages: messages) {
        return true
    }

    var trailingAssistantItemId: String?
    var sawTrailingAssistantMessage = false
    for message in messages.reversed() {
        if message.role == .user {
            return false
        }

        if message.role == .assistant {
            if sawTrailingAssistantMessage == false {
                trailingAssistantItemId = message.itemId
                sawTrailingAssistantMessage = true
            } else if message.itemId != trailingAssistantItemId {
                return false
            }

            if message.content.contains(where: aiChatContentPartIsToolCall(part:)) {
                return true
            }
        }
    }

    return false
}

func aiChatSnapshotRunHasToolCalls(
    activeRun: AIChatActiveRun?,
    messages: [AIChatMessage]
) -> Bool {
    if activeRun == nil {
        return aiChatTerminalRunHasToolCalls(messages: messages)
    }

    return aiChatActiveRunTailHasToolCalls(messages: messages)
}

private func aiChatContentPartIsToolCall(part: AIChatContentPart) -> Bool {
    if case .toolCall = part {
        return true
    }

    return false
}

private func reasoningSummaryText(reasoningSummary: AIChatReasoningSummary) -> String {
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
        case .image, .file, .card, .toolCall, .accountUpgradePrompt, .unknown:
            break
        }
    }
}
