import Foundation

extension AIChatStore {
    func markAssistantError(message: String) {
        let targetIndex = self.activeStreamingMessageId.flatMap { messageId in
            self.messages.firstIndex(where: { $0.id == messageId && $0.role == .assistant })
        } ?? self.messages.indices.last(where: { self.messages[$0].role == .assistant })

        if let targetIndex {
            let lastMessage = self.messages[targetIndex]
            let separator = extractAIChatTextContent(parts: lastMessage.content).isEmpty ? "" : "\n\n"
            self.messages[targetIndex] = AIChatMessage(
                id: lastMessage.id,
                role: lastMessage.role,
                content: appendingAIChatText(content: lastMessage.content, text: separator + message),
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
        if let lastIndex = self.messages.indices.last, self.messages[lastIndex].role == .assistant {
            let lastMessage = self.messages[lastIndex]
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
            isError: lastMessage.isError,
            isStopped: lastMessage.isStopped,
            cursor: lastMessage.cursor,
            itemId: lastMessage.itemId
        )
    }

    func finalizeStoppedAssistantMessageIfNeeded() {
        guard let activeStreamingMessageId = self.activeStreamingMessageId,
              let messageIndex = self.messages.firstIndex(where: { $0.id == activeStreamingMessageId }) else {
            return
        }

        let message = self.messages[messageIndex]
        self.messages[messageIndex] = AIChatMessage(
            id: message.id,
            role: message.role,
            content: removingOptimisticAIChatStatus(content: message.content),
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
    guard content.count == 1 else {
        return false
    }
    guard case .text(let text) = content[0] else {
        return false
    }

    return text == aiChatOptimisticAssistantStatusText
}

private func removingOptimisticAIChatStatus(content: [AIChatContentPart]) -> [AIChatContentPart] {
    return isOptimisticAIChatStatusContent(content: content) ? [] : content
}

func appendingAIChatText(content: [AIChatContentPart], text: String) -> [AIChatContentPart] {
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

func upsertingAIChatToolCall(
    content: [AIChatContentPart],
    toolCall: AIChatToolCall
) -> [AIChatContentPart] {
    var updatedContent = removingOptimisticAIChatStatus(content: content)
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

func upsertingAIChatReasoningSummary(
    content: [AIChatContentPart],
    reasoningSummary: AIChatReasoningSummary
) -> [AIChatContentPart] {
    var updatedContent = removingOptimisticAIChatStatus(content: content)
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

    updatedContent.insert(.reasoningSummary(reasoningSummary), at: 0)
    return updatedContent
}

func completingAIChatReasoningSummary(
    content: [AIChatContentPart],
    reasoningId: String
) -> [AIChatContentPart] {
    removingOptimisticAIChatStatus(content: content).compactMap { part in
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
    removingOptimisticAIChatStatus(content: content).compactMap { part in
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
        case .image, .file, .card, .toolCall, .accountUpgradePrompt:
            break
        }
    }
}
