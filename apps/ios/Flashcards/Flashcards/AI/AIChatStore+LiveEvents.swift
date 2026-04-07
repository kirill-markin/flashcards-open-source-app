import Foundation

extension AIChatStore {
    func handleLiveEvent(_ event: AIChatLiveEvent) {
        self.clearStaleResumeErrorIfNeeded(
            connectedResumeAttemptSequence: self.activeLiveResumeAttemptSequence
        )
        self.activeLiveResumeAttemptSequence = nil
        logAIChatStoreEvent(
            action: "ai_live_event_handle_start",
            metadata: self.metadataForLiveEvent(event)
        )

        let metadata = self.liveEventMetadata(event)
        guard self.shouldIgnoreLiveEvent(metadata: metadata) == false else {
            logAIChatStoreEvent(
                action: "ai_live_event_ignored_stale",
                metadata: self.metadataForLiveEvent(event)
            )
            return
        }
        self.recordLiveMetadata(metadata: metadata)

        switch event {
        case .assistantDelta(metadata: _, text: let text, itemId: let itemId):
            guard let cursor = metadata.cursor else {
                self.reloadConversationFromBootstrap()
                return
            }
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: true
            )
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: appendingAIChatText(content: message.content, text: text),
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            logAIChatStoreEvent(
                action: "ai_live_event_handle_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_delta",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: ["textLength": String(text.count)]
                )
            )

        case .assistantToolCall(metadata: _, toolCall: let toolCall, itemId: let itemId):
            guard let cursor = metadata.cursor else {
                self.reloadConversationFromBootstrap()
                return
            }
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: true
            )
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: upsertingAIChatToolCall(content: message.content, toolCall: toolCall),
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            logAIChatStoreEvent(
                action: "ai_live_event_handle_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_tool_call",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: [
                        "toolName": toolCall.name,
                        "toolStatus": toolCall.status.rawValue
                    ]
                )
            )

        case .assistantReasoningStarted(metadata: _, reasoningId: let reasoningId, itemId: let itemId):
            guard let cursor = metadata.cursor else {
                self.reloadConversationFromBootstrap()
                return
            }
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: true
            )
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: upsertingAIChatReasoningSummary(
                    content: message.content,
                    reasoningSummary: AIChatReasoningSummary(
                        id: reasoningId,
                        summary: "",
                        status: .started
                    )
                ),
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            logAIChatStoreEvent(
                action: "ai_live_event_handle_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_reasoning_started",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: ["reasoningId": reasoningId]
                )
            )

        case .assistantReasoningSummary(
            metadata: _,
            reasoningId: let reasoningId,
            summary: let summary,
            itemId: let itemId
        ):
            guard let cursor = metadata.cursor else {
                self.reloadConversationFromBootstrap()
                return
            }
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: true
            )
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: upsertingAIChatReasoningSummary(
                    content: message.content,
                    reasoningSummary: AIChatReasoningSummary(
                        id: reasoningId,
                        summary: summary,
                        status: .started
                    )
                ),
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            logAIChatStoreEvent(
                action: "ai_live_event_handle_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_reasoning_summary",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: [
                        "reasoningId": reasoningId,
                        "summaryLength": String(summary.count)
                    ]
                )
            )

        case .assistantReasoningDone(metadata: _, reasoningId: let reasoningId, itemId: let itemId):
            guard let cursor = metadata.cursor else {
                self.reloadConversationFromBootstrap()
                return
            }
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: true
            )
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: completingAIChatReasoningSummary(content: message.content, reasoningId: reasoningId),
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            logAIChatStoreEvent(
                action: "ai_live_event_handle_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_reasoning_done",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: ["reasoningId": reasoningId]
                )
            )

        case .assistantMessageDone(
            metadata: _,
            itemId: let itemId,
            content: let content,
            isError: let isError,
            isStopped: let isStopped
        ):
            guard let cursor = metadata.cursor else {
                self.reloadConversationFromBootstrap()
                return
            }
            let finalizedContent = finalizingAIChatContent(content: content)
            let messageIndex = self.resolveTerminalAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor
            )
            guard messageIndex >= 0 else {
                logAIChatStoreEvent(
                    action: "ai_live_terminal_event_reconcile_required",
                    metadata: self.metadataForAppliedStreamingEvent(
                        eventType: "assistant_message_done",
                        cursor: cursor,
                        itemId: itemId,
                        messageIndex: messageIndex,
                        extra: [
                            "reason": "message_not_found",
                            "isError": isError ? "true" : "false",
                            "isStopped": isStopped ? "true" : "false",
                            "contentCount": String(finalizedContent.count)
                        ]
                    )
                )
                self.reloadConversationFromBootstrap()
                return
            }
            guard aiChatTerminalEventHasRenderableContent(
                content: finalizedContent,
                isError: isError,
                isStopped: isStopped
            ) else {
                logAIChatStoreEvent(
                    action: "ai_live_terminal_event_reconcile_required",
                    metadata: self.metadataForAppliedStreamingEvent(
                        eventType: "assistant_message_done",
                        cursor: cursor,
                        itemId: itemId,
                        messageIndex: messageIndex,
                        extra: [
                            "reason": "non_renderable_success_content",
                            "isError": isError ? "true" : "false",
                            "isStopped": isStopped ? "true" : "false",
                            "contentCount": String(finalizedContent.count)
                        ]
                    )
                )
                self.reloadConversationFromBootstrap()
                return
            }
            let message = self.messages[messageIndex]
            logAIChatUnknownContentParts(
                content: finalizedContent,
                sessionId: metadata.sessionId,
                messageId: message.id,
                source: "live"
            )
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: finalizedContent,
                timestamp: message.timestamp,
                isError: isError,
                isStopped: isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.schedulePersistCurrentState()
            logAIChatStoreEvent(
                action: "ai_live_terminal_event_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_message_done",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: [
                        "isError": isError ? "true" : "false",
                        "isStopped": isStopped ? "true" : "false",
                        "contentCount": String(finalizedContent.count)
                    ]
                )
            )

        case .composerSuggestionsUpdated(metadata: _, suggestions: let suggestions):
            self.applyComposerSuggestions(suggestions)
            logAIChatStoreEvent(
                action: "ai_live_composer_suggestions_applied",
                metadata: [
                    "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
                    "count": String(suggestions.count)
                ]
            )

        case .repairStatus(metadata: _, status: let status):
            self.repairStatus = status
            logAIChatStoreEvent(
                action: "ai_live_repair_status_applied",
                metadata: [
                    "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
                    "attempt": String(status.attempt),
                    "maxAttempts": String(status.maxAttempts),
                    "toolName": status.toolName ?? "-"
                ]
            )

        case .runTerminal(
            metadata: _,
            outcome: let outcome,
            message: let message,
            assistantItemId: let assistantItemId,
            isError: let isError,
            isStopped: let isStopped
        ):
            switch outcome {
            case .completed:
                self.clearActiveRunTracking(resetComposer: true)
            case .stopped:
                if let cursor = metadata.cursor, let assistantItemId {
                    _ = self.resolveTerminalAssistantMessageIndex(itemId: assistantItemId, cursor: cursor)
                }
                self.finalizeStoppedAssistantMessageIfNeeded()
                self.clearActiveRunTracking(resetComposer: true)
            case .error:
                if let cursor = metadata.cursor, let assistantItemId {
                    _ = self.resolveTerminalAssistantMessageIndex(itemId: assistantItemId, cursor: cursor)
                }
                if let message, message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                    self.markAssistantError(message: message)
                    self.showGeneralError(message: message)
                } else if let latestAssistantError = aiChatLatestAssistantErrorMessage(messages: self.messages) {
                    self.showGeneralError(message: latestAssistantError)
                } else {
                    self.showGeneralError(message: "AI chat failed.")
                }
                self.clearActiveRunTracking(resetComposer: true)
            case .resetRequired:
                self.clearActiveRunTracking(resetComposer: true)
                self.reloadConversationFromBootstrap()
            }

            self.schedulePersistCurrentState()
            logAIChatStoreEvent(
                action: "ai_live_run_terminal_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "run_terminal",
                    cursor: metadata.cursor,
                    itemId: assistantItemId,
                    messageIndex: self.activeStreamingMessageId.flatMap { activeStreamingMessageId in
                        self.messages.firstIndex(where: { $0.id == activeStreamingMessageId })
                    } ?? -1,
                    extra: [
                        "outcome": outcome.rawValue,
                        "isError": isError.map { $0 ? "true" : "false" } ?? "-",
                        "isStopped": isStopped.map { $0 ? "true" : "false" } ?? "-",
                        "message": message ?? "-"
                    ]
                )
            )
        }
    }

    func resolveStreamingAssistantMessageIndex(
        itemId: String,
        cursor: String,
        allowsPlaceholderAdoption: Bool
    ) -> Int {
        if let existingIndex = self.messages.firstIndex(where: { message in
            message.role == .assistant && message.itemId == itemId
        }) {
            self.activeStreamingMessageId = self.messages[existingIndex].id
            self.activeStreamingItemId = itemId
            return existingIndex
        }

        if let activeStreamingMessageId = self.activeStreamingMessageId,
           let existingIndex = self.messages.firstIndex(where: { message in
               message.id == activeStreamingMessageId && message.role == .assistant
           })
        {
            let message = self.messages[existingIndex]
            self.messages[existingIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.activeStreamingItemId = itemId
            return existingIndex
        }

        guard allowsPlaceholderAdoption else {
            return -1
        }

        if let existingIndex = self.messages.indices.reversed().first(where: { index in
            let message = self.messages[index]
            return message.role == .assistant && message.itemId == nil && message.isStopped == false
        }) {
            let message = self.messages[existingIndex]
            self.messages[existingIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.activeStreamingMessageId = message.id
            self.activeStreamingItemId = itemId
            return existingIndex
        }

        let message = AIChatMessage(
            id: UUID().uuidString.lowercased(),
            role: .assistant,
            content: [],
            timestamp: nowIsoTimestamp(),
            isError: false,
            isStopped: false,
            cursor: cursor,
            itemId: itemId
        )
        self.messages.append(message)
        self.activeStreamingMessageId = message.id
        self.activeStreamingItemId = itemId
        return self.messages.count - 1
    }

    func metadataForLiveEvent(_ event: AIChatLiveEvent) -> [String: String] {
        let metadata = self.liveEventMetadata(event)
        var values: [String: String] = [
            "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
            "conversationScopeId": self.conversationScopeId.isEmpty ? "-" : self.conversationScopeId,
            "activeRunId": self.activeRunId ?? "-",
            "streamEpoch": self.activeStreamEpoch ?? "-",
            "eventSessionId": metadata.sessionId,
            "eventConversationScopeId": metadata.conversationScopeId,
            "eventRunId": metadata.runId,
            "eventStreamEpoch": metadata.streamEpoch,
            "sequenceNumber": String(metadata.sequenceNumber),
            "liveCursor": self.liveCursor ?? "-",
            "eventCursor": metadata.cursor ?? "-",
            "activeStreamingMessageId": self.activeStreamingMessageId ?? "-",
            "activeStreamingItemId": self.activeStreamingItemId ?? "-",
            "messagesCount": String(self.messages.count)
        ]

        switch event {
        case .assistantDelta(metadata: _, text: let text, itemId: let itemId):
            values["eventType"] = "assistant_delta"
            values["itemId"] = itemId
            values["textLength"] = String(text.count)
        case .assistantToolCall(metadata: _, toolCall: let toolCall, itemId: let itemId):
            values["eventType"] = "assistant_tool_call"
            values["itemId"] = itemId
            values["toolName"] = toolCall.name
            values["toolStatus"] = toolCall.status.rawValue
        case .assistantReasoningStarted(metadata: _, reasoningId: let reasoningId, itemId: let itemId):
            values["eventType"] = "assistant_reasoning_started"
            values["itemId"] = itemId
            values["reasoningId"] = reasoningId
        case .assistantReasoningSummary(
            metadata: _,
            reasoningId: let reasoningId,
            summary: let summary,
            itemId: let itemId
        ):
            values["eventType"] = "assistant_reasoning_summary"
            values["itemId"] = itemId
            values["reasoningId"] = reasoningId
            values["summaryLength"] = String(summary.count)
        case .assistantReasoningDone(metadata: _, reasoningId: let reasoningId, itemId: let itemId):
            values["eventType"] = "assistant_reasoning_done"
            values["itemId"] = itemId
            values["reasoningId"] = reasoningId
        case .assistantMessageDone(
            metadata: _,
            itemId: let itemId,
            content: let content,
            isError: let isError,
            isStopped: let isStopped
        ):
            values["eventType"] = "assistant_message_done"
            values["itemId"] = itemId
            values["contentCount"] = String(content.count)
            values["isError"] = isError ? "true" : "false"
            values["isStopped"] = isStopped ? "true" : "false"
        case .composerSuggestionsUpdated(metadata: _, suggestions: let suggestions):
            values["eventType"] = "composer_suggestions_updated"
            values["suggestionCount"] = String(suggestions.count)
        case .repairStatus(metadata: _, status: let status):
            values["eventType"] = "repair_status"
            values["attempt"] = String(status.attempt)
            values["maxAttempts"] = String(status.maxAttempts)
            values["toolName"] = status.toolName ?? "-"
        case .runTerminal(
            metadata: _,
            outcome: let outcome,
            message: let message,
            assistantItemId: let assistantItemId,
            isError: let isError,
            isStopped: let isStopped
        ):
            values["eventType"] = "run_terminal"
            values["outcome"] = outcome.rawValue
            values["assistantItemId"] = assistantItemId ?? "-"
            values["message"] = message ?? "-"
            values["isError"] = isError.map { $0 ? "true" : "false" } ?? "-"
            values["isStopped"] = isStopped.map { $0 ? "true" : "false" } ?? "-"
        }

        return values
    }

    func metadataForAppliedStreamingEvent(
        eventType: String,
        cursor: String?,
        itemId: String?,
        messageIndex: Int,
        extra: [String: String]
    ) -> [String: String] {
        var metadata: [String: String] = [
            "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
            "conversationScopeId": self.conversationScopeId.isEmpty ? "-" : self.conversationScopeId,
            "activeRunId": self.activeRunId ?? "-",
            "streamEpoch": self.activeStreamEpoch ?? "-",
            "eventType": eventType,
            "cursor": cursor ?? "-",
            "itemId": itemId ?? "-",
            "messageIndex": String(messageIndex),
            "liveCursor": self.liveCursor ?? "-",
            "activeStreamingMessageId": self.activeStreamingMessageId ?? "-",
            "activeStreamingItemId": self.activeStreamingItemId ?? "-",
            "messagesCount": String(self.messages.count)
        ]

        for (key, value) in extra {
            metadata[key] = value
        }

        return metadata
    }
}

extension AIChatStore {
    func liveEventMetadata(_ event: AIChatLiveEvent) -> AIChatLiveEventMetadata {
        switch event {
        case .assistantDelta(metadata: let metadata, text: _, itemId: _):
            return metadata
        case .assistantToolCall(metadata: let metadata, toolCall: _, itemId: _):
            return metadata
        case .assistantReasoningStarted(metadata: let metadata, reasoningId: _, itemId: _):
            return metadata
        case .assistantReasoningSummary(metadata: let metadata, reasoningId: _, summary: _, itemId: _):
            return metadata
        case .assistantReasoningDone(metadata: let metadata, reasoningId: _, itemId: _):
            return metadata
        case .assistantMessageDone(metadata: let metadata, itemId: _, content: _, isError: _, isStopped: _):
            return metadata
        case .composerSuggestionsUpdated(metadata: let metadata, suggestions: _):
            return metadata
        case .repairStatus(metadata: let metadata, status: _):
            return metadata
        case .runTerminal(
            metadata: let metadata,
            outcome: _,
            message: _,
            assistantItemId: _,
            isError: _,
            isStopped: _
        ):
            return metadata
        }
    }

    func shouldIgnoreLiveEvent(metadata: AIChatLiveEventMetadata) -> Bool {
        if self.shouldKeepLiveAttached == false {
            return true
        }
        if self.chatSessionId.isEmpty || metadata.sessionId != self.chatSessionId {
            return true
        }
        if self.conversationScopeId.isEmpty == false && metadata.conversationScopeId != self.conversationScopeId {
            return true
        }
        guard let activeRunId = self.activeRunId else {
            return true
        }
        if metadata.runId != activeRunId {
            return true
        }
        if let activeStreamEpoch = self.activeStreamEpoch, metadata.streamEpoch != activeStreamEpoch {
            return true
        }

        return false
    }

    func recordLiveMetadata(metadata: AIChatLiveEventMetadata) {
        if let cursor = metadata.cursor {
            self.setActiveRunCursor(cursor: cursor)
        }
        if self.activeStreamEpoch == nil {
            self.setActiveRunStreamEpoch(streamEpoch: metadata.streamEpoch)
        }
    }

    func clearActiveRunTracking(resetComposer: Bool) {
        self.clearActiveRunSession()
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil
        self.repairStatus = nil
        if resetComposer {
            self.transitionToIdle()
        }
    }

    func resolveTerminalAssistantMessageIndex(itemId: String, cursor: String) -> Int {
        if let existingIndex = self.messages.firstIndex(where: { message in
            message.role == .assistant && message.itemId == itemId
        }) {
            self.activeStreamingMessageId = self.messages[existingIndex].id
            self.activeStreamingItemId = itemId
            return existingIndex
        }

        if let activeStreamingMessageId = self.activeStreamingMessageId,
           let existingIndex = self.messages.firstIndex(where: { message in
               message.id == activeStreamingMessageId && message.role == .assistant
           })
        {
            let message = self.messages[existingIndex]
            self.messages[existingIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.activeStreamingItemId = itemId
            return existingIndex
        }

        if let existingIndex = self.messages.indices.reversed().first(where: { index in
            let message = self.messages[index]
            return message.role == .assistant && message.itemId == nil && message.isStopped == false
        }) {
            let message = self.messages[existingIndex]
            self.messages[existingIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                isError: message.isError,
                isStopped: message.isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.activeStreamingMessageId = message.id
            self.activeStreamingItemId = itemId
            return existingIndex
        }

        return -1
    }
}

private func aiChatTerminalEventHasRenderableContent(
    content: [AIChatContentPart],
    isError: Bool,
    isStopped: Bool
) -> Bool {
    if isError || isStopped {
        return true
    }

    return content.contains { part in
        switch part {
        case .text(let text):
            return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        case .reasoningSummary(let reasoningSummary):
            return reasoningSummary.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        case .image, .file, .card, .toolCall, .accountUpgradePrompt, .unknown:
            return true
        }
    }
}
