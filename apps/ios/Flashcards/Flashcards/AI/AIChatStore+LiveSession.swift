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
        if self.shouldKeepLiveAttached == isVisible {
            return
        }

        self.shouldKeepLiveAttached = isVisible

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
                if isAIChatRequestCancellationError(error: error) {
                    return
                }
                guard self.shouldKeepLiveAttached else {
                    return
                }
                self.clearActiveRunTracking(resetComposer: true)
                self.showGeneralError(error: error)
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

        self.startLinkedBootstrap(
            forceReloadState: false,
            resumeAttemptDiagnostics: self.nextResumeAttemptDiagnostics()
        )
    }

    func reloadConversationFromBootstrap() {
        Task {
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let requestedSessionId = try await self.ensureRemoteSessionIfNeeded(session: session)
                let response = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: requestedSessionId,
                    limit: aiChatBootstrapPageLimit,
                    resumeAttemptDiagnostics: nil
                )
                guard self.shouldKeepLiveAttached else {
                    return
                }
                guard self.chatSessionId == requestedSessionId else {
                    return
                }
                self.applyBootstrap(response)
                self.attachBootstrapLiveIfNeeded(
                    response: response,
                    session: session,
                    resumeAttemptDiagnostics: nil
                )
            } catch {
                if isAIChatRequestCancellationError(error: error) {
                    return
                }
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
        let fallbackAnchor = self.currentFailedLiveOptimisticFallbackAnchor()
        do {
            let session = try await self.flashcardsStore.cloudSessionForAI()
            let response = try await self.chatService.loadBootstrap(
                session: session,
                sessionId: sessionId,
                limit: aiChatBootstrapPageLimit,
                resumeAttemptDiagnostics: nil
            )
            guard self.shouldKeepLiveAttached else {
                return
            }
            guard self.chatSessionId == sessionId else {
                return
            }
            if let fallbackAnchor {
                guard self.currentOptimisticOutgoingTurn(matching: fallbackAnchor) != nil else {
                    return
                }
            }

            if let errorMessage = aiChatLatestAssistantErrorMessage(messages: response.conversation.messages) {
                self.applyBootstrap(response)
                self.transitionToIdle()
                self.showGeneralError(message: errorMessage)
                return
            }

            if response.activeRun != nil {
                self.applyBootstrap(response)
                self.attachBootstrapLiveIfNeeded(response: response, session: session, resumeAttemptDiagnostics: nil)
                return
            }

            let shouldApplyOptimisticFallback = fallbackAnchor.map { fallbackAnchor in
                aiChatShouldApplyFailedLiveOptimisticFallback(
                    responseMessages: response.conversation.messages,
                    fallbackAnchor: fallbackAnchor
                )
            } ?? false
            if shouldApplyOptimisticFallback {
                self.applyBootstrapMetadataPreservingMessages(response)
                self.transitionToIdle()
                self.markAssistantError(message: fallbackMessage)
                self.schedulePersistCurrentState()
                return
            }

            self.applyBootstrap(response)
            self.transitionToIdle()
        } catch {
            if isAIChatRequestCancellationError(error: error) {
                return
            }
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
            guard self.shouldKeepLiveAttached else {
                return
            }
            guard self.chatSessionId == sessionId else {
                return
            }
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
            if isAIChatRequestCancellationError(error: error) {
                return
            }
            self.clearActiveRunTracking(resetComposer: true)
            self.showGeneralError(error: error)
        }
    }
}

extension AIChatStore {
    func applyBootstrapMetadataPreservingMessages(_ response: AIChatBootstrapResponse) {
        self.chatSessionId = response.sessionId
        self.conversationScopeId = response.conversationScopeId
        self.requiresRemoteSessionProvisioning = false
        self.serverChatConfig = response.chatConfig
        self.applyComposerSuggestions(response.composerSuggestions)
        self.hasOlderMessages = response.conversation.hasOlder
        self.oldestCursor = response.conversation.oldestCursor
        self.repairStatus = nil
    }
}

struct AIChatFailedLiveOptimisticFallbackAnchor {
    let userMessageId: String
    let assistantMessageId: String
    let previousMessageId: String?
}

func aiChatLatestAssistantErrorMessage(messages: [AIChatMessage]) -> String? {
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
