import Foundation

extension AIChatStore {
    /**
     * Controls whether the chat surface is allowed to keep a live SSE attach.
     * Hidden, backgrounded, or inactive screens must detach immediately. When
     * the surface becomes visible again, recovery always starts from bootstrap.
     */
    func setChatVisibility(isVisible: Bool) {
        if self.shouldKeepLiveAttached == isVisible {
            return
        }

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

    /**
     * Applies the latest bootstrap snapshot and records the cursor boundary from
     * which a resumed live attach may continue.
     */
    func applyBootstrap(_ response: AIChatBootstrapResponse) {
        self.applyEnvelope(response)
    }

    /**
     * Attaches bootstrap-provided live SSE only when the surface is visible and
     * the backend still reports an active run.
     */
    func attachBootstrapLiveIfNeeded(
        response: AIChatBootstrapResponse,
        session: CloudLinkedSession,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) {
        guard self.shouldKeepLiveAttached else {
            self.activeLiveResumeAttemptSequence = nil
            Task {
                await self.runtime.detach()
            }
            return
        }
        guard let activeRun = response.activeRun else {
            self.activeLiveResumeAttemptSequence = nil
            Task {
                await self.runtime.detach()
            }
            return
        }

        self.activeLiveResumeAttemptSequence = resumeAttemptDiagnostics?.sequence
        Task {
            await self.runtime.detach()
            await self.runtime.attachLive(
                liveStream: activeRun.live.stream,
                sessionId: response.sessionId,
                runId: activeRun.runId,
                afterCursor: activeRun.live.cursor,
                configurationMode: session.configurationMode,
                resumeAttemptDiagnostics: resumeAttemptDiagnostics,
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
        guard let activeRunId = self.activeRunId, activeRunId.isEmpty == false else {
            self.clearActiveRunTracking(resetComposer: true)
            self.showGeneralError(message: "AI active run is unavailable.")
            return
        }
        guard let liveStream = self.activeLiveStream else {
            self.clearActiveRunTracking(resetComposer: true)
            self.showGeneralError(message: "AI live stream is unavailable for the active run.")
            return
        }
        guard self.chatSessionId.isEmpty == false else {
            self.clearActiveRunTracking(resetComposer: true)
            self.showGeneralError(message: "AI chat session is unavailable for the active run.")
            return
        }

        let sessionId = self.chatSessionId
        let afterCursor = self.liveCursor
        self.activeLiveResumeAttemptSequence = nil
        Task {
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                guard self.shouldKeepLiveAttached else {
                    await self.runtime.detach()
                    return
                }
                guard self.activeRunId == activeRunId else {
                    await self.runtime.detach()
                    return
                }
                await self.runtime.detach()
                await self.runtime.attachLive(
                    liveStream: liveStream,
                    sessionId: sessionId,
                    runId: activeRunId,
                    afterCursor: afterCursor,
                    configurationMode: session.configurationMode,
                    resumeAttemptDiagnostics: nil,
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
                self.clearActiveRunTracking(resetComposer: true)
                self.showGeneralError(error: error)
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

        self.startLinkedBootstrap(
            forceReloadState: false,
            resumeAttemptDiagnostics: self.nextResumeAttemptDiagnostics()
        )
    }

    func reloadConversationFromBootstrap() {
        Task {
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let response = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
                    limit: aiChatBootstrapPageLimit,
                    resumeAttemptDiagnostics: nil
                )
                self.applyBootstrap(response)
                self.attachBootstrapLiveIfNeeded(response: response, session: session, resumeAttemptDiagnostics: nil)
            } catch {
                self.clearActiveRunTracking(resetComposer: true)
                self.showGeneralError(error: error)
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
                limit: aiChatBootstrapPageLimit,
                resumeAttemptDiagnostics: nil
            )
            self.applyBootstrap(response)

            if let errorMessage = aiChatLatestAssistantErrorMessage(messages: response.conversation.messages) {
                self.transitionToIdle()
                self.showGeneralError(message: errorMessage)
                return
            }

            if response.activeRun != nil {
                self.attachBootstrapLiveIfNeeded(response: response, session: session, resumeAttemptDiagnostics: nil)
                return
            }

            self.transitionToIdle()
            if self.messages.last.map({ message in
                message.role == .assistant && isOptimisticAIChatStatusContent(content: message.content)
            }) == true {
                self.markAssistantError(message: fallbackMessage)
            }
        } catch {
            self.clearActiveRunTracking(resetComposer: true)
            self.showGeneralError(error: error)
        }
    }

    func reconcileUnexpectedLiveStreamEnd(sessionId: String) async {
        do {
            let session = try await self.flashcardsStore.cloudSessionForAI()
            let response = try await self.chatService.loadBootstrap(
                session: session,
                sessionId: sessionId,
                limit: aiChatBootstrapPageLimit,
                resumeAttemptDiagnostics: nil
            )
            self.applyBootstrap(response)

            if let errorMessage = aiChatLatestAssistantErrorMessage(messages: response.conversation.messages) {
                self.transitionToIdle()
                self.showGeneralError(message: errorMessage)
                return
            }

            if response.activeRun != nil {
                self.attachBootstrapLiveIfNeeded(response: response, session: session, resumeAttemptDiagnostics: nil)
                return
            }
        } catch {
            self.clearActiveRunTracking(resetComposer: true)
            self.showGeneralError(error: error)
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

private extension AIChatStore {
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
        case .image, .file, .toolCall, .accountUpgradePrompt:
            return true
        }
    }
}
