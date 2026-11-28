import Foundation

extension AIChatStore {
    func currentFailedLiveOptimisticFallbackAnchor() -> AIChatFailedLiveOptimisticFallbackAnchor? {
        guard let optimisticTurn = self.currentOptimisticOutgoingTurn() else {
            return nil
        }

        let previousMessageId: String?
        if self.messages.count > 2 {
            previousMessageId = self.messages[self.messages.count - 3].id
        } else {
            previousMessageId = nil
        }

        return AIChatFailedLiveOptimisticFallbackAnchor(
            userMessageId: optimisticTurn.userMessage.id,
            assistantMessageId: optimisticTurn.assistantMessage.id,
            previousMessageId: previousMessageId
        )
    }

    func currentOptimisticOutgoingTurn(
        matching fallbackAnchor: AIChatFailedLiveOptimisticFallbackAnchor
    ) -> AIChatOptimisticOutgoingTurn? {
        guard let optimisticTurn = self.currentOptimisticOutgoingTurn() else {
            return nil
        }
        guard optimisticTurn.userMessage.id == fallbackAnchor.userMessageId else {
            return nil
        }
        guard optimisticTurn.assistantMessage.id == fallbackAnchor.assistantMessageId else {
            return nil
        }

        return optimisticTurn
    }

    func setChatVisibility(isVisible: Bool) {
        if isVisible {
            if self.shouldAutoStartFreshLocalSession(persistedState: self.currentPersistedState()) {
                self.startFreshLocalSession(
                    inputText: "",
                    pendingAttachments: []
                )
                return
            }
            self.resumeVisibleSessionIfNeeded()
            return
        }

        Task {
            await self.runtime.detach()
        }
    }

    func applyBootstrap(_ response: AIChatBootstrapResponse) {
        guard self.canApplyBootstrapResponse(response) else {
            return
        }

        if self.isLiveReconciliationPending {
            self.pendingLiveReconciliationScope = nil
        }
        self.applyEnvelope(response)
        self.markRunHadToolCallsFromSnapshot(
            activeRun: response.activeRun,
            messages: response.conversation.messages
        )
        if response.activeRun == nil {
            self.syncLinkedDataAfterTerminalRunIfNeeded()
        }
    }

    func attachBootstrapLiveIfNeeded(
        response: AIChatBootstrapResponse,
        session: CloudLinkedSession,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) {
        guard self.canApplyBootstrapResponse(response) else {
            self.activeLiveResumeAttemptSequence = nil
            Task {
                await self.runtime.detach()
            }
            return
        }
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

        let scope = self.currentSessionScope()
        self.activeLiveResumeAttemptSequence = resumeAttemptDiagnostics?.sequence
        Task { [self] in
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
                    await self?.handleLiveStreamTermination(termination, scope: scope, runId: activeRun.runId)
                }
            )
        }
    }

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

        let scope = self.currentSessionScope()
        let afterCursor = self.liveCursor
        self.activeLiveResumeAttemptSequence = nil
        Task { [self] in
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                guard self.shouldKeepLiveAttached else {
                    await self.runtime.detach()
                    return
                }
                guard scope == self.currentSessionScope(), self.activeRunId == activeRunId else {
                    return
                }
                await self.runtime.detach()
                await self.runtime.attachLive(
                    liveStream: liveStream,
                    sessionId: scope.sessionId,
                    runId: activeRunId,
                    afterCursor: afterCursor,
                    configurationMode: session.configurationMode,
                    resumeAttemptDiagnostics: nil,
                    eventHandler: { [weak self] event in
                        await self?.handleLiveEvent(event)
                    },
                    completionHandler: { [weak self] termination in
                        await self?.handleLiveStreamTermination(termination, scope: scope, runId: activeRunId)
                    }
                )
            } catch {
                self.recordLiveReconciliationFailure(error, scope: scope, runId: activeRunId)
            }
        }
    }

    func nextResumeAttemptDiagnostics() -> AIChatResumeAttemptDiagnostics {
        self.nextResumeAttemptSequence += 1
        return AIChatResumeAttemptDiagnostics(sequence: self.nextResumeAttemptSequence)
    }

    func clearStaleResumeErrorIfNeeded(connectedResumeAttemptSequence: Int?) {
        guard let connectedResumeAttemptSequence else {
            return
        }
        guard let activeResumeErrorAttemptSequence = self.activeResumeErrorAttemptSequence else {
            return
        }
        guard activeResumeErrorAttemptSequence < connectedResumeAttemptSequence else {
            return
        }
        guard case .generalError(_, let message) = self.activeAlert,
              message == "AI live stream is unavailable for the active run."
        else {
            return
        }

        self.activeResumeErrorAttemptSequence = nil
        self.activeAlert = nil
    }

    func resumeVisibleSessionIfNeeded() {
        guard self.shouldKeepLiveAttached else {
            return
        }
        guard self.isChatInteractive else {
            return
        }
        guard self.activeNewSessionTask == nil else {
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

        guard self.activeAttachmentTransferCount == 0 else {
            self.resumesAfterAttachmentTransfer = true
            return
        }
        let resumeAttemptDiagnostics = self.nextResumeAttemptDiagnostics()
        if self.isLiveReconciliationPending || self.activeRunId != nil || self.pendingToolRunPostSync {
            self.pendingLiveReconciliationScope = self.currentSessionScope()
            self.startLiveConversationReconciliation(resumeAttemptDiagnostics: resumeAttemptDiagnostics)
            return
        }
        self.startLinkedBootstrap(
            forceReloadState: false,
            resumeAttemptDiagnostics: resumeAttemptDiagnostics
        )
    }

    var isLiveReconciliationPending: Bool {
        self.pendingLiveReconciliationScope == self.currentSessionScope()
    }

    func reloadConversationFromBootstrap() {
        self.pendingLiveReconciliationScope = self.currentSessionScope()
        self.retryLiveConversationReconciliation()
    }

    func retryLiveConversationReconciliation() {
        self.startLiveConversationReconciliation(resumeAttemptDiagnostics: nil)
    }

    private func startLiveConversationReconciliation(
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) {
        guard self.hasExternalProviderConsent, self.activeBootstrapTask == nil,
              let scope = self.pendingLiveReconciliationScope,
              scope == self.currentSessionScope() else {
            return
        }

        self.invalidateActivePassiveSnapshotRefreshTask()
        let requestSequence = self.beginBootstrapRequestSequence()
        let runId = self.activeRunId
        self.activeBootstrapTask = Task {
            defer {
                if self.isCurrentBootstrapRequest(sequence: requestSequence) {
                    self.activeBootstrapTask = nil
                }
            }

            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                guard self.isCurrentBootstrapRequest(sequence: requestSequence),
                      scope == self.currentSessionScope() else {
                    return
                }
                try self.flashcardsStore.cloudRuntime.checkCurrentLinkedSyncSession(linkedSession: session)
                let response = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: scope.sessionId,
                    limit: aiChatBootstrapPageLimit,
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics
                )
                guard self.isCurrentBootstrapRequest(sequence: requestSequence),
                      scope == self.currentSessionScope(),
                      scope == self.pendingLiveReconciliationScope,
                      self.activeRunId == runId || self.activeRunId == response.activeRun?.runId else {
                    return
                }
                try self.flashcardsStore.cloudRuntime.checkCurrentLinkedSyncSession(linkedSession: session)
                try validateAIChatBootstrapSessionContract(
                    response: response,
                    requestedSessionId: scope.sessionId
                )
                self.applyBootstrap(response)
                self.bootstrapPhase = .ready
                self.lastBootstrapFailureWasRetryable = false
                self.attachBootstrapLiveIfNeeded(
                    response: response,
                    session: session,
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics
                )
            } catch {
                guard self.isCurrentBootstrapRequest(sequence: requestSequence),
                      scope == self.currentSessionScope(),
                      isAIChatRequestCancellationError(error: error) == false else {
                    return
                }
                self.showGeneralError(error: error)
            }
        }
    }

    func handleLiveStreamTermination(
        _ termination: AIChatLiveAttachTermination,
        scope: AIChatSessionScope,
        runId: String
    ) async {
        guard self.canReconcileLiveStream(scope: scope, runId: runId) else {
            return
        }
        switch termination {
        case .sawTerminalEvent(_, _):
            return
        case .failed(let message, let requestId, let clientRequestId):
            await self.reconcileFailedLiveStreamTermination(
                sessionId: scope.sessionId,
                requestId: requestId,
                clientRequestId: clientRequestId,
                fallbackMessage: message
            )
        case .endedWithoutTerminalEvent(let requestId, let clientRequestId):
            await self.reconcileUnexpectedLiveStreamEnd(
                sessionId: scope.sessionId,
                requestId: requestId,
                clientRequestId: clientRequestId
            )
        }
    }

    func reconcileFailedLiveStreamTermination(
        sessionId: String,
        requestId: String?,
        clientRequestId: String?,
        fallbackMessage: String
    ) async {
        let scope = self.currentSessionScope()
        guard scope.sessionId == sessionId, let runId = self.activeRunId else {
            return
        }
        let fallbackAnchor = self.currentFailedLiveOptimisticFallbackAnchor()
        do {
            let session = try await self.flashcardsStore.cloudSessionForAI()
            let response = try await self.chatService.loadBootstrap(
                session: session,
                sessionId: sessionId,
                limit: aiChatBootstrapPageLimit,
                resumeAttemptDiagnostics: nil
            )
            guard self.canReconcileLiveStream(scope: scope, runId: runId) else {
                return
            }
            if let fallbackAnchor {
                guard self.currentOptimisticOutgoingTurn(matching: fallbackAnchor) != nil else {
                    return
                }
            }
            try validateAIChatBootstrapSessionContract(
                response: response,
                requestedSessionId: sessionId
            )

            if response.activeRun != nil {
                self.applyBootstrap(response)
                self.attachBootstrapLiveIfNeeded(response: response, session: session, resumeAttemptDiagnostics: nil)
                return
            }

            if let errorMessage = aiChatLatestAssistantErrorMessage(messages: response.conversation.messages) {
                let reconciledAfterCursor: String? = self.liveCursor
                self.applyBootstrap(response)
                self.transitionToIdle()
                self.showLiveReconciledError(
                    message: errorMessage,
                    errorCode: aiChatTerminalAlertErrorCode(eventMessage: nil, messages: response.conversation.messages),
                    sessionId: sessionId,
                    runId: runId,
                    afterCursor: reconciledAfterCursor,
                    requestId: requestId,
                    clientRequestId: clientRequestId,
                    eventType: "failed_stream_reconcile_error"
                )
                return
            }

            let shouldApplyOptimisticFallback = fallbackAnchor.map { fallbackAnchor in
                aiChatShouldApplyFailedLiveOptimisticFallback(
                    responseMessages: response.conversation.messages,
                    fallbackAnchor: fallbackAnchor
                )
            } ?? false
            if shouldApplyOptimisticFallback {
                self.captureLiveOptimisticFallbackFailure(
                    sessionId: sessionId,
                    runId: runId,
                    afterCursor: self.liveCursor,
                    requestId: requestId,
                    clientRequestId: clientRequestId
                )
                self.applyBootstrapMetadataPreservingMessages(response)
                self.transitionToIdle()
                self.markAssistantError(message: fallbackMessage)
                self.schedulePersistCurrentState()
                return
            }

            self.applyBootstrap(response)
            self.transitionToIdle()
        } catch {
            self.recordLiveReconciliationFailure(error, scope: scope, runId: runId)
        }
    }

    private func reconcileUnexpectedLiveStreamEnd(
        sessionId: String,
        requestId: String?,
        clientRequestId: String?
    ) async {
        let scope = self.currentSessionScope()
        guard scope.sessionId == sessionId, let runId = self.activeRunId else {
            return
        }
        do {
            let session = try await self.flashcardsStore.cloudSessionForAI()
            let response = try await self.chatService.loadBootstrap(
                session: session,
                sessionId: sessionId,
                limit: aiChatBootstrapPageLimit,
                resumeAttemptDiagnostics: nil
            )
            guard self.canReconcileLiveStream(scope: scope, runId: runId) else {
                return
            }
            try validateAIChatBootstrapSessionContract(
                response: response,
                requestedSessionId: sessionId
            )
            let reconciledAfterCursor: String? = self.liveCursor
            self.applyBootstrap(response)

            if response.activeRun != nil {
                self.attachBootstrapLiveIfNeeded(response: response, session: session, resumeAttemptDiagnostics: nil)
                return
            }

            if let errorMessage = aiChatLatestAssistantErrorMessage(messages: response.conversation.messages) {
                self.transitionToIdle()
                self.showLiveReconciledError(
                    message: errorMessage,
                    errorCode: aiChatTerminalAlertErrorCode(eventMessage: nil, messages: response.conversation.messages),
                    sessionId: sessionId,
                    runId: runId,
                    afterCursor: reconciledAfterCursor,
                    requestId: requestId,
                    clientRequestId: clientRequestId,
                    eventType: "unexpected_stream_end_reconcile_error"
                )
            }
        } catch {
            self.recordLiveReconciliationFailure(error, scope: scope, runId: runId)
        }
    }

    private func canReconcileLiveStream(scope: AIChatSessionScope, runId: String) -> Bool {
        Task.isCancelled == false && self.shouldKeepLiveAttached
            && scope == self.currentSessionScope() && runId == self.activeRunId
    }

    private func recordLiveReconciliationFailure(_ error: Error, scope: AIChatSessionScope, runId: String) {
        guard self.canReconcileLiveStream(scope: scope, runId: runId),
              isAIChatRequestCancellationError(error: error) == false else {
            return
        }
        self.pendingLiveReconciliationScope = scope
        self.showGeneralError(error: error)
    }
}

extension AIChatStore {
    func applyBootstrapMetadataPreservingMessages(_ response: AIChatBootstrapResponse) {
        guard self.canApplyBootstrapResponse(response) else {
            return
        }

        self.chatSessionId = response.sessionId
        self.conversationScopeId = response.conversationScopeId
        self.requiresRemoteSessionProvisioning = false
        self.serverChatConfig = response.chatConfig
        self.applyCustomInstructionsReading(response.customInstructions)
        self.applyComposerSuggestions(response.composerSuggestions)
        self.hasOlderMessages = response.conversation.hasOlder
        self.oldestCursor = response.conversation.oldestCursor
        self.repairStatus = nil
    }

    func canApplyBootstrapResponse(_ response: AIChatBootstrapResponse) -> Bool {
        let expectedSessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId
        )
        let expectedConversationScopeId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.conversationScopeId
        )

        if expectedSessionId.isEmpty && expectedConversationScopeId.isEmpty {
            return true
        }

        let responseSessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: response.sessionId
        )
        let responseConversationScopeId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: response.conversationScopeId
        )
        guard responseSessionId == expectedSessionId,
              responseConversationScopeId == expectedConversationScopeId
        else {
            logAIChatStoreEvent(
                action: "ai_bootstrap_session_contract_mismatch",
                metadata: [
                    "expectedSessionId": expectedSessionId,
                    "expectedConversationScopeId": expectedConversationScopeId,
                    "actualSessionId": responseSessionId,
                    "actualConversationScopeId": responseConversationScopeId
                ]
            )
            return false
        }

        return true
    }
}

struct AIChatFailedLiveOptimisticFallbackAnchor {
    let userMessageId: String
    let assistantMessageId: String
    let previousMessageId: String?
}

/// The latest assistant error message's code, used only when the terminal event names no other failure:
/// a different event message is a newer failure, such as a lost live poll, that has no stored error message.
func aiChatTerminalAlertErrorCode(eventMessage: String?, messages: [AIChatMessage]) -> String? {
    guard let assistantMessage = messages.last(where: { $0.role == .assistant && $0.isError }) else {
        return nil
    }

    let trimmedEventMessage = eventMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard trimmedEventMessage.isEmpty || trimmedEventMessage == aiChatMessageText(message: assistantMessage) else {
        return nil
    }

    return assistantMessage.errorCode
}

func aiChatLatestAssistantErrorMessage(messages: [AIChatMessage]) -> String? {
    guard let assistantMessage = messages.last(where: { $0.role == .assistant && $0.isError }) else {
        return nil
    }

    let message = aiChatMessageText(message: assistantMessage)
    return message.isEmpty ? nil : message
}

func aiChatMessageText(message: AIChatMessage) -> String {
    message.content.reduce(into: "") { result, part in
        if case .text(let text) = part {
            result.append(text)
        }
    }.trimmingCharacters(in: .whitespacesAndNewlines)
}

func aiChatShouldApplyFailedLiveOptimisticFallback(
    responseMessages: [AIChatMessage],
    fallbackAnchor: AIChatFailedLiveOptimisticFallbackAnchor
) -> Bool {
    let messagesAfterAnchor: ArraySlice<AIChatMessage>
    if let previousMessageId = fallbackAnchor.previousMessageId {
        guard let previousMessageIndex = responseMessages.lastIndex(where: { message in
            message.id == previousMessageId
        }) else {
            return true
        }
        let nextMessageIndex = responseMessages.index(after: previousMessageIndex)
        messagesAfterAnchor = responseMessages[nextMessageIndex...]
    } else {
        messagesAfterAnchor = responseMessages[responseMessages.startIndex...]
    }

    return messagesAfterAnchor.contains(where: { message in
        message.role == .assistant
    }) == false
}

func validateAIChatBootstrapSessionContract(
    response: AIChatBootstrapResponse,
    requestedSessionId: String
) throws {
    let expectedSessionId = aiChatResolvedSessionId(
        workspaceId: nil,
        sessionId: requestedSessionId
    )
    let actualSessionId = aiChatResolvedSessionId(
        workspaceId: nil,
        sessionId: response.sessionId
    )
    let actualConversationScopeId = aiChatResolvedSessionId(
        workspaceId: nil,
        sessionId: response.conversationScopeId
    )

    guard expectedSessionId.isEmpty == false else {
        throw LocalStoreError.validation(
            "AI chat bootstrap validation requires a requested session id."
        )
    }

    guard actualSessionId == expectedSessionId,
          actualConversationScopeId == expectedSessionId
    else {
        throw LocalStoreError.validation(
            """
            AI chat bootstrap returned an unexpected session contract. \
            expectedSessionId=\(expectedSessionId) \
            actualSessionId=\(actualSessionId) \
            actualConversationScopeId=\(actualConversationScopeId)
            """
        )
    }
}
