import Foundation

extension AIChatStore {
    /**
     * Controls whether the chat surface is allowed to keep a live SSE attach.
     * Hidden, backgrounded, or inactive screens must detach immediately. When
     * the surface becomes visible again, recovery always starts from bootstrap.
     */
    func setChatVisibility(isVisible: Bool) {
        self.shouldKeepLiveAttached = isVisible

        if isVisible {
            self.resumeVisibleSessionIfNeeded()
            return
        }

        Task {
            await self.runtime.detach()
        }
    }

    /**
     * Applies one typed live event on top of the last trusted bootstrap state.
     * Snapshot/bootstrap remains the source of truth. The live stream only
     * mutates the currently active assistant turn while the run is streaming.
     */
    func handleLiveEvent(_ event: AIChatLiveEvent) {
        logAIChatStoreEvent(
            action: "ai_live_event_handle_start",
            metadata: self.metadataForLiveEvent(event)
        )

        switch event {
        case .assistantDelta(let text, let cursor, let itemId):
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
            self.liveCursor = cursor
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

        case .assistantToolCall(let toolCall, let cursor, let itemId):
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
            self.liveCursor = cursor
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

        case .assistantReasoningStarted(let reasoningId, let cursor, let itemId):
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
            self.liveCursor = cursor
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

        case .assistantReasoningSummary(let reasoningId, let summary, let cursor, let itemId):
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
            self.liveCursor = cursor
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

        case .assistantReasoningDone(let reasoningId, let cursor, let itemId):
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
            self.liveCursor = cursor
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

        case .assistantMessageDone(let cursor, let itemId, let isError, let isStopped):
            let messageIndex = self.resolveStreamingAssistantMessageIndex(
                itemId: itemId,
                cursor: cursor,
                allowsPlaceholderAdoption: false
            )
            guard messageIndex >= 0 else {
                logAIChatStoreEvent(
                    action: "ai_live_terminal_event_dropped",
                    metadata: self.metadataForAppliedStreamingEvent(
                        eventType: "assistant_message_done",
                        cursor: cursor,
                        itemId: itemId,
                        messageIndex: messageIndex,
                        extra: [
                            "isError": isError ? "true" : "false",
                            "isStopped": isStopped ? "true" : "false"
                        ]
                    )
                )
                return
            }
            let message = self.messages[messageIndex]
            self.messages[messageIndex] = AIChatMessage(
                id: message.id,
                role: message.role,
                content: finalizingAIChatContent(content: message.content),
                timestamp: message.timestamp,
                isError: isError,
                isStopped: isStopped,
                cursor: cursor,
                itemId: itemId
            )
            self.liveCursor = cursor
            self.activeStreamingMessageId = nil
            self.activeStreamingItemId = nil
            self.composerPhase = .idle
            self.repairStatus = nil
            if isError {
                self.showGeneralError(
                    message: aiChatLatestAssistantErrorMessage(messages: self.messages) ?? "AI chat failed."
                )
            }
            logAIChatStoreEvent(
                action: "ai_live_terminal_event_applied",
                metadata: self.metadataForAppliedStreamingEvent(
                    eventType: "assistant_message_done",
                    cursor: cursor,
                    itemId: itemId,
                    messageIndex: messageIndex,
                    extra: [
                        "isError": isError ? "true" : "false",
                        "isStopped": isStopped ? "true" : "false"
                    ]
                )
            )

        case .runState(let state):
            if state != "running" {
                logAIChatStoreEvent(
                    action: "ai_live_run_state_non_running",
                    metadata: [
                        "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
                        "runState": state,
                        "activeStreamingMessageId": self.activeStreamingMessageId ?? "-",
                        "activeStreamingItemId": self.activeStreamingItemId ?? "-",
                        "messagesCount": String(self.messages.count)
                    ]
                )
                /**
                 * The live stream can report a non-running session state before
                 * the terminal assistant message event is applied on the UI
                 * side. Keep the streaming UI active until that terminal event
                 * clears the active assistant message, otherwise the "Stop
                 * response" state disappears while text deltas are still
                 * arriving.
                 */
                if self.activeStreamingMessageId == nil && self.activeStreamingItemId == nil {
                    self.composerPhase = .idle
                    self.repairStatus = nil
                }
            }

        case .repairStatus(let status):
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

        case .error(let message):
            self.activeStreamingMessageId = nil
            self.activeStreamingItemId = nil
            self.composerPhase = .idle
            self.showGeneralError(message: message)
            logAIChatStoreEvent(
                action: "ai_live_error_applied",
                metadata: [
                    "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
                    "message": message,
                    "messagesCount": String(self.messages.count)
                ]
            )

        case .stopAck:
            logAIChatStoreEvent(
                action: "ai_live_stop_ack_ignored",
                metadata: [
                    "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId
                ]
            )

        case .resetRequired:
            logAIChatStoreEvent(
                action: "ai_live_reset_required",
                metadata: [
                    "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
                    "liveCursor": self.liveCursor ?? "-"
                ]
            )
            self.reloadConversationFromBootstrap()
        }
    }

    /**
     * Applies the latest bootstrap snapshot and records the cursor boundary from
     * which a resumed live attach may continue.
     */
    func applyBootstrap(_ response: AIChatBootstrapResponse) {
        self.messages = response.messages
        self.chatSessionId = response.sessionId
        self.serverChatConfig = response.chatConfig
        self.hasOlderMessages = response.hasOlder
        self.oldestCursor = response.oldestCursor
        self.liveCursor = response.liveCursor
        self.activeLiveStream = response.liveStream
        self.composerPhase = response.runState == "running" ? .running : .idle

        if response.runState == "running",
           let lastAssistantMessage = response.messages.last(where: { $0.role == .assistant })
        {
            self.activeStreamingMessageId = lastAssistantMessage.id
            self.activeStreamingItemId = lastAssistantMessage.itemId
        } else {
            self.activeStreamingMessageId = nil
            self.activeStreamingItemId = nil
        }

        Task {
            await self.historyStore.saveState(state: self.currentPersistedState())
        }
    }

    /**
     * Attaches bootstrap-provided live SSE only when the surface is visible and
     * the backend still reports an active run.
     */
    func attachBootstrapLiveIfNeeded(
        response: AIChatBootstrapResponse,
        session: CloudLinkedSession
    ) {
        guard self.shouldKeepLiveAttached else {
            Task {
                await self.runtime.detach()
            }
            return
        }
        guard response.runState == "running" else {
            Task {
                await self.runtime.detach()
            }
            return
        }

        guard let liveStream = response.liveStream else {
            self.showGeneralError(message: "AI live stream is unavailable for the active run.")
            self.composerPhase = .idle
            return
        }

        Task {
            await self.runtime.detach()
            await self.runtime.attachLive(
                liveStream: liveStream,
                sessionId: response.sessionId,
                afterCursor: response.liveCursor,
                configurationMode: session.configurationMode,
                eventHandler: { [weak self] event in
                    await self?.handleLiveEvent(event)
                },
                completionHandler: { [weak self] termination in
                    await self?.handleLiveStreamTermination(termination, sessionId: response.sessionId)
                }
            )
        }
    }

    /**
     * Re-attaches the current live stream envelope for the active run. This is
     * only valid while the surface stays visible and the latest cursor is known.
     */
    func attachActiveLiveStreamIfPossible() {
        guard self.shouldKeepLiveAttached else {
            Task {
                await self.runtime.detach()
            }
            return
        }
        guard self.composerPhase == .running else {
            return
        }
        guard let liveStream = self.activeLiveStream else {
            self.showGeneralError(message: "AI live stream is unavailable for the active run.")
            self.composerPhase = .idle
            return
        }
        guard self.chatSessionId.isEmpty == false else {
            self.showGeneralError(message: "AI chat session is unavailable for the active run.")
            self.composerPhase = .idle
            return
        }

        let sessionId = self.chatSessionId
        let afterCursor = self.liveCursor
        Task {
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                guard self.shouldKeepLiveAttached else {
                    await self.runtime.detach()
                    return
                }
                await self.runtime.detach()
                await self.runtime.attachLive(
                    liveStream: liveStream,
                    sessionId: sessionId,
                    afterCursor: afterCursor,
                    configurationMode: session.configurationMode,
                    eventHandler: { [weak self] event in
                        await self?.handleLiveEvent(event)
                    },
                    completionHandler: { [weak self] termination in
                        await self?.handleLiveStreamTermination(termination, sessionId: sessionId)
                    }
                )
            } catch {
                guard self.shouldKeepLiveAttached else {
                    return
                }
                self.showGeneralError(message: Flashcards.errorMessage(error: error))
                self.composerPhase = .idle
            }
        }
    }

    /**
     * Resumes the visible chat surface by fetching bootstrap first. Live SSE is
     * never resumed blindly; bootstrap decides whether attach is still needed.
     */
    func resumeVisibleSessionIfNeeded() {
        guard self.shouldKeepLiveAttached else {
            return
        }
        guard self.isChatInteractive else {
            return
        }
        let cloudState = self.flashcardsStore.cloudSettings?.cloudState
        guard cloudState == .linked || cloudState == .guest else {
            return
        }
        guard self.hasExternalProviderConsent else {
            return
        }
        guard self.activeBootstrapTask == nil else {
            return
        }
        guard self.composerPhase != .preparingSend && self.composerPhase != .startingRun else {
            return
        }

        self.startLinkedBootstrap(forceReloadState: false)
    }

    func reloadConversationFromBootstrap() {
        Task {
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let response = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
                    limit: aiChatBootstrapPageLimit
                )
                self.applyBootstrap(response)
                self.attachBootstrapLiveIfNeeded(response: response, session: session)
            } catch {
                self.showGeneralError(message: Flashcards.errorMessage(error: error))
                self.composerPhase = .idle
            }
        }
    }

    func handleLiveStreamTermination(
        _ termination: AIChatLiveAttachTermination,
        sessionId: String
    ) async {
        switch termination {
        case .sawTerminalEvent:
            return
        case .failed(let message):
            guard self.shouldKeepLiveAttached else {
                return
            }
            await self.reconcileFailedLiveStreamTermination(
                sessionId: sessionId,
                fallbackMessage: message
            )
        case .endedWithoutTerminalEvent:
            guard self.shouldKeepLiveAttached else {
                return
            }
            await self.reconcileUnexpectedLiveStreamEnd(sessionId: sessionId)
        }
    }

    func reconcileFailedLiveStreamTermination(
        sessionId: String,
        fallbackMessage: String
    ) async {
        do {
            let session = try await self.flashcardsStore.cloudSessionForAI()
            let response = try await self.chatService.loadBootstrap(
                session: session,
                sessionId: sessionId,
                limit: aiChatBootstrapPageLimit
            )
            self.applyBootstrap(response)

            if let errorMessage = aiChatLatestAssistantErrorMessage(messages: response.messages) {
                self.composerPhase = .idle
                self.showGeneralError(message: errorMessage)
                return
            }

            if response.runState == "running" {
                self.attachBootstrapLiveIfNeeded(response: response, session: session)
                return
            }

            self.composerPhase = .idle
            if self.messages.last.map({ message in
                message.role == .assistant && isOptimisticAIChatStatusContent(content: message.content)
            }) == true {
                self.markAssistantError(message: fallbackMessage)
            }
        } catch {
            self.composerPhase = .idle
            self.showGeneralError(message: Flashcards.errorMessage(error: error))
        }
    }

    func reconcileUnexpectedLiveStreamEnd(sessionId: String) async {
        do {
            let session = try await self.flashcardsStore.cloudSessionForAI()
            let response = try await self.chatService.loadBootstrap(
                session: session,
                sessionId: sessionId,
                limit: aiChatBootstrapPageLimit
            )
            self.applyBootstrap(response)

            if let errorMessage = aiChatLatestAssistantErrorMessage(messages: response.messages) {
                self.composerPhase = .idle
                self.showGeneralError(message: errorMessage)
                return
            }

            if response.runState == "running" {
                self.composerPhase = .idle
                self.showGeneralError(message: "AI live stream ended before message completion.")
                return
            }
        } catch {
            self.composerPhase = .idle
            self.showGeneralError(message: Flashcards.errorMessage(error: error))
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
        var metadata: [String: String] = [
            "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
            "liveCursor": self.liveCursor ?? "-",
            "activeStreamingMessageId": self.activeStreamingMessageId ?? "-",
            "activeStreamingItemId": self.activeStreamingItemId ?? "-",
            "messagesCount": String(self.messages.count)
        ]

        switch event {
        case .runState(let state):
            metadata["eventType"] = "run_state"
            metadata["runState"] = state
        case .assistantDelta(let text, let cursor, let itemId):
            metadata["eventType"] = "assistant_delta"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["textLength"] = String(text.count)
        case .assistantToolCall(let toolCall, let cursor, let itemId):
            metadata["eventType"] = "assistant_tool_call"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["toolName"] = toolCall.name
            metadata["toolStatus"] = toolCall.status.rawValue
        case .assistantReasoningStarted(let reasoningId, let cursor, let itemId):
            metadata["eventType"] = "assistant_reasoning_started"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["reasoningId"] = reasoningId
        case .assistantReasoningSummary(let reasoningId, let summary, let cursor, let itemId):
            metadata["eventType"] = "assistant_reasoning_summary"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["reasoningId"] = reasoningId
            metadata["summaryLength"] = String(summary.count)
        case .assistantReasoningDone(let reasoningId, let cursor, let itemId):
            metadata["eventType"] = "assistant_reasoning_done"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["reasoningId"] = reasoningId
        case .assistantMessageDone(let cursor, let itemId, let isError, let isStopped):
            metadata["eventType"] = "assistant_message_done"
            metadata["cursor"] = cursor
            metadata["itemId"] = itemId
            metadata["isError"] = isError ? "true" : "false"
            metadata["isStopped"] = isStopped ? "true" : "false"
        case .repairStatus(let status):
            metadata["eventType"] = "repair_status"
            metadata["attempt"] = String(status.attempt)
            metadata["maxAttempts"] = String(status.maxAttempts)
            metadata["toolName"] = status.toolName ?? "-"
        case .error(let message):
            metadata["eventType"] = "error"
            metadata["message"] = message
        case .stopAck(let sessionId):
            metadata["eventType"] = "stop_ack"
            metadata["ackSessionId"] = sessionId
        case .resetRequired:
            metadata["eventType"] = "reset_required"
        }

        return metadata
    }

    func metadataForAppliedStreamingEvent(
        eventType: String,
        cursor: String,
        itemId: String,
        messageIndex: Int,
        extra: [String: String]
    ) -> [String: String] {
        var metadata: [String: String] = [
            "chatSessionId": self.chatSessionId.isEmpty ? "-" : self.chatSessionId,
            "eventType": eventType,
            "cursor": cursor,
            "itemId": itemId,
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

private func aiChatLatestAssistantErrorMessage(messages: [AIChatMessage]) -> String? {
    guard let assistantMessage = messages.last(where: { $0.role == .assistant && $0.isError }) else {
        return nil
    }

    let message = assistantMessage.content.reduce(into: "") { result, part in
        if case .text(let text) = part {
            result.append(text)
        }
    }.trimmingCharacters(in: .whitespacesAndNewlines)

    return message.isEmpty ? nil : message
}
